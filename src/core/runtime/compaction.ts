import type { BetaUsage as Usage } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import type { QuerySource } from '../../constants/querySource.js'
import type { QueryDeps } from '../../query/deps.js'
import type { ToolUseContext } from '../../Tool.js'
import type {
  AssistantMessage,
  Message,
  SystemCompactBoundaryMessage,
  UserMessage,
} from '../../types/message.js'
import {
  getCompactPrompt,
  getCompactUserSummaryMessage,
} from '../../services/compact/prompt.js'
import { groupMessagesByApiRound } from '../../services/compact/grouping.js'
import { asSystemPrompt } from '../../utils/systemPromptType.js'
import {
  createCompactBoundaryMessage,
  createUserMessage,
} from './messages.js'

const DEFAULT_CONTEXT_WINDOW = 200_000
const DEFAULT_MAX_SUMMARY_OUTPUT_TOKENS = 20_000
const DEFAULT_AUTOCOMPACT_BUFFER_TOKENS = 13_000
const DEFAULT_WARNING_BUFFER_TOKENS = 20_000
const DEFAULT_ERROR_BUFFER_TOKENS = 20_000
const DEFAULT_BLOCKING_BUFFER_TOKENS = 3_000
const MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES = 3
const MAX_PROMPT_TOO_LONG_RETRIES = 3
const MEDIA_TOKEN_ESTIMATE = 2_000
const PROMPT_TOO_LONG_PREFIX = 'Prompt is too long'
const PROMPT_TOO_LONG_RETRY_MARKER =
  '[earlier conversation truncated for compaction retry]'

export type CoreCompactionOptions = {
  /**
   * Claude Code's default context window is 200k. Hosts using a different
   * model can provide either a fixed value or a model-aware resolver.
   */
  contextWindow?: number | ((model: string) => number)
  enabled?: boolean
  maxSummaryOutputTokens?: number
  autoCompactBufferTokens?: number
  warningBufferTokens?: number
  errorBufferTokens?: number
  blockingBufferTokens?: number
  customInstructions?: string
}

type ResolvedCoreCompactionOptions = {
  contextWindow: number | ((model: string) => number)
  enabled: boolean
  maxSummaryOutputTokens: number
  autoCompactBufferTokens: number
  warningBufferTokens: number
  errorBufferTokens: number
  blockingBufferTokens: number
  customInstructions?: string
}

type CoreCompactionDeps = Pick<
  QueryDeps,
  | 'microcompact'
  | 'autocompact'
  | 'buildPostCompactMessages'
  | 'calculateTokenWarningState'
  | 'isAutoCompactEnabled'
  | 'tokenCountWithEstimation'
>

type TokenUsageLike = {
  input_tokens?: number
  cache_creation_input_tokens?: number
  cache_read_input_tokens?: number
  output_tokens?: number
  iterations?: unknown
}

function positiveOr(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && value! > 0 ? value! : fallback
}

function nonNegativeOr(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && value! >= 0 ? value! : fallback
}

function resolveOptions(
  options: CoreCompactionOptions = {},
): ResolvedCoreCompactionOptions {
  return {
    contextWindow: options.contextWindow ?? DEFAULT_CONTEXT_WINDOW,
    enabled: options.enabled ?? true,
    maxSummaryOutputTokens: positiveOr(
      options.maxSummaryOutputTokens,
      DEFAULT_MAX_SUMMARY_OUTPUT_TOKENS,
    ),
    autoCompactBufferTokens: nonNegativeOr(
      options.autoCompactBufferTokens,
      DEFAULT_AUTOCOMPACT_BUFFER_TOKENS,
    ),
    warningBufferTokens: nonNegativeOr(
      options.warningBufferTokens,
      DEFAULT_WARNING_BUFFER_TOKENS,
    ),
    errorBufferTokens: nonNegativeOr(
      options.errorBufferTokens,
      DEFAULT_ERROR_BUFFER_TOKENS,
    ),
    blockingBufferTokens: nonNegativeOr(
      options.blockingBufferTokens,
      DEFAULT_BLOCKING_BUFFER_TOKENS,
    ),
    customInstructions: options.customInstructions,
  }
}

function contextWindowForModel(
  model: string,
  options: ResolvedCoreCompactionOptions,
): number {
  const configured =
    typeof options.contextWindow === 'function'
      ? options.contextWindow(model)
      : options.contextWindow
  return positiveOr(configured, DEFAULT_CONTEXT_WINDOW)
}

function effectiveContextWindow(
  model: string,
  options: ResolvedCoreCompactionOptions,
): number {
  const contextWindow = contextWindowForModel(model, options)
  return Math.max(
    1,
    contextWindow -
      Math.min(contextWindow - 1, options.maxSummaryOutputTokens),
  )
}

