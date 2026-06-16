import type {
  ContextCollapseCommitEntry,
  ContextCollapseSnapshotEntry,
} from '../../types/logs.js'
import { restoreContextCollapseState } from './index.js'

export function restoreFromEntries(
  entries: ContextCollapseCommitEntry[] | unknown[],
  snapshot: ContextCollapseSnapshotEntry | unknown,
): void {
  restoreContextCollapseState(entries, snapshot)
}
