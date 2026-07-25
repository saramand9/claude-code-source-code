import type {
  ContentBlockParam,
  ToolResultBlockParam,
  ToolUseBlock,
} from '@anthropic-ai/sdk/resources/index.mjs'
import type { UUID } from 'crypto'
import type { CanUseToolFn } from '../../hooks/useCanUseTool.js'
import {
  findToolByName,
  type Tool,
  type ToolProgressData,
  type ToolUseContext,
} from '../../Tool.js'
import type {
  AssistantMessage,
  Message,
  ProgressMessage,
  UserMessage,
} from '../../types/message.js'
import type {
  PermissionDecision,
  PermissionResult,
} from '../../types/permissions.js'

const CANCEL_MESSAGE =
  "The user doesn't want to take this action right now. STOP what you are doing and wait for the user to tell you how to proceed."
const INTERRUPT_MESSAGE_FOR_TOOL_USE = '[Request interrupted by user for tool use]'

/**
 * Kept for drop-in compatibility with modules that only use this display
 * threshold. The headless runtime itself does not execute or render hooks.
 */
export const HOOK_TIMING_DISPLAY_THRESHOLD_MS = 500

export type MessageUpdateLazy<M extends Message = Message> = {
  message: M
  contextModifier?: {
    toolUseID: string
    modifyContext: (context: ToolUseContext) => ToolUseContext
  }
}

/**
 * Kept as a type-only compatibility export for callers compiled against the
 * product tool executor. The core runtime does not inspect MCP transports.
 */
export type McpServerType =
  | 'stdio'
  | 'sse'
  | 'http'
  | 'ws'
  | 'sdk'
  | 'sse-ide'
  | 'ws-ide'
  | 'claudeai-proxy'
  | undefined

type ObjectInput = Record<string, unknown>

function createUUID(): UUID {
  const crypto = globalThis.crypto
  if (crypto?.randomUUID) {
    return crypto.randomUUID() as UUID
  }

  const bytes = new Uint8Array(16)
  if (crypto?.getRandomValues) {
    crypto.getRandomValues(bytes)
  } else {
    for (let index = 0; index < bytes.length; index++) {
      bytes[index] = Math.floor(Math.random() * 256)
    }
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x40
  bytes[8] = (bytes[8]! & 0x3f) | 0x80

  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0'))
  return [
    hex.slice(0, 4).join(''),
    hex.slice(4, 6).join(''),
    hex.slice(6, 8).join(''),
    hex.slice(8, 10).join(''),
    hex.slice(10, 16).join(''),
  ].join('-') as UUID
}

function createUserMessage({
  content,
  toolUseResult,
  mcpMeta,
  sourceToolAssistantUUID,
}: {
  content: string | ContentBlockParam[]
  toolUseResult?: unknown
  mcpMeta?: {
    _meta?: Record<string, unknown>
    structuredContent?: Record<string, unknown>
  }
  sourceToolAssistantUUID?: UUID
}): UserMessage {
  return {
    type: 'user',
    uuid: createUUID(),
    timestamp: new Date().toISOString(),
    message: {
      role: 'user',
      content,
    },
    toolUseResult,
    mcpMeta,
    sourceToolAssistantUUID,
  }
}

function createProgressMessage(
  parentToolUseID: string,
  progress: {
    toolUseID: string
    data: ToolProgressData
  },
): ProgressMessage<ToolProgressData> {
  return {
    type: 'progress',
    uuid: createUUID(),
    timestamp: new Date().toISOString(),
    toolUseID: progress.toolUseID,
    parentToolUseID,
    data: progress.data,
  }
}

function errorText(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error)
  }

  const parts = [error.message]
  if ('stderr' in error && typeof error.stderr === 'string') {
    parts.push(error.stderr)
  }
  if ('stdout' in error && typeof error.stdout === 'string') {
    parts.push(error.stdout)
  }
  const message =
    parts.filter(Boolean).join('\n').trim() || 'Command failed with no output'
  if (message.length <= 10_000) {
    return message
  }
  return `${message.slice(0, 5_000)}\n\n... [${
    message.length - 10_000
  } characters truncated] ...\n\n${message.slice(-5_000)}`
}

export function isToolResultContentEmpty(
  content: ToolResultBlockParam['content'],
): boolean {
  if (!content) return true
  if (typeof content === 'string') return content.trim() === ''
  if (!Array.isArray(content)) return false
  if (content.length === 0) return true
  return content.every(
    block =>
      typeof block === 'object' &&
      'type' in block &&
      block.type === 'text' &&
      'text' in block &&
      (typeof block.text !== 'string' || block.text.trim() === ''),
  )
}

function normalizeToolResultContent(
  block: ToolResultBlockParam,
  toolName: string,
): ToolResultBlockParam {
  return isToolResultContentEmpty(block.content)
    ? {
        ...block,
        content: `(${toolName} completed with no output)`,
      }
    : block
}

