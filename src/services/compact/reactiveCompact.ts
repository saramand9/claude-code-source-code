import type { QuerySource } from '../../constants/querySource.js'
import type { ToolUseContext } from '../../Tool.js'
import type { Message, StreamEvent } from '../../types/message.js'
import { isEnvTruthy } from '../../utils/envUtils.js'
import { hasExactErrorMessage } from '../../utils/errors.js'
import type { CacheSafeParams } from '../../utils/forkedAgent.js'
import { logError } from '../../utils/log.js'
import { setLastSummarizedMessageId } from '../SessionMemory/sessionMemoryUtils.js'
import {
  isMediaSizeErrorMessage,
  isPromptTooLongMessage,
} from '../api/errors.js'
import { isAutoCompactEnabled } from './autoCompact.js'
import {
  compactConversation,
  type CompactionResult,
  ERROR_MESSAGE_NOT_ENOUGH_MESSAGES,
  ERROR_MESSAGE_PROMPT_TOO_LONG,
  ERROR_MESSAGE_USER_ABORT,
} from './compact.js'
import { runPostCompactCleanup } from './postCompactCleanup.js'

type ReactiveCompactFailureReason =
  | 'too_few_groups'
  | 'aborted'
  | 'exhausted'
  | 'media_unstrippable'
  | 'error'

export type ReactiveCompactOutcome =
  | { ok: true; result: CompactionResult; reason?: never; error?: never }
  | {
      ok: false
      reason: ReactiveCompactFailureReason
      error?: unknown
      result?: never
    }

type ReactiveCompactOptions = {
  customInstructions?: string
  trigger?: 'auto' | 'manual'
}

function isRecursiveSource(querySource: QuerySource): boolean {
  return querySource === 'compact' || querySource === 'session_memory'
}

export function isReactiveCompactEnabled(): boolean {
  if (isEnvTruthy(process.env.DISABLE_COMPACT)) return false
  if (isEnvTruthy(process.env.DISABLE_AUTO_COMPACT)) return false
  if (isEnvTruthy(process.env.DISABLE_REACTIVE_COMPACT)) return false
  if (isEnvTruthy(process.env.CLAUDE_CODE_DISABLE_REACTIVE_COMPACT)) {
    return false
  }

  const explicit = process.env.CLAUDE_CODE_REACTIVE_COMPACT
  if (explicit !== undefined) {
    return isEnvTruthy(explicit)
  }
  return true
}

export function isReactiveOnlyMode(): boolean {
  return (
    isReactiveCompactEnabled() &&
    isEnvTruthy(process.env.CLAUDE_CODE_REACTIVE_COMPACT_ONLY)
  )
}

export function isWithheldPromptTooLong(
  message: Message | StreamEvent | undefined,
): boolean {
  return (
    isReactiveCompactEnabled() &&
    message?.type === 'assistant' &&
    isPromptTooLongMessage(message)
  )
}

export function isWithheldMediaSizeError(
  message: Message | StreamEvent | undefined,
): boolean {
  return (
    isReactiveCompactEnabled() &&
    message?.type === 'assistant' &&
    isMediaSizeErrorMessage(message)
  )
}

function failureReason(error: unknown): ReactiveCompactFailureReason {
  if (hasExactErrorMessage(error, ERROR_MESSAGE_NOT_ENOUGH_MESSAGES)) {
    return 'too_few_groups'
  }
  if (hasExactErrorMessage(error, ERROR_MESSAGE_USER_ABORT)) {
    return 'aborted'
  }
  if (hasExactErrorMessage(error, ERROR_MESSAGE_PROMPT_TOO_LONG)) {
    return 'exhausted'
  }
  return 'error'
}

export async function reactiveCompactOnPromptTooLong(
  messages: Message[],
  cacheSafeParams: CacheSafeParams,
  options: ReactiveCompactOptions = {},
): Promise<ReactiveCompactOutcome> {
  const context = cacheSafeParams.toolUseContext
  if (context.abortController.signal.aborted) {
    return { ok: false, reason: 'aborted' }
  }

  try {
    const result = await compactConversation(
      messages,
      context,
      cacheSafeParams,
      true,
      options.customInstructions,
      options.trigger !== 'manual',
      {
        isRecompactionInChain: false,
        turnsSincePreviousCompact: -1,
        autoCompactThreshold: -1,
        querySource: context.options.querySource,
      },
    )
    return { ok: true, result }
  } catch (error) {
    const reason = failureReason(error)
    if (reason !== 'aborted') {
      logError(error)
    }
    return { ok: false, reason, error }
  }
}

export async function tryReactiveCompact({
  hasAttempted,
  querySource,
  aborted,
  messages,
  cacheSafeParams,
}: {
  hasAttempted: boolean
  querySource: QuerySource
  aborted: boolean
  messages: Message[]
  cacheSafeParams: {
    systemPrompt: CacheSafeParams['systemPrompt']
    userContext: { [k: string]: string }
    systemContext: { [k: string]: string }
    toolUseContext: ToolUseContext
    forkContextMessages: Message[]
  }
}): Promise<CompactionResult | null> {
  if (hasAttempted || aborted || isRecursiveSource(querySource)) {
    return null
  }
  if (!isReactiveCompactEnabled() || !isAutoCompactEnabled()) {
    return null
  }

  const outcome = await reactiveCompactOnPromptTooLong(messages, cacheSafeParams, {
    trigger: 'auto',
  })
  if (!outcome.ok) {
    return null
  }

  setLastSummarizedMessageId(undefined)
  runPostCompactCleanup(querySource)
  return outcome.result
}
