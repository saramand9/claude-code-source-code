import type { UUID } from 'crypto'
import type { SDKAssistantMessageError } from 'src/entrypoints/sdk/coreTypes.generated.js'

export type SystemMessageLevel = 'info' | 'warning' | 'error' | 'suggestion'

export type MessageBase<TType extends string = string> = {
  type: TType
  uuid: UUID
  parentUuid?: UUID | null
  timestamp: string
  requestId?: string
  isMeta?: boolean
  isVirtual?: boolean
  isVisibleInTranscriptOnly?: boolean
  [key: string]: any
}

export type UserMessage = MessageBase<'user'> & {
  isMeta?: true
  isVisibleInTranscriptOnly?: true
  isVirtual?: true
  isCompactSummary?: true
  message: {
    role: 'user'
    content: any
    [key: string]: any
  }
  toolUseResult?: unknown
  mcpMeta?: {
    _meta?: Record<string, unknown>
    structuredContent?: Record<string, unknown>
  }
  imagePasteIds?: number[]
  sourceToolAssistantUUID?: UUID
  permissionMode?: string
  origin?: MessageOrigin
}

export type AssistantMessage = MessageBase<'assistant'> & {
  isVirtual?: true
  message: {
    id: string
    role: 'assistant'
    content: any[]
    usage?: any
    stop_reason?: string | null
    stop_sequence?: string | null
    [key: string]: any
  }
  apiError?: SDKAssistantMessageError
  error?: SDKAssistantMessageError
  errorDetails?: string
  isApiErrorMessage?: boolean
  advisorModel?: string
}

export type SystemMessage<TSubtype extends string = string> =
  MessageBase<'system'> & {
    subtype?: TSubtype
    content?: string
    level?: SystemMessageLevel
  }

export type AttachmentMessage<T = any> = MessageBase<'attachment'> & {
  attachment: T
}

export type ProgressMessage<T = any> = MessageBase<'progress'> & {
  toolUseID: string
  parentToolUseID: string
  content?: T
  data: T
}

export type HookResultMessage = AttachmentMessage | ProgressMessage

export type SystemAPIErrorMessage = SystemMessage<'api_error'> & {
  error?: unknown
  cause?: Error
  retryInMs?: number
  retryAttempt?: number
  maxRetries?: number
}

export type SystemInformationalMessage = SystemMessage<'informational'>
export type SystemLocalCommandMessage = SystemMessage<'local_command'>
export type SystemBridgeStatusMessage = SystemMessage<'bridge_status'> & {
  url?: string
  upgradeNudge?: string
}
export type SystemScheduledTaskFireMessage =
  SystemMessage<'scheduled_task_fire'>
export type SystemStopHookSummaryMessage = SystemMessage<'stop_hook_summary'> & {
  hookCount?: number
  hookInfos?: StopHookInfo[]
  hookErrors?: string[]
  preventedContinuation?: boolean
  stopReason?: string
  hasOutput?: boolean
  toolUseID?: string
  hookLabel?: string
  totalDurationMs?: number
}
export type SystemTurnDurationMessage = SystemMessage<'turn_duration'> & {
  durationMs?: number
  budgetTokens?: number
  budgetLimit?: number
  budgetNudges?: number
  messageCount?: number
}
export type SystemAwaySummaryMessage = SystemMessage<'away_summary'>
export type SystemMemorySavedMessage = SystemMessage<'memory_saved'> & {
  writtenPaths?: string[]
}
export type SystemAgentsKilledMessage = SystemMessage<'agents_killed'>
export type SystemApiMetricsMessage = SystemMessage<'api_metrics'> & {
  ttftMs: number
  otps: number
  isP50?: boolean
  hookDurationMs?: number
  turnDurationMs?: number
  toolDurationMs?: number
  classifierDurationMs?: number
  toolCount?: number
  hookCount?: number
  classifierCount?: number
  configWriteCount?: number
}
export type SystemCompactBoundaryMessage =
  SystemMessage<'compact_boundary'> & {
    compactMetadata?: CompactMetadata
    logicalParentUuid?: UUID
  }
