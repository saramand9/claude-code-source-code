import type { ToolUseBlockParam } from '@anthropic-ai/sdk/resources/index.mjs'
import { randomUUID } from 'crypto'
import type { Message, SystemMessage } from '../../types/message.js'
import { isEnvTruthy } from '../../utils/envUtils.js'
import {
  isSnipBoundaryMessage,
  projectSnippedView,
  type SnipBoundaryMessage,
} from './snipProjection.js'

export const SNIP_NUDGE_TEXT =
  'Old context can be snipped when it is no longer useful. Prefer preserving recent user intent, active tool results, and unresolved tasks.'

const DEFAULT_TRIGGER_TOKENS = 120_000
const DEFAULT_NUDGE_TOKENS = 80_000
const DEFAULT_TARGET_TOKENS = 90_000
const DEFAULT_PROTECTED_TAIL_MESSAGES = 12
const DEFAULT_MIN_REMOVED_MESSAGES = 4

type SnipTrigger = 'auto' | 'manual' | 'tool'
type SnipStrategy = 'auto_segments' | 'targeted_segments' | 'boundary_replay'

export type SnipOptions = {
  force?: boolean
  trigger?: SnipTrigger
  reason?: string
  targetMessageIds?: string[]
  targetUuids?: string[]
  targetTokens?: number
}

export type SnipCompactResult = {
  messages: Message[]
  executed: boolean
  tokensFreed: number
  removedMessages: number
  boundaryMessage?: SnipBoundaryMessage
  strategy?: SnipStrategy
  preTokens?: number
  postTokens?: number
}

type SnipSegment = {
  start: number
  end: number
  messages: Message[]
  tokens: number
  removable: boolean
  uuidSet: Set<string>
  idSet: Set<string>
}

function envInt(name: string, fallback: number): number {
  const value = process.env[name]
  if (!value) return fallback
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function deriveShortMessageId(uuid: string): string {
  let hash = 2166136261
  for (const char of uuid) {
    hash ^= char.charCodeAt(0)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36).padStart(6, '0').slice(0, 6)
}

function isCompactBoundaryMessage(message: Message | undefined): boolean {
  return message?.type === 'system' && message.subtype === 'compact_boundary'
}

function isBoundaryMessage(message: Message | undefined): boolean {
  return isCompactBoundaryMessage(message) || isSnipBoundaryMessage(message)
}

function estimateValueTokens(value: unknown): number {
  if (typeof value === 'string') {
    return Math.ceil(value.length / 4)
  }
  return Math.ceil(JSON.stringify(value ?? '').length / 4)
}

function estimateMessageTokens(message: Message): number {
  if (message.type === 'assistant' && message.message.usage) {
    const usage = message.message.usage
    return (
      (usage.input_tokens ?? 0) +
      (usage.output_tokens ?? 0) +
      (usage.cache_creation_input_tokens ?? 0) +
      (usage.cache_read_input_tokens ?? 0)
    )
  }
  if (
    (message.type === 'assistant' || message.type === 'user') &&
    message.message
  ) {
    return estimateValueTokens(message.message.content)
  }
  return estimateValueTokens(message.content ?? message)
}

function estimateMessagesTokens(messages: readonly Message[]): number {
  return messages.reduce(
    (total, message) => total + estimateMessageTokens(message),
    0,
  )
}

export function isSnipRuntimeEnabled(): boolean {
  return (
    !isEnvTruthy(process.env.DISABLE_COMPACT) &&
    !isEnvTruthy(process.env.DISABLE_SNIP) &&
    !isEnvTruthy(process.env.CLAUDE_CODE_DISABLE_SNIP)
  )
}

export function isSnipMarkerMessage(
  message: Message | SystemMessage | undefined,
): boolean {
  return message?.type === 'system' && message.subtype === 'snip_marker'
}

export function shouldNudgeForSnips(messages: Message[]): boolean {
  if (!isSnipRuntimeEnabled()) return false
  return (
    estimateMessagesTokens(projectSnippedView(messages)) >=
    envInt('CLAUDE_CODE_SNIP_NUDGE_TOKENS', DEFAULT_NUDGE_TOKENS)
  )
}

function isToolResultOnly(message: Message): boolean {
  return (
    message.type === 'user' &&
    Array.isArray(message.message.content) &&
    message.message.content.length > 0 &&
    message.message.content.every(block => block.type === 'tool_result')
  )
}

function isTurnStarter(message: Message): boolean {
  return message.type === 'user' && !isToolResultOnly(message)
}

function getToolUseIds(message: Message): string[] {
  if (message.type !== 'assistant' || !Array.isArray(message.message.content)) {
    return []
  }
  return message.message.content
    .filter((block): block is ToolUseBlockParam => block.type === 'tool_use')
    .map(block => block.id)
}

function getToolResultIds(message: Message): string[] {
  if (message.type !== 'user' || !Array.isArray(message.message.content)) {
    return []
  }
  return message.message.content
    .filter(
      (block): block is { type: 'tool_result'; tool_use_id: string } =>
        block.type === 'tool_result' &&
        typeof block.tool_use_id === 'string',
    )
    .map(block => block.tool_use_id)
}

function findActiveStart(messages: Message[]): number {
  let start = 0
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (!message) continue
    if (isBoundaryMessage(message)) {
      start = i + 1
      break
    }
  }
  return start
}

