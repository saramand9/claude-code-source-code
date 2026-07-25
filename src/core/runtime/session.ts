import type { TranscriptMessage } from '../../types/logs.js'
import type { Message, SystemCompactBoundaryMessage } from '../../types/message.js'

export type { TranscriptMessage } from '../../types/logs.js'

export type TranscriptUuid = TranscriptMessage['uuid']

/**
 * Session-scoped fields that the product implementation reads from bootstrap,
 * git, and environment state before writing each message. Portable hosts pass
 * the already-resolved values instead.
 */
export type SessionStamp = {
  cwd: string
  userType: string
  entrypoint?: string
  sessionId: string
  version: string
  gitBranch?: string
  slug?: string
}

export type InsertMessageChainOptions = {
  isSidechain?: boolean
  agentId?: string
  startingParentUuid?: TranscriptUuid | null
  teamInfo?: {
    teamName?: string
    agentName?: string
  }
  promptId?: string
}

export type ParsedTranscript = {
  messages: Map<TranscriptUuid, TranscriptMessage>
  leafUuids: Set<TranscriptUuid>
}

type PreservedSegment = {
  headUuid: TranscriptUuid
  anchorUuid: TranscriptUuid
  tailUuid: TranscriptUuid
}

type LegacyProgressEntry = {
  type: 'progress'
  uuid: TranscriptUuid
  parentUuid: TranscriptUuid | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function hasTranscriptMessageType(
  value: unknown,
): value is Extract<
  Message,
  { type: 'user' | 'assistant' | 'attachment' | 'system' }
> {
  if (!isRecord(value)) return false
  return (
    value.type === 'user' ||
    value.type === 'assistant' ||
    value.type === 'attachment' ||
    value.type === 'system'
  )
}

/**
 * Transcript messages include user, assistant, attachment, and system
 * messages. Progress messages are ephemeral UI state and must not be
 * persisted or participate in the parentUuid chain.
 */
export function isTranscriptMessage(
  entry: unknown,
): entry is TranscriptMessage {
  if (!hasTranscriptMessageType(entry)) return false
  if (typeof entry.uuid !== 'string') return false
  if (entry.parentUuid !== null && typeof entry.parentUuid !== 'string') {
    return false
  }
  return (
    typeof entry.cwd === 'string' &&
    typeof entry.userType === 'string' &&
    typeof entry.sessionId === 'string' &&
    typeof entry.timestamp === 'string' &&
    typeof entry.version === 'string' &&
    typeof entry.isSidechain === 'boolean'
  )
}

function isLegacyProgressEntry(entry: unknown): entry is LegacyProgressEntry {
  return (
    isRecord(entry) &&
    entry.type === 'progress' &&
    typeof entry.uuid === 'string' &&
    (entry.parentUuid === null || typeof entry.parentUuid === 'string')
  )
}

function isCompactBoundaryMessage(
  message: TranscriptMessage,
): message is TranscriptMessage & SystemCompactBoundaryMessage {
  return message.type === 'system' && message.subtype === 'compact_boundary'
}

/**
 * Pure version of Project.insertMessageChain().
 *
 * It preserves the original transcript protocol while taking session state as
 * data: normal messages form a sequential parent chain, tool_result messages
 * point to their source assistant when available, and compact boundaries
 * deliberately start a new physical chain while retaining the logical parent.
 */
export function insertMessageChain(
  messages: readonly Message[],
  stamp: SessionStamp,
  options: InsertMessageChainOptions = {},
): TranscriptMessage[] {
  const transcript: TranscriptMessage[] = []
  let parentUuid: TranscriptUuid | null =
    options.startingParentUuid ?? null
  const isSidechain = options.isSidechain ?? false

  for (const message of messages) {
    if (!hasTranscriptMessageType(message)) continue

    const isCompactBoundary =
      message.type === 'system' && message.subtype === 'compact_boundary'

    // For tool_result messages, use the assistant message UUID recorded when
    // the result was created; otherwise fall back to the sequential parent.
    let effectiveParentUuid = parentUuid
    if (
      message.type === 'user' &&
      message.sourceToolAssistantUUID
    ) {
      effectiveParentUuid = message.sourceToolAssistantUUID
    }

    const transcriptMessage = {
      parentUuid: isCompactBoundary ? null : effectiveParentUuid,
      logicalParentUuid: isCompactBoundary ? parentUuid : undefined,
      isSidechain,
      teamName: options.teamInfo?.teamName,
      agentName: options.teamInfo?.agentName,
      promptId: message.type === 'user' ? options.promptId : undefined,
      agentId: options.agentId,
      ...message,
      // Session stamps intentionally come after the message spread. Resumed
      // or forked messages may carry source-session fields; the destination
      // transcript must always be stamped with the current session.
      userType: stamp.userType,
      entrypoint: stamp.entrypoint,
      cwd: stamp.cwd,
      sessionId: stamp.sessionId,
      version: stamp.version,
      gitBranch: stamp.gitBranch,
      slug: stamp.slug,
    } as TranscriptMessage

    transcript.push(transcriptMessage)
    parentUuid = message.uuid
  }

  return transcript
}

/**
 * Serialize append-only transcript entries using Claude Code's JSONL shape.
 * The trailing newline lets callers append the returned text directly.
 */
export function serializeTranscriptEntries(
  entries: readonly TranscriptMessage[],
): string {
  if (entries.length === 0) return ''
  return entries.map(entry => JSON.stringify(entry)).join('\n') + '\n'
}

function getPreservedSegment(
  boundary: TranscriptMessage & SystemCompactBoundaryMessage,
): PreservedSegment | undefined {
  const candidate = boundary.compactMetadata?.preservedSegment
  if (!isRecord(candidate)) return undefined
  if (
    typeof candidate.headUuid !== 'string' ||
    typeof candidate.anchorUuid !== 'string' ||
    typeof candidate.tailUuid !== 'string'
  ) {
    return undefined
  }
  return {
    headUuid: candidate.headUuid as TranscriptUuid,
    anchorUuid: candidate.anchorUuid as TranscriptUuid,
    tailUuid: candidate.tailUuid as TranscriptUuid,
  }
}

/**
 * Splice the preserved segment back into the chain after compaction.
 *
 * Preserved messages remain in JSONL with their original pre-compact
 * parentUuids because the write path de-duplicates them. Their internal chain
 * is intact; only the endpoints need patching: head -> anchor, and anchor's
 * other children -> tail.
 *
 * Unlike the product's general-purpose loader, this portable parser is
 * resume-oriented, so an ordinary final compact boundary also discards the
 * physically older prefix immediately.
 */
function applyLastCompactBoundary(
  messages: Map<TranscriptUuid, TranscriptMessage>,
): void {
  let lastBoundary:
    | (TranscriptMessage & SystemCompactBoundaryMessage)
    | undefined
  let lastBoundaryIndex = -1
  const entryIndex = new Map<TranscriptUuid, number>()

  let index = 0
  for (const message of messages.values()) {
    entryIndex.set(message.uuid, index)
    if (isCompactBoundaryMessage(message)) {
      lastBoundary = message
      lastBoundaryIndex = index
    }
    index++
  }

  if (!lastBoundary || lastBoundaryIndex < 0) return

  const segment = getPreservedSegment(lastBoundary)
  const preservedUuids = new Set<TranscriptUuid>()

  if (segment) {
    // Validate tail -> head before mutating. If the stored segment is
    // incomplete, keep the full history rather than returning a truncated
    // or dangling resume chain.
    const walkSeen = new Set<TranscriptUuid>()
    let current = messages.get(segment.tailUuid)
    let reachedHead = false
    while (current && !walkSeen.has(current.uuid)) {
      walkSeen.add(current.uuid)
      preservedUuids.add(current.uuid)
      if (current.uuid === segment.headUuid) {
        reachedHead = true
        break
      }
      current = current.parentUuid
        ? messages.get(current.parentUuid)
        : undefined
    }
    if (!reachedHead) return

    const head = messages.get(segment.headUuid)
    if (head) {
      messages.set(segment.headUuid, {
        ...head,
        parentUuid: segment.anchorUuid,
      })
    }

    // New messages written after compaction initially chain to the summary
    // anchor. Move those children after the preserved tail.
    for (const [uuid, message] of messages) {
      if (
        message.parentUuid === segment.anchorUuid &&
        uuid !== segment.headUuid
      ) {
        messages.set(uuid, { ...message, parentUuid: segment.tailUuid })
      }
    }

    // On-disk usage reflects the pre-compact context. Keeping it would make a
    // resumed session immediately look over threshold and compact again.
    for (const uuid of preservedUuids) {
      const message = messages.get(uuid)
      if (message?.type !== 'assistant') continue
      messages.set(uuid, {
        ...message,
        message: {
          ...message.message,
          usage: {
            ...message.message.usage,
            input_tokens: 0,
            output_tokens: 0,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
          },
        },
      })
    }
  }

  // Remove the stale physical prefix. A valid preserved segment is the only
  // pre-boundary content that remains reachable after compaction.
  for (const [uuid] of messages) {
    const messageIndex = entryIndex.get(uuid)
    if (
      messageIndex !== undefined &&
      messageIndex < lastBoundaryIndex &&
      !preservedUuids.has(uuid)
    ) {
      messages.delete(uuid)
    }
  }
}

function computeLeafUuids(
  messages: Map<TranscriptUuid, TranscriptMessage>,
): Set<TranscriptUuid> {
  const parentUuids = new Set<TranscriptUuid>()
  for (const message of messages.values()) {
    if (message.parentUuid) parentUuids.add(message.parentUuid)
  }

  const leafUuids = new Set<TranscriptUuid>()
  for (const terminal of messages.values()) {
    if (parentUuids.has(terminal.uuid)) continue

    // System and attachment messages may terminate the physical chain, but
    // only user/assistant messages are valid conversation resume leaves.
    const seen = new Set<TranscriptUuid>()
    let current: TranscriptMessage | undefined = terminal
    while (current) {
      if (seen.has(current.uuid)) break
      seen.add(current.uuid)
      if (current.type === 'user' || current.type === 'assistant') {
        leafUuids.add(current.uuid)
        break
      }
      current = current.parentUuid
        ? messages.get(current.parentUuid)
        : undefined
    }
  }
  return leafUuids
}

/**
 * Parse transcript JSONL without platform I/O.
 *
 * Malformed lines and non-transcript metadata entries are ignored. Duplicate
 * UUIDs follow the original Map-based loader semantics: the last value wins.
 * Legacy progress entries are not retained, but their parent links are used
 * to bridge old transcripts written before progress became ephemeral.
 */
export function parseTranscriptJsonl(jsonl: string): ParsedTranscript {
  const messages = new Map<TranscriptUuid, TranscriptMessage>()
  const progressBridge = new Map<
    TranscriptUuid,
    TranscriptUuid | null
  >()
  const input = jsonl.charCodeAt(0) === 0xfeff ? jsonl.slice(1) : jsonl

  let start = 0
  while (start < input.length) {
    let end = input.indexOf('\n', start)
    if (end === -1) end = input.length
    const line = input.slice(start, end).trim()
    start = end + 1
    if (!line) continue

    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      continue
    }

    if (isLegacyProgressEntry(parsed)) {
      const parent = parsed.parentUuid
      progressBridge.set(
        parsed.uuid,
        parent && progressBridge.has(parent)
          ? (progressBridge.get(parent) ?? null)
          : parent,
      )
      continue
    }

    if (!isTranscriptMessage(parsed)) continue

    const entry =
      parsed.parentUuid && progressBridge.has(parsed.parentUuid)
        ? {
            ...parsed,
            parentUuid: progressBridge.get(parsed.parentUuid) ?? null,
          }
        : parsed
    messages.set(entry.uuid, entry)
  }

  applyLastCompactBoundary(messages)
  return {
    messages,
    leafUuids: computeLeafUuids(messages),
  }
}