export type SystemMicrocompactBoundaryMessage =
  SystemMessage<'microcompact_boundary'> & {
    microcompactMetadata?: {
      trigger?: string
      preTokens?: number
      tokensSaved?: number
      compactedToolIds?: string[]
      clearedAttachmentUUIDs?: string[]
      [key: string]: any
    }
  }
export type SystemPermissionRetryMessage = SystemMessage<'permission_retry'> & {
  commands?: string[]
}
export type SystemThinkingMessage = SystemMessage<'thinking'>

export type ToolUseSummaryMessage = MessageBase<'tool_use_summary'> & {
  summary: string
  precedingToolUseIds: string[]
}

export type TombstoneMessage = MessageBase<'tombstone'> & {
  message: Message
  tombstoneFor?: string
}

export type CollapsibleMessage =
  | NormalizedAssistantMessage
  | NormalizedUserMessage
  | GroupedToolUseMessage

export type StopHookInfo = {
  reason?: string
  hookEventName?: string
  [key: string]: any
}

export type RequestStartEvent = {
  type: 'stream_request_start'
  requestId?: string
  timestamp?: string
  [key: string]: any
}

export type StreamEvent = MessageBase<'stream_event'> & {
  event?: any
  delta?: any
  ttftMs?: number
  stopHookInfo?: StopHookInfo
}

export type Message =
  | UserMessage
  | AssistantMessage
  | SystemMessage
  | AttachmentMessage
  | ProgressMessage
  | HookResultMessage
  | ToolUseSummaryMessage
  | StreamEvent

export type NormalizedUserMessage = UserMessage & {
  message: UserMessage['message'] & { content: any[] }
}

export type NormalizedAssistantMessage<T = any> = AssistantMessage & {
  message: AssistantMessage['message'] & {
    content: T extends any[] ? T : any[]
  }
}

export type NormalizedMessage =
  | NormalizedUserMessage
  | NormalizedAssistantMessage
  | AttachmentMessage
  | ProgressMessage
  | SystemMessage

export type GroupedToolUseMessage = {
  type: 'grouped_tool_use'
  toolName: string
  messages: NormalizedAssistantMessage[]
  results: NormalizedUserMessage[]
  displayMessage: NormalizedAssistantMessage
  uuid: string
  timestamp: string
  messageId: string
}

export type RenderableMessage =
  | NormalizedMessage
  | GroupedToolUseMessage
  | CollapsedReadSearchGroup

export type PartialCompactDirection =
  | 'from'
  | 'through'
  | 'up_to'
  | 'before'
  | 'after'
  | {
      mode?: string
      summary?: string
      [key: string]: any
    }

export type CollapsedReadSearchGroup = {
  type: 'collapsed_read_search'
  searchCount: number
  readCount: number
  listCount: number
  replCount: number
  memorySearchCount: number
  memoryReadCount: number
  memoryWriteCount: number
  readFilePaths: string[]
  searchArgs: string[]
  latestDisplayHint?: string
  messages: CollapsibleMessage[]
  displayMessage: CollapsibleMessage
  uuid: string
  timestamp: string
  teamMemorySearchCount?: number
  teamMemoryReadCount?: number
  teamMemoryWriteCount?: number
  mcpCallCount?: number
  mcpServerNames?: string[]
  bashCount?: number
  gitOpBashCount?: number
  commits?: any[]
  pushes?: any[]
  branches?: any[]
  prs?: any[]
  hookTotalMs?: number
  hookCount?: number
  hookInfos?: StopHookInfo[]
  relevantMemories?: any[]
  [key: string]: any
}

export type MessageOrigin = {
  kind?: string
  [key: string]: any
}

export type CompactMetadata = {
  trigger?: 'manual' | 'auto' | string
  preTokens?: number
  userContext?: string
  messagesSummarized?: number
  [key: string]: any
}

export type SystemFileSnapshotMessage = SystemMessage<'file_snapshot'> & {
  files?: any[]
}