function findProtectedStart(messages: Message[], activeStart: number): number {
  const protectedTail = envInt(
    'CLAUDE_CODE_SNIP_PROTECTED_TAIL_MESSAGES',
    DEFAULT_PROTECTED_TAIL_MESSAGES,
  )
  let start = Math.max(activeStart, messages.length - protectedTail)

  while (start > activeStart) {
    const message = messages[start]
    if (message && isTurnStarter(message)) return start
    start--
  }
  return activeStart
}

function isRemovableSegment(messages: Message[]): boolean {
  const first = messages[0]
  return Boolean(
    first &&
      isTurnStarter(first) &&
      !messages.some(message => message.type === 'system'),
  )
}

function buildSegments(
  messages: Message[],
  activeStart: number,
  protectedStart: number,
): SnipSegment[] {
  const segments: SnipSegment[] = []
  let index = activeStart

  while (index < protectedStart) {
    const start = index
    index++
    while (
      index < protectedStart &&
      !isTurnStarter(messages[index]!) &&
      !isBoundaryMessage(messages[index])
    ) {
      index++
    }

    const segmentMessages = messages.slice(start, index)
    segments.push({
      start,
      end: index,
      messages: segmentMessages,
      tokens: estimateMessagesTokens(segmentMessages),
      removable: isRemovableSegment(segmentMessages),
      uuidSet: new Set(segmentMessages.map(message => message.uuid)),
      idSet: new Set(
        segmentMessages.flatMap(message => [
          message.uuid,
          shortMessageIdForSnip(message),
        ]),
      ),
    })
  }

  return segments
}

function resolveTargetTokens(
  totalTokens: number,
  threshold: number,
  options: SnipOptions,
): number {
  if (
    options.targetTokens !== undefined &&
    Number.isFinite(options.targetTokens) &&
    options.targetTokens > 0
  ) {
    return Math.floor(options.targetTokens)
  }

  const envTarget = envInt('CLAUDE_CODE_SNIP_TARGET_TOKENS', 0)
  if (envTarget > 0) return envTarget

  if (options.force) {
    return Math.max(1, Math.floor(totalTokens * 0.6))
  }

  return Math.min(
    DEFAULT_TARGET_TOKENS,
    Math.max(1, Math.floor(threshold * 0.75)),
  )
}

function normalizeTargets(options: SnipOptions): Set<string> {
  return new Set(
    [...(options.targetMessageIds ?? []), ...(options.targetUuids ?? [])]
      .map(id => id.trim())
      .filter(Boolean),
  )
}

function addSegmentWithToolPairs(
  segments: SnipSegment[],
  selected: Set<number>,
  index: number,
): boolean {
  const segment = segments[index]
  if (!segment?.removable) return false
  selected.add(index)

  let changed = true
  while (changed) {
    changed = false
    for (const selectedIndex of Array.from(selected)) {
      const selectedSegment = segments[selectedIndex]
      if (!selectedSegment) continue

      const selectedToolUseIds = new Set(
        selectedSegment.messages.flatMap(getToolUseIds),
      )
      const selectedToolResultIds = new Set(
        selectedSegment.messages.flatMap(getToolResultIds),
      )

      for (const [candidateIndex, candidate] of segments.entries()) {
        if (selected.has(candidateIndex)) continue

        const candidateToolUseIds = candidate.messages.flatMap(getToolUseIds)
        const candidateToolResultIds =
          candidate.messages.flatMap(getToolResultIds)

        const needsCandidate =
          candidateToolResultIds.some(id => selectedToolUseIds.has(id)) ||
          candidateToolUseIds.some(id => selectedToolResultIds.has(id))

        if (!needsCandidate) continue
        if (!candidate.removable) return false

        selected.add(candidateIndex)
        changed = true
      }
    }
  }

  return true
}

