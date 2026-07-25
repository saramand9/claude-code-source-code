#!/usr/bin/env node

import assert from 'node:assert/strict'
import {
  buildConversationChain,
  buildLatestConversationChain,
  insertMessageChain,
  parseTranscriptJsonl,
  serializeTranscriptEntries,
} from '../dist-core/index.js'

const stamp = {
  cwd: '/portable/project',
  userType: 'external',
  entrypoint: 'core-test',
  sessionId: 'session-portable',
  version: 'core-test',
}

let sequence = 0
function base(type, timestamp) {
  sequence += 1
  return {
    type,
    uuid: `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`,
    timestamp: timestamp ?? `2026-07-25T00:00:${String(sequence).padStart(2, '0')}.000Z`,
  }
}

function user(content, timestamp) {
  return {
    ...base('user', timestamp),
    message: { role: 'user', content },
  }
}

function assistant(content, id, timestamp) {
  return {
    ...base('assistant', timestamp),
    message: {
      id: id ?? `response-${sequence}`,
      type: 'message',
      role: 'assistant',
      model: 'core-test-model',
      content,
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: {
        input_tokens: 10,
        output_tokens: 5,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    },
  }
}

function chainFromLatest(parsed) {
  const chain = buildLatestConversationChain(parsed)
  assert(chain.length > 0, 'parsed transcript has no conversation leaf')
  return chain
}

// Sequential append -> JSONL -> parse -> resume chain.
const firstUser = user('hello')
const firstAssistant = assistant([{ type: 'text', text: 'hi' }])
const sequentialEntries = insertMessageChain(
  [firstUser, firstAssistant],
  stamp,
)
assert.equal(sequentialEntries[0].parentUuid, null)
assert.equal(sequentialEntries[1].parentUuid, firstUser.uuid)

const sequentialParsed = parseTranscriptJsonl(
  `not-json\n${serializeTranscriptEntries(sequentialEntries)}`,
)
assert.deepEqual(
  chainFromLatest(sequentialParsed).map(message => message.uuid),
  [firstUser.uuid, firstAssistant.uuid],
)

// A normal compact boundary drops the stale physical prefix on resume.
const compactBoundary = {
  ...base('system'),
  subtype: 'compact_boundary',
  content: 'Conversation compacted',
  level: 'info',
  compactMetadata: { trigger: 'auto', preTokens: 1_000 },
}
const compactSummary = {
  ...user('summary'),
  isCompactSummary: true,
  isVisibleInTranscriptOnly: true,
}
const compactEntries = insertMessageChain(
  [compactBoundary, compactSummary],
  stamp,
  { startingParentUuid: firstAssistant.uuid },
)
const compactParsed = parseTranscriptJsonl(
  serializeTranscriptEntries([...sequentialEntries, ...compactEntries]),
)
assert.equal(compactParsed.messages.has(firstUser.uuid), false)
assert.deepEqual(
  chainFromLatest(compactParsed).map(message => message.uuid),
  [compactBoundary.uuid, compactSummary.uuid],
)

// Preserved recent messages are spliced after the summary, while a new child
// originally attached to the summary moves after the preserved tail.
const oldUser = user('old prefix')
const oldAssistant = assistant([{ type: 'text', text: 'old response' }])
const keptUser = user('kept recent user')
const keptAssistant = assistant([{ type: 'text', text: 'kept response' }])
const oldAndKept = insertMessageChain(
  [oldUser, oldAssistant, keptUser, keptAssistant],
  stamp,
)
const segmentBoundary = {
  ...base('system'),
  subtype: 'compact_boundary',
  content: 'Conversation compacted',
  level: 'info',
  compactMetadata: {
    trigger: 'auto',
    preTokens: 2_000,
    preservedSegment: {
      headUuid: keptUser.uuid,
      anchorUuid: '',
      tailUuid: keptAssistant.uuid,
    },
  },
}
const segmentSummary = {
  ...user('segment summary'),
  isCompactSummary: true,
  isVisibleInTranscriptOnly: true,
}
segmentBoundary.compactMetadata.preservedSegment.anchorUuid =
  segmentSummary.uuid
const afterCompact = user('continue after compact')
const segmentNewEntries = insertMessageChain(
  [segmentBoundary, segmentSummary, afterCompact],
  stamp,
  { startingParentUuid: keptAssistant.uuid },
)
const segmentParsed = parseTranscriptJsonl(
  serializeTranscriptEntries([...oldAndKept, ...segmentNewEntries]),
)
assert.equal(segmentParsed.messages.has(oldUser.uuid), false)
assert.deepEqual(
  chainFromLatest(segmentParsed).map(message => message.uuid),
  [
    segmentBoundary.uuid,
    segmentSummary.uuid,
    keptUser.uuid,
    keptAssistant.uuid,
    afterCompact.uuid,
  ],
)
assert.equal(
  segmentParsed.messages.get(keptAssistant.uuid).message.usage.input_tokens,
  0,
)

// Parallel streamed assistant siblings form a DAG. Resume must recover the
// off-chain sibling and its tool_result.
const parallelRoot = user('run both')
const siblingA = assistant(
  [{ type: 'tool_use', id: 'tool-a', name: 'A', input: {} }],
  'shared-response',
  '2026-07-25T00:01:01.000Z',
)
const resultA = {
  ...user(
    [{ type: 'tool_result', tool_use_id: 'tool-a', content: 'A done' }],
    '2026-07-25T00:01:03.000Z',
  ),
  sourceToolAssistantUUID: siblingA.uuid,
}
const nextAssistant = assistant(
  [{ type: 'text', text: 'both done' }],
  'next-response',
  '2026-07-25T00:01:05.000Z',
)
const mainBranch = insertMessageChain(
  [parallelRoot, siblingA, resultA, nextAssistant],
  stamp,
)
const siblingB = assistant(
  [{ type: 'tool_use', id: 'tool-b', name: 'B', input: {} }],
  'shared-response',
  '2026-07-25T00:01:02.000Z',
)
const resultB = {
  ...user(
    [{ type: 'tool_result', tool_use_id: 'tool-b', content: 'B done' }],
    '2026-07-25T00:01:04.000Z',
  ),
  sourceToolAssistantUUID: siblingB.uuid,
}
const siblingBranch = insertMessageChain(
  [siblingB, resultB],
  stamp,
  { startingParentUuid: parallelRoot.uuid },
)
const parallelParsed = parseTranscriptJsonl(
  serializeTranscriptEntries([...mainBranch, ...siblingBranch]),
)
const parallelChain = buildConversationChain(
  parallelParsed.messages,
  parallelParsed.messages.get(nextAssistant.uuid),
)
assert.deepEqual(
  new Set(parallelChain.map(message => message.uuid)),
  new Set([
    parallelRoot.uuid,
    siblingA.uuid,
    resultA.uuid,
    siblingB.uuid,
    resultB.uuid,
    nextAssistant.uuid,
  ]),
)

console.log(
  `core session OK - ${sequentialParsed.messages.size} round-trip messages, compact and parallel-DAG recovery verified`,
)
