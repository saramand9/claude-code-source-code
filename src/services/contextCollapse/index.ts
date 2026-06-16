import type { QuerySource } from '../../constants/querySource.js'
import type { ToolUseContext } from '../../Tool.js'
import type {
  AssistantMessage,
  Message,
  StreamEvent,
} from '../../types/message.js'
import type {
  ContextCollapseCommitEntry,
  ContextCollapseSnapshotEntry,
} from '../../types/logs.js'
import { isEnvTruthy } from '../../utils/envUtils.js'
import { projectView } from './operations.js'

export type ContextCollapseHealth = {
  totalSpawns: number
  totalErrors: number
  lastError?: string
  totalEmptySpawns: number
  emptySpawnWarningEmitted: boolean
}

export type ContextCollapseStats = {
  collapsedSpans: number
  collapsedMessages: number
  stagedSpans: number
  runtimeRequested: boolean
  hasRestoredState: boolean
  implementation: 'external-conservative'
  health: ContextCollapseHealth
}

type Listener = () => void

let restoredCommits: ContextCollapseCommitEntry[] = []
let restoredSnapshot: ContextCollapseSnapshotEntry | undefined
const listeners = new Set<Listener>()

function notify(): void {
  for (const listener of listeners) {
    listener()
  }
}

function isCommitEntry(entry: unknown): entry is ContextCollapseCommitEntry {
  return (
    typeof entry === 'object' &&
    entry !== null &&
    (entry as { type?: unknown }).type === 'marble-origami-commit'
  )
}

function isSnapshotEntry(
  entry: unknown,
): entry is ContextCollapseSnapshotEntry {
  const snapshot = entry as { type?: unknown; staged?: unknown } | null
  return (
    typeof entry === 'object' &&
    entry !== null &&
    snapshot?.type === 'marble-origami-snapshot' &&
    Array.isArray(snapshot.staged)
  )
}

export function isContextCollapseRuntimeRequested(): boolean {
  return (
    isEnvTruthy(process.env.CLAUDE_CONTEXT_COLLAPSE) ||
    isEnvTruthy(process.env.CLAUDE_CODE_CONTEXT_COLLAPSE)
  )
}

export function hasRestoredContextCollapseState(): boolean {
  return (
    restoredCommits.length > 0 || (restoredSnapshot?.staged.length ?? 0) > 0
  )
}

export function isContextCollapseEnabled(): boolean {
  return (
    isContextCollapseRuntimeRequested() && hasRestoredContextCollapseState()
  )
}

export function getStats(): ContextCollapseStats {
  return {
    collapsedSpans: restoredCommits.length,
    collapsedMessages: 0,
    stagedSpans: restoredSnapshot?.staged.length ?? 0,
    runtimeRequested: isContextCollapseRuntimeRequested(),
    hasRestoredState: hasRestoredContextCollapseState(),
    implementation: 'external-conservative',
    health: {
      totalSpawns: 0,
      totalErrors: 0,
      totalEmptySpawns: 0,
      emptySpawnWarningEmitted: false,
    },
  }
}

export function initContextCollapse(): void {
  notify()
}

export function resetContextCollapse(): void {
  restoredCommits = []
  restoredSnapshot = undefined
  notify()
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export async function applyCollapsesIfNeeded(
  messages: Message[],
  _toolUseContext: ToolUseContext,
  _querySource: QuerySource,
): Promise<{ messages: Message[] }> {
  return { messages: projectView(messages) }
}

export function isWithheldPromptTooLong(
  message: Message | StreamEvent,
  isPromptTooLong: (message: AssistantMessage) => boolean,
  _querySource: QuerySource,
): boolean {
  return (
    isContextCollapseEnabled() &&
    message.type === 'assistant' &&
    isPromptTooLong(message)
  )
}

export function recoverFromOverflow(
  messages: Message[],
  _querySource: QuerySource,
): { committed: number; messages: Message[] } {
  return {
    committed: 0,
    messages: projectView(messages),
  }
}

export function restoreContextCollapseState(
  entries: unknown[],
  snapshot: unknown,
): void {
  restoredCommits = entries.filter(isCommitEntry)
  restoredSnapshot = isSnapshotEntry(snapshot) ? snapshot : undefined
  notify()
}
