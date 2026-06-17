import type { SystemMessage, Message } from '../../types/message.js'

export type SnipMetadata = {
  trigger: 'auto' | 'manual' | 'tool'
  strategy?: 'auto_segments' | 'targeted_segments' | 'boundary_replay'
  removedUuids: string[]
  removedMessages: number
  tokensFreed: number
  preTokens?: number
  postTokens?: number
  targetTokens?: number
  protectedTailMessages?: number
  removedRanges?: {
    startUuid: string
    endUuid: string
    messages: number
    tokensFreed: number
  }[]
  targetMessageIds?: string[]
  reason?: string
}

export type SnipBoundaryMessage = SystemMessage<'snip_boundary'> & {
  snipMetadata: SnipMetadata
}

function hasSnipMetadata(
  message: Message | SystemMessage | undefined,
): message is SnipBoundaryMessage {
  const metadata = (message as { snipMetadata?: unknown } | undefined)
    ?.snipMetadata
  return (
    typeof metadata === 'object' &&
    metadata !== null &&
    Array.isArray((metadata as { removedUuids?: unknown }).removedUuids)
  )
}

export function isSnipBoundaryMessage(
  message: Message | SystemMessage | undefined,
): message is SnipBoundaryMessage {
  return (
    message?.type === 'system' &&
    (message.subtype === 'snip_boundary' || hasSnipMetadata(message))
  )
}

export function projectSnippedView<T extends Message[]>(messages: T): T {
  const removed = new Set<string>()
  for (const message of messages) {
    if (!isSnipBoundaryMessage(message)) continue
    for (const uuid of message.snipMetadata.removedUuids) {
      removed.add(uuid)
    }
  }

  if (removed.size === 0) {
    return messages
  }

  return messages.filter(message => !removed.has(message.uuid)) as T
}
