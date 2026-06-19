/**
 * Standalone implementation of listSessions for the Agent SDK.
 *
 * Dependencies are kept minimal and portable — no bootstrap/state.ts,
 * no analytics, no bun:bundle, no module-scope mutable state. This module
 * can be imported safely from the SDK entrypoint without triggering CLI
 * initialization or pulling in expensive dependency chains.
 */

import type { Dirent } from 'fs'
import { randomUUID, type UUID } from 'crypto'
import {
  appendFile,
  mkdir,
  readdir,
  stat,
  writeFile,
} from 'fs/promises'
import { basename, dirname, join } from 'path'
import type { SDKMessage } from '../entrypoints/sdk/coreTypes.js'
import { getWorktreePathsPortable } from './getWorktreePathsPortable.js'
import type { LiteSessionFile } from './sessionStoragePortable.js'
import {
  canonicalizePath,
  extractFirstPromptFromHead,
  extractJsonStringField,
  extractLastJsonStringField,
  findProjectDir,
  getProjectsDir,
  MAX_SANITIZED_LENGTH,
  readTranscriptForLoad,
  readSessionLite,
  resolveSessionFilePath,
  sanitizePath,
  validateUuid,
} from './sessionStoragePortable.js'

/**
 * Session metadata returned by listSessions.
 * Contains only data extractable from stat + head/tail reads — no full
 * JSONL parsing required.
 */
export type SessionInfo = {
  sessionId: string
  summary: string
  lastModified: number
  fileSize?: number
  customTitle?: string
  firstPrompt?: string
  gitBranch?: string
  cwd?: string
  tag?: string
  /** Epoch ms — from first entry's ISO timestamp. Undefined if unparseable. */
  createdAt?: number
}

export type ListSessionsOptions = {
  /**
   * Directory to list sessions for. When provided, returns sessions for
   * this project directory (and optionally its git worktrees). When omitted,
   * returns sessions across all projects.
   */
  dir?: string
  /** Maximum number of sessions to return. */
  limit?: number
  /**
   * Number of sessions to skip from the start of the sorted result set.
   * Use with `limit` for pagination. Defaults to 0.
   */
  offset?: number
  /**
   * When `dir` is provided and the directory is inside a git repository,
   * include sessions from all git worktree paths. Defaults to `true`.
   */
  includeWorktrees?: boolean
}

export type GetSessionInfoOptions = {
  dir?: string
}

export type GetSessionMessagesOptions = {
  dir?: string
  limit?: number
  offset?: number
  includeSystemMessages?: boolean
}

export type SessionMutationOptions = {
  dir?: string
}

export type ForkSessionOptions = {
  dir?: string
  upToMessageId?: string
  title?: string
}

export type ForkSessionResult = {
  sessionId: string
}

type TranscriptEntry = Record<string, unknown> & {
  type: 'user' | 'assistant' | 'system'
  uuid: UUID
  parentUuid: UUID | null
  sessionId: string
  timestamp?: string
  isSidechain?: boolean
  message?: Record<string, unknown>
  order: number
}

// ---------------------------------------------------------------------------
// Field extraction — shared by listSessionsImpl and getSessionInfoImpl
// ---------------------------------------------------------------------------

/**
 * Parses SessionInfo fields from a lite session read (head/tail/stat).
 * Returns null for sidechain sessions or metadata-only sessions with no
 * extractable summary.
 *
 * Exported for reuse by getSessionInfoImpl.
 */
