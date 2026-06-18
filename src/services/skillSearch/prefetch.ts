import { getProjectRoot } from '../../bootstrap/state.js'
import { getMcpSkillCommands } from '../../commands.js'
import type { ToolUseContext } from '../../Tool.js'
import type { Attachment } from '../../utils/attachments.js'
import { logForDebugging } from '../../utils/debug.js'
import { getUserMessageText } from '../../utils/messages.js'
import type { Message } from '../../types/message.js'
import { isSkillSearchEnabled } from './featureCheck.js'
import { searchSkillIndex, type SkillSearchResult } from './localSearch.js'

const TURN_ZERO_MAX_RESULTS = 5
const PREFETCH_MAX_RESULTS = 3

type SkillDiscoveryPrefetch = {
  promise: Promise<Attachment[]>
  settledAt: number | null
}

function getDiscoveredSet(context: ToolUseContext): Set<string> {
  if (!context.discoveredSkillNames) {
    context.discoveredSkillNames = new Set<string>()
  }
  return context.discoveredSkillNames
}

function skillResultsToAttachment(
  results: SkillSearchResult[],
  signal: string,
): Attachment[] {
  if (results.length === 0) return []
  return [
    {
      type: 'skill_discovery',
      skills: results.map(result => ({
        name: result.name,
        description: result.description,
      })),
      signal,
      source: 'native',
    },
  ]
}

function mcpSkillsForContext(context: ToolUseContext) {
  return getMcpSkillCommands(context.getAppState().mcp.commands)
}

async function discoverSkillsForSignal(
  input: string | null | undefined,
  context: ToolUseContext,
  maxResults: number,
): Promise<Attachment[]> {
  if (!isSkillSearchEnabled()) return []
  const rawInput = String(input ?? '')
  if (rawInput.trim().length === 0) return []
  const discovered = getDiscoveredSet(context)
  const results = await searchSkillIndex(getProjectRoot(), rawInput, {
    extraCommands: mcpSkillsForContext(context),
    excludeNames: discovered,
    maxResults,
  })
  for (const result of results) {
    discovered.add(result.name)
  }
  return skillResultsToAttachment(results, rawInput.slice(0, 160))
}

export async function getTurnZeroSkillDiscovery(
  input: string,
  _messages: Message[],
  context: ToolUseContext,
): Promise<Attachment[]> {
  try {
    return await discoverSkillsForSignal(input, context, TURN_ZERO_MAX_RESULTS)
  } catch (error) {
    logForDebugging(`Skill discovery failed: ${String(error)}`)
    return []
  }
}

function latestUserText(messages: Message[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (message?.type === 'user' && !message.isMeta) {
      return getUserMessageText(message) ?? ''
    }
  }
  return ''
}

export function startSkillDiscoveryPrefetch(
  _signal: null,
  messages: Message[],
  context: ToolUseContext,
): SkillDiscoveryPrefetch | null {
  if (!isSkillSearchEnabled()) return null
  const input = latestUserText(messages)
  if (input.trim().length === 0) return null

  const prefetch: SkillDiscoveryPrefetch = {
    promise: discoverSkillsForSignal(input, context, PREFETCH_MAX_RESULTS),
    settledAt: null,
  }
  prefetch.promise
    .then(() => {
      prefetch.settledAt = Date.now()
    })
    .catch(() => {
      prefetch.settledAt = Date.now()
    })
  return prefetch
}

export async function collectSkillDiscoveryPrefetch(
  prefetch: unknown,
): Promise<Attachment[]> {
  if (!prefetch || typeof prefetch !== 'object' || !('promise' in prefetch)) {
    return []
  }
  try {
    return await (prefetch as SkillDiscoveryPrefetch).promise
  } catch (error) {
    logForDebugging(`Skill discovery prefetch failed: ${String(error)}`)
    return []
  }
}