function autoCompactThreshold(
  model: string,
  options: ResolvedCoreCompactionOptions,
): number {
  return Math.max(
    1,
    effectiveContextWindow(model, options) -
      options.autoCompactBufferTokens,
  )
}

function stringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? ''
  } catch {
    return String(value)
  }
}

export function roughTokenCount(content: string): number {
  return Math.round(content.length / 4)
}

function roughTokenCountForContent(content: unknown): number {
  if (!content) return 0
  if (typeof content === 'string') return roughTokenCount(content)
  if (!Array.isArray(content)) return roughTokenCount(stringify(content))

  let total = 0
  for (const block of content) {
    if (typeof block === 'string') {
      total += roughTokenCount(block)
      continue
    }
    if (!block || typeof block !== 'object') {
      total += roughTokenCount(stringify(block))
      continue
    }

    const typed = block as Record<string, unknown>
    switch (typed.type) {
      case 'text':
        total += roughTokenCount(String(typed.text ?? ''))
        break
      case 'thinking':
        total += roughTokenCount(String(typed.thinking ?? ''))
        break
      case 'redacted_thinking':
        total += roughTokenCount(String(typed.data ?? ''))
        break
      case 'image':
      case 'document':
        total += MEDIA_TOKEN_ESTIMATE
        break
      case 'tool_result':
        total += roughTokenCountForContent(typed.content)
        break
      case 'tool_use':
        total += roughTokenCount(
          String(typed.name ?? '') + stringify(typed.input ?? {}),
        )
        break
      default:
        total += roughTokenCount(stringify(typed))
        break
    }
  }
  return total
}

export function roughTokenCountForMessages(
  messages: readonly Message[],
): number {
  let total = 0
  for (const message of messages) {
    if (message.type === 'assistant' || message.type === 'user') {
      total += roughTokenCountForContent(message.message.content)
    } else if (message.type === 'attachment') {
      total += roughTokenCount(stringify(message.attachment))
    }
  }
  return total
}

function usageTokenCount(usage: TokenUsageLike): number {
  const iterations = usage.iterations
  if (Array.isArray(iterations) && iterations.length > 0) {
    const finalIteration = iterations.at(-1)
    if (finalIteration && typeof finalIteration === 'object') {
      return usageTokenCount(finalIteration as TokenUsageLike)
    }
  }
  return (
    Number(usage.input_tokens ?? 0) +
    Number(usage.cache_creation_input_tokens ?? 0) +
    Number(usage.cache_read_input_tokens ?? 0) +
    Number(usage.output_tokens ?? 0)
  )
}

function assistantUsage(
  message: Message | undefined,
): TokenUsageLike | undefined {
  if (
    message?.type !== 'assistant' ||
    !message.message.usage ||
    typeof message.message.usage !== 'object'
  ) {
    return undefined
  }
  return message.message.usage as TokenUsageLike
}

/**
 * Extracted from Claude Code's canonical tokenCountWithEstimation strategy:
 * trust the most recent API usage, then estimate only messages added after it.
 */
export function coreTokenCountWithEstimation(
  messages: readonly Message[],
): number {
  let usageIndex = messages.length - 1
  while (usageIndex >= 0) {
    const message = messages[usageIndex]
    const usage = assistantUsage(message)
    if (message?.type === 'assistant' && usage) {
      const responseId = message.message.id
      let firstSiblingIndex = usageIndex
      for (let index = usageIndex - 1; index >= 0; index--) {
        const prior = messages[index]
        if (prior?.type === 'assistant') {
          if (prior.message.id === responseId) {
            firstSiblingIndex = index
          } else {
            break
          }
        }
      }
      return (
        usageTokenCount(usage) +
        roughTokenCountForMessages(messages.slice(firstSiblingIndex + 1))
      )
    }
    usageIndex--
  }
  return roughTokenCountForMessages(messages)
}

function stripMediaFromContent(content: unknown): unknown {
  if (!Array.isArray(content)) return content
  return content.map(block => {
    if (!block || typeof block !== 'object') return block
    const typed = block as Record<string, unknown>
    if (typed.type === 'image') return { type: 'text', text: '[image]' }
    if (typed.type === 'document') {
      return { type: 'text', text: '[document]' }
    }
    if (typed.type !== 'tool_result' || !Array.isArray(typed.content)) {
      return block
    }
    return {
      ...typed,
      content: typed.content.map(item => {
        if (!item || typeof item !== 'object') return item
        const nested = item as Record<string, unknown>
        if (nested.type === 'image') {
          return { type: 'text', text: '[image]' }
        }
        if (nested.type === 'document') {
          return { type: 'text', text: '[document]' }
        }
        return item
      }),
    }
  })
}

function stripMediaFromMessages(messages: Message[]): Message[] {
  return messages.map(message => {
    if (message.type !== 'user') return message
    const content = stripMediaFromContent(message.message.content)
    return content === message.message.content
      ? message
      : {
          ...message,
          message: { ...message.message, content },
        }
  })
}