/**
 * Builds a conversation chain from a leaf message to root.
 * Cycles terminate the walk and return the recoverable partial transcript.
 */
export function buildConversationChain(
  messages: Map<TranscriptUuid, TranscriptMessage>,
  leafMessage: TranscriptMessage,
): TranscriptMessage[] {
  const transcript: TranscriptMessage[] = []
  const seen = new Set<TranscriptUuid>()
  let currentMsg: TranscriptMessage | undefined = leafMessage

  while (currentMsg) {
    if (seen.has(currentMsg.uuid)) break
    seen.add(currentMsg.uuid)
    transcript.push(currentMsg)
    currentMsg = currentMsg.parentUuid
      ? messages.get(currentMsg.parentUuid)
      : undefined
  }

  transcript.reverse()
  return recoverOrphanedParallelToolResults(messages, transcript, seen)
}

/**
 * Select the most recently written conversation leaf and rebuild its chain.
 * This is the platform-neutral core of loadTranscriptFromFile's resume path.
 */
export function buildLatestConversationChain(
  parsed: ParsedTranscript,
): TranscriptMessage[] {
  let latest: TranscriptMessage | undefined
  let latestTime = -Infinity
  for (const uuid of parsed.leafUuids) {
    const candidate = parsed.messages.get(uuid)
    if (!candidate) continue
    const timestamp = Date.parse(candidate.timestamp)
    if (!latest || timestamp > latestTime) {
      latest = candidate
      latestTime = timestamp
    }
  }
  return latest ? buildConversationChain(parsed.messages, latest) : []
}

