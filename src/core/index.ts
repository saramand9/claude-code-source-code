/**
 * Public, headless entry point for the existing Claude Code agent loop.
 *
 * Keep this module as a thin export boundary: the core continues to use the
 * query state machine, message protocol, and Tool contract defined by the
 * original implementation.
 */
export {
  query,
  type QueryEvent,
  type QueryParams,
  type QueryTerminal,
} from '../query.js'
export type { QueryDeps } from '../query/deps.js'
export {
  createCoreDeps,
  type CoreDepsOptions,
  type CoreRequiredDeps,
} from './deps.js'
export {
  coreTokenCountWithEstimation,
  createCoreCompactionDeps,
  roughTokenCount,
  roughTokenCountForMessages,
  truncateHeadForCompactRetry,
  type CoreCompactionOptions,
} from './runtime/compaction.js'
export { isToolResultContentEmpty } from './runtime/toolExecution.js'
export {
  buildConversationChain,
  buildLatestConversationChain,
  insertMessageChain,
  isTranscriptMessage,
  parseTranscriptJsonl,
  serializeTranscriptEntries,
  type InsertMessageChainOptions,
  type ParsedTranscript,
  type SessionStamp,
  type TranscriptMessage,
  type TranscriptUuid,
} from './runtime/session.js'

import type { QueryParams } from '../query.js'
import type { QueryDeps } from '../query/deps.js'

/**
 * The portable build has no implicit production wiring. Hosts pass a composed
 * dependency object, normally createCoreDeps({ callModel }), instead of
 * falling back to Claude Code's CLI runtime.
 */
export type CoreQueryParams = Omit<QueryParams, 'deps'> & {
  deps: QueryDeps
}

export {
  asSystemPrompt,
  type SystemPrompt,
} from '../utils/systemPromptType.js'
export {
  CORE_AGENT_PROMPT_SECTIONS,
  createCoreSystemPrompt,
} from './prompt.js'
export type { QuerySource } from '../constants/querySource.js'
export type { CanUseToolFn } from '../hooks/useCanUseTool.js'
export type {
  AssistantMessage,
  AttachmentMessage,
  Message,
  ProgressMessage,
  RequestStartEvent,
  StreamEvent,
  SystemMessage,
  TombstoneMessage,
  ToolUseSummaryMessage,
  UserMessage,
} from '../types/message.js'

export {
  buildTool,
  findToolByName,
  getEmptyToolPermissionContext,
  toolMatchesName,
} from '../Tool.js'
export type {
  AnyObject,
  Progress,
  Tool,
  ToolCallProgress,
  ToolDef,
  ToolInputJSONSchema,
  ToolPermissionContext,
  ToolProgress,
  ToolResult,
  Tools,
  ToolUseContext,
  ValidationResult,
} from '../Tool.js'