function validationErrorText(
  toolName: string,
  error: {
    message: string
    issues?: Array<{ path?: PropertyKey[]; message?: string }>
  },
): string {
  if (!error.issues?.length) {
    return error.message
  }

  const issues = error.issues.map(issue => {
    const path = (issue.path ?? []).reduce<string>((result, segment) => {
      if (typeof segment === 'number') {
        return `${result}[${segment}]`
      }
      return result ? `${result}.${String(segment)}` : String(segment)
    }, '')
    return path ? `${path}: ${issue.message ?? 'Invalid value'}` : issue.message
  })
  return `${toolName} failed input validation:\n${issues.join('\n')}`
}

function errorUpdate({
  toolUseID,
  assistantMessage,
  content,
  toolUseResult,
  wrapAsToolUseError = false,
}: {
  toolUseID: string
  assistantMessage: AssistantMessage
  content: string
  toolUseResult?: unknown
  wrapAsToolUseError?: boolean
}): MessageUpdateLazy<UserMessage> {
  return {
    message: createUserMessage({
      content: [
        {
          type: 'tool_result',
          content: wrapAsToolUseError
            ? `<tool_use_error>${content}</tool_use_error>`
            : content,
          is_error: true,
          tool_use_id: toolUseID,
        },
      ],
      toolUseResult: toolUseResult ?? `Error: ${content}`,
      sourceToolAssistantUUID: assistantMessage.uuid,
    }),
  }
}

function abortUpdate(
  toolUseID: string,
  assistantMessage: AssistantMessage,
): MessageUpdateLazy<UserMessage> {
  return errorUpdate({
    toolUseID,
    assistantMessage,
    content: CANCEL_MESSAGE,
    toolUseResult: CANCEL_MESSAGE,
  })
}

function inputFromDecision(
  input: ObjectInput,
  decision: PermissionResult | PermissionDecision,
): ObjectInput {
  if (
    'updatedInput' in decision &&
    decision.updatedInput !== undefined &&
    typeof decision.updatedInput === 'object' &&
    decision.updatedInput !== null
  ) {
    return decision.updatedInput
  }
  return input
}

async function resolvePermission(
  tool: Tool,
  input: ObjectInput,
  toolUseContext: ToolUseContext,
  canUseTool: CanUseToolFn,
  assistantMessage: AssistantMessage,
  toolUseID: string,
): Promise<{ decision: PermissionDecision; input: ObjectInput }> {
  const toolDecision = await tool.checkPermissions(input, toolUseContext)
  const permissionInput = inputFromDecision(input, toolDecision)

  if (toolDecision.behavior === 'deny') {
    return { decision: toolDecision, input: permissionInput }
  }

  // A tool-level allow must not bypass host policy, so the host still makes
  // the final decision. An explicit ask is forwarded so interactive hosts can
  // present the tool-specific reason without recomputing it.
  const decision = await canUseTool(
    tool,
    permissionInput,
    toolUseContext,
    assistantMessage,
    toolUseID,
    toolDecision.behavior === 'ask' ? toolDecision : undefined,
  )
  return {
    decision,
    input: inputFromDecision(permissionInput, decision),
  }
}

async function callToolWithProgress(
  tool: Tool,
  input: ObjectInput,
  toolUseID: string,
  assistantMessage: AssistantMessage,
  canUseTool: CanUseToolFn,
  toolUseContext: ToolUseContext,
  userModified: boolean,
  onProgress: (message: ProgressMessage<ToolProgressData>) => void,
) {
  let settled = false
  let rejected = false
  let rejection: unknown
  let result: Awaited<ReturnType<Tool['call']>> | undefined
  let wake: (() => void) | undefined

  const completion = Promise.resolve()
    .then(() =>
      tool.call(
        input,
        {
          ...toolUseContext,
          toolUseId: toolUseID,
          userModified,
        },
        canUseTool,
        assistantMessage,
        progress => {
          if (!settled) {
            onProgress(createProgressMessage(toolUseID, progress))
            const resolve = wake
            wake = undefined
            resolve?.()
          }
        },
      ),
    )
    .then(
      value => {
        result = value
      },
      error => {
        rejected = true
        rejection = error
      },
    )
    .finally(() => {
      settled = true
      const resolve = wake
      wake = undefined
      resolve?.()
    })

  return {
    completion,
    isSettled: () => settled,
    waitForUpdate: () =>
      new Promise<void>(resolve => {
        wake = resolve
        if (settled) {
          wake = undefined
          resolve()
        }
      }),
    result: async () => {
      await completion
      if (rejected) {
        throw rejection
      }
      return result!
    },
  }
}