export function parseSessionInfoFromLite(
  sessionId: string,
  lite: LiteSessionFile,
  projectPath?: string,
): SessionInfo | null {
  const { head, tail, mtime, size } = lite

  // Check first line for sidechain sessions
  const firstNewline = head.indexOf('\n')
  const firstLine = firstNewline >= 0 ? head.slice(0, firstNewline) : head
  if (
    firstLine.includes('"isSidechain":true') ||
    firstLine.includes('"isSidechain": true')
  ) {
    return null
  }
  // User title (customTitle) wins over AI title (aiTitle); distinct
  // field names mean extractLastJsonStringField naturally disambiguates.
  const customTitle =
    extractLastJsonStringField(tail, 'customTitle') ||
    extractLastJsonStringField(head, 'customTitle') ||
    extractLastJsonStringField(tail, 'aiTitle') ||
    extractLastJsonStringField(head, 'aiTitle') ||
    undefined
  const firstPrompt = extractFirstPromptFromHead(head) || undefined
  // First entry's ISO timestamp → epoch ms. More reliable than
  // stat().birthtime which is unsupported on some filesystems.
  const firstTimestamp = extractJsonStringField(head, 'timestamp')
  let createdAt: number | undefined
  if (firstTimestamp) {
    const parsed = Date.parse(firstTimestamp)
    if (!Number.isNaN(parsed)) createdAt = parsed
  }
  // last-prompt tail entry (captured by extractFirstPrompt at write
  // time, filtered) shows what the user was most recently doing.
  // Head scan is fallback for sessions without a last-prompt entry.
  const summary =
    customTitle ||
    extractLastJsonStringField(tail, 'lastPrompt') ||
    extractLastJsonStringField(tail, 'summary') ||
    firstPrompt

  // Skip metadata-only sessions (no title, no summary, no prompt)
  if (!summary) return null
  const gitBranch =
    extractLastJsonStringField(tail, 'gitBranch') ||
    extractJsonStringField(head, 'gitBranch') ||
    undefined
  const sessionCwd =
    extractJsonStringField(head, 'cwd') || projectPath || undefined
  // Type-scope tag extraction to the {"type":"tag"} JSONL line to avoid
  // collision with tool_use inputs containing a `tag` parameter (git tag,
  // Docker tags, cloud resource tags). Mirrors sessionStorage.ts:608.
  const tagLine = tail.split('\n').findLast(l => l.startsWith('{"type":"tag"'))
  const tag = tagLine
    ? extractLastJsonStringField(tagLine, 'tag') || undefined
    : undefined

  return {
    sessionId,
    summary,
    lastModified: mtime,
    fileSize: size,
    customTitle,
    firstPrompt,
    gitBranch,
    cwd: sessionCwd,
    tag,
    createdAt,
  }
}

// ---------------------------------------------------------------------------
// Candidate discovery — stat-only pass. Cheap: 1 syscall per file, no
// data reads. Lets us sort/filter before doing expensive head/tail reads.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Session message loading - full JSONL parse for a single session.
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseJsonlRecords(buf: Buffer): Record<string, unknown>[] {
  const text = buf.toString('utf8')
  const records: Record<string, unknown>[] = []
  let start = 0

  while (start < text.length) {
    let end = text.indexOf('\n', start)
    if (end < 0) end = text.length

    const line = text.slice(start, end).trim()
    start = end + 1
    if (!line) continue

    try {
      const parsed = JSON.parse(line)
      if (isRecord(parsed)) records.push(parsed)
    } catch {
      // Match the CLI JSONL reader: malformed lines are ignored.
    }
  }

  return records
}

function normalizeTranscriptEntry(
  entry: Record<string, unknown>,
  fallbackSessionId: UUID,
  order: number,
): TranscriptEntry | null {
  const type = entry.type
  if (type !== 'user' && type !== 'assistant' && type !== 'system') return null

  const uuid = validateUuid(entry.uuid)
  if (!uuid) return null

  if ((type === 'user' || type === 'assistant') && !isRecord(entry.message)) {
    return null
  }

  const parentUuid =
    entry.parentUuid === null ? null : (validateUuid(entry.parentUuid) ?? null)
  const sessionId =
    typeof entry.session_id === 'string'
      ? entry.session_id
      : typeof entry.sessionId === 'string'
        ? entry.sessionId
        : fallbackSessionId

  return {
    ...entry,
    type,
    uuid,
    parentUuid,
    sessionId,
    isSidechain: entry.isSidechain === true,
    timestamp: typeof entry.timestamp === 'string' ? entry.timestamp : undefined,
    message: isRecord(entry.message) ? entry.message : undefined,
    order,
  }
}

function compareTranscriptOrder(
  a: TranscriptEntry,
  b: TranscriptEntry,
): number {
  const aTime = a.timestamp ? Date.parse(a.timestamp) : Number.NEGATIVE_INFINITY
  const bTime = b.timestamp ? Date.parse(b.timestamp) : Number.NEGATIVE_INFINITY
  const aSort = Number.isNaN(aTime) ? Number.NEGATIVE_INFINITY : aTime
  const bSort = Number.isNaN(bTime) ? Number.NEGATIVE_INFINITY : bTime
  if (aSort !== bSort) return aSort - bSort
  return a.order - b.order
}