function selectTargetedSegments(
  segments: SnipSegment[],
  targets: Set<string>,
): Set<number> | null {
  const selected = new Set<number>()
  for (const [index, segment] of segments.entries()) {
    if (![...targets].some(target => segment.idSet.has(target))) continue
    if (!addSegmentWithToolPairs(segments, selected, index)) return null
  }
  return selected
}

function selectAutoSegments(
  segments: SnipSegment[],
  targetFreedTokens: number,
): Set<number> | null {
  const selected = new Set<number>()
  let freed = 0

  for (const [index, segment] of segments.entries()) {
    if (!segment.removable) continue
    const beforeSize = selected.size
    if (!addSegmentWithToolPairs(segments, selected, index)) continue

    if (selected.size !== beforeSize) {
      freed = Array.from(selected).reduce(
        (total, selectedIndex) => total + (segments[selectedIndex]?.tokens ?? 0),
        0,
      )
    }
    if (freed >= targetFreedTokens) break
  }

  return selected.size > 0 ? selected : null
}

function selectedMessages(
  segments: SnipSegment[],
  selected: Set<number>,
): Message[] {
  return Array.from(selected)
    .sort((a, b) => a - b)
    .flatMap(index => segments[index]?.messages ?? [])
}

function selectionSplitsToolPairs(
  messages: Message[],
  removedUuids: Set<string>,
): boolean {
  const toolUseRemoved = new Map<string, boolean>()
  const toolResultRemoved = new Map<string, boolean>()

  for (const message of messages) {
    const removed = removedUuids.has(message.uuid)
    for (const id of getToolUseIds(message)) {
      toolUseRemoved.set(id, removed)
    }
    for (const id of getToolResultIds(message)) {
      toolResultRemoved.set(id, removed)
    }
  }

  for (const [id, removed] of toolUseRemoved) {
    if (toolResultRemoved.has(id) && toolResultRemoved.get(id) !== removed) {
      return true
    }
  }
  for (const [id, removed] of toolResultRemoved) {
    if (toolUseRemoved.has(id) && toolUseRemoved.get(id) !== removed) {
      return true
    }
  }

  return false
}

function selectedRanges(segments: SnipSegment[], selected: Set<number>) {
  const sorted = Array.from(selected).sort((a, b) => a - b)
  const ranges: {
    startUuid: string
    endUuid: string
    messages: number
    tokensFreed: number
  }[] = []
  let previousSelectedIndex: number | undefined

  for (const index of sorted) {
    const segment = segments[index]
    if (!segment || segment.messages.length === 0) continue
    const lastRange = ranges.at(-1)
    const firstMessage = segment.messages[0]!
    const lastMessage = segment.messages.at(-1)!

    if (
      lastRange &&
      previousSelectedIndex === index - 1 &&
      segments[index - 1]?.end === segment.start
    ) {
      lastRange.endUuid = lastMessage.uuid
      lastRange.messages += segment.messages.length
      lastRange.tokensFreed += segment.tokens
    } else {
      ranges.push({
        startUuid: firstMessage.uuid,
        endUuid: lastMessage.uuid,
        messages: segment.messages.length,
        tokensFreed: segment.tokens,
      })
    }
    previousSelectedIndex = index
  }

  return ranges
}

function createSnipBoundaryMessage({
  removed,
  ranges,
  tokensFreed,
  trigger,
  strategy,
  reason,
  preTokens,
  postTokens,
  targetTokens,
  targetMessageIds,
}: {
  removed: Message[]
  ranges: ReturnType<typeof selectedRanges>
  tokensFreed: number
  trigger: SnipTrigger
  strategy: SnipStrategy
  reason?: string
  preTokens: number
  postTokens: number
  targetTokens: number
  targetMessageIds?: string[]
}): SnipBoundaryMessage {
  return {
    type: 'system',
    subtype: 'snip_boundary',
    content: 'Conversation history snipped',
    isMeta: false,
    timestamp: new Date().toISOString(),
    uuid: randomUUID(),
    level: 'info',
    snipMetadata: {
      trigger,
      strategy,
      removedUuids: removed.map(message => message.uuid),
      removedMessages: removed.length,
      tokensFreed,
      preTokens,
      postTokens,
      targetTokens,
      protectedTailMessages: envInt(
        'CLAUDE_CODE_SNIP_PROTECTED_TAIL_MESSAGES',
        DEFAULT_PROTECTED_TAIL_MESSAGES,
      ),
      removedRanges: ranges,
      targetMessageIds,
      reason,
    },
  }
}

