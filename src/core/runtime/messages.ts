import type {
  BetaContentBlock,
  BetaUsage as Usage,
} from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/index.mjs'
import type { UUID } from 'crypto'
import type { Tools } from '../../Tool.js'
import { NO_CONTENT_MESSAGE } from '../../constants/messages.js'
import type {
  AssistantMessage,
  AttachmentMessage,
  Message,
  MessageOrigin,
  NormalizedMessage,
  PartialCompactDirection,
  SystemCompactBoundaryMessage,
  SystemInformationalMessage,
  SystemMessageLevel,
  SystemMicrocompactBoundaryMessage,
  ToolUseSummaryMessage,
  UserMessage,
} from '../../types/message.js'

const INTERRUPT_MESSAGE = '[Request interrupted by user]'
const INTERRUPT_MESSAGE_FOR_TOOL_USE =
  '[Request interrupted by user for tool use]'
const CANCEL_MESSAGE =
  "The user doesn't want to take this action right now. STOP what you are doing and wait for the user to tell you how to proceed."
export const REJECT_MESSAGE =
  "The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). STOP what you are doing and wait for the user to tell you how to proceed."
const NO_RESPONSE_REQUESTED = 'No response requested.'

function randomUUID(): UUID {
  const crypto = globalThis.crypto
  if (crypto?.randomUUID) return crypto.randomUUID() as UUID

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
    hex.slice(10).join(''),
  ].join('-') as UUID
}

export const SYNTHETIC_MODEL = '<synthetic>'

export const SYNTHETIC_MESSAGES = new Set([
  INTERRUPT_MESSAGE,
  INTERRUPT_MESSAGE_FOR_TOOL_USE,
  CANCEL_MESSAGE,
  REJECT_MESSAGE,
  NO_RESPONSE_REQUESTED,
])

/**
 * The product implementation appends a memory hint only when both auto-memory
 * and its rollout flag are enabled. Core builds have product feature gates
 * disabled, so the equivalent portable behavior is the unchanged message.
 */
export function withMemoryCorrectionHint(message: string): string {
  return message
}

function createEmptyUsage(): Usage {
  return {
    input_tokens: 0,
    output_tokens: 0,
    output_tokens_details: { thinking_tokens: 0 },
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    server_tool_use: {
      web_search_requests: 0,
      web_fetch_requests: 0,
    },
    service_tier: null,
    cache_creation: {
      ephemeral_1h_input_tokens: 0,
      ephemeral_5m_input_tokens: 0,
    },
    inference_geo: null,
    iterations: null,
    speed: null,
  } as Usage
}

function baseCreateAssistantMessage({
  content,
  apiError,
  error,
  errorDetails,
}: {
  content: BetaContentBlock[]
  apiError?: AssistantMessage['apiError']
  error?: AssistantMessage['error']
  errorDetails?: string
}): AssistantMessage {
  return {
    type: 'assistant',
    uuid: randomUUID(),
    timestamp: new Date().toISOString(),
    message: {
      id: randomUUID(),
      container: null,
      model: SYNTHETIC_MODEL,
      role: 'assistant',
      stop_reason: 'stop_sequence',
      stop_sequence: '',
      type: 'message',
      usage: createEmptyUsage(),
      content,
      context_management: null,
    },
    requestId: undefined,
    apiError,
    error,
    errorDetails,
    isApiErrorMessage: true,
  }
}

export function createAssistantAPIErrorMessage({
  content,
  apiError,
  error,
  errorDetails,
}: {
  content: string
  apiError?: AssistantMessage['apiError']
  error?: AssistantMessage['error']
  errorDetails?: string
}): AssistantMessage {
  return baseCreateAssistantMessage({
    content: [
      {
        type: 'text',
        text: content === '' ? NO_CONTENT_MESSAGE : content,
      } as BetaContentBlock,
    ],
    apiError,
    error,
    errorDetails,
  })
}