function assistantText(message: AssistantMessage | undefined): string | null {
  if (!message || !Array.isArray(message.message.content)) return null
  const text = message.message.content
    .filter(
      (block): block is { type: 'text'; text: string } =>
        block?.type === 'text' && typeof block.text === 'string',
    )
    .map(block => block.text)
    .join('')
    .trim()
  return text || null
}

function promptTooLongTokenGap(
  response: AssistantMessage,
): number | undefined {
  const match = response.errorDetails?.match(
    /prompt is too long[^0-9]*(\d+)\s*tokens?\s*>\s*(\d+)/i,
  )
  if (!match) return undefined
  const gap = Number.parseInt(match[1]!, 10) - Number.parseInt(match[2]!, 10)
  return gap > 0 ? gap : undefined
}

/**
 * Claude Code's last-resort compaction recovery: remove complete oldest API
 * rounds, never arbitrary tool_use/tool_result fragments.
 */
export function truncateHeadForCompactRetry(
  messages: Message[],
  response: AssistantMessage,
): Message[] | null {
  const input =
    messages[0]?.type === 'user' &&
    messages[0].isMeta &&
    messages[0].message.content === PROMPT_TOO_LONG_RETRY_MARKER
      ? messages.slice(1)
      : messages
  const groups = groupMessagesByApiRound(input)
  if (groups.length < 2) return null

  const tokenGap = promptTooLongTokenGap(response)
  let dropCount = 0
  if (tokenGap !== undefined) {
    let removedTokens = 0
    for (const group of groups) {
      removedTokens += roughTokenCountForMessages(group)
      dropCount++
      if (removedTokens >= tokenGap) break
    }
  } else {
    dropCount = Math.max(1, Math.floor(groups.length * 0.2))
  }
  dropCount = Math.min(dropCount, groups.length - 1)
  if (dropCount < 1) return null

  const sliced = groups.slice(dropCount).flat()
  if (sliced[0]?.type === 'assistant') {
    return [
      createUserMessage({
        content: PROMPT_TOO_LONG_RETRY_MARKER,
        isMeta: true,
      }),
      ...sliced,
    ]
  }
  return sliced
}

async function generateSummary(
  messages: Message[],
  toolUseContext: ToolUseContext,
  callModel: QueryDeps['callModel'],
  options: ResolvedCoreCompactionOptions,
): Promise<AssistantMessage> {
  const summaryRequest = createUserMessage({
    content: getCompactPrompt(options.customInstructions),
  })
  let response: AssistantMessage | undefined

  const modelParams = {
    messages: [...stripMediaFromMessages(messages), summaryRequest],
    systemPrompt: asSystemPrompt([
      'You are a helpful AI assistant tasked with summarizing conversations.',
    ]),
    thinkingConfig: { type: 'disabled' as const },
    tools: [],
    signal: toolUseContext.abortController.signal,
    options: {
      async getToolPermissionContext() {
        return toolUseContext.getAppState().toolPermissionContext
      },
      model: toolUseContext.options.mainLoopModel,
      toolChoice: undefined,
      isNonInteractiveSession:
        toolUseContext.options.isNonInteractiveSession,
      hasAppendSystemPrompt: false,
      maxOutputTokensOverride: options.maxSummaryOutputTokens,
      querySource: 'compact' as QuerySource,
      agents: [],
      allowedAgentTypes: [],
      mcpTools: [],
      hasPendingMcpServers: false,
      skipCacheWrite: true,
      agentId: toolUseContext.agentId,
    },
  } as Parameters<QueryDeps['callModel']>[0]

  for await (const event of callModel(modelParams)) {
    if (event?.type === 'assistant') response = event
  }

  if (!response) {
    throw new Error('Compaction did not return a usable assistant message')
  }
  return response
}

function compactionUsage(
  response: AssistantMessage,
): Usage | undefined {
  const usage = response.message.usage
  return usage && typeof usage === 'object'
    ? (usage as Usage)
    : undefined
}

