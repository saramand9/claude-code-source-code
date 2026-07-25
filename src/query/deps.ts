import { randomUUID } from 'crypto'
import {
  getCurrentTurnTokenBudget,
  getTurnOutputTokens,
  incrementBudgetContinuationCount,
} from '../bootstrap/state.js'
import { logEvent } from '../services/analytics/index.js'
import { queryModelWithStreaming } from '../services/api/claude.js'
import { createDumpPromptsFetch } from '../services/api/dumpPrompts.js'
import {
  PROMPT_TOO_LONG_ERROR_MESSAGE,
  isPromptTooLongMessage,
} from '../services/api/errors.js'
import { autoCompactIfNeeded } from '../services/compact/autoCompact.js'
import {
  calculateTokenWarningState,
  isAutoCompactEnabled,
} from '../services/compact/autoCompact.js'
import { buildPostCompactMessages } from '../services/compact/compact.js'
import { microcompactMessages } from '../services/compact/microCompact.js'
import { generateToolUseSummary } from '../services/toolUseSummary/toolUseSummaryGenerator.js'
import {
  createAttachmentMessage,
  filterDuplicateMemoryAttachments,
  getAttachmentMessages,
  startRelevantMemoryPrefetch,
} from '../utils/attachments.js'
import { notifyCommandLifecycle } from '../utils/commandLifecycle.js'
import { logAntError, logForDebugging } from '../utils/debug.js'
import { headlessProfilerCheckpoint } from '../utils/headlessProfiler.js'
import { executeStopFailureHooks } from '../utils/hooks.js'
import { executePostSamplingHooks } from '../utils/hooks/postSamplingHooks.js'
import { logError } from '../utils/log.js'
import {
  getCommandsByMaxPriority,
  isSlashCommand,
  remove as removeFromQueue,
} from '../utils/messageQueueManager.js'
import {
  getRuntimeMainLoopModel,
  renderModelName,
} from '../utils/model/model.js'
import { queryCheckpoint } from '../utils/queryProfiler.js'
import { recordContentReplacement } from '../utils/sessionStorage.js'
import {
  doesMostRecentAssistantMessageExceed200k,
  finalContextTokensFromLastResponse,
  tokenCountWithEstimation,
} from '../utils/tokens.js'
import { applyToolResultBudget } from '../utils/toolResultStorage.js'
import { buildQueryConfig } from './config.js'
import { handleStopHooks } from './stopHooks.js'

// -- deps

// I/O dependencies for query(). Passing a `deps` override into QueryParams
// lets tests inject fakes directly instead of spyOn-per-module — the most
// common mocks (callModel, autocompact) are each spied in 6-8 test files
// today with module-import-and-spy boilerplate.
//
// Using `typeof fn` keeps signatures in sync with the real implementations
// automatically. This file imports the real functions for both typing and
// the production factory — tests that import this file for typing are
// already importing query.ts (which imports everything), so there's no
// new module-graph cost.
//
// Keep production wiring in this module. The headless core build replaces this
// module with a fail-fast factory, so query.ts retains its original state
// machine while hosts provide these dependencies explicitly.
export type QueryDeps = {
  // -- model
  callModel: typeof queryModelWithStreaming

  // -- compaction
  microcompact: typeof microcompactMessages
  autocompact: typeof autoCompactIfNeeded
  buildPostCompactMessages: typeof buildPostCompactMessages
  calculateTokenWarningState: typeof calculateTokenWarningState
  isAutoCompactEnabled: typeof isAutoCompactEnabled

  // -- context, memory, and turn lifecycle
  createAttachmentMessage: typeof createAttachmentMessage
  filterDuplicateMemoryAttachments: typeof filterDuplicateMemoryAttachments
  getAttachmentMessages: typeof getAttachmentMessages
  startRelevantMemoryPrefetch: typeof startRelevantMemoryPrefetch
  handleStopHooks: typeof handleStopHooks
  executePostSamplingHooks: typeof executePostSamplingHooks
  executeStopFailureHooks: typeof executeStopFailureHooks
  applyToolResultBudget: typeof applyToolResultBudget
  recordContentReplacement: typeof recordContentReplacement

  // -- host queue and lifecycle
  getCommandsByMaxPriority: typeof getCommandsByMaxPriority
  isSlashCommand: typeof isSlashCommand
  removeFromQueue: typeof removeFromQueue
  notifyCommandLifecycle: typeof notifyCommandLifecycle

  // -- product policy and optional services
  createDumpPromptsFetch: typeof createDumpPromptsFetch
  generateToolUseSummary: typeof generateToolUseSummary
  getRuntimeMainLoopModel: typeof getRuntimeMainLoopModel
  renderModelName: typeof renderModelName
  isPromptTooLongMessage: typeof isPromptTooLongMessage
  promptTooLongErrorMessage: typeof PROMPT_TOO_LONG_ERROR_MESSAGE
  doesMostRecentAssistantMessageExceed200k: typeof doesMostRecentAssistantMessageExceed200k
  finalContextTokensFromLastResponse: typeof finalContextTokensFromLastResponse
  tokenCountWithEstimation: typeof tokenCountWithEstimation
  getCurrentTurnTokenBudget: typeof getCurrentTurnTokenBudget
  getTurnOutputTokens: typeof getTurnOutputTokens
  incrementBudgetContinuationCount: typeof incrementBudgetContinuationCount

  // -- observability
  logEvent: typeof logEvent
  logError: typeof logError
  logAntError: typeof logAntError
  logForDebugging: typeof logForDebugging
  headlessProfilerCheckpoint: typeof headlessProfilerCheckpoint
  queryCheckpoint: typeof queryCheckpoint

  // -- platform
  buildConfig: typeof buildQueryConfig
  uuid: () => string
}

export function productionDeps(): QueryDeps {
  return {
    callModel: queryModelWithStreaming,
    microcompact: microcompactMessages,
    autocompact: autoCompactIfNeeded,
    buildPostCompactMessages,
    calculateTokenWarningState,
    isAutoCompactEnabled,
    createAttachmentMessage,
    filterDuplicateMemoryAttachments,
    getAttachmentMessages,
    startRelevantMemoryPrefetch,
    handleStopHooks,
    executePostSamplingHooks,
    executeStopFailureHooks,
    applyToolResultBudget,
    recordContentReplacement,
    getCommandsByMaxPriority,
    isSlashCommand,
    removeFromQueue,
    notifyCommandLifecycle,
    createDumpPromptsFetch,
    generateToolUseSummary,
    getRuntimeMainLoopModel,
    renderModelName,
    isPromptTooLongMessage,
    promptTooLongErrorMessage: PROMPT_TOO_LONG_ERROR_MESSAGE,
    doesMostRecentAssistantMessageExceed200k,
    finalContextTokensFromLastResponse,
    tokenCountWithEstimation,
    getCurrentTurnTokenBudget,
    getTurnOutputTokens,
    incrementBudgetContinuationCount,
    logEvent,
    logError,
    logAntError,
    logForDebugging,
    headlessProfilerCheckpoint,
    queryCheckpoint,
    buildConfig: buildQueryConfig,
    uuid: randomUUID,
  }
}
