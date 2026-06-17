#!/usr/bin/env node

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import http from 'node:http'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const DIST_CLI = join(ROOT, 'dist', 'cli.js')
const ARTIFACT_DIR = join(ROOT, 'build-src', 'test-artifacts')

const prompts = [
  'cli resume e2e prompt one',
  'cli resume e2e prompt two',
  'cli resume e2e prompt three',
]

const responses = [
  'cli resume e2e response one',
  'cli resume e2e response two',
  'cli resume e2e response three',
]

const leakPrompt = 'cli textual tool call leak prompt'
const leakResponse = [
  'I will inspect the file first.',
  'Calling: Read',
  '{"file_path":"kina_solution.cpp"}',
].join('\n')

const toolPrompt = 'cli structured read tool prompt'
const toolFileContent = 'structured tool use fixture: maple-7319'
const toolFinalResponse = 'structured Read tool completed with maple-7319'
let toolReadFilePath = ''

const chunkedToolPrompt = 'cli chunked structured read tool prompt'
const chunkedToolFileContent = 'chunked structured tool use fixture: cedar-8842'
const chunkedToolFinalResponse =
  'chunked structured Read tool completed with cedar-8842'
let chunkedToolReadFilePath = ''

const unclosedToolPrompt = 'cli unclosed structured read tool prompt'
const unclosedToolFileContent = 'unclosed structured tool use fixture: birch-5021'
const unclosedToolFinalResponse =
  'unclosed structured Read tool completed with birch-5021'
let unclosedToolReadFilePath = ''

const outOfOrderPrompt = 'cli out-of-order stream fallback prompt'
const outOfOrderFallbackResponse =
  'out-of-order streaming recovered through non-streaming fallback'

const multiToolPrompt = 'cli multi structured read tools prompt'
const multiToolFileContentA = 'multi structured tool fixture: ash-1190'
const multiToolFileContentB = 'multi structured tool fixture: elm-7734'
const multiToolFinalResponse =
  'multi structured Read tools completed with ash-1190 and elm-7734'
let multiToolReadFilePathA = ''
let multiToolReadFilePathB = ''

const mixedToolPrompt = 'cli mixed text read bash tools prompt'
const mixedToolAssistantText = 'I will read a file and run a read-only shell command.'
const mixedToolReadContent = 'mixed structured tool fixture: spruce-4408'
const mixedToolBashResult = 'mixed-bash-5520'
const mixedToolFinalResponse =
  'mixed text Read and Bash tools completed with spruce-4408'
let mixedToolReadFilePath = ''

const tripleToolPrompt = 'cli triple read bash read tools prompt'
const tripleToolAssistantText =
  'I will run three tool blocks in one assistant response.'
const tripleToolFileContentA = 'triple structured tool fixture: pine-2816'
const tripleToolFileContentB = 'triple structured tool fixture: oak-9164'
const tripleToolBashResult = 'triple-bash-7305'
const tripleToolFinalResponse =
  'triple Read Bash Read tools completed with pine-2816 oak-9164'
let tripleToolReadFilePathA = ''
let tripleToolReadFilePathB = ''

const bashSideEffectPrompt = 'cli bash side effect tool prompt'
const bashSideEffectResult = 'bash-side-effect-6401'
const bashSideEffectFinalResponse =
  'Bash side effect tool completed with file marker'
const bashSideEffectRelativePath =
  'build-src/test-artifacts/cli-bash-side-effect-tool.txt'
const bashSideEffectFilePath = join(ROOT, bashSideEffectRelativePath)

const editToolPrompt = 'cli read then edit tool prompt'
const editToolOriginalContent = 'edit structured tool fixture: before-1842'
const editToolUpdatedContent = 'edit structured tool fixture: after-1842'
const editToolFinalResponse =
  'structured Read then Edit tool completed with after-1842'
let editToolFilePath = ''

const writeToolPrompt = 'cli write tool create prompt'
const writeToolContent = 'write structured tool fixture: willow-2751'
const writeToolFinalResponse =
  'structured Write tool completed with willow-2751'
let writeToolFilePath = ''

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', chunk => chunks.push(chunk))
    req.on('error', reject)
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      if (!raw) {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(raw))
      } catch (error) {
        reject(new Error(`Failed to parse request JSON: ${error.message}`))
      }
    })
  })
}

function writeJson(res, data) {
  res.writeHead(200, {
    'content-type': 'application/json',
    'request-id': `req_mock_${Date.now()}`,
  })
  res.end(JSON.stringify(data))
}

function makeMessage(id, text, usage = {}) {
  return {
    id,
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-4-6',
    content: [{ type: 'text', text }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: {
      input_tokens: usage.input_tokens ?? 10,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      output_tokens: usage.output_tokens ?? Math.max(1, Math.ceil(text.length / 4)),
    },
  }
}

function writeSseFrame(res, event, data) {
  res.write(`event: ${event}\n`)
  res.write(`data: ${JSON.stringify(data)}\n\n`)
}

function writeStreamingMessage(res, index, sequence, text) {
  const responseText =
    text ?? responses[index] ?? `cli resume e2e extra response ${index + 1}`
  const id = `msg_cli_resume_e2e_${index + 1}`

  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
    'request-id': `req_mock_${sequence}`,
  })
  writeSseFrame(res, 'message_start', {
    type: 'message_start',
    message: {
      ...makeMessage(id, '', { input_tokens: 100 + index }),
      content: [],
      stop_reason: null,
      usage: {
        input_tokens: 100 + index,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        output_tokens: 0,
      },
    },
  })
  writeSseFrame(res, 'content_block_start', {
    type: 'content_block_start',
    index: 0,
    content_block: { type: 'text', text: '' },
  })
  writeSseFrame(res, 'content_block_delta', {
    type: 'content_block_delta',
    index: 0,
    delta: { type: 'text_delta', text: responseText },
  })
  writeSseFrame(res, 'content_block_stop', {
    type: 'content_block_stop',
    index: 0,
  })
  writeSseFrame(res, 'message_delta', {
    type: 'message_delta',
    delta: { stop_reason: 'end_turn', stop_sequence: null },
    usage: { output_tokens: Math.max(1, Math.ceil(responseText.length / 4)) },
  })
  writeSseFrame(res, 'message_stop', { type: 'message_stop' })
  res.end()
}

function writeOutOfOrderStreamingMessage(res, sequence) {
  const id = `msg_cli_out_of_order_${sequence}`

  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
    'request-id': `req_mock_${sequence}`,
  })
  writeSseFrame(res, 'message_start', {
    type: 'message_start',
    message: {
      ...makeMessage(id, '', { input_tokens: 130 }),
      content: [],
      stop_reason: null,
      usage: {
        input_tokens: 130,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        output_tokens: 0,
      },
    },
  })
  writeSseFrame(res, 'content_block_delta', {
    type: 'content_block_delta',
    index: 0,
    delta: { type: 'text_delta', text: outOfOrderFallbackResponse },
  })
  res.end()
}