function findLatestMessage<T extends TranscriptEntry>(
  messages: Iterable<T>,
  predicate: (message: T) => boolean,
): T | undefined {
  let latest: T | undefined
  for (const message of messages) {
    if (!predicate(message)) continue
    if (!latest || compareTranscriptOrder(latest, message) < 0) {
      latest = message
    }
  }
  return latest
}

function findLatestUserAssistantLeaf(
  messages: Map<UUID, TranscriptEntry>,
): TranscriptEntry | undefined {
  const parentUuids = new Set<UUID>()
  for (const message of messages.values()) {
    if (message.parentUuid) parentUuids.add(message.parentUuid)
  }

  const leafUuids = new Set<UUID>()
  for (const terminal of messages.values()) {
    if (parentUuids.has(terminal.uuid)) continue

    const seen = new Set<UUID>()
    let current: TranscriptEntry | undefined = terminal
    while (current) {
      if (seen.has(current.uuid)) break
      seen.add(current.uuid)

      if (
        (current.type === 'user' || current.type === 'assistant') &&
        !current.isSidechain
      ) {
        leafUuids.add(current.uuid)
        break
      }

      current = current.parentUuid ? messages.get(current.parentUuid) : undefined
    }
  }

  return findLatestMessage(
    messages.values(),
    message => leafUuids.has(message.uuid) && !message.isSidechain,
  )
}

function getAssistantMessageId(message: TranscriptEntry): string | undefined {
  if (message.type !== 'assistant') return undefined
  const id = message.message?.id
  return typeof id === 'string' ? id : undefined
}

function hasToolResultContent(message: TranscriptEntry): boolean {
  if (message.type !== 'user' || !message.message) return false
  const content = message.message.content
  return (
    Array.isArray(content) &&
    content.some(block => isRecord(block) && block.type === 'tool_result')
  )
}

function recoverOrphanedParallelToolResults(
  messages: Map<UUID, TranscriptEntry>,
  chain: TranscriptEntry[],
  seen: Set<UUID>,
): TranscriptEntry[] {
  const chainAssistants = chain.filter(
    message => message.type === 'assistant',
  )
  if (chainAssistants.length === 0) return chain

  const anchorByMessageId = new Map<string, TranscriptEntry>()
  for (const assistant of chainAssistants) {
    const messageId = getAssistantMessageId(assistant)
    if (messageId) anchorByMessageId.set(messageId, assistant)
  }

  const siblingsByMessageId = new Map<string, TranscriptEntry[]>()
  const toolResultsByAssistant = new Map<UUID, TranscriptEntry[]>()
  for (const message of messages.values()) {
    const messageId = getAssistantMessageId(message)
    if (messageId) {
      const siblings = siblingsByMessageId.get(messageId)
      if (siblings) siblings.push(message)
      else siblingsByMessageId.set(messageId, [message])
    } else if (message.parentUuid && hasToolResultContent(message)) {
      const results = toolResultsByAssistant.get(message.parentUuid)
      if (results) results.push(message)
      else toolResultsByAssistant.set(message.parentUuid, [message])
    }
  }

  const processedGroups = new Set<string>()
  const inserts = new Map<UUID, TranscriptEntry[]>()

  for (const assistant of chainAssistants) {
    const messageId = getAssistantMessageId(assistant)
    if (!messageId || processedGroups.has(messageId)) continue
    processedGroups.add(messageId)

    const siblings = siblingsByMessageId.get(messageId) ?? [assistant]
    const orphanedSiblings = siblings.filter(sibling => !seen.has(sibling.uuid))
    const orphanedToolResults: TranscriptEntry[] = []
    for (const sibling of siblings) {
      const results = toolResultsByAssistant.get(sibling.uuid)
      if (!results) continue
      for (const result of results) {
        if (!seen.has(result.uuid)) orphanedToolResults.push(result)
      }
    }

    if (orphanedSiblings.length === 0 && orphanedToolResults.length === 0) {
      continue
    }

    orphanedSiblings.sort(compareTranscriptOrder)
    orphanedToolResults.sort(compareTranscriptOrder)

    const anchor = anchorByMessageId.get(messageId)!
    const recovered = [...orphanedSiblings, ...orphanedToolResults]
    for (const message of recovered) seen.add(message.uuid)
    inserts.set(anchor.uuid, recovered)
  }

  if (inserts.size === 0) return chain

  const result: TranscriptEntry[] = []
  for (const message of chain) {
    result.push(message)
    const insert = inserts.get(message.uuid)
    if (insert) result.push(...insert)
  }
  return result
}

