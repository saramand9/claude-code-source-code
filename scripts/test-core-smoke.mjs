#!/usr/bin/env node

import assert from 'node:assert/strict'
import { z } from 'zod/v4'
import {
  asSystemPrompt,
  buildTool,
  createCoreDeps,
  createCoreSystemPrompt,
  getEmptyToolPermissionContext,
  isToolResultContentEmpty,
  query,
  truncateHeadForCompactRetry,
} from '../dist-core/index.js'

const defaultCorePrompt = createCoreSystemPrompt()
assert(
  defaultCorePrompt.some(section => section.includes('diagnose why')),
  'portable prompt must preserve failure-diagnosis behavior',
)
assert(
  defaultCorePrompt.some(section => section.includes('verify that it actually')),
  'portable prompt must preserve verification behavior',
)
assert.equal(isToolResultContentEmpty('  '), true)
assert.equal(
  isToolResultContentEmpty([{ type: 'text', text: 'result' }]),
  false,
)

function usage() {
  return {
    input_tokens: 10,
    output_tokens: 5,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  }
}

let nextId = 0
function assistantMessage(content, stopReason = 'end_turn') {
  nextId += 1
  return {
    type: 'assistant',
    uuid: `assistant-${nextId}`,
    timestamp: new Date().toISOString(),
    requestId: `request-${nextId}`,
    message: {
      id: `message-${nextId}`,
      type: 'message',
      role: 'assistant',
      model: 'core-test-model',
      content,
      stop_reason: stopReason,
      stop_sequence: null,
      usage: usage(),
      container: null,
      context_management: null,
    },
  }
}

function userMessage(content) {
  return {
    type: 'user',
    uuid: 'user-1',
    timestamp: new Date().toISOString(),
    message: { role: 'user', content },
  }
}

const echoCalls = []
const EchoTool = buildTool({
  name: 'Echo',
  aliases: ['Repeat'],
  inputSchema: z.object({ value: z.string() }),
  maxResultSizeChars: Number.POSITIVE_INFINITY,
  async description() {
    return 'Echo a value'
  },
  async prompt() {
    return 'Echo a value'
  },
  async call(input, _context, _canUseTool, _parent, onProgress) {
    echoCalls.push(input.value)
    onProgress?.({
      toolUseID: 'tool-1',
      data: { type: 'echo_progress', value: input.value },
    })
    return { data: { echoed: input.value } }
  },
  mapToolResultToToolResultBlockParam(result, toolUseID) {
    return {
      type: 'tool_result',
      tool_use_id: toolUseID,
      content: result.echoed,
    }
  },
  renderToolUseMessage() {
    return null
  },
})

const emptyCalls = []
const EmptyTool = buildTool({
  name: 'Empty',
  inputSchema: z.object({}),
  maxResultSizeChars: 100_000,
  async description() {
    return 'Return no output'
  },
  async prompt() {
    return 'Return no output'
  },
  async call() {
    emptyCalls.push(true)
    return { data: null }
  },
  mapToolResultToToolResultBlockParam(_result, toolUseID) {
    return {
      type: 'tool_result',
      tool_use_id: toolUseID,
      content: '',
    }
  },
  renderToolUseMessage() {
    return null
  },
})

let modelCalls = 0
const deps = createCoreDeps({
  async *callModel() {
    modelCalls += 1
    if (modelCalls === 1) {
      yield assistantMessage(
        [
          {
            type: 'tool_use',
            id: 'tool-1',
            name: 'Repeat',
            input: { value: 'portable' },
          },
          {
            type: 'tool_use',
            id: 'tool-2',
            name: 'Empty',
            input: {},
          },
        ],
        'tool_use',
      )
      return
    }
    yield assistantMessage([{ type: 'text', text: 'done' }])
  },
})

const appState = {
  toolPermissionContext: getEmptyToolPermissionContext(),
  fastMode: false,
  effortValue: undefined,
  advisorModel: undefined,
  mcp: { tools: [], clients: [] },
}
const initialMessages = [userMessage('Please repeat this')]
const toolUseContext = {
  options: {
    commands: [],
    debug: false,
    mainLoopModel: 'core-test-model',
    tools: [EchoTool, EmptyTool],
    verbose: false,
    thinkingConfig: { type: 'disabled' },
    mcpClients: [],
    mcpResources: {},
    isNonInteractiveSession: true,
    agentDefinitions: { activeAgents: [], allowedAgentTypes: [] },
  },
  abortController: new AbortController(),
  readFileState: new Map(),
  getAppState: () => appState,
  setAppState: () => {},
  setInProgressToolUseIDs: updater => {
    updater(new Set())
  },
  setResponseLength: updater => {
    updater(0)
  },
  updateFileHistoryState: () => {},
  updateAttributionState: () => {},
  messages: initialMessages,
}

const events = []
const generator = query({
  messages: initialMessages,
  systemPrompt: asSystemPrompt([]),
  userContext: {},
  systemContext: {},
  canUseTool: async (_tool, input) => ({
    behavior: 'allow',
    updatedInput: input,
  }),
  toolUseContext,
  querySource: 'sdk',
  maxTurns: 3,
  deps,
})

let terminal
while (true) {
  const step = await generator.next()
  if (step.done) {
    terminal = step.value
    break
  }
  events.push(step.value)
}