function writeStreamingToolUse(res, sequence, options = {}) {
  const id = `msg_cli_tool_use_${sequence}`
  const toolUseId = `toolu_cli_read_${sequence}`
  const filePath = options.filePath ?? toolReadFilePath
  const inputJson = JSON.stringify({ file_path: filePath })
  const inputDeltas = options.splitInputDeltas
    ? [
        inputJson.slice(0, 2),
        inputJson.slice(2, 9),
        inputJson.slice(9, 17),
        inputJson.slice(17),
      ].filter(Boolean)
    : [inputJson]
  const stopReason = options.stopReason ?? 'tool_use'

  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
    'request-id': `req_mock_${sequence}`,
  })
  writeSseFrame(res, 'message_start', {
    type: 'message_start',
    message: {
      ...makeMessage(id, '', { input_tokens: 120 }),
      content: [],
      stop_reason: null,
      usage: {
        input_tokens: 120,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        output_tokens: 0,
      },
    },
  })
  writeSseFrame(res, 'content_block_start', {
    type: 'content_block_start',
    index: 0,
    content_block: {
      type: 'tool_use',
      id: toolUseId,
      name: 'Read',
      input: {},
    },
  })
  for (const partial_json of inputDeltas) {
    writeSseFrame(res, 'content_block_delta', {
      type: 'content_block_delta',
      index: 0,
      delta: {
        type: 'input_json_delta',
        partial_json,
      },
    })
  }
  if (!options.omitContentBlockStop) {
    writeSseFrame(res, 'content_block_stop', {
      type: 'content_block_stop',
      index: 0,
    })
  }
  writeSseFrame(res, 'message_delta', {
    type: 'message_delta',
    delta: { stop_reason: stopReason, stop_sequence: null },
    usage: { output_tokens: 8 },
  })
  writeSseFrame(res, 'message_stop', { type: 'message_stop' })
  res.end()
}

function splitIntoDeltas(inputJson) {
  return [
    inputJson.slice(0, 2),
    inputJson.slice(2, 11),
    inputJson.slice(11, 23),
    inputJson.slice(23),
  ].filter(Boolean)
}

function writeStreamingMultiToolUse(res, sequence) {
  const id = `msg_cli_multi_tool_use_${sequence}`
  const toolUseIdA = `toolu_cli_read_a_${sequence}`
  const toolUseIdB = `toolu_cli_read_b_${sequence}`
  const inputDeltasA = splitIntoDeltas(
    JSON.stringify({ file_path: multiToolReadFilePathA }),
  )
  const inputDeltasB = splitIntoDeltas(
    JSON.stringify({ file_path: multiToolReadFilePathB }),
  )

  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
    'request-id': `req_mock_${sequence}`,
  })
  writeSseFrame(res, 'message_start', {
    type: 'message_start',
    message: {
      ...makeMessage(id, '', { input_tokens: 150 }),
      content: [],
      stop_reason: null,
      usage: {
        input_tokens: 150,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        output_tokens: 0,
      },
    },
  })
  writeSseFrame(res, 'content_block_start', {
    type: 'content_block_start',
    index: 0,
    content_block: {
      type: 'tool_use',
      id: toolUseIdA,
      name: 'Read',
      input: {},
    },
  })
  writeSseFrame(res, 'content_block_start', {
    type: 'content_block_start',
    index: 1,
    content_block: {
      type: 'tool_use',
      id: toolUseIdB,
      name: 'Read',
      input: {},
    },
  })
  const maxDeltaCount = Math.max(inputDeltasA.length, inputDeltasB.length)
  for (let i = 0; i < maxDeltaCount; i++) {
    if (inputDeltasB[i]) {
      writeSseFrame(res, 'content_block_delta', {
        type: 'content_block_delta',
        index: 1,
        delta: {
          type: 'input_json_delta',
          partial_json: inputDeltasB[i],
        },
      })
    }
    if (inputDeltasA[i]) {
      writeSseFrame(res, 'content_block_delta', {
        type: 'content_block_delta',
        index: 0,
        delta: {
          type: 'input_json_delta',
          partial_json: inputDeltasA[i],
        },
      })
    }
  }
  writeSseFrame(res, 'content_block_stop', {
    type: 'content_block_stop',
    index: 1,
  })
  writeSseFrame(res, 'content_block_stop', {
    type: 'content_block_stop',
    index: 0,
  })
  writeSseFrame(res, 'message_delta', {
    type: 'message_delta',
    delta: { stop_reason: 'tool_use', stop_sequence: null },
    usage: { output_tokens: 12 },
  })
  writeSseFrame(res, 'message_stop', { type: 'message_stop' })
  res.end()
}

function writeStreamingMixedToolUse(res, sequence) {
  const id = `msg_cli_mixed_tool_use_${sequence}`
  const readToolUseId = `toolu_cli_mixed_read_${sequence}`
  const bashToolUseId = `toolu_cli_mixed_bash_${sequence}`
  const readInputDeltas = splitIntoDeltas(
    JSON.stringify({ file_path: mixedToolReadFilePath }),
  )
  const bashInputDeltas = splitIntoDeltas(
    JSON.stringify({
      command: `echo ${mixedToolBashResult}`,
      description: 'Print mixed Bash fixture marker',
    }),
  )

  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
    'request-id': `req_mock_${sequence}`,
  })
  writeSseFrame(res, 'message_start', {
    type: 'message_start',
    message: {
      ...makeMessage(id, '', { input_tokens: 160 }),
      content: [],
      stop_reason: null,
      usage: {
        input_tokens: 160,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        output_tokens: 0,
      },
    },
  })
  writeSseFrame(res, 'content_block_start', {
    type: 'content_block_start',
    index: 0,
    content_block: { type: 'text', text: '' },
  })
  writeSseFrame(res, 'content_block_delta', {
    type: 'content_block_delta',
    index: 0,
    delta: { type: 'text_delta', text: mixedToolAssistantText },
  })
  writeSseFrame(res, 'content_block_start', {
    type: 'content_block_start',
    index: 1,
    content_block: {
      type: 'tool_use',
      id: readToolUseId,
      name: 'Read',
      input: {},
    },
  })
  writeSseFrame(res, 'content_block_start', {
    type: 'content_block_start',
    index: 2,
    content_block: {
      type: 'tool_use',
      id: bashToolUseId,
      name: 'Bash',
      input: {},
    },
  })
  const maxDeltaCount = Math.max(readInputDeltas.length, bashInputDeltas.length)
  for (let i = 0; i < maxDeltaCount; i++) {
    if (readInputDeltas[i]) {
      writeSseFrame(res, 'content_block_delta', {
        type: 'content_block_delta',
        index: 1,
        delta: {
          type: 'input_json_delta',
          partial_json: readInputDeltas[i],
        },
      })
    }
    if (bashInputDeltas[i]) {
      writeSseFrame(res, 'content_block_delta', {
        type: 'content_block_delta',
        index: 2,
        delta: {
          type: 'input_json_delta',
          partial_json: bashInputDeltas[i],
        },
      })
    }
  }
  writeSseFrame(res, 'content_block_stop', {
    type: 'content_block_stop',
    index: 0,
  })
  writeSseFrame(res, 'content_block_stop', {
    type: 'content_block_stop',
    index: 2,
  })
  writeSseFrame(res, 'content_block_stop', {
    type: 'content_block_stop',
    index: 1,
  })
  writeSseFrame(res, 'message_delta', {
    type: 'message_delta',
    delta: { stop_reason: 'tool_use', stop_sequence: null },
    usage: { output_tokens: 16 },
  })
  writeSseFrame(res, 'message_stop', { type: 'message_stop' })
  res.end()
}

