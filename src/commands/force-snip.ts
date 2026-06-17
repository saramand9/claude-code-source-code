import type { Command } from '../commands.js'
import {
  isSnipRuntimeEnabled,
  snipCompactIfNeeded,
} from '../services/compact/snipCompact.js'
import type { LocalCommandCall } from '../types/command.js'

function parseArgs(args: string): {
  reason?: string
  targetMessageIds?: string[]
  targetTokens?: number
} {
  const parts = args.trim().split(/\s+/).filter(Boolean)
  const reasonParts: string[] = []
  const targetMessageIds: string[] = []
  let targetTokens: number | undefined

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!
    if ((part === '--id' || part === '--ids') && parts[i + 1]) {
      targetMessageIds.push(
        ...parts[++i]!.split(',').map(id => id.trim()).filter(Boolean),
      )
      continue
    }
    if (part.startsWith('--id=')) {
      targetMessageIds.push(
        ...part.slice('--id='.length).split(',').map(id => id.trim()).filter(Boolean),
      )
      continue
    }
    if (part.startsWith('--ids=')) {
      targetMessageIds.push(
        ...part.slice('--ids='.length).split(',').map(id => id.trim()).filter(Boolean),
      )
      continue
    }
    if ((part === '--target-tokens' || part === '--target') && parts[i + 1]) {
      const parsed = Number.parseInt(parts[++i]!, 10)
      if (Number.isFinite(parsed) && parsed > 0) targetTokens = parsed
      continue
    }
    if (part.startsWith('--target-tokens=')) {
      const parsed = Number.parseInt(part.slice('--target-tokens='.length), 10)
      if (Number.isFinite(parsed) && parsed > 0) targetTokens = parsed
      continue
    }
    reasonParts.push(part)
  }

  return {
    reason: reasonParts.join(' ') || undefined,
    targetMessageIds:
      targetMessageIds.length > 0 ? targetMessageIds : undefined,
    targetTokens,
  }
}

const call: LocalCommandCall = async (args, context) => {
  if (!isSnipRuntimeEnabled()) {
    return { type: 'text', value: 'Snip is disabled.' }
  }

  const parsed = parseArgs(args)
  const result = snipCompactIfNeeded(context.messages, {
    force: true,
    trigger: 'manual',
    reason: parsed.reason,
    targetMessageIds: parsed.targetMessageIds,
    targetTokens: parsed.targetTokens,
  })

  if (result.boundaryMessage) {
    context.setMessages(prev => [...prev, result.boundaryMessage!])
  }

  return {
    type: 'text',
    value: result.executed
      ? `Snipped ${result.removedMessages} messages with ${result.strategy} and freed about ${result.tokensFreed} tokens.`
      : 'No safe snip range found.',
  }
}

const forceSnip = {
  type: 'local',
  name: 'force-snip',
  description: 'Force a high-availability snip of stale conversation history',
  supportsNonInteractive: true,
  load: async () => ({ call }),
} satisfies Command

export default forceSnip