function buildConversationChain(
  messages: Map<UUID, TranscriptEntry>,
  leafMessage: TranscriptEntry,
): TranscriptEntry[] {
  const chain: TranscriptEntry[] = []
  const seen = new Set<UUID>()
  let current: TranscriptEntry | undefined = leafMessage

  while (current) {
    if (seen.has(current.uuid)) break
    seen.add(current.uuid)
    chain.push(current)
    current = current.parentUuid ? messages.get(current.parentUuid) : undefined
  }

  chain.reverse()
  return recoverOrphanedParallelToolResults(messages, chain, seen)
}

function toSdkCompactMetadata(
  value: unknown,
): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined

  const trigger = value.trigger
  const preTokens =
    typeof value.preTokens === 'number' ? value.preTokens : value.pre_tokens
  if ((trigger !== 'manual' && trigger !== 'auto') || typeof preTokens !== 'number') {
    return undefined
  }

  const preservedSegment = isRecord(value.preservedSegment)
    ? value.preservedSegment
    : isRecord(value.preserved_segment)
      ? value.preserved_segment
      : undefined

  const result: Record<string, unknown> = {
    trigger,
    pre_tokens: preTokens,
  }

  if (preservedSegment) {
    const headUuid =
      typeof preservedSegment.headUuid === 'string'
        ? preservedSegment.headUuid
        : preservedSegment.head_uuid
    const anchorUuid =
      typeof preservedSegment.anchorUuid === 'string'
        ? preservedSegment.anchorUuid
        : preservedSegment.anchor_uuid
    const tailUuid =
      typeof preservedSegment.tailUuid === 'string'
        ? preservedSegment.tailUuid
        : preservedSegment.tail_uuid
    if (
      typeof headUuid === 'string' &&
      typeof anchorUuid === 'string' &&
      typeof tailUuid === 'string'
    ) {
      result.preserved_segment = {
        head_uuid: headUuid,
        anchor_uuid: anchorUuid,
        tail_uuid: tailUuid,
      }
    }
  }

  return result
}

function isSdkEmittableMessage(
  entry: TranscriptEntry,
  includeSystemMessages: boolean,
): boolean {
  if (entry.type === 'user' || entry.type === 'assistant') return true
  if (!includeSystemMessages) return false
  if (entry.subtype === 'status') {
    return entry.status === null || entry.status === 'compacting'
  }
  if (entry.subtype !== 'compact_boundary') return false
  return (
    toSdkCompactMetadata(entry.compactMetadata ?? entry.compact_metadata) !==
    undefined
  )
}

function toSdkMessage(entry: TranscriptEntry): SDKMessage {
  const {
    compactMetadata,
    compact_metadata,
    isSidechain,
    logicalParentUuid,
    parentUuid,
    sessionId,
    order,
    ...rest
  } = entry

  const result: Record<string, unknown> = {
    ...rest,
    session_id:
      typeof rest.session_id === 'string' ? rest.session_id : sessionId,
  }

  if (entry.type === 'user' || entry.type === 'assistant') {
    delete result.userType
    delete result.entrypoint
    delete result.cwd
    delete result.version
    delete result.gitBranch
    delete result.slug
    delete result.teamName
    delete result.agentName
    delete result.promptId
    delete result.agentId
    result.parent_tool_use_id =
      typeof result.parent_tool_use_id === 'string' ||
      result.parent_tool_use_id === null
        ? result.parent_tool_use_id
        : null
  } else {
    const sdkCompactMetadata = toSdkCompactMetadata(
      compactMetadata ?? compact_metadata,
    )
    if (sdkCompactMetadata) result.compact_metadata = sdkCompactMetadata
  }

  return result as SDKMessage
}