/**
 * Recover sibling assistant blocks and tool_results that a single-parent walk
 * would otherwise orphan.
 *
 * Streaming emits one AssistantMessage per content block. Parallel tool uses
 * therefore have distinct UUIDs but the same API message.id, and each
 * tool_result points at its own assistant block. The stored topology is a DAG;
 * this post-pass restores the complete API round.
 */
function recoverOrphanedParallelToolResults(
  messages: Map<TranscriptUuid, TranscriptMessage>,
  chain: TranscriptMessage[],
  seen: Set<TranscriptUuid>,
): TranscriptMessage[] {
  type ChainAssistant = Extract<TranscriptMessage, { type: 'assistant' }>
  const chainAssistants = chain.filter(
    (message): message is ChainAssistant => message.type === 'assistant',
  )
  if (chainAssistants.length === 0) return chain

  // Anchor is the last on-chain member of each sibling group.
  const anchorByMessageId = new Map<string, ChainAssistant>()
  for (const assistant of chainAssistants) {
    if (assistant.message.id) {
      anchorByMessageId.set(assistant.message.id, assistant)
    }
  }

  const siblingsByMessageId = new Map<string, TranscriptMessage[]>()
  const toolResultsByAssistant = new Map<
    TranscriptUuid,
    TranscriptMessage[]
  >()
  for (const message of messages.values()) {
    if (message.type === 'assistant' && message.message.id) {
      const group = siblingsByMessageId.get(message.message.id)
      if (group) group.push(message)
      else siblingsByMessageId.set(message.message.id, [message])
    } else if (
      message.type === 'user' &&
      message.parentUuid &&
      Array.isArray(message.message.content) &&
      message.message.content.some(
        (block: { type?: string }) => block.type === 'tool_result',
      )
    ) {
      const group = toolResultsByAssistant.get(message.parentUuid)
      if (group) group.push(message)
      else toolResultsByAssistant.set(message.parentUuid, [message])
    }
  }

  const processedGroups = new Set<string>()
  const inserts = new Map<TranscriptUuid, TranscriptMessage[]>()
  let recoveredCount = 0

  for (const assistant of chainAssistants) {
    const messageId = assistant.message.id
    if (!messageId || processedGroups.has(messageId)) continue
    processedGroups.add(messageId)

    const group = siblingsByMessageId.get(messageId) ?? [assistant]
    const orphanedSiblings = group.filter(
      sibling => !seen.has(sibling.uuid),
    )
    const orphanedToolResults: TranscriptMessage[] = []
    for (const member of group) {
      const results = toolResultsByAssistant.get(member.uuid)
      if (!results) continue
      for (const result of results) {
        if (!seen.has(result.uuid)) orphanedToolResults.push(result)
      }
    }
    if (
      orphanedSiblings.length === 0 &&
      orphanedToolResults.length === 0
    ) {
      continue
    }

    const byTimestamp = (
      left: TranscriptMessage,
      right: TranscriptMessage,
    ) =>
      String(left.timestamp ?? '').localeCompare(
        String(right.timestamp ?? ''),
      )
    orphanedSiblings.sort(byTimestamp)
    orphanedToolResults.sort(byTimestamp)

    const anchor = anchorByMessageId.get(messageId)
    if (!anchor) continue
    const recovered = [...orphanedSiblings, ...orphanedToolResults]
    for (const message of recovered) seen.add(message.uuid)
    recoveredCount += recovered.length
    inserts.set(anchor.uuid, recovered)
  }

  if (recoveredCount === 0) return chain

  const result: TranscriptMessage[] = []
  for (const message of chain) {
    result.push(message)
    const toInsert = inserts.get(message.uuid)
    if (toInsert) result.push(...toInsert)
  }
  return result
}
