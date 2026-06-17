import * as React from 'react'
import { Box, Text } from '../../ink.js'
import type { SystemMessage } from '../../types/message.js'

export function SnipBoundaryMessage({
  message,
}: {
  message: SystemMessage
}): React.ReactNode {
  const metadata = (
    message as {
      snipMetadata?: {
        removedMessages?: number
        tokensFreed?: number
        strategy?: string
        removedRanges?: unknown[]
      }
    }
  ).snipMetadata
  const removed = metadata?.removedMessages ?? 0
  const tokens = metadata?.tokensFreed ?? 0
  const strategy = metadata?.strategy ? ` via ${metadata.strategy}` : ''
  const ranges =
    metadata?.removedRanges && metadata.removedRanges.length > 1
      ? ` across ${metadata.removedRanges.length} ranges`
      : ''
  const suffix =
    removed > 0
      ? ` (${removed} messages, about ${tokens} tokens${ranges}${strategy})`
      : ''

  return (
    <Box marginY={1}>
      <Text dimColor>Conversation history snipped{suffix}</Text>
    </Box>
  )
}