function applyMessagePagination(
  messages: SDKMessage[],
  limit: number | undefined,
  offset: number | undefined,
): SDKMessage[] {
  const start = Math.max(0, offset ?? 0)
  const end = limit && limit > 0 ? start + limit : undefined
  return messages.slice(start, end)
}

async function appendSessionMetadataEntry(
  sessionId: string,
  options: SessionMutationOptions | undefined,
  entryFor: (uuid: UUID) => Record<string, unknown>,
): Promise<void> {
  const uuid = validateUuid(sessionId)
  if (!uuid) throw new Error(`Invalid session id: ${sessionId}`)

  const resolved = await resolveSessionFilePath(uuid, options?.dir)
  if (!resolved) throw new Error(`Session not found: ${sessionId}`)

  await appendFile(resolved.filePath, JSON.stringify(entryFor(uuid)) + '\n', {
    encoding: 'utf8',
    mode: 0o600,
  })
}

function getEntryMessageId(entry: TranscriptEntry): string | undefined {
  const messageId = entry.message?.id
  return typeof messageId === 'string' ? messageId : undefined
}

function resolveForkCutIndex(
  chain: TranscriptEntry[],
  upToMessageId: string | undefined,
): number {
  if (!upToMessageId) return chain.length - 1
  const index = chain.findIndex(
    entry =>
      entry.uuid === upToMessageId || getEntryMessageId(entry) === upToMessageId,
  )
  if (index < 0) {
    throw new Error(`Message not found in session: ${upToMessageId}`)
  }
  return index
}

function toForkedEntry(
  entry: TranscriptEntry,
  forkSessionId: UUID,
  originalSessionId: UUID,
  parentUuid: UUID | null,
): Record<string, unknown> {
  const {
    order,
    session_id,
    sessionId,
    logicalParentUuid,
    parentUuid: _parentUuid,
    isSidechain,
    ...rest
  } = entry

  return {
    ...rest,
    uuid: randomUUID(),
    parentUuid,
    sessionId: forkSessionId,
    isSidechain: false,
    forkedFrom: {
      sessionId: originalSessionId,
      messageUuid: entry.uuid,
    },
  }
}

type Candidate = {
  sessionId: string
  filePath: string
  mtime: number
  /** Project path for cwd fallback when file lacks a cwd field. */
  projectPath?: string
}

/**
 * Lists candidate session files in a directory via readdir, optionally
 * stat'ing each for mtime. When `doStat` is false, mtime is set to 0
 * (caller must sort/dedup after reading file contents instead).
 */
export async function listCandidates(
  projectDir: string,
  doStat: boolean,
  projectPath?: string,
): Promise<Candidate[]> {
  let names: string[]
  try {
    names = await readdir(projectDir)
  } catch {
    return []
  }

  const results = await Promise.all(
    names.map(async (name): Promise<Candidate | null> => {
      if (!name.endsWith('.jsonl')) return null
      const sessionId = validateUuid(name.slice(0, -6))
      if (!sessionId) return null
      const filePath = join(projectDir, name)
      if (!doStat) return { sessionId, filePath, mtime: 0, projectPath }
      try {
        const s = await stat(filePath)
        return { sessionId, filePath, mtime: s.mtime.getTime(), projectPath }
      } catch {
        return null
      }
    }),
  )

  return results.filter((c): c is Candidate => c !== null)
}

/**
 * Reads a candidate's file contents and extracts full SessionInfo.
 * Returns null if the session should be filtered out (sidechain, no summary).
 */
async function readCandidate(c: Candidate): Promise<SessionInfo | null> {
  const lite = await readSessionLite(c.filePath)
  if (!lite) return null

  const info = parseSessionInfoFromLite(c.sessionId, lite, c.projectPath)
  if (!info) return null

  // Prefer stat-pass mtime for sort-key consistency; fall back to
  // lite.mtime when doStat=false (c.mtime is 0 placeholder).
  if (c.mtime) info.lastModified = c.mtime

  return info
}

// ---------------------------------------------------------------------------
// Sort + limit — batch-read candidates in sorted order until `limit`
// survivors are collected (some candidates filter out on full read).
// ---------------------------------------------------------------------------

/** Batch size for concurrent reads when walking the sorted candidate list. */
const READ_BATCH_SIZE = 32