assert.deepEqual(echoCalls, ['portable'], 'alias-routed tool did not execute')
assert.equal(emptyCalls.length, 1, 'empty-result tool did not execute')
assert.equal(modelCalls, 2, 'tool result should trigger exactly one follow-up')
assert.equal(terminal.reason, 'completed')
assert(
  events.some(
    event =>
      event.type === 'user' &&
      Array.isArray(event.message.content) &&
      event.message.content.some(
        block =>
          block.type === 'tool_result' && block.tool_use_id === 'tool-1',
      ),
  ),
  'query did not emit a paired tool_result',
)
assert(
  events.some(
    event =>
      event.type === 'user' &&
      Array.isArray(event.message.content) &&
      event.message.content.some(
        block =>
          block.type === 'tool_result' &&
          block.tool_use_id === 'tool-2' &&
          block.content === '(Empty completed with no output)',
      ),
  ),
  'empty tool result was not normalized',
)
assert(
  events.some(
    event =>
      event.type === 'assistant' &&
      event.message.content.some(
        block => block.type === 'text' && block.text === 'done',
      ),
  ),
  'query did not emit the final assistant response',
)

await assert.rejects(
  () => query({}).next(),
  /requires QueryParams\.deps/,
  'portable build must not load production dependencies implicitly',
)

let compactionCalls = 0
let compactedMainCalls = 0
let compactedMainMessages
const compactDeps = createCoreDeps({
  compaction: {
    contextWindow: 1_200,
    maxSummaryOutputTokens: 100,
    autoCompactBufferTokens: 200,
    warningBufferTokens: 100,
    errorBufferTokens: 50,
    blockingBufferTokens: 20,
  },
  async *callModel(params) {
    if (params.options.querySource === 'compact') {
      compactionCalls += 1
      const summaryPrompt = params.messages.at(-1)?.message?.content
      assert.match(
        String(summaryPrompt),
        /detailed summary/i,
        'core compactor must use Claude Code compact prompt',
      )
      yield assistantMessage([
        {
          type: 'text',
          text: [
            '<analysis>draft only</analysis>',
            '<summary>Continue the portable core extraction.</summary>',
          ].join(''),
        },
      ])
      return
    }

    compactedMainCalls += 1
    compactedMainMessages = params.messages
    yield assistantMessage([{ type: 'text', text: 'continued after compact' }])
  },
})

const largeMessages = [
  userMessage(
    'Portable context that should be summarized. '.repeat(140),
  ),
]
const compactToolUseContext = {
  ...toolUseContext,
  options: {
    ...toolUseContext.options,
    tools: [],
  },
  abortController: new AbortController(),
  readFileState: new Map(),
  messages: largeMessages,
}
const compactEvents = []
const compactGenerator = query({
  messages: largeMessages,
  systemPrompt: asSystemPrompt([]),
  userContext: {},
  systemContext: {},
  canUseTool: async (_tool, input) => ({
    behavior: 'allow',
    updatedInput: input,
  }),
  toolUseContext: compactToolUseContext,
  querySource: 'sdk',
  maxTurns: 1,
  deps: compactDeps,
})

while (true) {
  const step = await compactGenerator.next()
  if (step.done) {
    assert.equal(step.value.reason, 'completed')
    break
  }
  compactEvents.push(step.value)
}

assert.equal(compactionCalls, 1, 'large context should compact exactly once')
assert.equal(compactedMainCalls, 1, 'main model should run after compaction')
assert(
  compactEvents.some(
    event =>
      event.type === 'system' && event.subtype === 'compact_boundary',
  ),
  'compaction boundary was not emitted',
)
const compactSummary = compactedMainMessages?.find(
  message => message.type === 'user' && message.isCompactSummary,
)
assert(compactSummary, 'main model did not receive the compact summary')
assert.match(
  String(compactSummary.message.content),
  /Continue the portable core extraction/,
)
assert.doesNotMatch(
  String(compactSummary.message.content),
  /draft only/,
  'compact analysis scratchpad must be stripped',
)

const retryError = assistantMessage([
  { type: 'text', text: 'Prompt is too long' },
])
retryError.isApiErrorMessage = true
retryError.errorDetails = 'prompt is too long: 11 tokens > 10'
const retryMessages = [
  userMessage('oldest round'),
  assistantMessage([{ type: 'text', text: 'first response' }]),
  userMessage('newer round'),
  assistantMessage([{ type: 'text', text: 'second response' }]),
  userMessage('latest round'),
]
const truncatedForRetry = truncateHeadForCompactRetry(
  retryMessages,
  retryError,
)
assert(truncatedForRetry, 'prompt-too-long retry should retain a newer round')
assert.equal(
  truncatedForRetry[0].message.content,
  '[earlier conversation truncated for compaction retry]',
)
assert(
  truncatedForRetry.some(
    message =>
      message.type === 'user' && message.message.content === 'latest round',
  ),
  'prompt-too-long retry dropped the newest round',
)

console.log(
  [
    'core smoke OK',
    `${modelCalls} agent model calls`,
    `${echoCalls.length + emptyCalls.length} tool calls`,
    `${compactionCalls} compact call`,
    `${events.length + compactEvents.length} events`,
  ].join(' - '),
)