export function snipCompactIfNeeded(
  messages: Message[],
  options: SnipOptions = {},
): SnipCompactResult {
  const projectedMessages = projectSnippedView(messages)
  const force = options.force === true
  const targets = normalizeTargets(options)

  if (!force && targets.size === 0 && !isSnipRuntimeEnabled()) {
    return {
      messages: projectedMessages,
      executed: false,
      tokensFreed: 0,
      removedMessages: 0,
    }
  }

  const preTokens = estimateMessagesTokens(projectedMessages)
  const threshold = envInt(
    'CLAUDE_CODE_SNIP_TRIGGER_TOKENS',
    DEFAULT_TRIGGER_TOKENS,
  )
  if (!force && targets.size === 0 && preTokens < threshold) {
    return {
      messages: projectedMessages,
      executed: false,
      tokensFreed: 0,
      removedMessages: 0,
    }
  }

  const activeStart = findActiveStart(projectedMessages)
  const protectedStart = findProtectedStart(projectedMessages, activeStart)
  const segments = buildSegments(projectedMessages, activeStart, protectedStart)
  const targetTokens = resolveTargetTokens(preTokens, threshold, options)
  const targetFreedTokens = Math.max(1, preTokens - targetTokens)
  const selected =
    targets.size > 0
      ? selectTargetedSegments(segments, targets)
      : selectAutoSegments(segments, targetFreedTokens)

  if (!selected || selected.size === 0) {
    return {
      messages: projectedMessages,
      executed: false,
      tokensFreed: 0,
      removedMessages: 0,
    }
  }

  const removed = selectedMessages(segments, selected)
  const removedUuids = new Set(removed.map(message => message.uuid))
  if (selectionSplitsToolPairs(projectedMessages, removedUuids)) {
    return {
      messages: projectedMessages,
      executed: false,
      tokensFreed: 0,
      removedMessages: 0,
    }
  }

  const minRemoved = force || targets.size > 0
    ? 1
    : envInt('CLAUDE_CODE_SNIP_MIN_REMOVED_MESSAGES', DEFAULT_MIN_REMOVED_MESSAGES)

  if (removed.length < minRemoved) {
    return {
      messages: projectedMessages,
      executed: false,
      tokensFreed: 0,
      removedMessages: 0,
    }
  }

  const kept = projectedMessages.filter(message => !removedUuids.has(message.uuid))
  const tokensFreed = estimateMessagesTokens(removed)
  const postTokens = Math.max(0, preTokens - tokensFreed)
  const strategy: SnipStrategy =
    targets.size > 0 ? 'targeted_segments' : 'auto_segments'
  const boundaryMessage = createSnipBoundaryMessage({
    removed,
    ranges: selectedRanges(segments, selected),
    tokensFreed,
    trigger: options.trigger ?? (force ? 'manual' : 'auto'),
    strategy,
    reason: options.reason,
    preTokens,
    postTokens,
    targetTokens,
    targetMessageIds: targets.size > 0 ? Array.from(targets) : undefined,
  })

  return {
    messages: kept,
    executed: true,
    tokensFreed,
    removedMessages: removed.length,
    boundaryMessage,
    strategy,
    preTokens,
    postTokens,
  }
}

export function replaySnipBoundary(
  messages: Message[],
  boundary: Message,
): SnipCompactResult | undefined {
  if (!isSnipBoundaryMessage(boundary)) return undefined

  const alreadyPresent = messages.some(message => message.uuid === boundary.uuid)
  const withBoundary = alreadyPresent ? messages : [...messages, boundary]
  const projected = projectSnippedView(withBoundary)
  const removedMessages = Math.max(0, withBoundary.length - projected.length)
  const tokensFreed = boundary.snipMetadata.tokensFreed ?? 0
  const preTokens = estimateMessagesTokens(withBoundary)
  const postTokens = Math.max(0, preTokens - tokensFreed)

  return {
    messages: projected,
    executed: removedMessages > 0 || !alreadyPresent,
    tokensFreed,
    removedMessages: boundary.snipMetadata.removedMessages,
    boundaryMessage: boundary,
    strategy: 'boundary_replay',
    preTokens,
    postTokens,
  }
}

export function shortMessageIdForSnip(message: Message): string {
  return deriveShortMessageId(message.uuid)
}