export async function* runToolUse(
  toolUse: ToolUseBlock,
  assistantMessage: AssistantMessage,
  canUseTool: CanUseToolFn,
  toolUseContext: ToolUseContext,
): AsyncGenerator<MessageUpdateLazy, void> {
  const tool = findToolByName(toolUseContext.options.tools, toolUse.name)

  if (!tool) {
    yield errorUpdate({
      toolUseID: toolUse.id,
      assistantMessage,
      content: `Error: No such tool available: ${toolUse.name}`,
      toolUseResult: `Error: No such tool available: ${toolUse.name}`,
      wrapAsToolUseError: true,
    })
    return
  }

  try {
    if (toolUseContext.abortController.signal.aborted) {
      yield abortUpdate(toolUse.id, assistantMessage)
      return
    }

    const parsedInput = tool.inputSchema.safeParse(toolUse.input)
    if (!parsedInput.success) {
      const details = validationErrorText(tool.name, parsedInput.error)
      yield errorUpdate({
        toolUseID: toolUse.id,
        assistantMessage,
        content: `InputValidationError: ${details}`,
        toolUseResult: `InputValidationError: ${parsedInput.error.message}`,
        wrapAsToolUseError: true,
      })
      return
    }

    const callInput = parsedInput.data
    const validation = await tool.validateInput?.(callInput, toolUseContext)
    if (toolUseContext.abortController.signal.aborted) {
      yield abortUpdate(toolUse.id, assistantMessage)
      return
    }
    if (validation?.result === false) {
      yield errorUpdate({
        toolUseID: toolUse.id,
        assistantMessage,
        content: validation.message,
        toolUseResult: `Error: ${validation.message}`,
        wrapAsToolUseError: true,
      })
      return
    }

    let observableInput = callInput
    if (tool.backfillObservableInput) {
      observableInput = { ...callInput }
      tool.backfillObservableInput(observableInput)
    }

    const { decision, input: permittedInput } = await resolvePermission(
      tool,
      observableInput,
      toolUseContext,
      canUseTool,
      assistantMessage,
      toolUse.id,
    )
    if (toolUseContext.abortController.signal.aborted) {
      yield abortUpdate(toolUse.id, assistantMessage)
      return
    }
    if (decision.behavior !== 'allow') {
      const message =
        decision.message ||
        `Permission to use ${tool.name} was not granted by the host.`
      yield errorUpdate({
        toolUseID: toolUse.id,
        assistantMessage,
        content: message,
        toolUseResult: `Error: ${message}`,
      })
      return
    }

    // Keep model-provided fields untouched unless a permission layer
    // intentionally returned an updated input. Backfilled fields are for
    // permission observers, not for the tool implementation.
    const executionInput =
      permittedInput === observableInput ? callInput : permittedInput
    const progressQueue: ProgressMessage<ToolProgressData>[] = []
    const execution = await callToolWithProgress(
      tool,
      executionInput,
      toolUse.id,
      assistantMessage,
      canUseTool,
      toolUseContext,
      decision.userModified ?? false,
      progress => progressQueue.push(progress),
    )

    while (!execution.isSettled() || progressQueue.length > 0) {
      const progress = progressQueue.shift()
      if (progress) {
        yield { message: progress }
      } else {
        await execution.waitForUpdate()
      }
    }

    const result = await execution.result()
    if (toolUseContext.abortController.signal.aborted) {
      yield abortUpdate(toolUse.id, assistantMessage)
      return
    }

    const mappedResult = normalizeToolResultContent(
      tool.mapToolResultToToolResultBlockParam(result.data, toolUse.id),
      tool.name,
    )
    const content: ContentBlockParam[] = [
      mappedResult as ToolResultBlockParam,
    ]
    if (decision.acceptFeedback) {
      content.push({ type: 'text', text: decision.acceptFeedback })
    }
    if (decision.contentBlocks?.length) {
      content.push(...decision.contentBlocks)
    }

    yield {
      message: createUserMessage({
        content,
        toolUseResult:
          toolUseContext.agentId && !toolUseContext.preserveToolUseResults
            ? undefined
            : result.data,
        mcpMeta: toolUseContext.agentId ? undefined : result.mcpMeta,
        sourceToolAssistantUUID: assistantMessage.uuid,
      }),
      contextModifier: result.contextModifier
        ? {
            toolUseID: toolUse.id,
            modifyContext: result.contextModifier,
          }
        : undefined,
    }

    for (const message of result.newMessages ?? []) {
      yield { message }
    }
  } catch (error) {
    if (toolUseContext.abortController.signal.aborted) {
      yield abortUpdate(toolUse.id, assistantMessage)
      return
    }

    const content = errorText(error) || INTERRUPT_MESSAGE_FOR_TOOL_USE
    yield errorUpdate({
      toolUseID: toolUse.id,
      assistantMessage,
      content,
      toolUseResult: `Error: ${content}`,
    })
  }
}