/**
 * Sort comparator: lastModified desc, then sessionId desc for stable
 * ordering across mtime ties.
 */
function compareDesc(a: Candidate, b: Candidate): number {
  if (b.mtime !== a.mtime) return b.mtime - a.mtime
  return b.sessionId < a.sessionId ? -1 : b.sessionId > a.sessionId ? 1 : 0
}

async function applySortAndLimit(
  candidates: Candidate[],
  limit: number | undefined,
  offset: number,
): Promise<SessionInfo[]> {
  candidates.sort(compareDesc)

  const sessions: SessionInfo[] = []
  // limit: 0 means "no limit" (matches getSessionMessages semantics)
  const want = limit && limit > 0 ? limit : Infinity
  let skipped = 0
  // Dedup post-filter: since candidates are sorted mtime-desc, the first
  // non-null read per sessionId is naturally the newest valid copy.
  // Pre-filter dedup would drop a session entirely if its newest-mtime
  // copy is unreadable/empty, diverging from the no-stat readAllAndSort path.
  const seen = new Set<string>()

  for (let i = 0; i < candidates.length && sessions.length < want; ) {
    const batchEnd = Math.min(i + READ_BATCH_SIZE, candidates.length)
    const batch = candidates.slice(i, batchEnd)
    const results = await Promise.all(batch.map(readCandidate))
    for (let j = 0; j < results.length && sessions.length < want; j++) {
      i++
      const r = results[j]
      if (!r) continue
      if (seen.has(r.sessionId)) continue
      seen.add(r.sessionId)
      if (skipped < offset) {
        skipped++
        continue
      }
      sessions.push(r)
    }
  }

  return sessions
}

/**
 * Read-all path for when no limit/offset is set. Skips the stat pass
 * entirely — reads every candidate, then sorts/dedups on real mtimes
 * from readSessionLite. Matches pre-refactor I/O cost (no extra stats).
 */
async function readAllAndSort(candidates: Candidate[]): Promise<SessionInfo[]> {
  const all = await Promise.all(candidates.map(readCandidate))
  const byId = new Map<string, SessionInfo>()
  for (const s of all) {
    if (!s) continue
    const existing = byId.get(s.sessionId)
    if (!existing || s.lastModified > existing.lastModified) {
      byId.set(s.sessionId, s)
    }
  }
  const sessions = [...byId.values()]
  sessions.sort((a, b) =>
    b.lastModified !== a.lastModified
      ? b.lastModified - a.lastModified
      : b.sessionId < a.sessionId
        ? -1
        : b.sessionId > a.sessionId
          ? 1
          : 0,
  )
  return sessions
}

// ---------------------------------------------------------------------------
// Project directory enumeration (single-project vs all-projects)
// ---------------------------------------------------------------------------

/**
 * Gathers candidate session files for a specific project directory
 * (and optionally its git worktrees).
 */