export function createUserMessage({
  content,
  isMeta,
  isVisibleInTranscriptOnly,
  isVirtual,
  isCompactSummary,
  summarizeMetadata,
  toolUseResult,
  mcpMeta,
  uuid,
  timestamp,
  imagePasteIds,
  sourceToolAssistantUUID,
  permissionMode,
  origin,
}: {
  content: string | ContentBlockParam[]
  isMeta?: true
  isVisibleInTranscriptOnly?: true
  isVirtual?: true
  isCompactSummary?: true
  summarizeMetadata?: {
    messagesSummarized: number
    userContext?: string
    direction?: PartialCompactDirection
  }
  toolUseResult?: unknown
  mcpMeta?: UserMessage['mcpMeta']
  uuid?: UUID | string
  timestamp?: string
  imagePasteIds?: number[]
  sourceToolAssistantUUID?: UUID
  permissionMode?: UserMessage['permissionMode']
  origin?: MessageOrigin
}): UserMessage {
  return {
    type: 'user',
    message: {
      role: 'user',
      content: content || NO_CONTENT_MESSAGE,
    },
    isMeta,
    isVisibleInTranscriptOnly,
    isVirtual,
    isCompactSummary,
    summarizeMetadata,
    uuid: (uuid as UUID | undefined) || randomUUID(),
    timestamp: timestamp ?? new Date().toISOString(),
    toolUseResult,
    mcpMeta,
    imagePasteIds,
    sourceToolAssistantUUID,
    permissionMode,
    origin,
  }
}

export function createUserInterruptionMessage({
  toolUse = false,
}: {
  toolUse?: boolean
}): UserMessage {
  return createUserMessage({
    content: [
      {
        type: 'text',
        text: toolUse
          ? INTERRUPT_MESSAGE_FOR_TOOL_USE
          : INTERRUPT_MESSAGE,
      },
    ],
  })
}

function asUserContentBlocks(
  content: UserMessage['message']['content'],
): ContentBlockParam[] {
  if (Array.isArray(content)) return content as ContentBlockParam[]
  return [
    {
      type: 'text',
      text: typeof content === 'string' ? content : String(content ?? ''),
    },
  ]
}

function joinUserContent(
  left: ContentBlockParam[],
  right: ContentBlockParam[],
): ContentBlockParam[] {
  const lastLeft = left.at(-1)
  const firstRight = right[0]
  const joined =
    lastLeft?.type === 'text' && firstRight?.type === 'text'
      ? [
          ...left.slice(0, -1),
          { ...lastLeft, text: `${lastLeft.text}\n` },
          ...right,
        ]
      : [...left, ...right]

  // The API requires tool_result blocks to immediately follow the assistant
  // turn containing their tool_use blocks.
  return [
    ...joined.filter(block => block.type === 'tool_result'),
    ...joined.filter(block => block.type !== 'tool_result'),
  ]
}

function mergeUserMessages(
  left: UserMessage,
  right: UserMessage,
): UserMessage {
  return {
    ...left,
    uuid: left.isMeta ? right.uuid : left.uuid,
    message: {
      ...left.message,
      content: joinUserContent(
        asUserContentBlocks(left.message.content),
        asUserContentBlocks(right.message.content),
      ),
    },
  }
}

function mergeAssistantMessages(
  left: AssistantMessage,
  right: AssistantMessage,
): AssistantMessage {
  return {
    ...left,
    requestId: right.requestId ?? left.requestId,
    message: {
      ...left.message,
      usage: right.message.usage ?? left.message.usage,
      stop_reason:
        right.message.stop_reason ?? left.message.stop_reason,
      stop_sequence:
        right.message.stop_sequence ?? left.message.stop_sequence,
      content: [
        ...(Array.isArray(left.message.content)
          ? left.message.content
          : []),
        ...(Array.isArray(right.message.content)
          ? right.message.content
          : []),
      ],
    },
  }
}