function writeStreamingTripleToolUse(res, sequence) {
  const id = `msg_cli_triple_tool_use_${sequence}`
  const readToolUseIdA = `toolu_cli_triple_read_a_${sequence}`
  const bashToolUseId = `toolu_cli_triple_bash_${sequence}`
  const readToolUseIdB = `toolu_cli_triple_read_b_${sequence}`
  const readInputDeltasA = splitIntoDeltas(
    JSON.stringify({ file_path: tripleToolReadFilePathA }),
  )
  const bashInputDeltas = splitIntoDeltas(
    JSON.stringify({
      command: `echo ${tripleToolBashResult}`,
      description: 'Print triple Bash fixture marker',
    }),
  )
  const readInputDeltasB = splitIntoDeltas(
    JSON.stringify({ file_path: tripleToolReadFilePathB }),
  )

  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
    'request-id': `req_mock_${sequence}`,
  })
  writeSseFrame(res, 'message_start', {
    type: 'message_start',
    message: {
      ...makeMessage(id, '', { input_tokens: 165 }),
      content: [],
      stop_reason: null,
      usage: {
        input_tokens: 165,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        output_tokens: 0,
      },
    },
  })
  writeSseFrame(res, 'content_block_start', {
    type: 'content_block_start',
    index: 0,
    content_block: { type: 'text', text: '' },
  })
  writeSseFrame(res, 'content_block_delta', {
    type: 'content_block_delta',
    index: 0,
    delta: { type: 'text_delta', text: tripleToolAssistantText },
  })
  writeSseFrame(res, 'content_block_start', {
    type: 'content_block_start',
    index: 1,
    content_block: {
      type: 'tool_use',
      id: readToolUseIdA,
      name: 'Read',
      input: {},
    },
  })
  writeSseFrame(res, 'content_block_start', {
    type: 'content_block_start',
    index: 2,
    content_block: {
      type: 'tool_use',
      id: bashToolUseId,
      name: 'Bash',
      input: {},
    },
  })
  writeSseFrame(res, 'content_block_start', {
    type: 'content_block_start',
    index: 3,
    content_block: {
      type: 'tool_use',
      id: readToolUseIdB,
      name: 'Read',
      input: {},
    },
  })
  const maxDeltaCount = Math.max(
    readInputDeltasA.length,
    bashInputDeltas.length,
    readInputDeltasB.length,
  )
  for (let i = 0; i < maxDeltaCount; i++) {
    if (readInputDeltasB[i]) {
      writeSseFrame(res, 'content_block_delta', {
        type: 'content_block_delta',
        index: 3,
        delta: {
          type: 'input_json_delta',
          partial_json: readInputDeltasB[i],
        },
      })
    }
    if (bashInputDeltas[i]) {
      writeSseFrame(res, 'content_block_delta', {
        type: 'content_block_delta',
        index: 2,
        delta: {
          type: 'input_json_delta',
          partial_json: bashInputDeltas[i],
        },
      })
    }
    if (readInputDeltasA[i]) {
      writeSseFrame(res, 'content_block_delta', {
        type: 'content_block_delta',
        index: 1,
        delta: {
          type: 'input_json_delta',
          partial_json: readInputDeltasA[i],
        },
      })
    }
  }
  for (const index of [0, 3, 1, 2]) {
    writeSseFrame(res, 'content_block_stop', {
      type: 'content_block_stop',
      index,
    })
  }
  writeSseFrame(res, 'message_delta', {
    type: 'message_delta',
    delta: { stop_reason: 'tool_use', stop_sequence: null },
    usage: { output_tokens: 18 },
  })
  writeSseFrame(res, 'message_stop', { type: 'message_stop' })
  res.end()
}

function writeStreamingBashSideEffectToolUse(res, sequence) {
  const id = `msg_cli_bash_side_effect_tool_use_${sequence}`
  const toolUseId = `toolu_cli_bash_side_effect_${sequence}`
  const inputDeltas = splitIntoDeltas(
    JSON.stringify({
      command: `echo ${bashSideEffectResult} > ${bashSideEffectRelativePath}`,
      description: 'Write a Bash side-effect fixture marker',
    }),
  )

  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
    'request-id': `req_mock_${sequence}`,
  })
  writeSseFrame(res, 'message_start', {
    type: 'message_start',
    message: {
      ...makeMessage(id, '', { input_tokens: 168 }),
      content: [],
      stop_reason: null,
      usage: {
        input_tokens: 168,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        output_tokens: 0,
      },
    },
  })
  writeSseFrame(res, 'content_block_start', {
    type: 'content_block_start',
    index: 0,
    content_block: {
      type: 'tool_use',
      id: toolUseId,
      name: 'Bash',
      input: {},
    },
  })
  for (const partial_json of inputDeltas) {
    writeSseFrame(res, 'content_block_delta', {
      type: 'content_block_delta',
      index: 0,
      delta: {
        type: 'input_json_delta',
        partial_json,
      },
    })
  }
  writeSseFrame(res, 'content_block_stop', {
    type: 'content_block_stop',
    index: 0,
  })
  writeSseFrame(res, 'message_delta', {
    type: 'message_delta',
    delta: { stop_reason: 'tool_use', stop_sequence: null },
    usage: { output_tokens: 10 },
  })
  writeSseFrame(res, 'message_stop', { type: 'message_stop' })
  res.end()
}

function writeStreamingEditToolUse(res, sequence) {
  const id = `msg_cli_edit_tool_use_${sequence}`
  const toolUseId = `toolu_cli_edit_${sequence}`
  const inputDeltas = splitIntoDeltas(
    JSON.stringify({
      file_path: editToolFilePath,
      old_string: editToolOriginalContent,
      new_string: editToolUpdatedContent,
    }),
  )

  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
    'request-id': `req_mock_${sequence}`,
  })
  writeSseFrame(res, 'message_start', {
    type: 'message_start',
    message: {
      ...makeMessage(id, '', { input_tokens: 170 }),
      content: [],
      stop_reason: null,
      usage: {
        input_tokens: 170,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        output_tokens: 0,
      },
    },
  })
  writeSseFrame(res, 'content_block_start', {
    type: 'content_block_start',
    index: 0,
    content_block: {
      type: 'tool_use',
      id: toolUseId,
      name: 'Edit',
      input: {},
    },
  })
  for (const partial_json of inputDeltas) {
    writeSseFrame(res, 'content_block_delta', {
      type: 'content_block_delta',
      index: 0,
      delta: {
        type: 'input_json_delta',
        partial_json,
      },
    })
  }
  writeSseFrame(res, 'content_block_stop', {
    type: 'content_block_stop',
    index: 0,
  })
  writeSseFrame(res, 'message_delta', {
    type: 'message_delta',
    delta: { stop_reason: 'tool_use', stop_sequence: null },
    usage: { output_tokens: 10 },
  })
  writeSseFrame(res, 'message_stop', { type: 'message_stop' })
  res.end()
}

