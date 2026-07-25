import type { QueryConfig } from '../query/config.js'
import type { QueryDeps } from '../query/deps.js'
import type { AssistantMessage, AttachmentMessage } from '../types/message.js'
import {
  createCoreCompactionDeps,
  type CoreCompactionOptions,
} from './runtime/compaction.js'

/**
 * Model transport is the only unavoidable host capability. Portable
 * compaction is installed below; product/host integrations default to no-op.
 */
export type CoreRequiredDeps = Pick<QueryDeps, 'callModel'>

export type CoreDepsOptions = CoreRequiredDeps &
  Partial<Omit<QueryDeps, keyof CoreRequiredDeps>> & {
    compaction?: CoreCompactionOptions
  }

function fallbackUUID(): string {
  const crypto = globalThis.crypto
  if (crypto?.randomUUID) return crypto.randomUUID()

  // RFC 4122-shaped fallback for runtimes without Web Crypto. Hosts that need
  // stronger guarantees can override QueryDeps.uuid.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, char => {
    const value = Math.floor(Math.random() * 16)
    const nibble = char === 'x' ? value : (value & 0x3) | 0x8
    return nibble.toString(16)
  })
}

const noOp = () => {}

const createAttachmentMessage = ((
  attachment: Parameters<QueryDeps['createAttachmentMessage']>[0],
): AttachmentMessage => ({
  attachment,
  type: 'attachment',
  uuid: fallbackUUID() as AttachmentMessage['uuid'],
  timestamp: new Date().toISOString(),
})) as QueryDeps['createAttachmentMessage']

const getAttachmentMessages = (async function* () {
  // Host attachment providers can yield IDE, memory, task, or MCP context.
}) as QueryDeps['getAttachmentMessages']

const handleStopHooks = (async function* () {
  return {
    blockingErrors: [],
    preventContinuation: false,
  }
}) as QueryDeps['handleStopHooks']

const isPromptTooLongMessage = ((
  message: AssistantMessage,
): boolean => {
  if (!message?.isApiErrorMessage) return false
  const content = message.message.content
  return (
    Array.isArray(content) &&
    content.some(
      block =>
        block.type === 'text' && block.text.startsWith('Prompt is too long'),
    )
  )
}) as QueryDeps['isPromptTooLongMessage']

function lastUsage(messages: unknown[]): Record<string, unknown> | undefined {
  for (let index = messages.length - 1; index >= 0; index--) {
    const candidate = messages[index] as {
      type?: string
      message?: { usage?: Record<string, unknown> }
    }
    if (candidate?.type === 'assistant' && candidate.message?.usage) {
      return candidate.message.usage
    }
  }
  return undefined
}

const finalContextTokensFromLastResponse = ((
  messages: unknown[],
): number => {
  const usage = lastUsage(messages)
  if (!usage) return 0

  const iterations = usage.iterations as
    | Array<{ input_tokens?: number; output_tokens?: number }>
    | undefined
  const finalIteration = iterations?.at(-1)
  if (finalIteration) {
    return (
      (finalIteration.input_tokens ?? 0) +
      (finalIteration.output_tokens ?? 0)
    )
  }
  return (
    Number(usage.input_tokens ?? 0) + Number(usage.output_tokens ?? 0)
  )
}) as QueryDeps['finalContextTokensFromLastResponse']

const doesMostRecentAssistantMessageExceed200k = ((
  messages: unknown[],
): boolean => {
  const usage = lastUsage(messages)
  if (!usage) return false
  return (
    Number(usage.input_tokens ?? 0) +
      Number(usage.cache_creation_input_tokens ?? 0) +
      Number(usage.cache_read_input_tokens ?? 0) +
      Number(usage.output_tokens ?? 0) >
    200_000
  )
}) as QueryDeps['doesMostRecentAssistantMessageExceed200k']

/**
 * Fill Claude Code's existing flat QueryDeps seam with portable defaults.
 *
 * Memory, hooks, queues, persistence, telemetry, and UI policy remain
 * installable host capabilities. Passing an override enables that capability
 * without changing query(), Tool[], or the message protocol.
 */
export function createCoreDeps(options: CoreDepsOptions): QueryDeps {
  const uuid = options.uuid ?? fallbackUUID
  const { compaction, ...overrides } = options
  const compactDefaults = createCoreCompactionDeps(
    options.callModel,
    compaction,
  )

  const defaults = {
    createAttachmentMessage,
    filterDuplicateMemoryAttachments: (attachments: unknown[]) => attachments,
    getAttachmentMessages,
    startRelevantMemoryPrefetch: () => undefined,
    handleStopHooks,
    executePostSamplingHooks: noOp,
    executeStopFailureHooks: noOp,
    applyToolResultBudget: async (messages: unknown[]) => messages,
    recordContentReplacement: async () => {},
    getCommandsByMaxPriority: () => [],
    isSlashCommand: () => false,
    removeFromQueue: noOp,
    notifyCommandLifecycle: noOp,
    createDumpPromptsFetch: () => undefined,
    generateToolUseSummary: async () => null,
    getRuntimeMainLoopModel: ({
      mainLoopModel,
    }: {
      mainLoopModel: string
    }) => mainLoopModel,
    renderModelName: (model: string) => model,
    isPromptTooLongMessage,
    promptTooLongErrorMessage: 'Prompt is too long',
    doesMostRecentAssistantMessageExceed200k,
    finalContextTokensFromLastResponse,
    getCurrentTurnTokenBudget: () => undefined,
    getTurnOutputTokens: () => 0,
    incrementBudgetContinuationCount: noOp,
    logEvent: noOp,
    logError: noOp,
    logAntError: noOp,
    logForDebugging: noOp,
    headlessProfilerCheckpoint: noOp,
    queryCheckpoint: noOp,
    buildConfig: () =>
      ({
        sessionId: uuid(),
        gates: {
          streamingToolExecution: false,
          emitToolUseSummaries: false,
          isAnt: false,
          fastModeEnabled: false,
          maxOutputTokensEscalationEnabled: false,
        },
      }) as QueryConfig,
    uuid,
  } as unknown as Omit<QueryDeps, keyof CoreRequiredDeps>

  return {
    ...compactDefaults,
    ...defaults,
    ...overrides,
  } as QueryDeps
}