function isToolResultMessage(message: UserMessage): boolean {
  return (
    Array.isArray(message.message.content) &&
    message.message.content.some(
      (block: { type?: string }) => block.type === 'tool_result',
    )
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

const USER_CONTENT_BLOCK_TYPES = new Set([
  'text',
  'image',
  'document',
  'search_result',
  'tool_result',
  'tool_reference',
  'web_search_tool_result',
  'web_fetch_tool_result',
  'code_execution_tool_result',
  'bash_code_execution_tool_result',
  'text_editor_code_execution_tool_result',
  'mcp_tool_result',
  'container_upload',
])

function isUserContentBlockArray(
  value: unknown,
): value is ContentBlockParam[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      block =>
        isRecord(block) &&
        typeof block.type === 'string' &&
        USER_CONTENT_BLOCK_TYPES.has(block.type),
    )
  )
}

function stringifyAttachment(attachment: unknown): string | undefined {
  try {
    const value = JSON.stringify(attachment, (_key, item) =>
      typeof item === 'bigint' ? item.toString() : item,
    )
    return value === undefined ? undefined : value
  } catch {
    try {
      return String(attachment)
    } catch {
      return undefined
    }
  }
}

/**
 * A core host should normally turn platform attachments into user content
 * before calling query(). This fallback handles the portable shapes without
 * importing Claude Code's file, PDF, IDE, memory, or hook attachment stack.
 */
function attachmentToUserMessage(
  message: AttachmentMessage,
): UserMessage | undefined {
  const attachment: unknown = message.attachment
  let content: string | ContentBlockParam[] | undefined

  if (typeof attachment === 'string') {
    content = attachment
  } else if (isUserContentBlockArray(attachment)) {
    content = attachment
  } else if (isRecord(attachment)) {
    const embeddedMessage = attachment.message
    if (
      isRecord(embeddedMessage) &&
      embeddedMessage.role === 'user' &&
      (typeof embeddedMessage.content === 'string' ||
        isUserContentBlockArray(embeddedMessage.content))
    ) {
      content = embeddedMessage.content
    }

    if (content === undefined) {
      const directContent = attachment.content
      if (
        typeof directContent === 'string' ||
        isUserContentBlockArray(directContent)
      ) {
        content = directContent
      } else if (
        isRecord(directContent) &&
        directContent.type === 'text'
      ) {
        if (typeof directContent.text === 'string') {
          content = directContent.text
        } else if (
          isRecord(directContent.file) &&
          typeof directContent.file.content === 'string'
        ) {
          content = directContent.file.content
        }
      }
    }

    content ??= stringifyAttachment(attachment)
  } else {
    content = stringifyAttachment(attachment)
  }

  if (content === undefined) return undefined
  return createUserMessage({
    content,
    isMeta: true,
    uuid: message.uuid,
    timestamp: message.timestamp,
  })
}

function appendAssistantMessage(
  result: (UserMessage | AssistantMessage)[],
  message: AssistantMessage,
): void {
  // Streaming emits one AssistantMessage per content block. Match the
  // original response by id, even when tool_result messages are interleaved.
  for (let index = result.length - 1; index >= 0; index--) {
    const candidate = result[index]!
    if (candidate.type === 'assistant') {
      if (candidate.message.id === message.message.id) {
        result[index] = mergeAssistantMessages(candidate, message)
        return
      }
      continue
    }
    if (!isToolResultMessage(candidate)) break
  }

  result.push(message)
}

function appendUserMessage(
  result: (UserMessage | AssistantMessage)[],
  message: UserMessage,
): void {
  const previous = result.at(-1)
  if (previous?.type === 'user') {
    result[result.length - 1] = mergeUserMessages(previous, message)
  } else {
    result.push(message)
  }
}

/**
 * Produce the existing Anthropic user/assistant message protocol without any
 * UI, analytics, concrete-tool, or product-attachment dependencies.
 *
 * `tools` remains in the signature for drop-in compatibility. Core
 * normalization deliberately leaves tool names and inputs untouched.
 */