async function compactConversation(
  messages: Message[],
  toolUseContext: ToolUseContext,
  callModel: QueryDeps['callModel'],
  options: ResolvedCoreCompactionOptions,
): Promise<{
  boundaryMarker: SystemCompactBoundaryMessage
  summaryMessages: UserMessage[]
  attachments: []
  hookResults: []
  preCompactTokenCount: number
  postCompactTokenCount: number
  truePostCompactTokenCount: number
  compactionUsage?: Usage
}> {
  if (messages.length === 0) {
    throw new Error('Not enough messages to compact')
  }

  const preCompactTokenCount = coreTokenCountWithEstimation(messages)
  let messagesToSummarize = messages
  let response: AssistantMessage
  let summary: string | null
  let promptTooLongAttempts = 0
  for (;;) {
    response = await generateSummary(
      messagesToSummarize,
      toolUseContext,
      callModel,
      options,
    )
    summary = assistantText(response)
    if (!summary?.startsWith(PROMPT_TOO_LONG_PREFIX)) break

    promptTooLongAttempts++
    const truncated =
      promptTooLongAttempts <= MAX_PROMPT_TOO_LONG_RETRIES
        ? truncateHeadForCompactRetry(messagesToSummarize, response)
        : null
    if (!truncated) {
      throw new Error(PROMPT_TOO_LONG_PREFIX)
    }
    messagesToSummarize = truncated
  }
  if (
    !summary ||
    response.isApiErrorMessage ||
    summary.startsWith('API Error')
  ) {
    throw new Error(summary || 'Compaction returned no summary text')
  }

  const boundaryMarker = createCompactBoundaryMessage(
    'auto',
    preCompactTokenCount,
    messages.at(-1)?.uuid,
  )
  const summaryMessages = [
    createUserMessage({
      content: getCompactUserSummaryMessage(summary, true),
      isCompactSummary: true,
      isVisibleInTranscriptOnly: true,
    }),
  ]
  const usage = compactionUsage(response)
  const postCompactTokenCount = usage ? usageTokenCount(usage) : 0
  const truePostCompactTokenCount = roughTokenCountForMessages([
    boundaryMarker,
    ...summaryMessages,
  ])

  return {
    boundaryMarker,
    summaryMessages,
    attachments: [],
    hookResults: [],
    preCompactTokenCount,
    postCompactTokenCount,
    truePostCompactTokenCount,
    ...(usage && { compactionUsage: usage }),
  }
}

/**
 * Installs the portable implementations behind Claude Code's existing
 * QueryDeps seam. The query state machine and its compaction transitions stay
 * unchanged; only filesystem, feature-flag, and product hook work is omitted.
 */
export function createCoreCompactionDeps(
  callModel: QueryDeps['callModel'],
  configured: CoreCompactionOptions = {},
): CoreCompactionDeps {
  const options = resolveOptions(configured)

  const calculateTokenWarningState: QueryDeps['calculateTokenWarningState'] = (
    tokenUsage,
    model,
  ) => {
    const autoThreshold = autoCompactThreshold(model, options)
    const effectiveWindow = effectiveContextWindow(model, options)
    const threshold = options.enabled ? autoThreshold : effectiveWindow
    const percentLeft = Math.max(
      0,
      Math.round(((threshold - tokenUsage) / threshold) * 100),
    )
    return {
      percentLeft,
      isAboveWarningThreshold:
        tokenUsage >= Math.max(0, threshold - options.warningBufferTokens),
      isAboveErrorThreshold:
        tokenUsage >= Math.max(0, threshold - options.errorBufferTokens),
      isAboveAutoCompactThreshold:
        options.enabled && tokenUsage >= autoThreshold,
      isAtBlockingLimit:
        tokenUsage >=
        Math.max(1, effectiveWindow - options.blockingBufferTokens),
    }
  }

  const autocompact: QueryDeps['autocompact'] = async (
    messages,
    toolUseContext,
    _cacheSafeParams,
    querySource,
    tracking,
    snipTokensFreed = 0,
  ) => {
    if (
      !options.enabled ||
      querySource === 'compact' ||
      querySource === 'session_memory'
    ) {
      return { wasCompacted: false }
    }
    if (
      (tracking?.consecutiveFailures ?? 0) >=
      MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES
    ) {
      return { wasCompacted: false }
    }

    const tokenCount =
      coreTokenCountWithEstimation(messages) - snipTokensFreed
    const model = toolUseContext.options.mainLoopModel
    if (tokenCount < autoCompactThreshold(model, options)) {
      return { wasCompacted: false }
    }

    try {
      return {
        wasCompacted: true,
        compactionResult: await compactConversation(
          messages,
          toolUseContext,
          callModel,
          options,
        ),
        consecutiveFailures: 0,
      }
    } catch {
      return {
        wasCompacted: false,
        consecutiveFailures: (tracking?.consecutiveFailures ?? 0) + 1,
      }
    }
  }

  return {
    // Current external Claude Code builds also leave cached microcompact off;
    // full autocompaction below owns context pressure in the portable runtime.
    async microcompact(messages) {
      return { messages }
    },
    autocompact,
    buildPostCompactMessages(result) {
      return [
        result.boundaryMarker,
        ...result.summaryMessages,
        ...(result.messagesToKeep ?? []),
        ...result.attachments,
        ...result.hookResults,
      ]
    },
    calculateTokenWarningState,
    isAutoCompactEnabled: () => options.enabled,
    tokenCountWithEstimation: coreTokenCountWithEstimation,
  }
}