async function gatherProjectCandidates(
  dir: string,
  includeWorktrees: boolean,
  doStat: boolean,
): Promise<Candidate[]> {
  const canonicalDir = await canonicalizePath(dir)

  let worktreePaths: string[]
  if (includeWorktrees) {
    try {
      worktreePaths = await getWorktreePathsPortable(canonicalDir)
    } catch {
      worktreePaths = []
    }
  } else {
    worktreePaths = []
  }

  // No worktrees (or git not available / scanning disabled) — just scan the single project dir
  if (worktreePaths.length <= 1) {
    const projectDir = await findProjectDir(canonicalDir)
    if (!projectDir) return []
    return listCandidates(projectDir, doStat, canonicalDir)
  }

  // Worktree-aware scanning: find all project dirs matching any worktree
  const projectsDir = getProjectsDir()
  const caseInsensitive = process.platform === 'win32'

  // Sort worktree paths by sanitized prefix length (longest first) so
  // more specific matches take priority over shorter ones
  const indexed = worktreePaths.map(wt => {
    const sanitized = sanitizePath(wt)
    return {
      path: wt,
      prefix: caseInsensitive ? sanitized.toLowerCase() : sanitized,
    }
  })
  indexed.sort((a, b) => b.prefix.length - a.prefix.length)

  let allDirents: Dirent[]
  try {
    allDirents = await readdir(projectsDir, { withFileTypes: true })
  } catch {
    // Fall back to single project dir
    const projectDir = await findProjectDir(canonicalDir)
    if (!projectDir) return []
    return listCandidates(projectDir, doStat, canonicalDir)
  }

  const all: Candidate[] = []
  const seenDirs = new Set<string>()

  // Always include the user's actual directory (handles subdirectories
  // like /repo/packages/my-app that won't match worktree root prefixes)
  const canonicalProjectDir = await findProjectDir(canonicalDir)
  if (canonicalProjectDir) {
    const dirBase = basename(canonicalProjectDir)
    seenDirs.add(caseInsensitive ? dirBase.toLowerCase() : dirBase)
    all.push(
      ...(await listCandidates(canonicalProjectDir, doStat, canonicalDir)),
    )
  }

  for (const dirent of allDirents) {
    if (!dirent.isDirectory()) continue
    const dirName = caseInsensitive ? dirent.name.toLowerCase() : dirent.name
    if (seenDirs.has(dirName)) continue

    for (const { path: wtPath, prefix } of indexed) {
      // Only use startsWith for truncated paths (>MAX_SANITIZED_LENGTH) where
      // a hash suffix follows. For short paths, require exact match to avoid
      // /root/project matching /root/project-foo.
      const isMatch =
        dirName === prefix ||
        (prefix.length >= MAX_SANITIZED_LENGTH &&
          dirName.startsWith(prefix + '-'))
      if (isMatch) {
        seenDirs.add(dirName)
        all.push(
          ...(await listCandidates(
            join(projectsDir, dirent.name),
            doStat,
            wtPath,
          )),
        )
        break
      }
    }
  }

  return all
}

/**
 * Gathers candidate session files across all project directories.
 */
async function gatherAllCandidates(doStat: boolean): Promise<Candidate[]> {
  const projectsDir = getProjectsDir()

  let dirents: Dirent[]
  try {
    dirents = await readdir(projectsDir, { withFileTypes: true })
  } catch {
    return []
  }

  const perProject = await Promise.all(
    dirents
      .filter(d => d.isDirectory())
      .map(d => listCandidates(join(projectsDir, d.name), doStat)),
  )

  return perProject.flat()
}

/**
 * Lists sessions with metadata extracted from stat + head/tail reads.
 *
 * When `dir` is provided, returns sessions for that project directory
 * and its git worktrees. When omitted, returns sessions across all
 * projects.
 *
 * Pagination via `limit`/`offset` operates on the filtered, sorted result
 * set. When either is set, a cheap stat-only pass sorts candidates before
 * expensive head/tail reads — so `limit: 20` on a directory with 1000
 * sessions does ~1000 stats + ~20 content reads, not 1000 content reads.
 * When neither is set, stat is skipped (read-all-then-sort, same I/O cost
 * as the original implementation).
 */
export async function listSessionsImpl(
  options?: ListSessionsOptions,
): Promise<SessionInfo[]> {
  const { dir, limit, offset, includeWorktrees } = options ?? {}
  const off = offset ?? 0
  // Only stat when we need to sort before reading (won't read all anyway).
  // limit: 0 means "no limit" (see applySortAndLimit), so treat it as unset.
  const doStat = (limit !== undefined && limit > 0) || off > 0

  const candidates = dir
    ? await gatherProjectCandidates(dir, includeWorktrees ?? true, doStat)
    : await gatherAllCandidates(doStat)

  if (!doStat) return readAllAndSort(candidates)
  return applySortAndLimit(candidates, limit, off)
}

export async function getSessionInfoImpl(
  sessionId: string,
  options?: GetSessionInfoOptions,
): Promise<SessionInfo | undefined> {
  const uuid = validateUuid(sessionId)
  if (!uuid) return undefined

  const resolved = await resolveSessionFilePath(uuid, options?.dir)
  if (!resolved) return undefined

  const lite = await readSessionLite(resolved.filePath)
  if (!lite) return undefined

  return (
    parseSessionInfoFromLite(uuid, lite, resolved.projectPath) ?? undefined
  )
}