function writeStreamingWriteToolUse(res, sequence) {
  const id = `msg_cli_write_tool_use_${sequence}`
  const toolUseId = `toolu_cli_write_${sequence}`
  const inputDeltas = splitIntoDeltas(
    JSON.stringify({
      file_path: writeToolFilePath,
      content: `${writeToolContent}\n`,
    }),
  )

  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
    'request-id': `req_mock_${sequence}`,
  })
  writeSseFrame(res, 'message_start', {
    type: 'message_start',
    message: {
      ...makeMessage(id, '', { input_tokens: 172 }),
      content: [],
      stop_reason: null,
      usage: {
        input_tokens: 172,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        output_tokens: 0,
      },
    },
  })
  writeSseFrame(res, 'content_block_start', {
    type: 'content_block_start',
    index: 0,
    content_block: {
      type: 'tool_use',
      id: toolUseId,
      name: 'Write',
      input: {},
    },
  })
  for (const partial_json of inputDeltas) {
    writeSseFrame(res, 'content_block_delta', {
      type: 'content_block_delta',
      index: 0,
      delta: {
        type: 'input_json_delta',
        partial_json,
      },
    })
  }
  writeSseFrame(res, 'content_block_stop', {
    type: 'content_block_stop',
    index: 0,
  })
  writeSseFrame(res, 'message_delta', {
    type: 'message_delta',
    delta: { stop_reason: 'tool_use', stop_sequence: null },
    usage: { output_tokens: 10 },
  })
  writeSseFrame(res, 'message_stop', { type: 'message_stop' })
  res.end()
}

function bodyContentBlocks(body, type) {
  return (body.messages ?? []).flatMap(message => {
    const content = message.content
    if (!Array.isArray(content)) return []
    return content.filter(block => block?.type === type)
  })
}

function hasToolResultWithIdPrefix(body, prefix) {
  return bodyContentBlocks(body, 'tool_result').some(block => {
    return (
      typeof block.tool_use_id === 'string' &&
      block.tool_use_id.startsWith(prefix)
    )
  })
}

function responseForBody(body, fallbackIndex) {
  const combinedText = (body.messages ?? [])
    .map(message => textFromContent(message.content))
    .join('\n')
  if (combinedText.includes(writeToolPrompt)) {
    if (hasToolResultWithIdPrefix(body, 'toolu_cli_write_')) {
      return {
        index: responses.length + 10,
        text: writeToolFinalResponse,
      }
    }
    return {
      index: responses.length + 10,
      writeToolUse: true,
      text: '',
    }
  }
  if (combinedText.includes(editToolPrompt)) {
    if (
      hasToolResultWithIdPrefix(body, 'toolu_cli_edit_') ||
      combinedText.includes(editToolUpdatedContent)
    ) {
      return {
        index: responses.length + 7,
        text: editToolFinalResponse,
      }
    }
    if (combinedText.includes(editToolOriginalContent)) {
      return {
        index: responses.length + 7,
        editToolUse: true,
        text: '',
      }
    }
    return {
      index: responses.length + 7,
      toolUse: true,
      toolOptions: {
        filePath: editToolFilePath,
      },
      text: '',
    }
  }
  if (combinedText.includes(tripleToolPrompt)) {
    if (
      combinedText.includes(tripleToolFileContentA) &&
      combinedText.includes(tripleToolFileContentB) &&
      combinedText.includes(tripleToolBashResult)
    ) {
      return {
        index: responses.length + 8,
        text: tripleToolFinalResponse,
      }
    }
    return {
      index: responses.length + 8,
      tripleToolUse: true,
      text: '',
    }
  }
  if (combinedText.includes(bashSideEffectPrompt)) {
    if (hasToolResultWithIdPrefix(body, 'toolu_cli_bash_side_effect_')) {
      return {
        index: responses.length + 9,
        text: bashSideEffectFinalResponse,
      }
    }
    return {
      index: responses.length + 9,
      bashSideEffectToolUse: true,
      text: '',
    }
  }
  if (combinedText.includes(mixedToolPrompt)) {
    if (
      combinedText.includes(mixedToolReadContent) &&
      combinedText.includes(mixedToolBashResult)
    ) {
      return {
        index: responses.length + 6,
        text: mixedToolFinalResponse,
      }
    }
    return {
      index: responses.length + 6,
      mixedToolUse: true,
      text: '',
    }
  }
  if (combinedText.includes(multiToolPrompt)) {
    if (
      combinedText.includes(multiToolFileContentA) &&
      combinedText.includes(multiToolFileContentB)
    ) {
      return {
        index: responses.length + 5,
        text: multiToolFinalResponse,
      }
    }
    return {
      index: responses.length + 5,
      multiToolUse: true,
      text: '',
    }
  }
  if (combinedText.includes(outOfOrderPrompt)) {
    return {
      index: responses.length + 4,
      outOfOrderStream: true,
      text: outOfOrderFallbackResponse,
    }
  }
  if (combinedText.includes(unclosedToolPrompt)) {
    if (combinedText.includes(unclosedToolFileContent)) {
      return {
        index: responses.length + 3,
        text: unclosedToolFinalResponse,
      }
    }
    return {
      index: responses.length + 3,
      toolUse: true,
      toolOptions: {
        filePath: unclosedToolReadFilePath,
        omitContentBlockStop: true,
      },
      text: '',
    }
  }
  if (combinedText.includes(chunkedToolPrompt)) {
    if (combinedText.includes(chunkedToolFileContent)) {
      return {
        index: responses.length + 2,
        text: chunkedToolFinalResponse,
      }
    }
    return {
      index: responses.length + 2,
      toolUse: true,
      toolOptions: {
        filePath: chunkedToolReadFilePath,
        splitInputDeltas: true,
        stopReason: 'end_turn',
      },
      text: '',
    }
  }
  if (combinedText.includes(toolPrompt)) {
    if (combinedText.includes(toolFileContent)) {
      return {
        index: responses.length + 1,
        text: toolFinalResponse,
      }
    }
    return {
      index: responses.length + 1,
      toolUse: true,
      text: '',
    }
  }
  if (combinedText.includes(leakPrompt)) {
    return {
      index: responses.length,
      text: leakResponse,
    }
  }
  for (let i = prompts.length - 1; i >= 0; i--) {
    if (combinedText.includes(prompts[i])) {
      return {
        index: i,
        text: responses[i],
      }
    }
  }
  const index = Math.min(fallbackIndex, responses.length - 1)
  return {
    index,
    text: responses[index],
  }
}