export function normalizeMessagesForAPI(
  messages: Message[],
  _tools: Tools = [],
): (UserMessage | AssistantMessage)[] {
  const result: (UserMessage | AssistantMessage)[] = []

  for (const message of messages) {
    if (
      message.isVirtual ||
      message.type === 'progress' ||
      message.type === 'system' ||
      message.type === 'stream_event' ||
      message.type === 'tool_use_summary'
    ) {
      continue
    }

    if (message.type === 'attachment') {
      const expanded = attachmentToUserMessage(message)
      if (expanded) appendUserMessage(result, expanded)
      continue
    }

    if (message.type === 'user') {
      appendUserMessage(result, message)
      continue
    }

    if (message.type === 'assistant') {
      // Synthetic API errors are emitted to the host but are not conversation
      // turns and must never be replayed to the model.
      if (message.isApiErrorMessage) continue
      appendAssistantMessage(result, message)
    }
  }

  return result
}

export function createSystemMessage(
  content: string,
  level: SystemMessageLevel,
  toolUseID?: string,
  preventContinuation?: boolean,
): SystemInformationalMessage {
  return {
    type: 'system',
    subtype: 'informational',
    content,
    isMeta: false,
    timestamp: new Date().toISOString(),
    uuid: randomUUID(),
    toolUseID,
    level,
    ...(preventContinuation && { preventContinuation }),
  }
}

export function createCompactBoundaryMessage(
  trigger: 'manual' | 'auto',
  preTokens: number,
  lastPreCompactMessageUuid?: UUID,
  userContext?: string,
  messagesSummarized?: number,
): SystemCompactBoundaryMessage {
  return {
    type: 'system',
    subtype: 'compact_boundary',
    content: 'Conversation compacted',
    isMeta: false,
    timestamp: new Date().toISOString(),
    uuid: randomUUID(),
    level: 'info',
    compactMetadata: {
      trigger,
      preTokens,
      userContext,
      messagesSummarized,
    },
    ...(lastPreCompactMessageUuid && {
      logicalParentUuid: lastPreCompactMessageUuid,
    }),
  }
}

export function createMicrocompactBoundaryMessage(
  trigger: 'auto',
  preTokens: number,
  tokensSaved: number,
  compactedToolIds: string[],
  clearedAttachmentUUIDs: string[],
): SystemMicrocompactBoundaryMessage {
  return {
    type: 'system',
    subtype: 'microcompact_boundary',
    content: 'Context microcompacted',
    isMeta: false,
    timestamp: new Date().toISOString(),
    uuid: randomUUID(),
    level: 'info',
    microcompactMetadata: {
      trigger,
      preTokens,
      tokensSaved,
      compactedToolIds,
      clearedAttachmentUUIDs,
    },
  }
}

function findLastCompactBoundaryIndex<
  T extends Message | NormalizedMessage,
>(messages: T[]): number {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (
      message?.type === 'system' &&
      message.subtype === 'compact_boundary'
    ) {
      return index
    }
  }
  return -1
}

export function getMessagesAfterCompactBoundary<
  T extends Message | NormalizedMessage,
>(messages: T[], _options?: { includeSnipped?: boolean }): T[] {
  const boundaryIndex = findLastCompactBoundaryIndex(messages)
  return boundaryIndex === -1 ? messages : messages.slice(boundaryIndex)
}

export function stripSignatureBlocks(messages: Message[]): Message[] {
  let changed = false
  const result = messages.map(message => {
    if (
      message.type !== 'assistant' ||
      !Array.isArray(message.message.content)
    ) {
      return message
    }

    const content = message.message.content.filter(
      (block: { type?: string }) =>
        block.type !== 'thinking' &&
        block.type !== 'redacted_thinking' &&
        block.type !== 'connector_text',
    )
    if (content.length === message.message.content.length) return message

    changed = true
    return {
      ...message,
      message: { ...message.message, content },
    }
  })

  return changed ? result : messages
}

export function createToolUseSummaryMessage(
  summary: string,
  precedingToolUseIds: string[],
): ToolUseSummaryMessage {
  return {
    type: 'tool_use_summary',
    summary,
    precedingToolUseIds,
    uuid: randomUUID(),
    timestamp: new Date().toISOString(),
  }
}