export async function getSessionMessagesImpl(
  sessionId: string,
  options?: GetSessionMessagesOptions,
): Promise<SDKMessage[]> {
  const uuid = validateUuid(sessionId)
  if (!uuid) return []

  const resolved = await resolveSessionFilePath(uuid, options?.dir)
  if (!resolved) return []

  let postBoundaryBuf: Buffer
  try {
    postBoundaryBuf = (
      await readTranscriptForLoad(resolved.filePath, resolved.fileSize)
    ).postBoundaryBuf
  } catch {
    return []
  }

  const messages = new Map<UUID, TranscriptEntry>()
  const records = parseJsonlRecords(postBoundaryBuf)
  records.forEach((record, index) => {
    const message = normalizeTranscriptEntry(
      record,
      uuid,
      index,
    )
    if (message) messages.set(message.uuid, message)
  })

  if (messages.size === 0) return []

  const leaf = findLatestUserAssistantLeaf(messages)
  if (!leaf) return []

  const chain = buildConversationChain(messages, leaf)
    .filter(message =>
      isSdkEmittableMessage(message, options?.includeSystemMessages === true),
    )
    .map(toSdkMessage)
  return applyMessagePagination(chain, options?.limit, options?.offset)
}

export async function renameSessionImpl(
  sessionId: string,
  title: string,
  options?: SessionMutationOptions,
): Promise<void> {
  if (title.trim().length === 0) {
    throw new Error('Session title cannot be empty')
  }
  await appendSessionMetadataEntry(sessionId, options, uuid => ({
    type: 'custom-title',
    customTitle: title,
    sessionId: uuid,
  }))
}

export async function tagSessionImpl(
  sessionId: string,
  tag: string | null,
  options?: SessionMutationOptions,
): Promise<void> {
  await appendSessionMetadataEntry(sessionId, options, uuid => ({
    type: 'tag',
    tag: tag ?? '',
    sessionId: uuid,
  }))
}

export async function forkSessionImpl(
  sessionId: string,
  options?: ForkSessionOptions,
): Promise<ForkSessionResult> {
  const uuid = validateUuid(sessionId)
  if (!uuid) throw new Error(`Invalid session id: ${sessionId}`)

  const resolved = await resolveSessionFilePath(uuid, options?.dir)
  if (!resolved) throw new Error(`Session not found: ${sessionId}`)

  let postBoundaryBuf: Buffer
  try {
    postBoundaryBuf = (
      await readTranscriptForLoad(resolved.filePath, resolved.fileSize)
    ).postBoundaryBuf
  } catch {
    throw new Error(`Unable to read session: ${sessionId}`)
  }

  const messages = new Map<UUID, TranscriptEntry>()
  parseJsonlRecords(postBoundaryBuf).forEach((record, index) => {
    const message = normalizeTranscriptEntry(record, uuid, index)
    if (message && !message.isSidechain) messages.set(message.uuid, message)
  })

  const leaf = findLatestUserAssistantLeaf(messages)
  if (!leaf) throw new Error(`No messages to fork: ${sessionId}`)

  const chain = buildConversationChain(messages, leaf)
  const cutIndex = resolveForkCutIndex(chain, options?.upToMessageId)
  const selected = chain.slice(0, cutIndex + 1)
  if (selected.length === 0) throw new Error(`No messages to fork: ${sessionId}`)

  const forkSessionId = randomUUID()
  const lines: string[] = []
  let parentUuid: UUID | null = null
  for (const entry of selected) {
    const forked = toForkedEntry(entry, forkSessionId, uuid, parentUuid)
    const forkedUuid = validateUuid(forked.uuid)
    if (!forkedUuid) throw new Error('Failed to generate fork message UUID')
    lines.push(JSON.stringify(forked))
    parentUuid = forkedUuid
  }

  const title = options?.title
  if (title !== undefined) {
    if (title.trim().length === 0) {
      throw new Error('Session title cannot be empty')
    }
    lines.push(
      JSON.stringify({
        type: 'custom-title',
        customTitle: title,
        sessionId: forkSessionId,
      }),
    )
  }

  const targetDir = dirname(resolved.filePath)
  await mkdir(targetDir, { recursive: true, mode: 0o700 })
  await writeFile(
    join(targetDir, `${forkSessionId}.jsonl`),
    lines.join('\n') + '\n',
    {
      encoding: 'utf8',
      mode: 0o600,
    },
  )

  return { sessionId: forkSessionId }
}