function startMockServer() {
  const requests = []
  let messageRequests = 0

  const server = http.createServer(async (req, res) => {
    try {
      if (req.method !== 'POST') {
        res.writeHead(404)
        res.end('not found')
        return
      }

      const body = await readRequestBody(req)
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      requests.push({ path: url.pathname, body })

      if (url.pathname.endsWith('/messages/count_tokens')) {
        writeJson(res, { input_tokens: 100 })
        return
      }

      if (url.pathname.endsWith('/messages')) {
        const sequence = ++messageRequests
        const response = responseForBody(body, sequence - 1)
        if (response.outOfOrderStream && body.stream === true) {
          writeOutOfOrderStreamingMessage(res, sequence)
          return
        }
        if (response.multiToolUse) {
          writeStreamingMultiToolUse(res, sequence)
          return
        }
        if (response.mixedToolUse) {
          writeStreamingMixedToolUse(res, sequence)
          return
        }
        if (response.tripleToolUse) {
          writeStreamingTripleToolUse(res, sequence)
          return
        }
        if (response.bashSideEffectToolUse) {
          writeStreamingBashSideEffectToolUse(res, sequence)
          return
        }
        if (response.editToolUse) {
          writeStreamingEditToolUse(res, sequence)
          return
        }
        if (response.writeToolUse) {
          writeStreamingWriteToolUse(res, sequence)
          return
        }
        if (response.toolUse) {
          writeStreamingToolUse(res, sequence, response.toolOptions)
          return
        }
        if (body.stream === true) {
          writeStreamingMessage(res, response.index, sequence, response.text)
        } else {
          writeJson(res, makeMessage(`msg_cli_resume_e2e_sync_${sequence}`, response.text))
        }
        return
      }

      res.writeHead(404)
      res.end('not found')
    } catch (error) {
      if (res.headersSent) {
        res.destroy(error)
        return
      }
      res.writeHead(500, { 'content-type': 'text/plain' })
      res.end(error?.stack ?? String(error))
    }
  })

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      const address = server.address()
      assert(address && typeof address === 'object')
      resolve({
        baseUrl: `http://127.0.0.1:${address.port}`,
        requests,
        close: () =>
          new Promise((closeResolve, closeReject) => {
            server.close(error => (error ? closeReject(error) : closeResolve()))
          }),
      })
    })
  })
}

function runCli(args, env, options = {}) {
  return new Promise((resolve, reject) => {
    const timeoutMs = options.timeoutMs ?? 45_000
    const child = spawn(process.execPath, [DIST_CLI, ...args], {
      cwd: ROOT,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', chunk => {
      stdout += chunk
    })
    child.stderr.on('data', chunk => {
      stderr += chunk
    })
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill()
      reject(
        new Error(
          [
            `CLI timed out after ${timeoutMs}ms`,
            `args: ${args.join(' ')}`,
            options.describeState ? `state:\n${options.describeState()}` : '',
            `stdout:\n${stdout}`,
            `stderr:\n${stderr}`,
          ]
            .filter(Boolean)
            .join('\n'),
        ),
      )
    }, timeoutMs)
    child.on('error', error => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', code => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (code !== 0 && !options.allowNonZero) {
        reject(
          new Error(
            [
              `CLI exited with code ${code}`,
              `args: ${args.join(' ')}`,
              `stdout:\n${stdout}`,
              `stderr:\n${stderr}`,
            ].join('\n'),
          ),
        )
        return
      }
      resolve({ stdout, stderr, code })
    })
  })
}

function parseJsonOutput(stdout) {
  const candidates = stdout
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.startsWith('{') && line.endsWith('}'))
  assert(candidates.length > 0, `No JSON object found in stdout:\n${stdout}`)
  return JSON.parse(candidates.at(-1))
}

function textFromContent(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map(block => {
      if (!block || typeof block !== 'object') return ''
      if (typeof block.text === 'string') return block.text
      if (typeof block.content === 'string') return block.content
      return ''
    })
    .join('\n')
}

function requestTexts(request) {
  return (request.body.messages ?? []).map(message => ({
    role: message.role,
    text: textFromContent(message.content),
  }))
}

function requestContentBlocks(request, type) {
  return (request.body.messages ?? []).flatMap(message => {
    const content = message.content
    if (!Array.isArray(content)) return []
    return content.filter(block => block?.type === type)
  })
}

function containsText(messages, expectedText) {
  return messages.some(message => message.text.includes(expectedText))
}

function summarizeRequests(requests) {
  return requests
    .map((request, index) => ({
      index,
      path: request.path,
      stream: request.body.stream,
      texts: requestTexts(request),
    }))
}

async function findFiles(dir, predicate) {
  const results = []
  async function walk(current) {
    let entries
    try {
      entries = await readdir(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = join(current, entry.name)
      if (entry.isDirectory()) {
        await walk(full)
      } else if (entry.isFile() && predicate(full)) {
        results.push(full)
      }
    }
  }
  await walk(dir)
  return results
}

async function readJsonl(file) {
  const raw = await readFile(file, 'utf8')
  return raw
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => JSON.parse(line))
}

async function main() {
  await stat(DIST_CLI).catch(() => {
    throw new Error('dist/cli.js is missing. Run npm run build first.')
  })
  await mkdir(ARTIFACT_DIR, { recursive: true })
  toolReadFilePath = join(ARTIFACT_DIR, 'cli-structured-read-tool.txt')
  await writeFile(toolReadFilePath, `${toolFileContent}\n`, 'utf8')
  chunkedToolReadFilePath = join(
    ARTIFACT_DIR,
    'cli-chunked-structured-read-tool.txt',
  )
  await writeFile(chunkedToolReadFilePath, `${chunkedToolFileContent}\n`, 'utf8')
  unclosedToolReadFilePath = join(
    ARTIFACT_DIR,
    'cli-unclosed-structured-read-tool.txt',
  )
  await writeFile(
    unclosedToolReadFilePath,
    `${unclosedToolFileContent}\n`,
    'utf8',
  )
  multiToolReadFilePathA = join(
    ARTIFACT_DIR,
    'cli-multi-structured-read-tool-a.txt',
  )
  multiToolReadFilePathB = join(
    ARTIFACT_DIR,
    'cli-multi-structured-read-tool-b.txt',
  )
  await writeFile(multiToolReadFilePathA, `${multiToolFileContentA}\n`, 'utf8')
  await writeFile(multiToolReadFilePathB, `${multiToolFileContentB}\n`, 'utf8')
  mixedToolReadFilePath = join(
    ARTIFACT_DIR,
    'cli-mixed-structured-read-tool.txt',
  )
  await writeFile(mixedToolReadFilePath, `${mixedToolReadContent}\n`, 'utf8')
  tripleToolReadFilePathA = join(
    ARTIFACT_DIR,
    'cli-triple-structured-read-tool-a.txt',
  )
  tripleToolReadFilePathB = join(
    ARTIFACT_DIR,
    'cli-triple-structured-read-tool-b.txt',
  )
  await writeFile(tripleToolReadFilePathA, `${tripleToolFileContentA}\n`, 'utf8')
  await writeFile(tripleToolReadFilePathB, `${tripleToolFileContentB}\n`, 'utf8')
  await rm(bashSideEffectFilePath, { force: true })
  editToolFilePath = join(ARTIFACT_DIR, 'cli-read-then-edit-tool.txt')
  await writeFile(editToolFilePath, `${editToolOriginalContent}\n`, 'utf8')
  writeToolFilePath = join(ARTIFACT_DIR, 'cli-write-tool-create.txt')
  await rm(writeToolFilePath, { force: true })

  const server = await startMockServer()
  const configDir = await mkdtemp(join(ARTIFACT_DIR, 'cli-e2e-config-'))
  const tmpHome = await mkdtemp(join(tmpdir(), 'claude-cli-e2e-home-'))
  const env = {
    ...process.env,
    ANTHROPIC_API_KEY: 'test-key',
    ANTHROPIC_BASE_URL: server.baseUrl,
    CLAUDE_CONFIG_DIR: configDir,
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    CLAUDE_CODE_SIMPLE: '1',
    DISABLE_AUTOUPDATER: '1',
    DISABLE_TELEMETRY: '1',
    NO_COLOR: '1',
    NODE_ENV: 'production',
    USERPROFILE: tmpHome,
    HOME: tmpHome,
  }
  delete env.ANTHROPIC_AUTH_TOKEN
  delete env.CLAUDE_CODE_USE_BEDROCK
  delete env.CLAUDE_CODE_USE_VERTEX
  delete env.CLAUDE_CODE_USE_FOUNDRY

  try {
    const runCliOptions = () => ({
      describeState: () => JSON.stringify(summarizeRequests(server.requests), null, 2),
    })
    const baseArgs = [
      '--bare',
      '--print',
      '--output-format',
      'json',
      '--max-turns',
      '1',
      '--model',
      'sonnet',
    ]

    const first = parseJsonOutput(
      (await runCli([...baseArgs, prompts[0]], env, runCliOptions())).stdout,
    )
    assert.match(first.session_id, /^[0-9a-f-]{36}$/i, 'first run should return a session id')
    assert.equal(first.result, responses[0], 'first run result text')

    const second = parseJsonOutput(
      (
        await runCli(
          [...baseArgs, '--resume', first.session_id, prompts[1]],
          env,
          runCliOptions(),
        )
      ).stdout,
    )
    assert.equal(second.session_id, first.session_id, '--resume should reuse the session id')
    assert.equal(
      second.result,
      responses[1],
      `resume run result text\n${JSON.stringify(summarizeRequests(server.requests), null, 2)}`,
    )

    const third = parseJsonOutput(
      (await runCli([...baseArgs, '--continue', prompts[2]], env, runCliOptions())).stdout,
    )
    assert.equal(third.session_id, first.session_id, '--continue should reuse latest session id')
    assert.equal(third.result, responses[2], 'continue run result text')

    const promptRequests = server.requests.filter(request => {
      if (!request.path.endsWith('/messages') || request.body.stream !== true) {
        return false
      }
      const texts = requestTexts(request)
      return prompts.some(prompt => containsText(texts, prompt))
    })
    assert.equal(promptRequests.length, 3, 'expected three streamed prompt requests')

    const firstTexts = requestTexts(promptRequests[0])
    assert(containsText(firstTexts, prompts[0]), 'first request should contain first prompt')
    assert(!containsText(firstTexts, responses[0]), 'first request should not contain future assistant response')

    const secondTexts = requestTexts(promptRequests[1])
    assert(containsText(secondTexts, prompts[0]), 'resume request should contain first prompt')
    assert(containsText(secondTexts, responses[0]), 'resume request should contain first response')
    assert(containsText(secondTexts, prompts[1]), 'resume request should contain second prompt')

    const thirdTexts = requestTexts(promptRequests[2])
    for (const expected of [
      prompts[0],
      responses[0],
      prompts[1],
      responses[1],
      prompts[2],
    ]) {
      assert(containsText(thirdTexts, expected), `continue request should contain ${expected}`)
    }

    const transcripts = await findFiles(
      configDir,
      file => file.endsWith(`${first.session_id}.jsonl`),
    )
    assert.equal(transcripts.length, 1, 'expected one transcript for the session id')
    const entries = await readJsonl(transcripts[0])
    const transcriptText = entries.map(entry => JSON.stringify(entry)).join('\n')
    for (const expected of [...prompts, ...responses]) {
      assert(
        transcriptText.includes(expected),
        `transcript should contain ${expected}`,
      )
    }
    const messageEntries = entries.filter(entry => typeof entry.uuid === 'string')
    const messageUuids = messageEntries.map(entry => entry.uuid)
    assert.equal(
      new Set(messageUuids).size,
      messageUuids.length,
      'transcript message UUIDs should not be duplicated',
    )
    const persistedUserTexts = messageEntries
      .filter(entry => entry.type === 'user')
      .map(entry => textFromContent(entry.message?.content))
    const persistedAssistantTexts = messageEntries
      .filter(entry => entry.type === 'assistant')
      .map(entry => textFromContent(entry.message?.content))
    for (const prompt of prompts) {
      assert.equal(
        persistedUserTexts.filter(text => text.includes(prompt)).length,
        1,
        `transcript should persist one user message for ${prompt}`,
      )
    }
    for (const response of responses) {
      assert.equal(
        persistedAssistantTexts.filter(text => text.includes(response)).length,
        1,
        `transcript should persist one assistant message for ${response}`,
      )
    }

    const beforeLeakRequests = server.requests.length
    const leak = parseJsonOutput(
      (await runCli([...baseArgs, leakPrompt], env, { allowNonZero: true })).stdout,
    )
    assert.equal(leak.subtype, 'success', 'textual tool call leak should still emit JSON result')
    assert.equal(leak.is_error, true, 'textual tool call leak should be reported as an error')
    assert.match(
      leak.result,
      /textual tool call.*structured tool_use|structured tool_use.*textual tool call/i,
      'leak result should explain provider/tool_use incompatibility',
    )
    const leakRequests = server.requests.slice(beforeLeakRequests).filter(request => {
      return request.path.endsWith('/messages') && request.body.stream === true
    })
    assert.equal(leakRequests.length, 1, 'textual tool leak scenario should make one model request')

    const beforeToolRequests = server.requests.length
    const toolArgs = [...baseArgs]
    toolArgs[toolArgs.indexOf('--max-turns') + 1] = '2'
    const toolRun = parseJsonOutput(
      (await runCli([...toolArgs, toolPrompt], env)).stdout,
    )
    assert.equal(toolRun.is_error, false, 'structured Read tool run should succeed')
    assert.equal(toolRun.result, toolFinalResponse, 'structured Read tool final response')
    const toolRequests = server.requests.slice(beforeToolRequests).filter(request => {
      return request.path.endsWith('/messages') && request.body.stream === true
    })
    assert.equal(toolRequests.length, 2, 'structured tool run should make tool_use and follow-up requests')
    const followUpTexts = requestTexts(toolRequests[1])
    assert(
      containsText(followUpTexts, toolFileContent),
      'follow-up request should include Read tool_result content',
    )

    const beforeChunkedToolRequests = server.requests.length
    const chunkedToolRun = parseJsonOutput(
      (await runCli([...toolArgs, chunkedToolPrompt], env)).stdout,
    )
    assert.equal(
      chunkedToolRun.is_error,
      false,
      'chunked structured Read tool run should succeed',
    )
    assert.equal(
      chunkedToolRun.result,
      chunkedToolFinalResponse,
      'chunked structured Read tool final response',
    )
    const chunkedToolRequests = server.requests
      .slice(beforeChunkedToolRequests)
      .filter(request => {
        return request.path.endsWith('/messages') && request.body.stream === true
      })
    assert.equal(
      chunkedToolRequests.length,
      2,
      'chunked structured tool run should make tool_use and follow-up requests',
    )
    const chunkedFollowUpTexts = requestTexts(chunkedToolRequests[1])
    assert(
      containsText(chunkedFollowUpTexts, chunkedToolFileContent),
      'chunked follow-up request should include Read tool_result content',
    )

    const beforeUnclosedToolRequests = server.requests.length
    const unclosedToolRun = parseJsonOutput(
      (await runCli([...toolArgs, unclosedToolPrompt], env)).stdout,
    )
    assert.equal(
      unclosedToolRun.is_error,
      false,
      'unclosed structured Read tool run should succeed',
    )
    assert.equal(
      unclosedToolRun.result,
      unclosedToolFinalResponse,
      'unclosed structured Read tool final response',
    )
    const unclosedToolRequests = server.requests
      .slice(beforeUnclosedToolRequests)
      .filter(request => {
        return request.path.endsWith('/messages') && request.body.stream === true
      })
    assert.equal(
      unclosedToolRequests.length,
      2,
      'unclosed structured tool run should make tool_use and follow-up requests',
    )
    const unclosedFollowUpTexts = requestTexts(unclosedToolRequests[1])
    assert(
      containsText(unclosedFollowUpTexts, unclosedToolFileContent),
      'unclosed follow-up request should include Read tool_result content',
    )

    const beforeOutOfOrderRequests = server.requests.length
    const outOfOrderRun = parseJsonOutput(
      (await runCli([...baseArgs, outOfOrderPrompt], env, runCliOptions())).stdout,
    )
    assert.equal(
      outOfOrderRun.is_error,
      false,
      'out-of-order stream should recover through non-streaming fallback',
    )
    assert.equal(
      outOfOrderRun.result,
      outOfOrderFallbackResponse,
      'out-of-order fallback final response',
    )
    const outOfOrderRequests = server.requests
      .slice(beforeOutOfOrderRequests)
      .filter(request => request.path.endsWith('/messages'))
    assert.equal(
      outOfOrderRequests.length,
      2,
      'out-of-order stream should make one streaming request and one non-streaming fallback request',
    )
    assert.equal(
      outOfOrderRequests[0].body.stream,
      true,
      'out-of-order first request should be streaming',
    )
    assert.notEqual(
      outOfOrderRequests[1].body.stream,
      true,
      'out-of-order second request should be non-streaming fallback',
    )

    const beforeMultiToolRequests = server.requests.length
    const multiToolRun = parseJsonOutput(
      (await runCli([...toolArgs, multiToolPrompt], env)).stdout,
    )
    assert.equal(
      multiToolRun.is_error,
      false,
      'multi structured Read tool run should succeed',
    )
    assert.equal(
      multiToolRun.result,
      multiToolFinalResponse,
      'multi structured Read tool final response',
    )
    const multiToolRequests = server.requests
      .slice(beforeMultiToolRequests)
      .filter(request => {
        return request.path.endsWith('/messages') && request.body.stream === true
      })
    assert.equal(
      multiToolRequests.length,
      2,
      'multi structured tool run should make tool_use and follow-up requests',
    )
    const multiToolFollowUpTexts = requestTexts(multiToolRequests[1])
    assert(
      containsText(multiToolFollowUpTexts, multiToolFileContentA),
      'multi follow-up request should include first Read tool_result content',
    )
    assert(
      containsText(multiToolFollowUpTexts, multiToolFileContentB),
      'multi follow-up request should include second Read tool_result content',
    )
    const multiToolResultBlocks = requestContentBlocks(
      multiToolRequests[1],
      'tool_result',
    )
    assert.equal(
      multiToolResultBlocks.length,
      2,
      'multi follow-up request should include two tool_result blocks',
    )
    assert.equal(
      new Set(multiToolResultBlocks.map(block => block.tool_use_id)).size,
      2,
      'multi tool_result blocks should reference distinct tool_use ids',
    )

    const beforeMixedToolRequests = server.requests.length
    const mixedToolRun = parseJsonOutput(
      (await runCli([...toolArgs, mixedToolPrompt], env)).stdout,
    )
    assert.equal(
      mixedToolRun.is_error,
      false,
      'mixed text/tool run should succeed',
    )
    assert.equal(
      mixedToolRun.result,
      mixedToolFinalResponse,
      'mixed text/tool final response',
    )
    const mixedToolRequests = server.requests
      .slice(beforeMixedToolRequests)
      .filter(request => {
        return request.path.endsWith('/messages') && request.body.stream === true
      })
    assert.equal(
      mixedToolRequests.length,
      2,
      'mixed text/tool run should make tool_use and follow-up requests',
    )
    const mixedFollowUpTexts = requestTexts(mixedToolRequests[1])
    assert(
      containsText(mixedFollowUpTexts, mixedToolAssistantText),
      'mixed follow-up request should preserve assistant text block',
    )
    assert(
      containsText(mixedFollowUpTexts, mixedToolReadContent),
      'mixed follow-up request should include Read tool_result content',
    )
    assert(
      containsText(mixedFollowUpTexts, mixedToolBashResult),
      'mixed follow-up request should include Bash tool_result content',
    )
    const mixedToolResultBlocks = requestContentBlocks(
      mixedToolRequests[1],
      'tool_result',
    )
    assert.equal(
      mixedToolResultBlocks.length,
      2,
      'mixed follow-up request should include two tool_result blocks',
    )
    assert.equal(
      new Set(mixedToolResultBlocks.map(block => block.tool_use_id)).size,
      2,
      'mixed tool_result blocks should reference distinct tool_use ids',
    )

    const beforeTripleToolRequests = server.requests.length
    const tripleToolRun = parseJsonOutput(
      (await runCli([...toolArgs, tripleToolPrompt], env)).stdout,
    )
    assert.equal(
      tripleToolRun.is_error,
      false,
      'triple text/tool run should succeed',
    )
    assert.equal(
      tripleToolRun.result,
      tripleToolFinalResponse,
      'triple text/tool final response',
    )
    const tripleToolRequests = server.requests
      .slice(beforeTripleToolRequests)
      .filter(request => {
        return request.path.endsWith('/messages') && request.body.stream === true
      })
    assert.equal(
      tripleToolRequests.length,
      2,
      'triple text/tool run should make tool_use and follow-up requests',
    )
    const tripleFollowUpTexts = requestTexts(tripleToolRequests[1])
    assert(
      containsText(tripleFollowUpTexts, tripleToolAssistantText),
      'triple follow-up request should preserve assistant text block',
    )
    for (const expected of [
      tripleToolFileContentA,
      tripleToolFileContentB,
      tripleToolBashResult,
    ]) {
      assert(
        containsText(tripleFollowUpTexts, expected),
        `triple follow-up request should include ${expected}`,
      )
    }
    const tripleToolResultBlocks = requestContentBlocks(
      tripleToolRequests[1],
      'tool_result',
    )
    assert.equal(
      tripleToolResultBlocks.length,
      3,
      'triple follow-up request should include three tool_result blocks',
    )
    assert.equal(
      new Set(tripleToolResultBlocks.map(block => block.tool_use_id)).size,
      3,
      'triple tool_result blocks should reference distinct tool_use ids',
    )

    const beforeBashSideEffectRequests = server.requests.length
    const bashSideEffectArgs = [...toolArgs, '--allowedTools=Bash']
    const bashSideEffectRun = parseJsonOutput(
      (await runCli([...bashSideEffectArgs, bashSideEffectPrompt], env)).stdout,
    )
    assert.equal(
      bashSideEffectRun.is_error,
      false,
      'Bash side-effect tool run should succeed',
    )
    assert.equal(
      bashSideEffectRun.result,
      bashSideEffectFinalResponse,
      'Bash side-effect final response',
    )
    const bashSideEffectRequests = server.requests
      .slice(beforeBashSideEffectRequests)
      .filter(request => {
        return request.path.endsWith('/messages') && request.body.stream === true
      })
    assert.equal(
      bashSideEffectRequests.length,
      2,
      'Bash side-effect run should make tool_use and follow-up requests',
    )
    const bashSideEffectBlocks = requestContentBlocks(
      bashSideEffectRequests[1],
      'tool_result',
    )
    assert(
      bashSideEffectBlocks.some(block => {
        return (
          typeof block.tool_use_id === 'string' &&
          block.tool_use_id.startsWith('toolu_cli_bash_side_effect_')
        )
      }),
      'Bash side-effect follow-up should include Bash tool_result content',
    )
    assert.match(
      await readFile(bashSideEffectFilePath, 'utf8'),
      new RegExp(bashSideEffectResult),
      'Bash side-effect should write the fixture file on disk',
    )

    const beforeEditToolRequests = server.requests.length
    const editToolArgs = [...toolArgs]
    editToolArgs[editToolArgs.indexOf('--max-turns') + 1] = '3'
    editToolArgs.push('--permission-mode', 'acceptEdits')
    const editToolRun = parseJsonOutput(
      (await runCli([...editToolArgs, editToolPrompt], env)).stdout,
    )
    assert.equal(
      editToolRun.is_error,
      false,
      'Read then Edit tool run should succeed',
    )
    assert.equal(
      editToolRun.result,
      editToolFinalResponse,
      'Read then Edit final response',
    )
    const editToolRequests = server.requests
      .slice(beforeEditToolRequests)
      .filter(request => {
        return request.path.endsWith('/messages') && request.body.stream === true
      })
    assert.equal(
      editToolRequests.length,
      3,
      'Read then Edit run should make Read, Edit, and final requests',
    )
    const editReadFollowUpTexts = requestTexts(editToolRequests[1])
    assert(
      containsText(editReadFollowUpTexts, editToolOriginalContent),
      'Edit follow-up request should include Read tool_result content',
    )
    const editResultBlocks = requestContentBlocks(
      editToolRequests[2],
      'tool_result',
    )
    assert(
      editResultBlocks.some(block => {
        return (
          typeof block.tool_use_id === 'string' &&
          block.tool_use_id.startsWith('toolu_cli_edit_')
        )
      }),
      'final follow-up request should include Edit tool_result content',
    )
    assert.equal(
      await readFile(editToolFilePath, 'utf8'),
      `${editToolUpdatedContent}\n`,
      'Edit tool should update the fixture file on disk',
    )

    const beforeWriteToolRequests = server.requests.length
    const writeToolArgs = [
      '--bare',
      '--print',
      '--output-format',
      'json',
      '--max-turns',
      '2',
      '--strict-mcp-config',
      '--tools',
      'Write',
      '--allowedTools',
      'Write',
      '--model',
      'sonnet',
    ]
    const writeToolEnv = { ...env }
    const writeToolRun = parseJsonOutput(
      (
        await runCli(
          [...writeToolArgs, writeToolPrompt],
          writeToolEnv,
          runCliOptions(),
        )
      ).stdout,
    )
    assert.equal(
      writeToolRun.is_error,
      false,
      'Write tool create run should succeed',
    )
    assert.equal(
      writeToolRun.result,
      writeToolFinalResponse,
      'Write tool final response',
    )
    const writeToolRequests = server.requests
      .slice(beforeWriteToolRequests)
      .filter(request => {
        return request.path.endsWith('/messages') && request.body.stream === true
      })
    assert.equal(
      writeToolRequests.length,
      2,
      'Write tool run should make tool_use and follow-up requests',
    )
    const writeResultBlocks = requestContentBlocks(
      writeToolRequests[1],
      'tool_result',
    )
    assert(
      writeResultBlocks.some(block => {
        return (
          typeof block.tool_use_id === 'string' &&
          block.tool_use_id.startsWith('toolu_cli_write_') &&
          typeof block.content === 'string' &&
          block.content.includes('File created successfully')
        )
      }),
      'Write follow-up request should include Write tool_result content',
    )
    assert.equal(
      await readFile(writeToolFilePath, 'utf8'),
      `${writeToolContent}\n`,
      'Write tool should create the fixture file on disk',
    )

    console.log('ok - cli print/resume/continue E2E')
    console.log(`ok - local mock captured ${promptRequests.length} streamed prompt requests`)
    console.log('ok - textual tool-call leak is reported without executing a tool')
    console.log('ok - structured Read tool_use executes and sends tool_result')
    console.log('ok - chunked tool_use executes despite non-tool stop_reason')
    console.log('ok - unclosed tool_use block is finalized at stream end')
    console.log('ok - out-of-order stream recovers through non-streaming fallback')
    console.log('ok - multiple interleaved tool_use blocks execute and follow up')
    console.log('ok - mixed text, Read, and Bash blocks preserve text and results')
    console.log('ok - triple interleaved Read, Bash, and Read blocks follow up')
    console.log('ok - Bash side-effect tool writes an artifact fixture file')
    console.log('ok - Read then Edit executes and updates a fixture file')
    console.log('ok - Write tool creates an artifact fixture file')
    console.log(`ok - transcript ${transcripts[0]}`)
  } finally {
    await server.close()
    await rm(tmpHome, { recursive: true, force: true })
  }
}

main().catch(error => {
  console.error(error?.stack ?? error)
  process.exitCode = 1
})
