#!/usr/bin/env node

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { utimesSync, writeFileSync } from 'node:fs'
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

const readContentDenyPrompt = 'cli read content-specific deny prompt'
const readContentDenyFileContent =
  'read content-specific deny fixture: blocked-6391'
const readContentDenyFinalResponse =
  'structured Read content-specific deny completed'
const readContentDenyRelativePath =
  'build-src/test-artifacts/cli-read-content-deny-tool.txt'
const readContentDenyFilePath = join(ROOT, readContentDenyRelativePath)
const readContentAskPrompt = 'cli read content-specific ask prompt'
const readContentAskFileContent =
  'read content-specific ask fixture: blocked-8274'
const readContentAskFinalResponse =
  'structured Read content-specific ask completed'
const readContentAskRelativePath =
  'build-src/test-artifacts/cli-read-content-ask-tool.txt'
const readContentAskFilePath = join(ROOT, readContentAskRelativePath)

const outOfOrderPrompt = 'cli out-of-order stream fallback prompt'
const outOfOrderFallbackResponse =
  'out-of-order streaming recovered through non-streaming fallback'

const reactiveCompactPrompt = 'cli reactive compact prompt too long prompt'
const reactiveCompactSummary =
  'reactive compact summary marker with the important task details'
const reactiveCompactFinalResponse =
  'reactive compact recovered after summarizing context'

const partialStreamPrompt = 'cli stream-json partial flush prompt'
const partialStreamChunks = [
  'partial-stream-first-2931 ',
  'partial-stream-second-2931 ',
  'partial-stream-final-2931',
]
const partialStreamFinalResponse = partialStreamChunks.join('')

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
const bashContentDenyPrompt = 'cli bash content-specific deny prompt'
const bashContentDenyResult = 'bash-content-deny-2604'
const bashContentDenyFinalResponse = 'Bash content-specific deny completed'
const bashContentDenyRelativePath =
  'build-src/test-artifacts/cli-bash-content-deny-tool.txt'
const bashContentDenyFilePath = join(ROOT, bashContentDenyRelativePath)
const bashContentAskPrompt = 'cli bash content-specific ask prompt'
const bashContentAskResult = 'bash-content-ask-7508'
const bashContentAskFinalResponse = 'Bash content-specific ask completed'
const bashContentAskRelativePath =
  'build-src/test-artifacts/cli-bash-content-ask-tool.txt'
const bashContentAskFilePath = join(ROOT, bashContentAskRelativePath)
const projectBashContentDenyPrompt =
  'cli project bash content-specific deny prompt'
const projectBashContentDenyResult = 'project-bash-content-deny-6915'
const projectBashContentDenyFinalResponse =
  'Project Bash content-specific deny completed'
const projectBashContentDenyRelativePath =
  'project-bash-content-deny-tool.txt'
let projectBashContentDenyFilePath = ''
const projectBashContentAskPrompt =
  'cli project bash content-specific ask prompt'
const projectBashContentAskResult = 'project-bash-content-ask-4382'
const projectBashContentAskFinalResponse =
  'Project Bash content-specific ask completed'
const projectBashContentAskRelativePath =
  'project-bash-content-ask-tool.txt'
let projectBashContentAskFilePath = ''

const editToolPrompt = 'cli read then edit tool prompt'
const editToolOriginalContent = 'edit structured tool fixture: before-1842'
const editToolUpdatedContent = 'edit structured tool fixture: after-1842'
const editToolFinalResponse =
  'structured Read then Edit tool completed with after-1842'
let editToolFilePath = ''
const editUnreadPrompt = 'cli unread edit rejection prompt'
const editUnreadOriginalContent = 'edit unread rejection fixture: before-7510'
const editUnreadUpdatedContent = 'edit unread rejection fixture: after-7510'
const editUnreadFinalResponse = 'structured Edit unread rejection completed'
let editUnreadFilePath = ''
const editStalePrompt = 'cli stale edit rejection prompt'
const editStaleOriginalContent = 'edit stale rejection fixture: before-6302'
const editStaleExternalContent = 'edit stale rejection fixture: external-6302'
const editStaleUpdatedContent = 'edit stale rejection fixture: after-6302'
const editStaleFinalResponse = 'structured Edit stale rejection completed'
let editStaleFilePath = ''
let editStaleWasExternallyModified = false
const editDenyPrompt = 'cli edit permission deny prompt'
const editDenyOriginalContent = 'edit permission deny fixture: before-9174'
const editDenyUpdatedContent = 'edit permission deny fixture: after-9174'
const editDenyFinalResponse = 'structured Edit permission deny completed'
let editDenyFilePath = ''
const editContentDenyPrompt = 'cli edit content-specific deny prompt'
const editContentDenyOriginalContent =
  'edit content-specific deny fixture: before-3097'
const editContentDenyUpdatedContent =
  'edit content-specific deny fixture: after-3097'
const editContentDenyFinalResponse =
  'structured Edit content-specific deny completed'
const editContentDenyRelativePath =
  'build-src/test-artifacts/cli-edit-content-deny-tool.txt'
const editContentDenyFilePath = join(ROOT, editContentDenyRelativePath)
const editContentAskPrompt = 'cli edit content-specific ask prompt'
const editContentAskUpdatedContent =
  'edit content-specific ask fixture: after-4580'
const editContentAskFinalResponse =
  'structured Edit content-specific ask completed'
const editContentAskRelativePath =
  'build-src/test-artifacts/cli-edit-content-ask-tool.txt'
const editContentAskFilePath = join(ROOT, editContentAskRelativePath)
const editReplaceAllPrompt = 'cli edit replace all prompt'
const editReplaceAllOriginalContent = 'alpha replace-all-2048 alpha replace-all-2048 alpha replace-all-2048'
const editReplaceAllUpdatedContent = 'beta replace-all-2048 beta replace-all-2048 beta replace-all-2048'
const editReplaceAllFinalResponse =
  'structured Edit replace_all completed'
let editReplaceAllFilePath = ''
const editMultiMatchPrompt = 'cli edit multi match rejection prompt'
const editMultiMatchOriginalContent = 'duplicate-multi-5720 duplicate-multi-5720'
const editMultiMatchAttemptedContent = 'unique-multi-5720'
const editMultiMatchFinalResponse =
  'structured Edit multi-match rejection completed'
let editMultiMatchFilePath = ''
const editCreatePrompt = 'cli edit create new file prompt'
const editCreateContent = 'edit create new file fixture: rose-3386'
const editCreateFinalResponse =
  'structured Edit create new file completed'
let editCreateFilePath = ''
const editCrlfPrompt = 'cli edit crlf preserve prompt'
const editCrlfOriginalContent =
  'edit crlf fixture: before-6142\r\nedit crlf fixture: stable-6142\r\n'
const editCrlfUpdatedContent =
  'edit crlf fixture: after-6142\r\nedit crlf fixture: stable-6142\r\n'
const editCrlfFinalResponse =
  'structured Edit CRLF preservation completed'
let editCrlfFilePath = ''
const editMixedLineEndingsPrompt = 'cli edit mixed line endings preserve prompt'
const editMixedLineEndingsOriginalContent =
  'edit mixed fixture: before-3916\r\nedit mixed fixture: stable-lf-3916\nedit mixed fixture: stable-crlf-3916\r\n'
const editMixedLineEndingsUpdatedContent =
  'edit mixed fixture: after-3916\r\nedit mixed fixture: stable-lf-3916\nedit mixed fixture: stable-crlf-3916\r\n'
const editMixedLineEndingsFinalResponse =
  'structured Edit mixed line ending preservation completed'
let editMixedLineEndingsFilePath = ''
const editUtf16Prompt = 'cli edit utf16le bom preserve prompt'
const editUtf16OriginalContent =
  '\uFEFFedit utf16 fixture: before-9051\nedit utf16 fixture: stable-9051\n'
const editUtf16UpdatedContent =
  '\uFEFFedit utf16 fixture: after-9051\nedit utf16 fixture: stable-9051\n'
const editUtf16FinalResponse =
  'structured Edit UTF-16LE BOM preservation completed'
let editUtf16FilePath = ''
const editUtf8BomPrompt = 'cli edit utf8 bom preserve prompt'
const editUtf8BomOriginalContent =
  '\uFEFFedit utf8 bom fixture: before-1184\nedit utf8 bom fixture: stable-1184\n'
const editUtf8BomUpdatedContent =
  '\uFEFFedit utf8 bom fixture: after-1184\nedit utf8 bom fixture: stable-1184\n'
const editUtf8BomFinalResponse =
  'structured Edit UTF-8 BOM preservation completed'
let editUtf8BomFilePath = ''

const writeToolPrompt = 'cli write tool create prompt'
const writeToolContent = 'write structured tool fixture: willow-2751'
const writeToolFinalResponse =
  'structured Write tool completed with willow-2751'
let writeToolFilePath = ''
const writeUpdatePrompt = 'cli read then write update prompt'
const writeUpdateOriginalContent =
  'write update structured tool fixture: before-6219'
const writeUpdateUpdatedContent =
  'write update structured tool fixture: after-6219'
const writeUpdateFinalResponse =
  'structured Write update tool completed with after-6219'
let writeUpdateFilePath = ''
const writeUnreadPrompt = 'cli unread write rejection prompt'
const writeUnreadOriginalContent =
  'write unread rejection fixture: before-1038'
const writeUnreadAttemptedContent =
  'write unread rejection fixture: attempted-after-1038'
const writeUnreadFinalResponse =
  'structured Write unread rejection completed'
let writeUnreadFilePath = ''
const writeStalePrompt = 'cli stale write rejection prompt'
const writeStaleOriginalContent = 'write stale rejection fixture: before-4820'
const writeStaleExternalContent =
  'write stale rejection fixture: external-change-4820'
const writeStaleAttemptedContent =
  'write stale rejection fixture: attempted-after-4820'
const writeStaleFinalResponse =
  'structured Write stale rejection completed'
let writeStaleFilePath = ''
let writeStaleWasExternallyModified = false
const writeDenyPrompt = 'cli write permission deny prompt'
const writeDenyContent = 'write permission deny fixture: attempted-6681'
const writeDenyFinalResponse = 'structured Write permission deny completed'
let writeDenyFilePath = ''
const writeContentDenyPrompt = 'cli write content-specific deny prompt'
const writeContentDenyContent =
  'write content-specific deny fixture: attempted-5492'
const writeContentDenyFinalResponse =
  'structured Write content-specific deny completed'
const writeContentDenyRelativePath =
  'build-src/test-artifacts/cli-write-content-deny-tool.txt'
const writeContentDenyFilePath = join(ROOT, writeContentDenyRelativePath)
const writeContentAskPrompt = 'cli write content-specific ask prompt'
const writeContentAskContent =
  'write content-specific ask fixture: attempted-7136'
const writeContentAskFinalResponse =
  'structured Write content-specific ask completed'
const writeContentAskRelativePath =
  'build-src/test-artifacts/cli-write-content-ask-tool.txt'
const writeContentAskFilePath = join(ROOT, writeContentAskRelativePath)
const writeHookDenyPrompt = 'cli write pretooluse hook deny prompt'
const writeHookDenyContent =
  'write pretooluse hook deny fixture: attempted-3614'
const writeHookDenyFinalResponse =
  'structured Write PreToolUse hook deny completed'
const writeHookDenyReason =
  'pretooluse hook blocked Write fixture marker 3614'
const writeHookDenyRelativePath =
  'build-src/test-artifacts/cli-write-hook-deny-tool.txt'
const writeHookDenyFilePath = join(ROOT, writeHookDenyRelativePath)
const userSettingsWriteDenyPrompt =
  'cli user settings write deny prompt'
const userSettingsWriteDenyContent =
  'user settings write deny fixture: attempted-9140'
const userSettingsWriteDenyFinalResponse =
  'structured user settings Write deny completed'
let userSettingsWriteDenyFilePath = ''
const projectSettingsWriteDenyPrompt =
  'cli project settings write deny prompt'
const projectSettingsWriteDenyContent =
  'project settings write deny fixture: attempted-5067'
const projectSettingsWriteDenyFinalResponse =
  'structured project settings Write deny completed'
let projectSettingsWriteDenyFilePath = ''
const managedOnlyWritePrompt = 'cli managed-only write allow ignored prompt'
const managedOnlyWriteContent =
  'managed-only write fixture: attempted-2075'
const managedOnlyWriteFinalResponse =
  'structured managed-only Write rejection completed'
let managedOnlyWriteFilePath = ''
const binaryReadWritePrompt = 'cli binary read then write rejection prompt'
const binaryReadWriteOriginalBytes = Buffer.from([
  0x00, 0x01, 0x02, 0x03, 0xff, 0x10, 0x00, 0x7f,
])
const binaryReadWriteAttemptedContent =
  'binary read write attempted text replacement\n'
const binaryReadWriteFinalResponse =
  'structured binary Read and Write rejection completed'
let binaryReadWriteFilePath = ''
const writeCrlfPrompt = 'cli write crlf create prompt'
const writeCrlfContent =
  'write crlf fixture: first-7851\r\nwrite crlf fixture: second-7851\r\n'
const writeCrlfFinalResponse = 'structured Write CRLF completed'
let writeCrlfFilePath = ''
const writeMixedLineEndingsPrompt =
  'cli write mixed line endings create prompt'
const writeMixedLineEndingsContent =
  'write mixed fixture: first-2468\r\nwrite mixed fixture: second-2468\nwrite mixed fixture: third-2468\r\n'
const writeMixedLineEndingsFinalResponse =
  'structured Write mixed line endings completed'
let writeMixedLineEndingsFilePath = ''
const writeUtf16Prompt = 'cli write utf16le bom overwrite prompt'
const writeUtf16OriginalContent =
  '\uFEFFwrite utf16 fixture: before-4372\nwrite utf16 fixture: stable-4372\n'
const writeUtf16ModelContent =
  'write utf16 fixture: after-4372\nwrite utf16 fixture: stable-4372\n'
const writeUtf16UpdatedContent = `\uFEFF${writeUtf16ModelContent}`
const writeUtf16FinalResponse =
  'structured Write UTF-16LE BOM overwrite completed'
let writeUtf16FilePath = ''
const writeUtf8BomPrompt = 'cli write utf8 bom overwrite prompt'
const writeUtf8BomOriginalContent =
  '\uFEFFwrite utf8 bom fixture: before-2267\nwrite utf8 bom fixture: stable-2267\n'
const writeUtf8BomModelContent =
  'write utf8 bom fixture: after-2267\nwrite utf8 bom fixture: stable-2267\n'
const writeUtf8BomUpdatedContent = `\uFEFF${writeUtf8BomModelContent}`
const writeUtf8BomFinalResponse =
  'structured Write UTF-8 BOM overwrite completed'
let writeUtf8BomFilePath = ''

const notebookEditPrompt = 'cli read then notebook edit prompt'
const notebookEditOriginalSource = 'print("before-notebook-4187")'
const notebookEditUpdatedSource = 'print("after-notebook-4187")'
const notebookEditFinalResponse =
  'structured NotebookEdit tool completed with after-notebook-4187'
const notebookEditCellId = 'cell-alpha'
let notebookEditFilePath = ''
const notebookVariantPrompt = 'cli notebook insert delete prompt'
const notebookVariantBaseCellId = 'cell-base'
const notebookVariantBaseSource = 'print("notebook-base-3194")'
const notebookVariantInsertedSource = 'inserted markdown notebook-3194'
const notebookVariantFinalResponse =
  'structured NotebookEdit insert delete completed'
let notebookVariantFilePath = ''
const notebookRejectPrompt = 'cli notebook missing cell rejection prompt'
const notebookRejectCellId = 'cell-only'
const notebookRejectOriginalSource = 'print("notebook-reject-before-9027")'
const notebookRejectAttemptedSource = 'print("notebook-reject-after-9027")'
const notebookRejectFinalResponse =
  'structured NotebookEdit missing cell rejection completed'
let notebookRejectFilePath = ''
const notebookInvalidPrompt = 'cli notebook invalid json rejection prompt'
const notebookInvalidCellId = 'cell-invalid-json'
const notebookInvalidOriginalSource = 'print("notebook-invalid-before-2718")'
const notebookInvalidAttemptedSource = 'print("notebook-invalid-after-2718")'
const notebookInvalidCorruptContent = '{"cells": ['
const notebookInvalidFinalResponse =
  'structured NotebookEdit invalid json rejection completed'
let notebookInvalidFilePath = ''
let notebookInvalidStableMtime = new Date(0)
let notebookInvalidWasCorrupted = false
const notebookLargePrompt = 'cli notebook too large rejection prompt'
const notebookLargeCellId = 'cell-large'
const notebookLargeOriginalSource = 'print("notebook-large-before-6194")'
const notebookLargeAttemptedSource = 'print("notebook-large-after-6194")'
const notebookLargeExpandedMarker = 'notebook-large-expanded-6194'
const notebookLargeFinalResponse =
  'structured NotebookEdit too-large rejection completed'
let notebookLargeFilePath = ''
let notebookLargeStableMtime = new Date(0)
let notebookLargeWasExpanded = false
const notebookUnreadPrompt = 'cli unread notebook edit rejection prompt'
const notebookUnreadCellId = 'cell-unread'
const notebookUnreadOriginalSource = 'print("notebook-unread-before-5441")'
const notebookUnreadAttemptedSource = 'print("notebook-unread-after-5441")'
const notebookUnreadFinalResponse =
  'structured NotebookEdit unread rejection completed'
let notebookUnreadFilePath = ''
const notebookStalePrompt = 'cli stale notebook edit rejection prompt'
const notebookStaleCellId = 'cell-stale'
const notebookStaleOriginalSource = 'print("notebook-stale-before-7730")'
const notebookStaleExternalSource = 'print("notebook-stale-external-7730")'
const notebookStaleAttemptedSource = 'print("notebook-stale-after-7730")'
const notebookStaleFinalResponse =
  'structured NotebookEdit stale rejection completed'
let notebookStaleFilePath = ''
let notebookStaleWasExternallyModified = false
const notebookContentDenyPrompt =
  'cli notebook edit content-specific deny prompt'
const notebookContentDenyCellId = 'cell-notebook-content-deny'
const notebookContentDenyOriginalSource =
  'print("notebook-content-deny-before-6319")'
const notebookContentDenyAttemptedSource =
  'print("notebook-content-deny-after-6319")'
const notebookContentDenyFinalResponse =
  'structured NotebookEdit content-specific deny completed'
const notebookContentDenyRelativePath =
  'build-src/test-artifacts/cli-notebook-content-deny-tool.ipynb'
const notebookContentDenyFilePath = join(
  ROOT,
  notebookContentDenyRelativePath,
)
const notebookContentAskPrompt =
  'cli notebook edit content-specific ask prompt'
const notebookContentAskCellId = 'cell-notebook-content-ask'
const notebookContentAskOriginalSource =
  'print("notebook-content-ask-before-4726")'
const notebookContentAskAttemptedSource =
  'print("notebook-content-ask-after-4726")'
const notebookContentAskFinalResponse =
  'structured NotebookEdit content-specific ask completed'
const notebookContentAskRelativePath =
  'build-src/test-artifacts/cli-notebook-content-ask-tool.ipynb'
const notebookContentAskFilePath = join(ROOT, notebookContentAskRelativePath)
const notebookDenyPrompt = 'cli notebook edit permission deny prompt'
const notebookDenyCellId = 'cell-deny'
const notebookDenyOriginalSource = 'print("notebook-deny-before-1186")'
const notebookDenyAttemptedSource = 'print("notebook-deny-after-1186")'
const notebookDenyFinalResponse =
  'structured NotebookEdit permission deny completed'
let notebookDenyFilePath = ''
const notebookCellIndexPrompt = 'cli notebook cell index replace prompt'
const notebookCellIndexFirstSource = 'print("notebook-index-code-2401")'
const notebookCellIndexOriginalMarkdown = 'old markdown notebook-index-2401'
const notebookCellIndexUpdatedMarkdown = 'new markdown notebook-index-2401'
const notebookCellIndexFinalResponse =
  'structured NotebookEdit cell index replace completed'
let notebookCellIndexFilePath = ''

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

function writeApiError(res, status, message) {
  res.writeHead(status, {
    'content-type': 'application/json',
    'request-id': `req_mock_error_${Date.now()}`,
  })
  res.end(
    JSON.stringify({
      type: 'error',
      error: {
        type: 'invalid_request_error',
        message,
      },
    }),
  )
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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function makeNotebookContent(cells) {
  return JSON.stringify(
    {
      cells,
      metadata: {
        language_info: { name: 'python' },
      },
      nbformat: 4,
      nbformat_minor: 5,
    },
    null,
    1,
  )
}

function makeOversizedNotebookContent() {
  return makeNotebookContent([
    {
      cell_type: 'code',
      execution_count: 1,
      id: notebookLargeCellId,
      metadata: {},
      outputs: [],
      source: `${notebookLargeExpandedMarker}\n${'x'.repeat(300 * 1024)}`,
    },
  ])
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

async function writeDelayedStreamingMessage(res, sequence) {
  const id = `msg_cli_partial_stream_${sequence}`

  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
    'request-id': `req_mock_partial_${sequence}`,
  })
  writeSseFrame(res, 'message_start', {
    type: 'message_start',
    message: {
      ...makeMessage(id, '', { input_tokens: 140 }),
      content: [],
      stop_reason: null,
      usage: {
        input_tokens: 140,
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
    delta: { type: 'text_delta', text: partialStreamChunks[0] },
  })
  await sleep(350)
  writeSseFrame(res, 'content_block_delta', {
    type: 'content_block_delta',
    index: 0,
    delta: { type: 'text_delta', text: partialStreamChunks[1] },
  })
  await sleep(150)
  writeSseFrame(res, 'content_block_delta', {
    type: 'content_block_delta',
    index: 0,
    delta: { type: 'text_delta', text: partialStreamChunks[2] },
  })
  writeSseFrame(res, 'content_block_stop', {
    type: 'content_block_stop',
    index: 0,
  })
  writeSseFrame(res, 'message_delta', {
    type: 'message_delta',
    delta: { stop_reason: 'end_turn', stop_sequence: null },
    usage: { output_tokens: Math.max(1, Math.ceil(partialStreamFinalResponse.length / 4)) },
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
  const toolUseId = `${options.toolUseIdPrefix ?? 'toolu_cli_read_'}${sequence}`
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

function writeStreamingBashSideEffectToolUse(res, sequence, options = {}) {
  const id = `${options.messageIdPrefix ?? 'msg_cli_bash_side_effect_tool_use_'}${sequence}`
  const toolUseId = `${options.toolUseIdPrefix ?? 'toolu_cli_bash_side_effect_'}${sequence}`
  const inputDeltas = splitIntoDeltas(
    JSON.stringify({
      command:
        options.command ??
        `echo ${bashSideEffectResult} > ${bashSideEffectRelativePath}`,
      description:
        options.description ?? 'Write a Bash side-effect fixture marker',
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

function writeStreamingEditToolUse(res, sequence, options = {}) {
  const id = `msg_cli_edit_tool_use_${sequence}`
  const toolUseId = `${options.toolUseIdPrefix ?? 'toolu_cli_edit_'}${sequence}`
  const input = {
    file_path: options.filePath ?? editToolFilePath,
    old_string: options.oldString ?? editToolOriginalContent,
    new_string: options.newString ?? editToolUpdatedContent,
  }
  if (options.replaceAll !== undefined) {
    input.replace_all = options.replaceAll
  }
  const inputDeltas = splitIntoDeltas(JSON.stringify(input))

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

function writeStreamingWriteToolUse(res, sequence, options = {}) {
  const id = `msg_cli_write_tool_use_${sequence}`
  const toolUseId = `${options.toolUseIdPrefix ?? 'toolu_cli_write_'}${sequence}`
  const inputDeltas = splitIntoDeltas(
    JSON.stringify({
      file_path: options.filePath ?? writeToolFilePath,
      content: options.content ?? `${writeToolContent}\n`,
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

function writeStreamingNotebookEditToolUse(res, sequence, options = {}) {
  const id = `msg_cli_notebook_edit_tool_use_${sequence}`
  const toolUseId = `${options.toolUseIdPrefix ?? 'toolu_cli_notebook_edit_'}${sequence}`
  const input = {
    notebook_path: options.notebookPath ?? notebookEditFilePath,
    new_source: options.newSource ?? notebookEditUpdatedSource,
    edit_mode: options.editMode ?? 'replace',
  }
  if (options.cellId !== undefined) {
    input.cell_id = options.cellId
  } else {
    input.cell_id = notebookEditCellId
  }
  if (options.cellType !== undefined) {
    input.cell_type = options.cellType
  } else {
    input.cell_type = 'code'
  }
  const inputDeltas = splitIntoDeltas(JSON.stringify(input))

  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
    'request-id': `req_mock_${sequence}`,
  })
  writeSseFrame(res, 'message_start', {
    type: 'message_start',
    message: {
      ...makeMessage(id, '', { input_tokens: 174 }),
      content: [],
      stop_reason: null,
      usage: {
        input_tokens: 174,
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
      name: 'NotebookEdit',
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
  if (combinedText.includes(notebookEditPrompt)) {
    if (hasToolResultWithIdPrefix(body, 'toolu_cli_notebook_edit_')) {
      return {
        index: responses.length + 11,
        text: notebookEditFinalResponse,
      }
    }
    if (combinedText.includes(notebookEditOriginalSource)) {
      return {
        index: responses.length + 11,
        notebookEditToolUse: true,
        text: '',
      }
    }
    return {
      index: responses.length + 11,
      toolUse: true,
      toolOptions: {
        filePath: notebookEditFilePath,
      },
      text: '',
    }
  }
  if (combinedText.includes(notebookVariantPrompt)) {
    if (hasToolResultWithIdPrefix(body, 'toolu_cli_notebook_delete_')) {
      return {
        index: responses.length + 15,
        text: notebookVariantFinalResponse,
      }
    }
    if (hasToolResultWithIdPrefix(body, 'toolu_cli_notebook_insert_')) {
      return {
        index: responses.length + 15,
        notebookEditToolUse: true,
        notebookEditToolOptions: {
          cellId: 'cell-1',
          editMode: 'delete',
          newSource: '',
          notebookPath: notebookVariantFilePath,
          toolUseIdPrefix: 'toolu_cli_notebook_delete_',
        },
        text: '',
      }
    }
    if (combinedText.includes(notebookVariantBaseSource)) {
      return {
        index: responses.length + 15,
        notebookEditToolUse: true,
        notebookEditToolOptions: {
          cellId: notebookVariantBaseCellId,
          cellType: 'markdown',
          editMode: 'insert',
          newSource: notebookVariantInsertedSource,
          notebookPath: notebookVariantFilePath,
          toolUseIdPrefix: 'toolu_cli_notebook_insert_',
        },
        text: '',
      }
    }
    return {
      index: responses.length + 15,
      toolUse: true,
      toolOptions: {
        filePath: notebookVariantFilePath,
      },
      text: '',
    }
  }
  if (combinedText.includes(notebookRejectPrompt)) {
    if (hasToolResultWithIdPrefix(body, 'toolu_cli_notebook_reject_')) {
      return {
        index: responses.length + 16,
        text: notebookRejectFinalResponse,
      }
    }
    if (combinedText.includes(notebookRejectOriginalSource)) {
      return {
        index: responses.length + 16,
        notebookEditToolUse: true,
        notebookEditToolOptions: {
          cellId: 'missing-cell-9027',
          cellType: 'code',
          editMode: 'replace',
          newSource: notebookRejectAttemptedSource,
          notebookPath: notebookRejectFilePath,
          toolUseIdPrefix: 'toolu_cli_notebook_reject_',
        },
        text: '',
      }
    }
    return {
      index: responses.length + 16,
      toolUse: true,
      toolOptions: {
        filePath: notebookRejectFilePath,
      },
      text: '',
    }
  }
  if (combinedText.includes(notebookInvalidPrompt)) {
    if (hasToolResultWithIdPrefix(body, 'toolu_cli_notebook_invalid_')) {
      return {
        index: responses.length + 31,
        text: notebookInvalidFinalResponse,
      }
    }
    if (combinedText.includes(notebookInvalidOriginalSource)) {
      if (!notebookInvalidWasCorrupted) {
        writeFileSync(
          notebookInvalidFilePath,
          notebookInvalidCorruptContent,
          'utf8',
        )
        utimesSync(
          notebookInvalidFilePath,
          notebookInvalidStableMtime,
          notebookInvalidStableMtime,
        )
        notebookInvalidWasCorrupted = true
      }
      return {
        index: responses.length + 31,
        notebookEditToolUse: true,
        notebookEditToolOptions: {
          cellId: notebookInvalidCellId,
          cellType: 'code',
          editMode: 'replace',
          newSource: notebookInvalidAttemptedSource,
          notebookPath: notebookInvalidFilePath,
          toolUseIdPrefix: 'toolu_cli_notebook_invalid_',
        },
        text: '',
      }
    }
    return {
      index: responses.length + 31,
      toolUse: true,
      toolOptions: {
        filePath: notebookInvalidFilePath,
      },
      text: '',
    }
  }
  if (combinedText.includes(notebookLargePrompt)) {
    if (hasToolResultWithIdPrefix(body, 'toolu_cli_notebook_large_')) {
      return {
        index: responses.length + 39,
        text: notebookLargeFinalResponse,
      }
    }
    if (combinedText.includes(notebookLargeOriginalSource)) {
      if (!notebookLargeWasExpanded) {
        writeFileSync(
          notebookLargeFilePath,
          makeOversizedNotebookContent(),
          'utf8',
        )
        utimesSync(
          notebookLargeFilePath,
          notebookLargeStableMtime,
          notebookLargeStableMtime,
        )
        notebookLargeWasExpanded = true
      }
      return {
        index: responses.length + 39,
        notebookEditToolUse: true,
        notebookEditToolOptions: {
          cellId: notebookLargeCellId,
          cellType: 'code',
          editMode: 'replace',
          newSource: notebookLargeAttemptedSource,
          notebookPath: notebookLargeFilePath,
          toolUseIdPrefix: 'toolu_cli_notebook_large_',
        },
        text: '',
      }
    }
    return {
      index: responses.length + 39,
      toolUse: true,
      toolOptions: {
        filePath: notebookLargeFilePath,
      },
      text: '',
    }
  }
  if (combinedText.includes(notebookUnreadPrompt)) {
    if (hasToolResultWithIdPrefix(body, 'toolu_cli_notebook_unread_')) {
      return {
        index: responses.length + 17,
        text: notebookUnreadFinalResponse,
      }
    }
    return {
      index: responses.length + 17,
      notebookEditToolUse: true,
      notebookEditToolOptions: {
        cellId: notebookUnreadCellId,
        cellType: 'code',
        editMode: 'replace',
        newSource: notebookUnreadAttemptedSource,
        notebookPath: notebookUnreadFilePath,
        toolUseIdPrefix: 'toolu_cli_notebook_unread_',
      },
      text: '',
    }
  }
  if (combinedText.includes(notebookStalePrompt)) {
    if (hasToolResultWithIdPrefix(body, 'toolu_cli_notebook_stale_')) {
      return {
        index: responses.length + 18,
        text: notebookStaleFinalResponse,
      }
    }
    if (combinedText.includes(notebookStaleOriginalSource)) {
      if (!notebookStaleWasExternallyModified) {
        writeFileSync(
          notebookStaleFilePath,
          JSON.stringify(
            {
              cells: [
                {
                  cell_type: 'code',
                  execution_count: 1,
                  id: notebookStaleCellId,
                  metadata: {},
                  outputs: [],
                  source: notebookStaleExternalSource,
                },
              ],
              metadata: {
                language_info: { name: 'python' },
              },
              nbformat: 4,
              nbformat_minor: 5,
            },
            null,
            1,
          ),
          'utf8',
        )
        const future = new Date(Date.now() + 10_000)
        utimesSync(notebookStaleFilePath, future, future)
        notebookStaleWasExternallyModified = true
      }
      return {
        index: responses.length + 18,
        notebookEditToolUse: true,
        notebookEditToolOptions: {
          cellId: notebookStaleCellId,
          cellType: 'code',
          editMode: 'replace',
          newSource: notebookStaleAttemptedSource,
          notebookPath: notebookStaleFilePath,
          toolUseIdPrefix: 'toolu_cli_notebook_stale_',
        },
        text: '',
      }
    }
    return {
      index: responses.length + 18,
      toolUse: true,
      toolOptions: {
        filePath: notebookStaleFilePath,
      },
      text: '',
    }
  }
  if (combinedText.includes(notebookContentDenyPrompt)) {
    if (hasToolResultWithIdPrefix(body, 'toolu_cli_notebook_content_deny_')) {
      return {
        index: responses.length + 52,
        text: notebookContentDenyFinalResponse,
      }
    }
    if (combinedText.includes(notebookContentDenyOriginalSource)) {
      return {
        index: responses.length + 52,
        notebookEditToolUse: true,
        notebookEditToolOptions: {
          cellId: notebookContentDenyCellId,
          cellType: 'code',
          editMode: 'replace',
          newSource: notebookContentDenyAttemptedSource,
          notebookPath: notebookContentDenyFilePath,
          toolUseIdPrefix: 'toolu_cli_notebook_content_deny_',
        },
        text: '',
      }
    }
    return {
      index: responses.length + 52,
      toolUse: true,
      toolOptions: {
        filePath: notebookContentDenyFilePath,
        toolUseIdPrefix: 'toolu_cli_read_notebook_content_deny_',
      },
      text: '',
    }
  }
  if (combinedText.includes(notebookContentAskPrompt)) {
    if (hasToolResultWithIdPrefix(body, 'toolu_cli_notebook_content_ask_')) {
      return {
        index: responses.length + 53,
        text: notebookContentAskFinalResponse,
      }
    }
    if (combinedText.includes(notebookContentAskOriginalSource)) {
      return {
        index: responses.length + 53,
        notebookEditToolUse: true,
        notebookEditToolOptions: {
          cellId: notebookContentAskCellId,
          cellType: 'code',
          editMode: 'replace',
          newSource: notebookContentAskAttemptedSource,
          notebookPath: notebookContentAskFilePath,
          toolUseIdPrefix: 'toolu_cli_notebook_content_ask_',
        },
        text: '',
      }
    }
    return {
      index: responses.length + 53,
      toolUse: true,
      toolOptions: {
        filePath: notebookContentAskFilePath,
        toolUseIdPrefix: 'toolu_cli_read_notebook_content_ask_',
      },
      text: '',
    }
  }
  if (combinedText.includes(notebookDenyPrompt)) {
    if (hasToolResultWithIdPrefix(body, 'toolu_cli_notebook_deny_')) {
      return {
        index: responses.length + 20,
        text: notebookDenyFinalResponse,
      }
    }
    if (combinedText.includes(notebookDenyOriginalSource)) {
      return {
        index: responses.length + 20,
        notebookEditToolUse: true,
        notebookEditToolOptions: {
          cellId: notebookDenyCellId,
          cellType: 'code',
          editMode: 'replace',
          newSource: notebookDenyAttemptedSource,
          notebookPath: notebookDenyFilePath,
          toolUseIdPrefix: 'toolu_cli_notebook_deny_',
        },
        text: '',
      }
    }
    return {
      index: responses.length + 20,
      toolUse: true,
      toolOptions: {
        filePath: notebookDenyFilePath,
      },
      text: '',
    }
  }
  if (combinedText.includes(notebookCellIndexPrompt)) {
    if (hasToolResultWithIdPrefix(body, 'toolu_cli_notebook_cell_index_')) {
      return {
        index: responses.length + 21,
        text: notebookCellIndexFinalResponse,
      }
    }
    if (combinedText.includes(notebookCellIndexOriginalMarkdown)) {
      return {
        index: responses.length + 21,
        notebookEditToolUse: true,
        notebookEditToolOptions: {
          cellId: 'cell-1',
          cellType: 'markdown',
          editMode: 'replace',
          newSource: notebookCellIndexUpdatedMarkdown,
          notebookPath: notebookCellIndexFilePath,
          toolUseIdPrefix: 'toolu_cli_notebook_cell_index_',
        },
        text: '',
      }
    }
    return {
      index: responses.length + 21,
      toolUse: true,
      toolOptions: {
        filePath: notebookCellIndexFilePath,
      },
      text: '',
    }
  }
  if (combinedText.includes(writeUpdatePrompt)) {
    if (hasToolResultWithIdPrefix(body, 'toolu_cli_write_update_')) {
      return {
        index: responses.length + 12,
        text: writeUpdateFinalResponse,
      }
    }
    if (combinedText.includes(writeUpdateOriginalContent)) {
      return {
        index: responses.length + 12,
        writeToolUse: true,
        writeToolOptions: {
          content: `${writeUpdateUpdatedContent}\n`,
          filePath: writeUpdateFilePath,
          toolUseIdPrefix: 'toolu_cli_write_update_',
        },
        text: '',
      }
    }
    return {
      index: responses.length + 12,
      toolUse: true,
      toolOptions: {
        filePath: writeUpdateFilePath,
      },
      text: '',
    }
  }
  if (combinedText.includes(writeUnreadPrompt)) {
    if (hasToolResultWithIdPrefix(body, 'toolu_cli_write_unread_')) {
      return {
        index: responses.length + 13,
        text: writeUnreadFinalResponse,
      }
    }
    return {
      index: responses.length + 13,
      writeToolUse: true,
      writeToolOptions: {
        content: `${writeUnreadAttemptedContent}\n`,
        filePath: writeUnreadFilePath,
        toolUseIdPrefix: 'toolu_cli_write_unread_',
      },
      text: '',
    }
  }
  if (combinedText.includes(writeStalePrompt)) {
    if (hasToolResultWithIdPrefix(body, 'toolu_cli_write_stale_')) {
      return {
        index: responses.length + 14,
        text: writeStaleFinalResponse,
      }
    }
    if (combinedText.includes(writeStaleOriginalContent)) {
      if (!writeStaleWasExternallyModified) {
        writeFileSync(writeStaleFilePath, `${writeStaleExternalContent}\n`, 'utf8')
        const future = new Date(Date.now() + 10_000)
        utimesSync(writeStaleFilePath, future, future)
        writeStaleWasExternallyModified = true
      }
      return {
        index: responses.length + 14,
        writeToolUse: true,
        writeToolOptions: {
          content: `${writeStaleAttemptedContent}\n`,
          filePath: writeStaleFilePath,
          toolUseIdPrefix: 'toolu_cli_write_stale_',
        },
        text: '',
      }
    }
    return {
      index: responses.length + 14,
      toolUse: true,
      toolOptions: {
        filePath: writeStaleFilePath,
      },
      text: '',
    }
  }
  if (combinedText.includes(writeDenyPrompt)) {
    if (hasToolResultWithIdPrefix(body, 'toolu_cli_write_deny_')) {
      return {
        index: responses.length + 19,
        text: writeDenyFinalResponse,
      }
    }
    return {
      index: responses.length + 19,
      writeToolUse: true,
      writeToolOptions: {
        content: `${writeDenyContent}\n`,
        filePath: writeDenyFilePath,
        toolUseIdPrefix: 'toolu_cli_write_deny_',
      },
      text: '',
    }
  }
  if (combinedText.includes(writeContentDenyPrompt)) {
    if (hasToolResultWithIdPrefix(body, 'toolu_cli_write_content_deny_')) {
      return {
        index: responses.length + 46,
        text: writeContentDenyFinalResponse,
      }
    }
    return {
      index: responses.length + 46,
      writeToolUse: true,
      writeToolOptions: {
        content: `${writeContentDenyContent}\n`,
        filePath: writeContentDenyFilePath,
        toolUseIdPrefix: 'toolu_cli_write_content_deny_',
      },
      text: '',
    }
  }
  if (combinedText.includes(writeContentAskPrompt)) {
    if (hasToolResultWithIdPrefix(body, 'toolu_cli_write_content_ask_')) {
      return {
        index: responses.length + 47,
        text: writeContentAskFinalResponse,
      }
    }
    return {
      index: responses.length + 47,
      writeToolUse: true,
      writeToolOptions: {
        content: `${writeContentAskContent}\n`,
        filePath: writeContentAskFilePath,
        toolUseIdPrefix: 'toolu_cli_write_content_ask_',
      },
      text: '',
    }
  }
  if (combinedText.includes(writeHookDenyPrompt)) {
    if (hasToolResultWithIdPrefix(body, 'toolu_cli_write_hook_deny_')) {
      return {
        index: responses.length + 54,
        text: writeHookDenyFinalResponse,
      }
    }
    return {
      index: responses.length + 54,
      writeToolUse: true,
      writeToolOptions: {
        content: `${writeHookDenyContent}\n`,
        filePath: writeHookDenyFilePath,
        toolUseIdPrefix: 'toolu_cli_write_hook_deny_',
      },
      text: '',
    }
  }
  if (combinedText.includes(userSettingsWriteDenyPrompt)) {
    if (hasToolResultWithIdPrefix(body, 'toolu_cli_user_settings_write_deny_')) {
      return {
        index: responses.length + 40,
        text: userSettingsWriteDenyFinalResponse,
      }
    }
    return {
      index: responses.length + 40,
      writeToolUse: true,
      writeToolOptions: {
        content: `${userSettingsWriteDenyContent}\n`,
        filePath: userSettingsWriteDenyFilePath,
        toolUseIdPrefix: 'toolu_cli_user_settings_write_deny_',
      },
      text: '',
    }
  }
  if (combinedText.includes(projectSettingsWriteDenyPrompt)) {
    if (
      hasToolResultWithIdPrefix(body, 'toolu_cli_project_settings_write_deny_')
    ) {
      return {
        index: responses.length + 41,
        text: projectSettingsWriteDenyFinalResponse,
      }
    }
    return {
      index: responses.length + 41,
      writeToolUse: true,
      writeToolOptions: {
        content: `${projectSettingsWriteDenyContent}\n`,
        filePath: projectSettingsWriteDenyFilePath,
        toolUseIdPrefix: 'toolu_cli_project_settings_write_deny_',
      },
      text: '',
    }
  }
  if (combinedText.includes(managedOnlyWritePrompt)) {
    if (hasToolResultWithIdPrefix(body, 'toolu_cli_managed_write_')) {
      return {
        index: responses.length + 39,
        text: managedOnlyWriteFinalResponse,
      }
    }
    return {
      index: responses.length + 39,
      writeToolUse: true,
      writeToolOptions: {
        content: `${managedOnlyWriteContent}\n`,
        filePath: managedOnlyWriteFilePath,
        toolUseIdPrefix: 'toolu_cli_managed_write_',
      },
      text: '',
    }
  }
  if (combinedText.includes(writeCrlfPrompt)) {
    if (hasToolResultWithIdPrefix(body, 'toolu_cli_write_crlf_')) {
      return {
        index: responses.length + 30,
        text: writeCrlfFinalResponse,
      }
    }
    return {
      index: responses.length + 30,
      writeToolUse: true,
      writeToolOptions: {
        content: writeCrlfContent,
        filePath: writeCrlfFilePath,
        toolUseIdPrefix: 'toolu_cli_write_crlf_',
      },
      text: '',
    }
  }
  if (combinedText.includes(binaryReadWritePrompt)) {
    if (hasToolResultWithIdPrefix(body, 'toolu_cli_binary_write_')) {
      return {
        index: responses.length + 38,
        text: binaryReadWriteFinalResponse,
      }
    }
    if (hasToolResultWithIdPrefix(body, 'toolu_cli_read_')) {
      return {
        index: responses.length + 38,
        writeToolUse: true,
        writeToolOptions: {
          content: binaryReadWriteAttemptedContent,
          filePath: binaryReadWriteFilePath,
          toolUseIdPrefix: 'toolu_cli_binary_write_',
        },
        text: '',
      }
    }
    return {
      index: responses.length + 38,
      toolUse: true,
      toolOptions: {
        filePath: binaryReadWriteFilePath,
      },
      text: '',
    }
  }
  if (combinedText.includes(writeMixedLineEndingsPrompt)) {
    if (hasToolResultWithIdPrefix(body, 'toolu_cli_write_mixed_eol_')) {
      return {
        index: responses.length + 37,
        text: writeMixedLineEndingsFinalResponse,
      }
    }
    return {
      index: responses.length + 37,
      writeToolUse: true,
      writeToolOptions: {
        content: writeMixedLineEndingsContent,
        filePath: writeMixedLineEndingsFilePath,
        toolUseIdPrefix: 'toolu_cli_write_mixed_eol_',
      },
      text: '',
    }
  }
  if (combinedText.includes(writeUtf16Prompt)) {
    if (hasToolResultWithIdPrefix(body, 'toolu_cli_write_utf16_')) {
      return {
        index: responses.length + 34,
        text: writeUtf16FinalResponse,
      }
    }
    if (hasToolResultWithIdPrefix(body, 'toolu_cli_read_')) {
      return {
        index: responses.length + 34,
        writeToolUse: true,
        writeToolOptions: {
          content: writeUtf16ModelContent,
          filePath: writeUtf16FilePath,
          toolUseIdPrefix: 'toolu_cli_write_utf16_',
        },
        text: '',
      }
    }
    return {
      index: responses.length + 34,
      toolUse: true,
      toolOptions: {
        filePath: writeUtf16FilePath,
      },
      text: '',
    }
  }
  if (combinedText.includes(writeUtf8BomPrompt)) {
    if (hasToolResultWithIdPrefix(body, 'toolu_cli_write_utf8_bom_')) {
      return {
        index: responses.length + 36,
        text: writeUtf8BomFinalResponse,
      }
    }
    if (hasToolResultWithIdPrefix(body, 'toolu_cli_read_')) {
      return {
        index: responses.length + 36,
        writeToolUse: true,
        writeToolOptions: {
          content: writeUtf8BomModelContent,
          filePath: writeUtf8BomFilePath,
          toolUseIdPrefix: 'toolu_cli_write_utf8_bom_',
        },
        text: '',
      }
    }
    return {
      index: responses.length + 36,
      toolUse: true,
      toolOptions: {
        filePath: writeUtf8BomFilePath,
      },
      text: '',
    }
  }
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
  if (combinedText.includes(editUnreadPrompt)) {
    if (hasToolResultWithIdPrefix(body, 'toolu_cli_edit_unread_')) {
      return {
        index: responses.length + 22,
        text: editUnreadFinalResponse,
      }
    }
    return {
      index: responses.length + 22,
      editToolUse: true,
      editToolOptions: {
        filePath: editUnreadFilePath,
        oldString: editUnreadOriginalContent,
        newString: editUnreadUpdatedContent,
        toolUseIdPrefix: 'toolu_cli_edit_unread_',
      },
      text: '',
    }
  }
  if (combinedText.includes(editStalePrompt)) {
    if (hasToolResultWithIdPrefix(body, 'toolu_cli_edit_stale_')) {
      return {
        index: responses.length + 23,
        text: editStaleFinalResponse,
      }
    }
    if (combinedText.includes(editStaleOriginalContent)) {
      if (!editStaleWasExternallyModified) {
        writeFileSync(editStaleFilePath, `${editStaleExternalContent}\n`, 'utf8')
        const future = new Date(Date.now() + 10_000)
        utimesSync(editStaleFilePath, future, future)
        editStaleWasExternallyModified = true
      }
      return {
        index: responses.length + 23,
        editToolUse: true,
        editToolOptions: {
          filePath: editStaleFilePath,
          oldString: editStaleOriginalContent,
          newString: editStaleUpdatedContent,
          toolUseIdPrefix: 'toolu_cli_edit_stale_',
        },
        text: '',
      }
    }
    return {
      index: responses.length + 23,
      toolUse: true,
      toolOptions: {
        filePath: editStaleFilePath,
      },
      text: '',
    }
  }
  if (combinedText.includes(editDenyPrompt)) {
    if (hasToolResultWithIdPrefix(body, 'toolu_cli_edit_deny_')) {
      return {
        index: responses.length + 24,
        text: editDenyFinalResponse,
      }
    }
    if (combinedText.includes(editDenyOriginalContent)) {
      return {
        index: responses.length + 24,
        editToolUse: true,
        editToolOptions: {
          filePath: editDenyFilePath,
          oldString: editDenyOriginalContent,
          newString: editDenyUpdatedContent,
          toolUseIdPrefix: 'toolu_cli_edit_deny_',
        },
        text: '',
      }
    }
    return {
      index: responses.length + 24,
      toolUse: true,
      toolOptions: {
        filePath: editDenyFilePath,
      },
      text: '',
    }
  }
  if (combinedText.includes(editContentDenyPrompt)) {
    if (hasToolResultWithIdPrefix(body, 'toolu_cli_edit_content_deny_')) {
      return {
        index: responses.length + 48,
        text: editContentDenyFinalResponse,
      }
    }
    return {
      index: responses.length + 48,
      editToolUse: true,
      editToolOptions: {
        filePath: editContentDenyFilePath,
        oldString: editContentDenyOriginalContent,
        newString: editContentDenyUpdatedContent,
        toolUseIdPrefix: 'toolu_cli_edit_content_deny_',
      },
      text: '',
    }
  }
  if (combinedText.includes(editContentAskPrompt)) {
    if (hasToolResultWithIdPrefix(body, 'toolu_cli_edit_content_ask_')) {
      return {
        index: responses.length + 49,
        text: editContentAskFinalResponse,
      }
    }
    return {
      index: responses.length + 49,
      editToolUse: true,
      editToolOptions: {
        filePath: editContentAskFilePath,
        oldString: '',
        newString: `${editContentAskUpdatedContent}\n`,
        toolUseIdPrefix: 'toolu_cli_edit_content_ask_',
      },
      text: '',
    }
  }
  if (combinedText.includes(editReplaceAllPrompt)) {
    if (hasToolResultWithIdPrefix(body, 'toolu_cli_edit_replace_all_')) {
      return {
        index: responses.length + 27,
        text: editReplaceAllFinalResponse,
      }
    }
    if (combinedText.includes(editReplaceAllOriginalContent)) {
      return {
        index: responses.length + 27,
        editToolUse: true,
        editToolOptions: {
          filePath: editReplaceAllFilePath,
          oldString: 'alpha replace-all-2048',
          newString: 'beta replace-all-2048',
          replaceAll: true,
          toolUseIdPrefix: 'toolu_cli_edit_replace_all_',
        },
        text: '',
      }
    }
    return {
      index: responses.length + 27,
      toolUse: true,
      toolOptions: {
        filePath: editReplaceAllFilePath,
      },
      text: '',
    }
  }
  if (combinedText.includes(editMultiMatchPrompt)) {
    if (hasToolResultWithIdPrefix(body, 'toolu_cli_edit_multi_match_')) {
      return {
        index: responses.length + 28,
        text: editMultiMatchFinalResponse,
      }
    }
    if (combinedText.includes(editMultiMatchOriginalContent)) {
      return {
        index: responses.length + 28,
        editToolUse: true,
        editToolOptions: {
          filePath: editMultiMatchFilePath,
          oldString: 'duplicate-multi-5720',
          newString: editMultiMatchAttemptedContent,
          toolUseIdPrefix: 'toolu_cli_edit_multi_match_',
        },
        text: '',
      }
    }
    return {
      index: responses.length + 28,
      toolUse: true,
      toolOptions: {
        filePath: editMultiMatchFilePath,
      },
      text: '',
    }
  }
  if (combinedText.includes(editCreatePrompt)) {
    if (hasToolResultWithIdPrefix(body, 'toolu_cli_edit_create_')) {
      return {
        index: responses.length + 29,
        text: editCreateFinalResponse,
      }
    }
    return {
      index: responses.length + 29,
      editToolUse: true,
      editToolOptions: {
        filePath: editCreateFilePath,
        oldString: '',
        newString: `${editCreateContent}\n`,
        toolUseIdPrefix: 'toolu_cli_edit_create_',
      },
      text: '',
    }
  }
  if (combinedText.includes(editCrlfPrompt)) {
    if (hasToolResultWithIdPrefix(body, 'toolu_cli_edit_crlf_')) {
      return {
        index: responses.length + 32,
        text: editCrlfFinalResponse,
      }
    }
    if (combinedText.includes('edit crlf fixture: before-6142')) {
      return {
        index: responses.length + 32,
        editToolUse: true,
        editToolOptions: {
          filePath: editCrlfFilePath,
          oldString: 'edit crlf fixture: before-6142',
          newString: 'edit crlf fixture: after-6142',
          toolUseIdPrefix: 'toolu_cli_edit_crlf_',
        },
        text: '',
      }
    }
    return {
      index: responses.length + 32,
      toolUse: true,
      toolOptions: {
        filePath: editCrlfFilePath,
      },
      text: '',
    }
  }
  if (combinedText.includes(editMixedLineEndingsPrompt)) {
    if (hasToolResultWithIdPrefix(body, 'toolu_cli_edit_mixed_eol_')) {
      return {
        index: responses.length + 36,
        text: editMixedLineEndingsFinalResponse,
      }
    }
    if (combinedText.includes('edit mixed fixture: before-3916')) {
      return {
        index: responses.length + 36,
        editToolUse: true,
        editToolOptions: {
          filePath: editMixedLineEndingsFilePath,
          oldString: 'edit mixed fixture: before-3916',
          newString: 'edit mixed fixture: after-3916',
          toolUseIdPrefix: 'toolu_cli_edit_mixed_eol_',
        },
        text: '',
      }
    }
    return {
      index: responses.length + 36,
      toolUse: true,
      toolOptions: {
        filePath: editMixedLineEndingsFilePath,
      },
      text: '',
    }
  }
  if (combinedText.includes(editUtf16Prompt)) {
    if (hasToolResultWithIdPrefix(body, 'toolu_cli_edit_utf16_')) {
      return {
        index: responses.length + 33,
        text: editUtf16FinalResponse,
      }
    }
    if (hasToolResultWithIdPrefix(body, 'toolu_cli_read_')) {
      return {
        index: responses.length + 33,
        editToolUse: true,
        editToolOptions: {
          filePath: editUtf16FilePath,
          oldString: 'edit utf16 fixture: before-9051',
          newString: 'edit utf16 fixture: after-9051',
          toolUseIdPrefix: 'toolu_cli_edit_utf16_',
        },
        text: '',
      }
    }
    return {
      index: responses.length + 33,
      toolUse: true,
      toolOptions: {
        filePath: editUtf16FilePath,
      },
      text: '',
    }
  }
  if (combinedText.includes(editUtf8BomPrompt)) {
    if (hasToolResultWithIdPrefix(body, 'toolu_cli_edit_utf8_bom_')) {
      return {
        index: responses.length + 35,
        text: editUtf8BomFinalResponse,
      }
    }
    if (hasToolResultWithIdPrefix(body, 'toolu_cli_read_')) {
      return {
        index: responses.length + 35,
        editToolUse: true,
        editToolOptions: {
          filePath: editUtf8BomFilePath,
          oldString: 'edit utf8 bom fixture: before-1184',
          newString: 'edit utf8 bom fixture: after-1184',
          toolUseIdPrefix: 'toolu_cli_edit_utf8_bom_',
        },
        text: '',
      }
    }
    return {
      index: responses.length + 35,
      toolUse: true,
      toolOptions: {
        filePath: editUtf8BomFilePath,
      },
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
  if (combinedText.includes(bashContentDenyPrompt)) {
    if (hasToolResultWithIdPrefix(body, 'toolu_cli_bash_content_deny_')) {
      return {
        index: responses.length + 10,
        text: bashContentDenyFinalResponse,
      }
    }
    return {
      index: responses.length + 10,
      bashSideEffectToolUse: true,
      bashSideEffectOptions: {
        command: `echo ${bashContentDenyResult} > ${bashContentDenyRelativePath}`,
        description: 'Attempt to write a denied Bash fixture marker',
        messageIdPrefix: 'msg_cli_bash_content_deny_tool_use_',
        toolUseIdPrefix: 'toolu_cli_bash_content_deny_',
      },
      text: '',
    }
  }
  if (combinedText.includes(bashContentAskPrompt)) {
    if (hasToolResultWithIdPrefix(body, 'toolu_cli_bash_content_ask_')) {
      return {
        index: responses.length + 11,
        text: bashContentAskFinalResponse,
      }
    }
    return {
      index: responses.length + 11,
      bashSideEffectToolUse: true,
      bashSideEffectOptions: {
        command: `echo ${bashContentAskResult} > ${bashContentAskRelativePath}`,
        description: 'Attempt to write a Bash fixture requiring approval',
        messageIdPrefix: 'msg_cli_bash_content_ask_tool_use_',
        toolUseIdPrefix: 'toolu_cli_bash_content_ask_',
      },
      text: '',
    }
  }
  if (combinedText.includes(projectBashContentDenyPrompt)) {
    if (
      hasToolResultWithIdPrefix(body, 'toolu_cli_project_bash_content_deny_')
    ) {
      return {
        index: responses.length + 12,
        text: projectBashContentDenyFinalResponse,
      }
    }
    return {
      index: responses.length + 12,
      bashSideEffectToolUse: true,
      bashSideEffectOptions: {
        command: `echo ${projectBashContentDenyResult} > ${projectBashContentDenyRelativePath}`,
        description: 'Attempt to write a project-denied Bash fixture marker',
        messageIdPrefix: 'msg_cli_project_bash_content_deny_tool_use_',
        toolUseIdPrefix: 'toolu_cli_project_bash_content_deny_',
      },
      text: '',
    }
  }
  if (combinedText.includes(projectBashContentAskPrompt)) {
    if (
      hasToolResultWithIdPrefix(body, 'toolu_cli_project_bash_content_ask_')
    ) {
      return {
        index: responses.length + 13,
        text: projectBashContentAskFinalResponse,
      }
    }
    return {
      index: responses.length + 13,
      bashSideEffectToolUse: true,
      bashSideEffectOptions: {
        command: `echo ${projectBashContentAskResult} > ${projectBashContentAskRelativePath}`,
        description: 'Attempt to write a project ask Bash fixture marker',
        messageIdPrefix: 'msg_cli_project_bash_content_ask_tool_use_',
        toolUseIdPrefix: 'toolu_cli_project_bash_content_ask_',
      },
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
  if (combinedText.includes(reactiveCompactSummary)) {
    return {
      index: responses.length + 25,
      text: reactiveCompactFinalResponse,
    }
  }
  if (
    combinedText.includes(reactiveCompactPrompt) &&
    combinedText.includes('Your task is to create a detailed summary')
  ) {
    return {
      index: responses.length + 25,
      text: reactiveCompactSummary,
    }
  }
  if (combinedText.includes(reactiveCompactPrompt)) {
    return {
      index: responses.length + 25,
      promptTooLong: true,
      text: '',
    }
  }
  if (combinedText.includes(partialStreamPrompt)) {
    return {
      index: responses.length + 26,
      delayedStream: true,
      text: partialStreamFinalResponse,
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
  if (combinedText.includes(readContentDenyPrompt)) {
    if (hasToolResultWithIdPrefix(body, 'toolu_cli_read_content_deny_')) {
      return {
        index: responses.length + 50,
        text: readContentDenyFinalResponse,
      }
    }
    return {
      index: responses.length + 50,
      toolUse: true,
      toolOptions: {
        filePath: readContentDenyFilePath,
        toolUseIdPrefix: 'toolu_cli_read_content_deny_',
      },
      text: '',
    }
  }
  if (combinedText.includes(readContentAskPrompt)) {
    if (hasToolResultWithIdPrefix(body, 'toolu_cli_read_content_ask_')) {
      return {
        index: responses.length + 51,
        text: readContentAskFinalResponse,
      }
    }
    return {
      index: responses.length + 51,
      toolUse: true,
      toolOptions: {
        filePath: readContentAskFilePath,
        toolUseIdPrefix: 'toolu_cli_read_content_ask_',
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

      if (url.pathname === '/hook/pretooluse-block-write') {
        assert.equal(
          body.hook_event_name,
          'PreToolUse',
          'PreToolUse hook endpoint should receive a PreToolUse event',
        )
        assert.equal(
          body.tool_name,
          'Write',
          'PreToolUse hook endpoint should receive the Write tool name',
        )
        assert.equal(
          body.tool_input?.file_path,
          writeHookDenyFilePath,
          'PreToolUse hook endpoint should receive the Write file path',
        )
        writeJson(res, {
          decision: 'block',
          reason: writeHookDenyReason,
        })
        return
      }

      if (url.pathname.endsWith('/messages')) {
        const sequence = ++messageRequests
        const response = responseForBody(body, sequence - 1)
        if (response.outOfOrderStream && body.stream === true) {
          writeOutOfOrderStreamingMessage(res, sequence)
          return
        }
        if (response.promptTooLong) {
          writeApiError(
            res,
            400,
            'prompt is too long: 137500 tokens > 135000 maximum',
          )
          return
        }
        if (response.delayedStream && body.stream === true) {
          await writeDelayedStreamingMessage(res, sequence)
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
          writeStreamingBashSideEffectToolUse(
            res,
            sequence,
            response.bashSideEffectOptions,
          )
          return
        }
        if (response.editToolUse) {
          writeStreamingEditToolUse(res, sequence, response.editToolOptions)
          return
        }
        if (response.writeToolUse) {
          writeStreamingWriteToolUse(res, sequence, response.writeToolOptions)
          return
        }
        if (response.notebookEditToolUse) {
          writeStreamingNotebookEditToolUse(
            res,
            sequence,
            response.notebookEditToolOptions,
          )
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
      cwd: options.cwd ?? ROOT,
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
              options.describeState ? `state:\n${options.describeState()}` : '',
              `stdout:\n${stdout}`,
              `stderr:\n${stderr}`,
            ]
              .filter(Boolean)
              .join('\n'),
          ),
        )
        return
      }
      resolve({ stdout, stderr, code })
    })
  })
}

function runCliStreaming(args, env, options = {}) {
  return new Promise((resolve, reject) => {
    const timeoutMs = options.timeoutMs ?? 45_000
    const child = spawn(process.execPath, [DIST_CLI, ...args], {
      cwd: options.cwd ?? ROOT,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    let stdout = ''
    let stderr = ''
    let lineBuffer = ''
    const events = []
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', chunk => {
      const observedAt = Date.now()
      stdout += chunk
      lineBuffer += chunk
      const lines = lineBuffer.split(/\r?\n/)
      lineBuffer = lines.pop() ?? ''
      for (const rawLine of lines) {
        const line = rawLine.trim()
        if (!line) continue
        try {
          events.push({
            observedAt,
            message: JSON.parse(line),
            line,
          })
        } catch {
          events.push({
            observedAt,
            message: null,
            line,
          })
        }
      }
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
      const closedAt = Date.now()
      if (lineBuffer.trim()) {
        const line = lineBuffer.trim()
        try {
          events.push({
            observedAt: closedAt,
            message: JSON.parse(line),
            line,
          })
        } catch {
          events.push({
            observedAt: closedAt,
            message: null,
            line,
          })
        }
      }
      if (code !== 0 && !options.allowNonZero) {
        reject(
          new Error(
            [
              `CLI exited with code ${code}`,
              `args: ${args.join(' ')}`,
              options.describeState ? `state:\n${options.describeState()}` : '',
              `stdout:\n${stdout}`,
              `stderr:\n${stderr}`,
            ]
              .filter(Boolean)
              .join('\n'),
          ),
        )
        return
      }
      resolve({ stdout, stderr, code, events, closedAt })
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
      if (Array.isArray(block.content)) return textFromContent(block.content)
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
  await writeFile(
    readContentDenyFilePath,
    `${readContentDenyFileContent}\n`,
    'utf8',
  )
  await writeFile(
    readContentAskFilePath,
    `${readContentAskFileContent}\n`,
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
  await rm(bashContentDenyFilePath, { force: true })
  await rm(bashContentAskFilePath, { force: true })
  editToolFilePath = join(ARTIFACT_DIR, 'cli-read-then-edit-tool.txt')
  await writeFile(editToolFilePath, `${editToolOriginalContent}\n`, 'utf8')
  editUnreadFilePath = join(ARTIFACT_DIR, 'cli-unread-edit-rejection.txt')
  await writeFile(
    editUnreadFilePath,
    `${editUnreadOriginalContent}\n`,
    'utf8',
  )
  editStaleFilePath = join(ARTIFACT_DIR, 'cli-stale-edit-rejection.txt')
  editStaleWasExternallyModified = false
  await writeFile(editStaleFilePath, `${editStaleOriginalContent}\n`, 'utf8')
  editDenyFilePath = join(ARTIFACT_DIR, 'cli-edit-permission-deny.txt')
  await writeFile(editDenyFilePath, `${editDenyOriginalContent}\n`, 'utf8')
  await writeFile(
    editContentDenyFilePath,
    `${editContentDenyOriginalContent}\n`,
    'utf8',
  )
  await rm(editContentAskFilePath, { force: true })
  editReplaceAllFilePath = join(ARTIFACT_DIR, 'cli-edit-replace-all.txt')
  await writeFile(
    editReplaceAllFilePath,
    `${editReplaceAllOriginalContent}\n`,
    'utf8',
  )
  editMultiMatchFilePath = join(
    ARTIFACT_DIR,
    'cli-edit-multi-match-rejection.txt',
  )
  await writeFile(
    editMultiMatchFilePath,
    `${editMultiMatchOriginalContent}\n`,
    'utf8',
  )
  editCreateFilePath = join(ARTIFACT_DIR, 'cli-edit-create-new-file.txt')
  await rm(editCreateFilePath, { force: true })
  editCrlfFilePath = join(ARTIFACT_DIR, 'cli-edit-crlf-preserve.txt')
  await writeFile(editCrlfFilePath, editCrlfOriginalContent, 'utf8')
  editMixedLineEndingsFilePath = join(
    ARTIFACT_DIR,
    'cli-edit-mixed-line-endings-preserve.txt',
  )
  await writeFile(
    editMixedLineEndingsFilePath,
    editMixedLineEndingsOriginalContent,
    'utf8',
  )
  editUtf16FilePath = join(ARTIFACT_DIR, 'cli-edit-utf16le-bom-preserve.txt')
  await writeFile(
    editUtf16FilePath,
    Buffer.from(editUtf16OriginalContent, 'utf16le'),
  )
  editUtf8BomFilePath = join(ARTIFACT_DIR, 'cli-edit-utf8-bom-preserve.txt')
  await writeFile(editUtf8BomFilePath, editUtf8BomOriginalContent, 'utf8')
  writeToolFilePath = join(ARTIFACT_DIR, 'cli-write-tool-create.txt')
  await rm(writeToolFilePath, { force: true })
  writeUpdateFilePath = join(ARTIFACT_DIR, 'cli-read-then-write-update.txt')
  await writeFile(
    writeUpdateFilePath,
    `${writeUpdateOriginalContent}\n`,
    'utf8',
  )
  writeUnreadFilePath = join(ARTIFACT_DIR, 'cli-unread-write-rejection.txt')
  await writeFile(
    writeUnreadFilePath,
    `${writeUnreadOriginalContent}\n`,
    'utf8',
  )
  writeStaleFilePath = join(ARTIFACT_DIR, 'cli-stale-write-rejection.txt')
  writeStaleWasExternallyModified = false
  await writeFile(
    writeStaleFilePath,
    `${writeStaleOriginalContent}\n`,
    'utf8',
  )
  writeDenyFilePath = join(ARTIFACT_DIR, 'cli-write-permission-deny.txt')
  await rm(writeDenyFilePath, { force: true })
  await rm(writeContentDenyFilePath, { force: true })
  await rm(writeContentAskFilePath, { force: true })
  userSettingsWriteDenyFilePath = join(
    ARTIFACT_DIR,
    'cli-user-settings-write-deny.txt',
  )
  await rm(userSettingsWriteDenyFilePath, { force: true })
  projectSettingsWriteDenyFilePath = join(
    ARTIFACT_DIR,
    'cli-project-settings-write-deny.txt',
  )
  await rm(projectSettingsWriteDenyFilePath, { force: true })
  managedOnlyWriteFilePath = join(
    ARTIFACT_DIR,
    'cli-managed-only-write-allow-ignored.txt',
  )
  await rm(managedOnlyWriteFilePath, { force: true })
  binaryReadWriteFilePath = join(
    ARTIFACT_DIR,
    'cli-binary-read-write-rejection',
  )
  await writeFile(binaryReadWriteFilePath, binaryReadWriteOriginalBytes)
  writeCrlfFilePath = join(ARTIFACT_DIR, 'cli-write-crlf-create.txt')
  await rm(writeCrlfFilePath, { force: true })
  writeMixedLineEndingsFilePath = join(
    ARTIFACT_DIR,
    'cli-write-mixed-line-endings-create.txt',
  )
  await rm(writeMixedLineEndingsFilePath, { force: true })
  writeUtf16FilePath = join(
    ARTIFACT_DIR,
    'cli-write-utf16le-bom-overwrite.txt',
  )
  await writeFile(
    writeUtf16FilePath,
    Buffer.from(writeUtf16OriginalContent, 'utf16le'),
  )
  writeUtf8BomFilePath = join(
    ARTIFACT_DIR,
    'cli-write-utf8-bom-overwrite.txt',
  )
  await writeFile(writeUtf8BomFilePath, writeUtf8BomOriginalContent, 'utf8')
  notebookEditFilePath = join(ARTIFACT_DIR, 'cli-read-then-notebook-edit.ipynb')
  await writeFile(
    notebookEditFilePath,
    JSON.stringify(
      {
        cells: [
          {
            cell_type: 'code',
            execution_count: 1,
            id: notebookEditCellId,
            metadata: {},
            outputs: [],
            source: notebookEditOriginalSource,
          },
        ],
        metadata: {
          language_info: { name: 'python' },
        },
        nbformat: 4,
        nbformat_minor: 5,
      },
      null,
      1,
    ),
    'utf8',
  )
  notebookVariantFilePath = join(
    ARTIFACT_DIR,
    'cli-notebook-insert-delete.ipynb',
  )
  await writeFile(
    notebookVariantFilePath,
    JSON.stringify(
      {
        cells: [
          {
            cell_type: 'code',
            execution_count: 1,
            id: notebookVariantBaseCellId,
            metadata: {},
            outputs: [],
            source: notebookVariantBaseSource,
          },
        ],
        metadata: {
          language_info: { name: 'python' },
        },
        nbformat: 4,
        nbformat_minor: 5,
      },
      null,
      1,
    ),
    'utf8',
  )
  notebookRejectFilePath = join(
    ARTIFACT_DIR,
    'cli-notebook-missing-cell-rejection.ipynb',
  )
  await writeFile(
    notebookRejectFilePath,
    JSON.stringify(
      {
        cells: [
          {
            cell_type: 'code',
            execution_count: 1,
            id: notebookRejectCellId,
            metadata: {},
            outputs: [],
            source: notebookRejectOriginalSource,
          },
        ],
        metadata: {
          language_info: { name: 'python' },
        },
        nbformat: 4,
        nbformat_minor: 5,
      },
      null,
      1,
    ),
    'utf8',
  )
  notebookInvalidFilePath = join(
    ARTIFACT_DIR,
    'cli-notebook-invalid-json-rejection.ipynb',
  )
  notebookInvalidWasCorrupted = false
  await writeFile(
    notebookInvalidFilePath,
    JSON.stringify(
      {
        cells: [
          {
            cell_type: 'code',
            execution_count: 1,
            id: notebookInvalidCellId,
            metadata: {},
            outputs: [],
            source: notebookInvalidOriginalSource,
          },
        ],
        metadata: {
          language_info: { name: 'python' },
        },
        nbformat: 4,
        nbformat_minor: 5,
      },
      null,
      1,
    ),
    'utf8',
  )
  notebookInvalidStableMtime = new Date(Date.now() - 20_000)
  utimesSync(
    notebookInvalidFilePath,
    notebookInvalidStableMtime,
    notebookInvalidStableMtime,
  )
  notebookLargeFilePath = join(ARTIFACT_DIR, 'cli-notebook-too-large.ipynb')
  notebookLargeWasExpanded = false
  await writeFile(
    notebookLargeFilePath,
    makeNotebookContent([
      {
        cell_type: 'code',
        execution_count: 1,
        id: notebookLargeCellId,
        metadata: {},
        outputs: [],
        source: notebookLargeOriginalSource,
      },
    ]),
    'utf8',
  )
  notebookLargeStableMtime = new Date(Date.now() - 20_000)
  utimesSync(
    notebookLargeFilePath,
    notebookLargeStableMtime,
    notebookLargeStableMtime,
  )
  notebookUnreadFilePath = join(
    ARTIFACT_DIR,
    'cli-notebook-unread-rejection.ipynb',
  )
  await writeFile(
    notebookUnreadFilePath,
    JSON.stringify(
      {
        cells: [
          {
            cell_type: 'code',
            execution_count: 1,
            id: notebookUnreadCellId,
            metadata: {},
            outputs: [],
            source: notebookUnreadOriginalSource,
          },
        ],
        metadata: {
          language_info: { name: 'python' },
        },
        nbformat: 4,
        nbformat_minor: 5,
      },
      null,
      1,
    ),
    'utf8',
  )
  notebookStaleFilePath = join(
    ARTIFACT_DIR,
    'cli-notebook-stale-rejection.ipynb',
  )
  notebookStaleWasExternallyModified = false
  await writeFile(
    notebookStaleFilePath,
    JSON.stringify(
      {
        cells: [
          {
            cell_type: 'code',
            execution_count: 1,
            id: notebookStaleCellId,
            metadata: {},
            outputs: [],
            source: notebookStaleOriginalSource,
          },
        ],
        metadata: {
          language_info: { name: 'python' },
        },
        nbformat: 4,
        nbformat_minor: 5,
      },
      null,
      1,
    ),
    'utf8',
  )
  await writeFile(
    notebookContentDenyFilePath,
    makeNotebookContent([
      {
        cell_type: 'code',
        execution_count: 1,
        id: notebookContentDenyCellId,
        metadata: {},
        outputs: [],
        source: notebookContentDenyOriginalSource,
      },
    ]),
    'utf8',
  )
  await writeFile(
    notebookContentAskFilePath,
    makeNotebookContent([
      {
        cell_type: 'code',
        execution_count: 1,
        id: notebookContentAskCellId,
        metadata: {},
        outputs: [],
        source: notebookContentAskOriginalSource,
      },
    ]),
    'utf8',
  )
  notebookDenyFilePath = join(
    ARTIFACT_DIR,
    'cli-notebook-permission-deny.ipynb',
  )
  await writeFile(
    notebookDenyFilePath,
    JSON.stringify(
      {
        cells: [
          {
            cell_type: 'code',
            execution_count: 1,
            id: notebookDenyCellId,
            metadata: {},
            outputs: [],
            source: notebookDenyOriginalSource,
          },
        ],
        metadata: {
          language_info: { name: 'python' },
        },
        nbformat: 4,
        nbformat_minor: 5,
      },
      null,
      1,
    ),
    'utf8',
  )
  notebookCellIndexFilePath = join(
    ARTIFACT_DIR,
    'cli-notebook-cell-index-replace.ipynb',
  )
  await writeFile(
    notebookCellIndexFilePath,
    JSON.stringify(
      {
        cells: [
          {
            cell_type: 'code',
            execution_count: 1,
            id: 'notebook-index-code-cell',
            metadata: {},
            outputs: [],
            source: notebookCellIndexFirstSource,
          },
          {
            cell_type: 'markdown',
            id: 'notebook-index-markdown-cell',
            metadata: {},
            source: notebookCellIndexOriginalMarkdown,
          },
        ],
        metadata: {
          language_info: { name: 'python' },
        },
        nbformat: 4,
        nbformat_minor: 5,
      },
      null,
      1,
    ),
    'utf8',
  )

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

    const readContentRuleArgs = [
      '--bare',
      '--print',
      '--output-format',
      'json',
      '--max-turns',
      '2',
      '--strict-mcp-config',
      '--tools',
      'Read',
      '--allowedTools',
      'Read',
      '--model',
      'sonnet',
    ]

    const readContentDenyConfigDir = await mkdtemp(
      join(ARTIFACT_DIR, 'cli-read-content-deny-config-'),
    )
    await writeFile(
      join(readContentDenyConfigDir, 'settings.json'),
      JSON.stringify(
        {
          permissions: {
            deny: [`Read(${readContentDenyRelativePath})`],
          },
        },
        null,
        2,
      ),
      'utf8',
    )
    const readContentDenyEnv = {
      ...env,
      CLAUDE_CONFIG_DIR: readContentDenyConfigDir,
    }
    const beforeReadContentDenyRequests = server.requests.length
    const readContentDenyRun = parseJsonOutput(
      (
        await runCli(
          [...readContentRuleArgs, readContentDenyPrompt],
          readContentDenyEnv,
          runCliOptions(),
        )
      ).stdout,
    )
    assert.equal(
      readContentDenyRun.is_error,
      false,
      'Read content-specific deny run should complete after model final response',
    )
    assert.equal(
      readContentDenyRun.result,
      readContentDenyFinalResponse,
      'Read content-specific deny final response',
    )
    const readContentDenyRequests = server.requests
      .slice(beforeReadContentDenyRequests)
      .filter(request => {
        return request.path.endsWith('/messages') && request.body.stream === true
      })
    assert.equal(
      readContentDenyRequests.length,
      2,
      'Read content-specific deny run should make tool_use and final requests',
    )
    const readContentDenyResultBlocks = requestContentBlocks(
      readContentDenyRequests[1],
      'tool_result',
    )
    assert(
      readContentDenyResultBlocks.some(block => {
        return (
          typeof block.tool_use_id === 'string' &&
          block.tool_use_id.startsWith('toolu_cli_read_content_deny_') &&
          block.is_error === true &&
          typeof block.content === 'string' &&
          block.content.includes(
            'File is in a directory that is denied by your permission settings',
          )
        )
      }),
      `Read content-specific deny follow-up should include path-denied tool_result: ${JSON.stringify(readContentDenyResultBlocks, null, 2)}`,
    )
    assert(
      !containsText(requestTexts(readContentDenyRequests[1]), readContentDenyFileContent),
      'Read content-specific deny follow-up should not include denied file content',
    )
    assert.equal(
      await readFile(readContentDenyFilePath, 'utf8'),
      `${readContentDenyFileContent}\n`,
      'Read content-specific deny should leave the fixture unchanged',
    )

    const readContentAskConfigDir = await mkdtemp(
      join(ARTIFACT_DIR, 'cli-read-content-ask-config-'),
    )
    await writeFile(
      join(readContentAskConfigDir, 'settings.json'),
      JSON.stringify(
        {
          permissions: {
            ask: [`Read(${readContentAskRelativePath})`],
          },
        },
        null,
        2,
      ),
      'utf8',
    )
    const readContentAskEnv = {
      ...env,
      CLAUDE_CONFIG_DIR: readContentAskConfigDir,
    }
    const beforeReadContentAskRequests = server.requests.length
    const readContentAskRun = parseJsonOutput(
      (
        await runCli(
          [...readContentRuleArgs, readContentAskPrompt],
          readContentAskEnv,
          runCliOptions(),
        )
      ).stdout,
    )
    assert.equal(
      readContentAskRun.is_error,
      false,
      'Read content-specific ask run should complete after model final response',
    )
    assert.equal(
      readContentAskRun.result,
      readContentAskFinalResponse,
      'Read content-specific ask final response',
    )
    const readContentAskRequests = server.requests
      .slice(beforeReadContentAskRequests)
      .filter(request => {
        return request.path.endsWith('/messages') && request.body.stream === true
      })
    assert.equal(
      readContentAskRequests.length,
      2,
      'Read content-specific ask run should make tool_use and final requests',
    )
    const readContentAskResultBlocks = requestContentBlocks(
      readContentAskRequests[1],
      'tool_result',
    )
    assert(
      readContentAskResultBlocks.some(block => {
        return (
          typeof block.tool_use_id === 'string' &&
          block.tool_use_id.startsWith('toolu_cli_read_content_ask_') &&
          block.is_error === true &&
          typeof block.content === 'string' &&
          block.content.includes('Claude requested permissions to read from') &&
          block.content.includes("haven't granted it yet")
        )
      }),
      `Read content-specific ask follow-up should include approval-required tool_result: ${JSON.stringify(readContentAskResultBlocks, null, 2)}`,
    )
    assert(
      !containsText(requestTexts(readContentAskRequests[1]), readContentAskFileContent),
      'Read content-specific ask follow-up should not include unapproved file content',
    )
    assert.equal(
      await readFile(readContentAskFilePath, 'utf8'),
      `${readContentAskFileContent}\n`,
      'Read content-specific ask should leave the fixture unchanged',
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

    const beforeReactiveCompactRequests = server.requests.length
    const reactiveCompactRun = parseJsonOutput(
      (await runCli([...baseArgs, reactiveCompactPrompt], env, runCliOptions())).stdout,
    )
    assert.equal(
      reactiveCompactRun.is_error,
      false,
      'reactive compact should recover from prompt-too-long',
    )
    assert.equal(
      reactiveCompactRun.result,
      reactiveCompactFinalResponse,
      'reactive compact final response',
    )
    const reactiveCompactRequests = server.requests
      .slice(beforeReactiveCompactRequests)
      .filter(request => {
        return request.path.endsWith('/messages') && request.body.stream === true
      })
    assert.equal(
      reactiveCompactRequests.length,
      3,
      'reactive compact should make original, compact, and retry requests',
    )
    assert(
      containsText(
        requestTexts(reactiveCompactRequests[1]),
        'Your task is to create a detailed summary',
      ),
      'reactive compact second request should be the compact summary request',
    )
    assert(
      containsText(requestTexts(reactiveCompactRequests[2]), reactiveCompactSummary),
      'reactive compact retry should include compact summary',
    )

    const beforePartialStreamRequests = server.requests.length
    const partialStreamRun = await runCliStreaming(
      [
        '--bare',
        '--print',
        '--verbose',
        '--output-format',
        'stream-json',
        '--include-partial-messages',
        '--max-turns',
        '1',
        '--model',
        'sonnet',
        partialStreamPrompt,
      ],
      env,
      runCliOptions(),
    )
    const partialStreamRequests = server.requests
      .slice(beforePartialStreamRequests)
      .filter(request => {
        return request.path.endsWith('/messages') && request.body.stream === true
      })
    assert.equal(
      partialStreamRequests.length,
      1,
      'stream-json partial run should make one streamed request',
    )
    const partialDeltaEvents = partialStreamRun.events.filter(entry => {
      const message = entry.message
      return (
        message?.type === 'stream_event' &&
        message.event?.type === 'content_block_delta' &&
        message.event.delta?.type === 'text_delta'
      )
    })
    assert(
      partialDeltaEvents.some(entry =>
        String(entry.message.event.delta.text).includes(partialStreamChunks[0]),
      ),
      `stream-json output should include first partial delta before completion:\n${partialStreamRun.stdout}`,
    )
    const firstPartialDelta = partialDeltaEvents.find(entry =>
      String(entry.message.event.delta.text).includes(partialStreamChunks[0]),
    )
    const finalPartialResult = partialStreamRun.events.find(entry => {
      const message = entry.message
      return (
        message?.type === 'result' &&
        message.subtype === 'success' &&
        message.result === partialStreamFinalResponse
      )
    })
    assert(
      finalPartialResult,
      `stream-json output missing final result:\n${partialStreamRun.stdout}`,
    )
    assert(
      firstPartialDelta.observedAt < finalPartialResult.observedAt,
      'first partial delta should be emitted before the final result event',
    )
    assert(
      partialStreamRun.closedAt - firstPartialDelta.observedAt >= 150,
      'first partial delta should arrive while the process is still streaming, not only at close',
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

    const bashContentDenyConfigDir = await mkdtemp(
      join(ARTIFACT_DIR, 'cli-bash-content-deny-config-'),
    )
    await writeFile(
      join(bashContentDenyConfigDir, 'settings.json'),
      JSON.stringify(
        {
          permissions: {
            deny: ['Bash(echo:*)'],
          },
        },
        null,
        2,
      ),
      'utf8',
    )
    const bashContentDenyEnv = {
      ...env,
      CLAUDE_CONFIG_DIR: bashContentDenyConfigDir,
    }
    const beforeBashContentDenyRequests = server.requests.length
    const bashContentDenyRun = parseJsonOutput(
      (
        await runCli(
          [...bashSideEffectArgs, bashContentDenyPrompt],
          bashContentDenyEnv,
          runCliOptions(),
        )
      ).stdout,
    )
    assert.equal(
      bashContentDenyRun.is_error,
      false,
      'Bash content-specific deny run should complete after model final response',
    )
    assert.equal(
      bashContentDenyRun.result,
      bashContentDenyFinalResponse,
      'Bash content-specific deny final response',
    )
    const bashContentDenyRequests = server.requests
      .slice(beforeBashContentDenyRequests)
      .filter(request => {
        return request.path.endsWith('/messages') && request.body.stream === true
      })
    assert.equal(
      bashContentDenyRequests.length,
      2,
      'Bash content-specific deny run should make tool_use and final requests',
    )
    const bashContentDenyResultBlocks = requestContentBlocks(
      bashContentDenyRequests[1],
      'tool_result',
    )
    assert(
      bashContentDenyResultBlocks.some(block => {
        const content = textFromContent(block.content)
        return (
          typeof block.tool_use_id === 'string' &&
          block.tool_use_id.startsWith('toolu_cli_bash_content_deny_') &&
          block.is_error === true &&
          content.includes('Permission to use Bash') &&
          content.includes('has been denied')
        )
      }),
      `Bash content-specific deny follow-up should include rule-denied tool_result: ${JSON.stringify(bashContentDenyResultBlocks, null, 2)}`,
    )
    const bashContentDenyFileExists = await stat(
      bashContentDenyFilePath,
    ).then(
      () => true,
      () => false,
    )
    assert.equal(
      bashContentDenyFileExists,
      false,
      'Bash content-specific deny should not create the denied file',
    )

    const bashContentAskConfigDir = await mkdtemp(
      join(ARTIFACT_DIR, 'cli-bash-content-ask-config-'),
    )
    await writeFile(
      join(bashContentAskConfigDir, 'settings.json'),
      JSON.stringify(
        {
          permissions: {
            ask: ['Bash(echo:*)'],
          },
        },
        null,
        2,
      ),
      'utf8',
    )
    const bashContentAskEnv = {
      ...env,
      CLAUDE_CONFIG_DIR: bashContentAskConfigDir,
    }
    const beforeBashContentAskRequests = server.requests.length
    const bashContentAskRun = parseJsonOutput(
      (
        await runCli(
          [...bashSideEffectArgs, bashContentAskPrompt],
          bashContentAskEnv,
          runCliOptions(),
        )
      ).stdout,
    )
    assert.equal(
      bashContentAskRun.is_error,
      false,
      'Bash content-specific ask run should complete after model final response',
    )
    assert.equal(
      bashContentAskRun.result,
      bashContentAskFinalResponse,
      'Bash content-specific ask final response',
    )
    const bashContentAskRequests = server.requests
      .slice(beforeBashContentAskRequests)
      .filter(request => {
        return request.path.endsWith('/messages') && request.body.stream === true
      })
    assert.equal(
      bashContentAskRequests.length,
      2,
      'Bash content-specific ask run should make tool_use and final requests',
    )
    const bashContentAskResultBlocks = requestContentBlocks(
      bashContentAskRequests[1],
      'tool_result',
    )
    assert(
      bashContentAskResultBlocks.some(block => {
        const content = textFromContent(block.content)
        return (
          typeof block.tool_use_id === 'string' &&
          block.tool_use_id.startsWith('toolu_cli_bash_content_ask_') &&
          block.is_error === true &&
          content.includes('Claude requested permissions to use Bash') &&
          content.includes("haven't granted it yet")
        )
      }),
      `Bash content-specific ask follow-up should include approval-required tool_result: ${JSON.stringify(bashContentAskResultBlocks, null, 2)}`,
    )
    const bashContentAskFileExists = await stat(bashContentAskFilePath).then(
      () => true,
      () => false,
    )
    assert.equal(
      bashContentAskFileExists,
      false,
      'Bash content-specific ask should not create the unapproved file',
    )

    const projectBashContentDenyCwd = await mkdtemp(
      join(ARTIFACT_DIR, 'cli-project-bash-content-deny-cwd-'),
    )
    await mkdir(join(projectBashContentDenyCwd, '.claude'), {
      recursive: true,
    })
    await writeFile(
      join(projectBashContentDenyCwd, '.claude', 'settings.json'),
      JSON.stringify(
        {
          permissions: {
            deny: ['Bash(echo:*)'],
          },
        },
        null,
        2,
      ),
      'utf8',
    )
    projectBashContentDenyFilePath = join(
      projectBashContentDenyCwd,
      projectBashContentDenyRelativePath,
    )
    const projectBashContentDenyConfigDir = await mkdtemp(
      join(ARTIFACT_DIR, 'cli-project-bash-content-deny-config-'),
    )
    const projectBashContentDenyEnv = {
      ...env,
      CLAUDE_CONFIG_DIR: projectBashContentDenyConfigDir,
    }
    const beforeProjectBashContentDenyRequests = server.requests.length
    const projectBashContentDenyRun = parseJsonOutput(
      (
        await runCli(
          [...bashSideEffectArgs, projectBashContentDenyPrompt],
          projectBashContentDenyEnv,
          {
            ...runCliOptions(),
            cwd: projectBashContentDenyCwd,
          },
        )
      ).stdout,
    )
    assert.equal(
      projectBashContentDenyRun.is_error,
      false,
      'Project Bash content-specific deny run should complete after model final response',
    )
    assert.equal(
      projectBashContentDenyRun.result,
      projectBashContentDenyFinalResponse,
      'Project Bash content-specific deny final response',
    )
    const projectBashContentDenyRequests = server.requests
      .slice(beforeProjectBashContentDenyRequests)
      .filter(request => {
        return request.path.endsWith('/messages') && request.body.stream === true
      })
    assert.equal(
      projectBashContentDenyRequests.length,
      2,
      'Project Bash content-specific deny run should make tool_use and final requests',
    )
    const projectBashContentDenyResultBlocks = requestContentBlocks(
      projectBashContentDenyRequests[1],
      'tool_result',
    )
    assert(
      projectBashContentDenyResultBlocks.some(block => {
        const content = textFromContent(block.content)
        return (
          typeof block.tool_use_id === 'string' &&
          block.tool_use_id.startsWith(
            'toolu_cli_project_bash_content_deny_',
          ) &&
          block.is_error === true &&
          content.includes('Permission to use Bash') &&
          content.includes('has been denied')
        )
      }),
      `Project Bash content-specific deny follow-up should include rule-denied tool_result: ${JSON.stringify(projectBashContentDenyResultBlocks, null, 2)}`,
    )
    const projectBashContentDenyFileExists = await stat(
      projectBashContentDenyFilePath,
    ).then(
      () => true,
      () => false,
    )
    assert.equal(
      projectBashContentDenyFileExists,
      false,
      'Project Bash content-specific deny should not create the denied file',
    )

    const projectBashContentAskCwd = await mkdtemp(
      join(ARTIFACT_DIR, 'cli-project-bash-content-ask-cwd-'),
    )
    await mkdir(join(projectBashContentAskCwd, '.claude'), {
      recursive: true,
    })
    await writeFile(
      join(projectBashContentAskCwd, '.claude', 'settings.json'),
      JSON.stringify(
        {
          permissions: {
            ask: ['Bash(echo:*)'],
          },
        },
        null,
        2,
      ),
      'utf8',
    )
    projectBashContentAskFilePath = join(
      projectBashContentAskCwd,
      projectBashContentAskRelativePath,
    )
    const projectBashContentAskConfigDir = await mkdtemp(
      join(ARTIFACT_DIR, 'cli-project-bash-content-ask-config-'),
    )
    const projectBashContentAskEnv = {
      ...env,
      CLAUDE_CONFIG_DIR: projectBashContentAskConfigDir,
    }
    const beforeProjectBashContentAskRequests = server.requests.length
    const projectBashContentAskRun = parseJsonOutput(
      (
        await runCli(
          [...bashSideEffectArgs, projectBashContentAskPrompt],
          projectBashContentAskEnv,
          {
            ...runCliOptions(),
            cwd: projectBashContentAskCwd,
          },
        )
      ).stdout,
    )
    assert.equal(
      projectBashContentAskRun.is_error,
      false,
      'Project Bash content-specific ask run should complete after model final response',
    )
    assert.equal(
      projectBashContentAskRun.result,
      projectBashContentAskFinalResponse,
      'Project Bash content-specific ask final response',
    )
    const projectBashContentAskRequests = server.requests
      .slice(beforeProjectBashContentAskRequests)
      .filter(request => {
        return request.path.endsWith('/messages') && request.body.stream === true
      })
    assert.equal(
      projectBashContentAskRequests.length,
      2,
      'Project Bash content-specific ask run should make tool_use and final requests',
    )
    const projectBashContentAskResultBlocks = requestContentBlocks(
      projectBashContentAskRequests[1],
      'tool_result',
    )
    assert(
      projectBashContentAskResultBlocks.some(block => {
        const content = textFromContent(block.content)
        return (
          typeof block.tool_use_id === 'string' &&
          block.tool_use_id.startsWith(
            'toolu_cli_project_bash_content_ask_',
          ) &&
          block.is_error === true &&
          content.includes('Claude requested permissions to use Bash') &&
          content.includes("haven't granted it yet")
        )
      }),
      `Project Bash content-specific ask follow-up should include approval-required tool_result: ${JSON.stringify(projectBashContentAskResultBlocks, null, 2)}`,
    )
    const projectBashContentAskFileExists = await stat(
      projectBashContentAskFilePath,
    ).then(
      () => true,
      () => false,
    )
    assert.equal(
      projectBashContentAskFileExists,
      false,
      'Project Bash content-specific ask should not create the unapproved file',
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

    const beforeEditUnreadRequests = server.requests.length
    const editUnreadArgs = [
      '--bare',
      '--print',
      '--output-format',
      'json',
      '--max-turns',
      '2',
      '--strict-mcp-config',
      '--tools',
      'Edit',
      '--allowedTools',
      'Edit',
      '--model',
      'sonnet',
    ]
    const editUnreadRun = parseJsonOutput(
      (
        await runCli(
          [...editUnreadArgs, editUnreadPrompt],
          env,
          runCliOptions(),
        )
      ).stdout,
    )
    assert.equal(
      editUnreadRun.is_error,
      false,
      'Unread Edit rejection run should complete after model final response',
    )
    assert.equal(
      editUnreadRun.result,
      editUnreadFinalResponse,
      'Unread Edit rejection final response',
    )
    const editUnreadRequests = server.requests
      .slice(beforeEditUnreadRequests)
      .filter(request => {
        return request.path.endsWith('/messages') && request.body.stream === true
      })
    assert.equal(
      editUnreadRequests.length,
      2,
      'Unread Edit rejection run should make tool_use and final requests',
    )
    const editUnreadResultBlocks = requestContentBlocks(
      editUnreadRequests[1],
      'tool_result',
    )
    assert(
      editUnreadResultBlocks.some(block => {
        return (
          typeof block.tool_use_id === 'string' &&
          block.tool_use_id.startsWith('toolu_cli_edit_unread_') &&
          block.is_error === true &&
          typeof block.content === 'string' &&
          block.content.includes('File has not been read yet')
        )
      }),
      'Unread Edit follow-up should include read-before-write error result',
    )
    assert.equal(
      await readFile(editUnreadFilePath, 'utf8'),
      `${editUnreadOriginalContent}\n`,
      'Unread Edit rejection should leave the existing file unchanged',
    )

    const beforeEditStaleRequests = server.requests.length
    const editStaleArgs = [
      '--bare',
      '--print',
      '--output-format',
      'json',
      '--max-turns',
      '3',
      '--strict-mcp-config',
      '--tools',
      'Read,Edit',
      '--permission-mode',
      'acceptEdits',
      '--model',
      'sonnet',
    ]
    const editStaleRun = parseJsonOutput(
      (
        await runCli(
          [...editStaleArgs, editStalePrompt],
          env,
          runCliOptions(),
        )
      ).stdout,
    )
    assert.equal(
      editStaleRun.is_error,
      false,
      'Stale Edit rejection run should complete after model final response',
    )
    assert.equal(
      editStaleRun.result,
      editStaleFinalResponse,
      'Stale Edit rejection final response',
    )
    const editStaleRequests = server.requests
      .slice(beforeEditStaleRequests)
      .filter(request => {
        return request.path.endsWith('/messages') && request.body.stream === true
      })
    assert.equal(
      editStaleRequests.length,
      3,
      'Stale Edit rejection run should make Read, Edit, and final requests',
    )
    const editStaleReadFollowUpTexts = requestTexts(editStaleRequests[1])
    assert(
      containsText(editStaleReadFollowUpTexts, editStaleOriginalContent),
      'Stale Edit follow-up request should include Read file content before external modification',
    )
    const editStaleResultBlocks = requestContentBlocks(
      editStaleRequests[2],
      'tool_result',
    )
    assert(
      editStaleResultBlocks.some(block => {
        return (
          typeof block.tool_use_id === 'string' &&
          block.tool_use_id.startsWith('toolu_cli_edit_stale_') &&
          block.is_error === true &&
          typeof block.content === 'string' &&
          block.content.includes('modified since read')
        )
      }),
      'Stale Edit follow-up should include modified-since-read error result',
    )
    assert.equal(
      await readFile(editStaleFilePath, 'utf8'),
      `${editStaleExternalContent}\n`,
      'Stale Edit rejection should preserve the external modification',
    )

    const beforeEditDenyRequests = server.requests.length
    const editDenyArgs = [
      '--bare',
      '--print',
      '--output-format',
      'json',
      '--max-turns',
      '3',
      '--strict-mcp-config',
      '--tools',
      'Read,Edit',
      '--permission-mode',
      'acceptEdits',
      '--disallowedTools',
      'Edit',
      '--model',
      'sonnet',
    ]
    const editDenyRun = parseJsonOutput(
      (
        await runCli(
          [...editDenyArgs, editDenyPrompt],
          env,
          runCliOptions(),
        )
      ).stdout,
    )
    assert.equal(
      editDenyRun.is_error,
      false,
      'Edit permission deny run should complete after model final response',
    )
    assert.equal(
      editDenyRun.result,
      editDenyFinalResponse,
      'Edit permission deny final response',
    )
    const editDenyRequests = server.requests
      .slice(beforeEditDenyRequests)
      .filter(request => {
        return request.path.endsWith('/messages') && request.body.stream === true
      })
    assert.equal(
      editDenyRequests.length,
      3,
      'Edit permission deny run should make Read, Edit, and final requests',
    )
    const editDenyReadFollowUpTexts = requestTexts(editDenyRequests[1])
    assert(
      containsText(editDenyReadFollowUpTexts, editDenyOriginalContent),
      'Edit permission deny follow-up should include Read file content',
    )
    const editDenyResultBlocks = requestContentBlocks(
      editDenyRequests[2],
      'tool_result',
    )
    assert(
      editDenyResultBlocks.some(block => {
        return (
          typeof block.tool_use_id === 'string' &&
          block.tool_use_id.startsWith('toolu_cli_edit_deny_') &&
          block.is_error === true &&
          typeof block.content === 'string' &&
          block.content.includes('No such tool available: Edit')
        )
      }),
      'Edit permission deny follow-up should include disabled-tool error result',
    )
    assert.equal(
      await readFile(editDenyFilePath, 'utf8'),
      `${editDenyOriginalContent}\n`,
      'Edit permission deny should leave the file unchanged',
    )

    const editContentDenyConfigDir = await mkdtemp(
      join(ARTIFACT_DIR, 'cli-edit-content-deny-config-'),
    )
    await writeFile(
      join(editContentDenyConfigDir, 'settings.json'),
      JSON.stringify(
        {
          permissions: {
            deny: [`Edit(${editContentDenyRelativePath})`],
          },
        },
        null,
        2,
      ),
      'utf8',
    )
    const editContentDenyEnv = {
      ...env,
      CLAUDE_CONFIG_DIR: editContentDenyConfigDir,
    }
    const editContentRuleArgs = [
      '--bare',
      '--print',
      '--output-format',
      'json',
      '--max-turns',
      '2',
      '--strict-mcp-config',
      '--tools',
      'Edit',
      '--permission-mode',
      'acceptEdits',
      '--model',
      'sonnet',
    ]
    const beforeEditContentDenyRequests = server.requests.length
    const editContentDenyRun = parseJsonOutput(
      (
        await runCli(
          [...editContentRuleArgs, editContentDenyPrompt],
          editContentDenyEnv,
          runCliOptions(),
        )
      ).stdout,
    )
    assert.equal(
      editContentDenyRun.is_error,
      false,
      'Edit content-specific deny run should complete after model final response',
    )
    assert.equal(
      editContentDenyRun.result,
      editContentDenyFinalResponse,
      'Edit content-specific deny final response',
    )
    const editContentDenyRequests = server.requests
      .slice(beforeEditContentDenyRequests)
      .filter(request => {
        return request.path.endsWith('/messages') && request.body.stream === true
      })
    assert.equal(
      editContentDenyRequests.length,
      2,
      'Edit content-specific deny run should make tool_use and final requests',
    )
    const editContentDenyResultBlocks = requestContentBlocks(
      editContentDenyRequests[1],
      'tool_result',
    )
    assert(
      editContentDenyResultBlocks.some(block => {
        return (
          typeof block.tool_use_id === 'string' &&
          block.tool_use_id.startsWith('toolu_cli_edit_content_deny_') &&
          block.is_error === true &&
          typeof block.content === 'string' &&
          block.content.includes(
            'File is in a directory that is denied by your permission settings',
          )
        )
      }),
      `Edit content-specific deny follow-up should include path-denied tool_result: ${JSON.stringify(editContentDenyResultBlocks, null, 2)}`,
    )
    assert.equal(
      await readFile(editContentDenyFilePath, 'utf8'),
      `${editContentDenyOriginalContent}\n`,
      'Edit content-specific deny should leave the file unchanged',
    )

    const editContentAskConfigDir = await mkdtemp(
      join(ARTIFACT_DIR, 'cli-edit-content-ask-config-'),
    )
    await writeFile(
      join(editContentAskConfigDir, 'settings.json'),
      JSON.stringify(
        {
          permissions: {
            ask: [`Edit(${editContentAskRelativePath})`],
          },
        },
        null,
        2,
      ),
      'utf8',
    )
    const editContentAskEnv = {
      ...env,
      CLAUDE_CONFIG_DIR: editContentAskConfigDir,
    }
    const beforeEditContentAskRequests = server.requests.length
    const editContentAskRun = parseJsonOutput(
      (
        await runCli(
          [...editContentRuleArgs, editContentAskPrompt],
          editContentAskEnv,
          runCliOptions(),
        )
      ).stdout,
    )
    assert.equal(
      editContentAskRun.is_error,
      false,
      'Edit content-specific ask run should complete after model final response',
    )
    assert.equal(
      editContentAskRun.result,
      editContentAskFinalResponse,
      'Edit content-specific ask final response',
    )
    const editContentAskRequests = server.requests
      .slice(beforeEditContentAskRequests)
      .filter(request => {
        return request.path.endsWith('/messages') && request.body.stream === true
      })
    assert.equal(
      editContentAskRequests.length,
      2,
      'Edit content-specific ask run should make tool_use and final requests',
    )
    const editContentAskResultBlocks = requestContentBlocks(
      editContentAskRequests[1],
      'tool_result',
    )
    assert(
      editContentAskResultBlocks.some(block => {
        return (
          typeof block.tool_use_id === 'string' &&
          block.tool_use_id.startsWith('toolu_cli_edit_content_ask_') &&
          block.is_error === true &&
          typeof block.content === 'string' &&
          block.content.includes('Claude requested permissions to write to') &&
          block.content.includes("haven't granted it yet")
        )
      }),
      `Edit content-specific ask follow-up should include approval-required tool_result: ${JSON.stringify(editContentAskResultBlocks, null, 2)}`,
    )
    const editContentAskFileExists = await stat(editContentAskFilePath).then(
      () => true,
      () => false,
    )
    assert.equal(
      editContentAskFileExists,
      false,
      'Edit content-specific ask should not create the unapproved file',
    )

    const beforeEditReplaceAllRequests = server.requests.length
    const editReplaceAllRun = parseJsonOutput(
      (
        await runCli(
          [...editToolArgs, editReplaceAllPrompt],
          env,
          runCliOptions(),
        )
      ).stdout,
    )
    assert.equal(
      editReplaceAllRun.is_error,
      false,
      'Edit replace_all run should complete after model final response',
    )
    assert.equal(
      editReplaceAllRun.result,
      editReplaceAllFinalResponse,
      'Edit replace_all final response',
    )
    const editReplaceAllRequests = server.requests
      .slice(beforeEditReplaceAllRequests)
      .filter(request => {
        return request.path.endsWith('/messages') && request.body.stream === true
      })
    assert.equal(
      editReplaceAllRequests.length,
      3,
      'Edit replace_all run should make Read, Edit, and final requests',
    )
    const editReplaceAllBlocks = requestContentBlocks(
      editReplaceAllRequests[2],
      'tool_result',
    )
    assert(
      editReplaceAllBlocks.some(block => {
        return (
          typeof block.tool_use_id === 'string' &&
          block.tool_use_id.startsWith('toolu_cli_edit_replace_all_') &&
          block.is_error !== true
        )
      }),
      'Edit replace_all follow-up should include successful Edit tool_result',
    )
    assert.equal(
      await readFile(editReplaceAllFilePath, 'utf8'),
      `${editReplaceAllUpdatedContent}\n`,
      'Edit replace_all should update every occurrence on disk',
    )

    const beforeEditMultiMatchRequests = server.requests.length
    const editMultiMatchRun = parseJsonOutput(
      (
        await runCli(
          [...editToolArgs, editMultiMatchPrompt],
          env,
          runCliOptions(),
        )
      ).stdout,
    )
    assert.equal(
      editMultiMatchRun.is_error,
      false,
      'Edit multi-match rejection run should complete after model final response',
    )
    assert.equal(
      editMultiMatchRun.result,
      editMultiMatchFinalResponse,
      'Edit multi-match rejection final response',
    )
    const editMultiMatchRequests = server.requests
      .slice(beforeEditMultiMatchRequests)
      .filter(request => {
        return request.path.endsWith('/messages') && request.body.stream === true
      })
    assert.equal(
      editMultiMatchRequests.length,
      3,
      'Edit multi-match rejection should make Read, Edit, and final requests',
    )
    const editMultiMatchBlocks = requestContentBlocks(
      editMultiMatchRequests[2],
      'tool_result',
    )
    assert(
      editMultiMatchBlocks.some(block => {
        return (
          typeof block.tool_use_id === 'string' &&
          block.tool_use_id.startsWith('toolu_cli_edit_multi_match_') &&
          block.is_error === true &&
          typeof block.content === 'string' &&
          block.content.includes('replace_all is false')
        )
      }),
      'Edit multi-match follow-up should include replace_all guidance error',
    )
    assert.equal(
      await readFile(editMultiMatchFilePath, 'utf8'),
      `${editMultiMatchOriginalContent}\n`,
      'Edit multi-match rejection should leave the file unchanged',
    )

    const beforeEditCreateRequests = server.requests.length
    const editCreateArgs = [
      '--bare',
      '--print',
      '--output-format',
      'json',
      '--max-turns',
      '2',
      '--strict-mcp-config',
      '--tools',
      'Edit',
      '--permission-mode',
      'acceptEdits',
      '--model',
      'sonnet',
    ]
    const editCreateRun = parseJsonOutput(
      (
        await runCli(
          [...editCreateArgs, editCreatePrompt],
          env,
          runCliOptions(),
        )
      ).stdout,
    )
    assert.equal(
      editCreateRun.is_error,
      false,
      'Edit create-file run should complete after model final response',
    )
    assert.equal(
      editCreateRun.result,
      editCreateFinalResponse,
      'Edit create-file final response',
    )
    const editCreateRequests = server.requests
      .slice(beforeEditCreateRequests)
      .filter(request => {
        return request.path.endsWith('/messages') && request.body.stream === true
      })
    assert.equal(
      editCreateRequests.length,
      2,
      'Edit create-file run should make Edit and final requests',
    )
    const editCreateBlocks = requestContentBlocks(
      editCreateRequests[1],
      'tool_result',
    )
    assert(
      editCreateBlocks.some(block => {
        return (
          typeof block.tool_use_id === 'string' &&
          block.tool_use_id.startsWith('toolu_cli_edit_create_') &&
          block.is_error !== true
        )
      }),
      'Edit create-file follow-up should include successful Edit tool_result',
    )
    assert.equal(
      await readFile(editCreateFilePath, 'utf8'),
      `${editCreateContent}\n`,
      'Edit create-file should create the fixture file on disk',
    )

    const beforeEditCrlfRequests = server.requests.length
    const editCrlfRun = parseJsonOutput(
      (
        await runCli(
          [...editToolArgs, editCrlfPrompt],
          env,
          runCliOptions(),
        )
      ).stdout,
    )
    assert.equal(
      editCrlfRun.is_error,
      false,
      'Edit CRLF preservation run should complete after model final response',
    )
    assert.equal(
      editCrlfRun.result,
      editCrlfFinalResponse,
      'Edit CRLF preservation final response',
    )
    const editCrlfRequests = server.requests
      .slice(beforeEditCrlfRequests)
      .filter(request => {
        return request.path.endsWith('/messages') && request.body.stream === true
      })
    assert.equal(
      editCrlfRequests.length,
      3,
      'Edit CRLF preservation run should make Read, Edit, and final requests',
    )
    const editCrlfReadFollowUpTexts = requestTexts(editCrlfRequests[1])
    assert(
      containsText(editCrlfReadFollowUpTexts, 'edit crlf fixture: before-6142'),
      'Edit CRLF preservation follow-up should include Read file content',
    )
    const editCrlfBlocks = requestContentBlocks(
      editCrlfRequests[2],
      'tool_result',
    )
    assert(
      editCrlfBlocks.some(block => {
        return (
          typeof block.tool_use_id === 'string' &&
          block.tool_use_id.startsWith('toolu_cli_edit_crlf_') &&
          block.is_error !== true
        )
      }),
      'Edit CRLF preservation follow-up should include successful Edit tool_result',
    )
    assert.equal(
      await readFile(editCrlfFilePath, 'utf8'),
      editCrlfUpdatedContent,
      'Edit should preserve CRLF line endings on disk',
    )

    const beforeEditMixedLineEndingsRequests = server.requests.length
    const editMixedLineEndingsRun = parseJsonOutput(
      (
        await runCli(
          [...editToolArgs, editMixedLineEndingsPrompt],
          env,
          runCliOptions(),
        )
      ).stdout,
    )
    assert.equal(
      editMixedLineEndingsRun.is_error,
      false,
      'Edit mixed line ending preservation run should complete after model final response',
    )
    assert.equal(
      editMixedLineEndingsRun.result,
      editMixedLineEndingsFinalResponse,
      'Edit mixed line ending preservation final response',
    )
    const editMixedLineEndingsRequests = server.requests
      .slice(beforeEditMixedLineEndingsRequests)
      .filter(request => {
        return request.path.endsWith('/messages') && request.body.stream === true
      })
    assert.equal(
      editMixedLineEndingsRequests.length,
      3,
      'Edit mixed line ending preservation run should make Read, Edit, and final requests',
    )
    const editMixedLineEndingsBlocks = requestContentBlocks(
      editMixedLineEndingsRequests[2],
      'tool_result',
    )
    assert(
      editMixedLineEndingsBlocks.some(block => {
        return (
          typeof block.tool_use_id === 'string' &&
          block.tool_use_id.startsWith('toolu_cli_edit_mixed_eol_') &&
          block.is_error !== true
        )
      }),
      'Edit mixed line ending preservation follow-up should include successful Edit tool_result',
    )
    assert.equal(
      await readFile(editMixedLineEndingsFilePath, 'utf8'),
      editMixedLineEndingsUpdatedContent,
      'Edit should preserve mixed CRLF/LF line endings on disk',
    )

    const beforeEditUtf16Requests = server.requests.length
    const editUtf16Run = parseJsonOutput(
      (
        await runCli(
          [...editToolArgs, editUtf16Prompt],
          env,
          runCliOptions(),
        )
      ).stdout,
    )
    assert.equal(
      editUtf16Run.is_error,
      false,
      'Edit UTF-16LE preservation run should complete after model final response',
    )
    assert.equal(
      editUtf16Run.result,
      editUtf16FinalResponse,
      'Edit UTF-16LE preservation final response',
    )
    const editUtf16Requests = server.requests
      .slice(beforeEditUtf16Requests)
      .filter(request => {
        return request.path.endsWith('/messages') && request.body.stream === true
      })
    assert.equal(
      editUtf16Requests.length,
      3,
      'Edit UTF-16LE preservation run should make Read, Edit, and final requests',
    )
    const editUtf16Blocks = requestContentBlocks(
      editUtf16Requests[2],
      'tool_result',
    )
    assert(
      editUtf16Blocks.some(block => {
        return (
          typeof block.tool_use_id === 'string' &&
          block.tool_use_id.startsWith('toolu_cli_edit_utf16_') &&
          block.is_error !== true
        )
      }),
      'Edit UTF-16LE preservation follow-up should include successful Edit tool_result',
    )
    const editUtf16Bytes = await readFile(editUtf16FilePath)
    assert.equal(
      editUtf16Bytes[0],
      0xff,
      'Edit UTF-16LE preservation should keep FF BOM byte',
    )
    assert.equal(
      editUtf16Bytes[1],
      0xfe,
      'Edit UTF-16LE preservation should keep FE BOM byte',
    )
    assert.equal(
      editUtf16Bytes.toString('utf16le'),
      editUtf16UpdatedContent,
      'Edit should preserve UTF-16LE BOM encoding on disk',
    )

    const beforeEditUtf8BomRequests = server.requests.length
    const editUtf8BomRun = parseJsonOutput(
      (
        await runCli(
          [...editToolArgs, editUtf8BomPrompt],
          env,
          runCliOptions(),
        )
      ).stdout,
    )
    assert.equal(
      editUtf8BomRun.is_error,
      false,
      'Edit UTF-8 BOM preservation run should complete after model final response',
    )
    assert.equal(
      editUtf8BomRun.result,
      editUtf8BomFinalResponse,
      'Edit UTF-8 BOM preservation final response',
    )
    const editUtf8BomRequests = server.requests
      .slice(beforeEditUtf8BomRequests)
      .filter(request => {
        return request.path.endsWith('/messages') && request.body.stream === true
      })
    assert.equal(
      editUtf8BomRequests.length,
      3,
      'Edit UTF-8 BOM preservation run should make Read, Edit, and final requests',
    )
    const editUtf8BomBlocks = requestContentBlocks(
      editUtf8BomRequests[2],
      'tool_result',
    )
    assert(
      editUtf8BomBlocks.some(block => {
        return (
          typeof block.tool_use_id === 'string' &&
          block.tool_use_id.startsWith('toolu_cli_edit_utf8_bom_') &&
          block.is_error !== true
        )
      }),
      'Edit UTF-8 BOM preservation follow-up should include successful Edit tool_result',
    )
    const editUtf8BomBytes = await readFile(editUtf8BomFilePath)
    assert.equal(
      editUtf8BomBytes[0],
      0xef,
      'Edit UTF-8 BOM preservation should keep EF BOM byte',
    )
    assert.equal(
      editUtf8BomBytes[1],
      0xbb,
      'Edit UTF-8 BOM preservation should keep BB BOM byte',
    )
    assert.equal(
      editUtf8BomBytes[2],
      0xbf,
      'Edit UTF-8 BOM preservation should keep BF BOM byte',
    )
    assert.equal(
      editUtf8BomBytes.toString('utf8'),
      editUtf8BomUpdatedContent,
      'Edit should preserve UTF-8 BOM on disk',
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

    const beforeWriteCrlfRequests = server.requests.length
    const writeCrlfRun = parseJsonOutput(
      (
        await runCli(
          [...writeToolArgs, writeCrlfPrompt],
          env,
          runCliOptions(),
        )
      ).stdout,
    )
    assert.equal(
      writeCrlfRun.is_error,
      false,
      'Write CRLF create run should succeed',
    )
    assert.equal(
      writeCrlfRun.result,
      writeCrlfFinalResponse,
      'Write CRLF final response',
    )
    const writeCrlfRequests = server.requests
      .slice(beforeWriteCrlfRequests)
      .filter(request => {
        return request.path.endsWith('/messages') && request.body.stream === true
      })
    assert.equal(
      writeCrlfRequests.length,
      2,
      'Write CRLF run should make tool_use and follow-up requests',
    )
    const writeCrlfResultBlocks = requestContentBlocks(
      writeCrlfRequests[1],
      'tool_result',
    )
    assert(
      writeCrlfResultBlocks.some(block => {
        return (
          typeof block.tool_use_id === 'string' &&
          block.tool_use_id.startsWith('toolu_cli_write_crlf_') &&
          block.is_error !== true
        )
      }),
      'Write CRLF follow-up request should include successful Write tool_result',
    )
    assert.equal(
      await readFile(writeCrlfFilePath, 'utf8'),
      writeCrlfContent,
      'Write tool should preserve CRLF content on disk',
    )

    const beforeWriteMixedLineEndingsRequests = server.requests.length
    const writeMixedLineEndingsRun = parseJsonOutput(
      (
        await runCli(
          [...writeToolArgs, writeMixedLineEndingsPrompt],
          env,
          runCliOptions(),
        )
      ).stdout,
    )
    assert.equal(
      writeMixedLineEndingsRun.is_error,
      false,
      'Write mixed line endings create run should succeed',
    )
    assert.equal(
      writeMixedLineEndingsRun.result,
      writeMixedLineEndingsFinalResponse,
      'Write mixed line endings final response',
    )
    const writeMixedLineEndingsRequests = server.requests
      .slice(beforeWriteMixedLineEndingsRequests)
      .filter(request => {
        return request.path.endsWith('/messages') && request.body.stream === true
      })
    assert.equal(
      writeMixedLineEndingsRequests.length,
      2,
      'Write mixed line endings run should make tool_use and follow-up requests',
    )
    const writeMixedLineEndingsResultBlocks = requestContentBlocks(
      writeMixedLineEndingsRequests[1],
      'tool_result',
    )
    assert(
      writeMixedLineEndingsResultBlocks.some(block => {
        return (
          typeof block.tool_use_id === 'string' &&
          block.tool_use_id.startsWith('toolu_cli_write_mixed_eol_') &&
          block.is_error !== true
        )
      }),
      'Write mixed line endings follow-up request should include successful Write tool_result',
    )
    assert.equal(
      await readFile(writeMixedLineEndingsFilePath, 'utf8'),
      writeMixedLineEndingsContent,
      'Write tool should preserve mixed CRLF/LF content on disk',
    )

    const beforeWriteUpdateRequests = server.requests.length
    const writeUpdateArgs = [
      '--bare',
      '--print',
      '--output-format',
      'json',
      '--max-turns',
      '3',
      '--strict-mcp-config',
      '--tools',
      'Read,Write',
      '--permission-mode',
      'acceptEdits',
      '--model',
      'sonnet',
    ]
    const writeUpdateRun = parseJsonOutput(
      (
        await runCli(
          [...writeUpdateArgs, writeUpdatePrompt],
          env,
          runCliOptions(),
        )
      ).stdout,
    )
    assert.equal(
      writeUpdateRun.is_error,
      false,
      'Read then Write update run should succeed',
    )
    assert.equal(
      writeUpdateRun.result,
      writeUpdateFinalResponse,
      'Read then Write update final response',
    )
    const writeUpdateRequests = server.requests
      .slice(beforeWriteUpdateRequests)
      .filter(request => {
        return request.path.endsWith('/messages') && request.body.stream === true
      })
    assert.equal(
      writeUpdateRequests.length,
      3,
      'Read then Write update run should make Read, Write, and final requests',
    )
    const writeUpdateReadFollowUpTexts = requestTexts(writeUpdateRequests[1])
    assert(
      containsText(writeUpdateReadFollowUpTexts, writeUpdateOriginalContent),
      'Write update follow-up request should include Read file content',
    )
    const writeUpdateResultBlocks = requestContentBlocks(
      writeUpdateRequests[2],
      'tool_result',
    )
    assert(
      writeUpdateResultBlocks.some(block => {
        return (
          typeof block.tool_use_id === 'string' &&
          block.tool_use_id.startsWith('toolu_cli_write_update_') &&
          typeof block.content === 'string' &&
          block.content.includes('has been updated successfully')
        )
      }),
      'final follow-up request should include Write update tool_result content',
    )
    assert.equal(
      await readFile(writeUpdateFilePath, 'utf8'),
      `${writeUpdateUpdatedContent}\n`,
      'Write tool should update the existing fixture file on disk',
    )

    const beforeWriteUtf16Requests = server.requests.length
    const writeUtf16Run = parseJsonOutput(
      (
        await runCli(
          [...writeUpdateArgs, writeUtf16Prompt],
          env,
          runCliOptions(),
        )
      ).stdout,
    )
    assert.equal(
      writeUtf16Run.is_error,
      false,
      'Write UTF-16LE overwrite run should complete after model final response',
    )
    assert.equal(
      writeUtf16Run.result,
      writeUtf16FinalResponse,
      'Write UTF-16LE overwrite final response',
    )
    const writeUtf16Requests = server.requests
      .slice(beforeWriteUtf16Requests)
      .filter(request => {
        return request.path.endsWith('/messages') && request.body.stream === true
      })
    assert.equal(
      writeUtf16Requests.length,
      3,
      'Write UTF-16LE overwrite run should make Read, Write, and final requests',
    )
    const writeUtf16ResultBlocks = requestContentBlocks(
      writeUtf16Requests[2],
      'tool_result',
    )
    assert(
      writeUtf16ResultBlocks.some(block => {
        return (
          typeof block.tool_use_id === 'string' &&
          block.tool_use_id.startsWith('toolu_cli_write_utf16_') &&
          block.is_error !== true
        )
      }),
      'Write UTF-16LE overwrite follow-up should include successful Write tool_result',
    )
    const writeUtf16Bytes = await readFile(writeUtf16FilePath)
    assert.equal(
      writeUtf16Bytes[0],
      0xff,
      'Write UTF-16LE overwrite should keep FF BOM byte',
    )
    assert.equal(
      writeUtf16Bytes[1],
      0xfe,
      'Write UTF-16LE overwrite should keep FE BOM byte',
    )
    assert.equal(
      writeUtf16Bytes.toString('utf16le'),
      writeUtf16UpdatedContent,
      'Write should preserve UTF-16LE BOM encoding on disk',
    )

    const beforeWriteUtf8BomRequests = server.requests.length
    const writeUtf8BomRun = parseJsonOutput(
      (
        await runCli(
          [...writeUpdateArgs, writeUtf8BomPrompt],
          env,
          runCliOptions(),
        )
      ).stdout,
    )
    assert.equal(
      writeUtf8BomRun.is_error,
      false,
      'Write UTF-8 BOM overwrite run should complete after model final response',
    )
    assert.equal(
      writeUtf8BomRun.result,
      writeUtf8BomFinalResponse,
      'Write UTF-8 BOM overwrite final response',
    )
    const writeUtf8BomRequests = server.requests
      .slice(beforeWriteUtf8BomRequests)
      .filter(request => {
        return request.path.endsWith('/messages') && request.body.stream === true
      })
    assert.equal(
      writeUtf8BomRequests.length,
      3,
      'Write UTF-8 BOM overwrite run should make Read, Write, and final requests',
    )
    const writeUtf8BomResultBlocks = requestContentBlocks(
      writeUtf8BomRequests[2],
      'tool_result',
    )
    assert(
      writeUtf8BomResultBlocks.some(block => {
        return (
          typeof block.tool_use_id === 'string' &&
          block.tool_use_id.startsWith('toolu_cli_write_utf8_bom_') &&
          block.is_error !== true
        )
      }),
      'Write UTF-8 BOM overwrite follow-up should include successful Write tool_result',
    )
    const writeUtf8BomBytes = await readFile(writeUtf8BomFilePath)
    assert.equal(
      writeUtf8BomBytes[0],
      0xef,
      'Write UTF-8 BOM overwrite should keep EF BOM byte',
    )
    assert.equal(
      writeUtf8BomBytes[1],
      0xbb,
      'Write UTF-8 BOM overwrite should keep BB BOM byte',
    )
    assert.equal(
      writeUtf8BomBytes[2],
      0xbf,
      'Write UTF-8 BOM overwrite should keep BF BOM byte',
    )
    assert.equal(
      writeUtf8BomBytes.toString('utf8'),
      writeUtf8BomUpdatedContent,
      'Write should preserve UTF-8 BOM on disk',
    )

    const beforeWriteUnreadRequests = server.requests.length
    const writeUnreadArgs = [
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
    const writeUnreadRun = parseJsonOutput(
      (
        await runCli(
          [...writeUnreadArgs, writeUnreadPrompt],
          env,
          runCliOptions(),
        )
      ).stdout,
    )
    assert.equal(
      writeUnreadRun.is_error,
      false,
      'Unread Write rejection run should complete after model final response',
    )
    assert.equal(
      writeUnreadRun.result,
      writeUnreadFinalResponse,
      'Unread Write rejection final response',
    )
    const writeUnreadRequests = server.requests
      .slice(beforeWriteUnreadRequests)
      .filter(request => {
        return request.path.endsWith('/messages') && request.body.stream === true
      })
    assert.equal(
      writeUnreadRequests.length,
      2,
      'Unread Write rejection run should make tool_use and final requests',
    )
    const writeUnreadResultBlocks = requestContentBlocks(
      writeUnreadRequests[1],
      'tool_result',
    )
    assert(
      writeUnreadResultBlocks.some(block => {
        return (
          typeof block.tool_use_id === 'string' &&
          block.tool_use_id.startsWith('toolu_cli_write_unread_') &&
          block.is_error === true &&
          typeof block.content === 'string' &&
          block.content.includes('File has not been read yet')
        )
      }),
      'Unread Write follow-up should include read-before-write error result',
    )
    assert.equal(
      await readFile(writeUnreadFilePath, 'utf8'),
      `${writeUnreadOriginalContent}\n`,
      'Unread Write rejection should leave the existing file unchanged',
    )

    const beforeWriteStaleRequests = server.requests.length
    const writeStaleArgs = [
      '--bare',
      '--print',
      '--output-format',
      'json',
      '--max-turns',
      '3',
      '--strict-mcp-config',
      '--tools',
      'Read,Write',
      '--permission-mode',
      'acceptEdits',
      '--model',
      'sonnet',
    ]
    const writeStaleRun = parseJsonOutput(
      (
        await runCli(
          [...writeStaleArgs, writeStalePrompt],
          env,
          runCliOptions(),
        )
      ).stdout,
    )
    assert.equal(
      writeStaleRun.is_error,
      false,
      'Stale Write rejection run should complete after model final response',
    )
    assert.equal(
      writeStaleRun.result,
      writeStaleFinalResponse,
      'Stale Write rejection final response',
    )
    const writeStaleRequests = server.requests
      .slice(beforeWriteStaleRequests)
      .filter(request => {
        return request.path.endsWith('/messages') && request.body.stream === true
      })
    assert.equal(
      writeStaleRequests.length,
      3,
      'Stale Write rejection run should make Read, Write, and final requests',
    )
    const writeStaleReadFollowUpTexts = requestTexts(writeStaleRequests[1])
    assert(
      containsText(writeStaleReadFollowUpTexts, writeStaleOriginalContent),
      'Stale Write follow-up request should include Read file content before external modification',
    )
    const writeStaleResultBlocks = requestContentBlocks(
      writeStaleRequests[2],
      'tool_result',
    )
    assert(
      writeStaleResultBlocks.some(block => {
        return (
          typeof block.tool_use_id === 'string' &&
          block.tool_use_id.startsWith('toolu_cli_write_stale_') &&
          block.is_error === true &&
          typeof block.content === 'string' &&
          block.content.includes('modified since read')
        )
      }),
      'Stale Write follow-up should include modified-since-read error result',
    )
    assert.equal(
      await readFile(writeStaleFilePath, 'utf8'),
      `${writeStaleExternalContent}\n`,
      'Stale Write rejection should preserve the external modification',
    )

    const beforeWriteDenyRequests = server.requests.length
    const writeDenyArgs = [
      '--bare',
      '--print',
      '--output-format',
      'json',
      '--max-turns',
      '2',
      '--strict-mcp-config',
      '--tools',
      'Write',
      '--disallowedTools',
      'Write',
      '--model',
      'sonnet',
    ]
    const writeDenyRun = parseJsonOutput(
      (
        await runCli(
          [...writeDenyArgs, writeDenyPrompt],
          env,
          runCliOptions(),
        )
      ).stdout,
    )
    assert.equal(
      writeDenyRun.is_error,
      false,
      'Write permission deny run should complete after model final response',
    )
    assert.equal(
      writeDenyRun.result,
      writeDenyFinalResponse,
      'Write permission deny final response',
    )
    const writeDenyRequests = server.requests
      .slice(beforeWriteDenyRequests)
      .filter(request => {
        return request.path.endsWith('/messages') && request.body.stream === true
      })
    assert.equal(
      writeDenyRequests.length,
      2,
      'Write permission deny run should make tool_use and final requests',
    )
    const writeDenyResultBlocks = requestContentBlocks(
      writeDenyRequests[1],
      'tool_result',
    )
    assert(
      writeDenyResultBlocks.some(block => {
        return (
          typeof block.tool_use_id === 'string' &&
          block.tool_use_id.startsWith('toolu_cli_write_deny_') &&
          block.is_error === true &&
          typeof block.content === 'string' &&
          block.content.includes('No such tool available: Write')
        )
      }),
      `Write permission deny follow-up should include explicit deny error result: ${JSON.stringify(writeDenyResultBlocks, null, 2)}`,
    )
    const writeDenyFileExists = await stat(writeDenyFilePath).then(
      () => true,
      () => false,
    )
    assert.equal(
      writeDenyFileExists,
      false,
      'Write permission deny should not create the denied file',
    )

    const writeContentDenyConfigDir = await mkdtemp(
      join(ARTIFACT_DIR, 'cli-write-content-deny-config-'),
    )
    await writeFile(
      join(writeContentDenyConfigDir, 'settings.json'),
      JSON.stringify(
        {
          permissions: {
            deny: [`Edit(${writeContentDenyRelativePath})`],
          },
        },
        null,
        2,
      ),
      'utf8',
    )
    const writeContentDenyEnv = {
      ...env,
      CLAUDE_CONFIG_DIR: writeContentDenyConfigDir,
    }
    const writeContentRuleArgs = [
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
    const beforeWriteContentDenyRequests = server.requests.length
    const writeContentDenyRun = parseJsonOutput(
      (
        await runCli(
          [...writeContentRuleArgs, writeContentDenyPrompt],
          writeContentDenyEnv,
          runCliOptions(),
        )
      ).stdout,
    )
    assert.equal(
      writeContentDenyRun.is_error,
      false,
      'Write content-specific deny run should complete after model final response',
    )
    assert.equal(
      writeContentDenyRun.result,
      writeContentDenyFinalResponse,
      'Write content-specific deny final response',
    )
    const writeContentDenyRequests = server.requests
      .slice(beforeWriteContentDenyRequests)
      .filter(request => {
        return request.path.endsWith('/messages') && request.body.stream === true
      })
    assert.equal(
      writeContentDenyRequests.length,
      2,
      'Write content-specific deny run should make tool_use and final requests',
    )
    const writeContentDenyResultBlocks = requestContentBlocks(
      writeContentDenyRequests[1],
      'tool_result',
    )
    assert(
      writeContentDenyResultBlocks.some(block => {
        return (
          typeof block.tool_use_id === 'string' &&
          block.tool_use_id.startsWith('toolu_cli_write_content_deny_') &&
          block.is_error === true &&
          typeof block.content === 'string' &&
          block.content.includes(
            'File is in a directory that is denied by your permission settings',
          )
        )
      }),
      `Write content-specific deny follow-up should include path-denied tool_result: ${JSON.stringify(writeContentDenyResultBlocks, null, 2)}`,
    )
    const writeContentDenyFileExists = await stat(
      writeContentDenyFilePath,
    ).then(
      () => true,
      () => false,
    )
    assert.equal(
      writeContentDenyFileExists,
      false,
      'Write content-specific deny should not create the denied file',
    )

    const writeContentAskConfigDir = await mkdtemp(
      join(ARTIFACT_DIR, 'cli-write-content-ask-config-'),
    )
    await writeFile(
      join(writeContentAskConfigDir, 'settings.json'),
      JSON.stringify(
        {
          permissions: {
            ask: [`Edit(${writeContentAskRelativePath})`],
          },
        },
        null,
        2,
      ),
      'utf8',
    )
    const writeContentAskEnv = {
      ...env,
      CLAUDE_CONFIG_DIR: writeContentAskConfigDir,
    }
    const beforeWriteContentAskRequests = server.requests.length
    const writeContentAskRun = parseJsonOutput(
      (
        await runCli(
          [...writeContentRuleArgs, writeContentAskPrompt],
          writeContentAskEnv,
          runCliOptions(),
        )
      ).stdout,
    )
    assert.equal(
      writeContentAskRun.is_error,
      false,
      'Write content-specific ask run should complete after model final response',
    )
    assert.equal(
      writeContentAskRun.result,
      writeContentAskFinalResponse,
      'Write content-specific ask final response',
    )
    const writeContentAskRequests = server.requests
      .slice(beforeWriteContentAskRequests)
      .filter(request => {
        return request.path.endsWith('/messages') && request.body.stream === true
      })
    assert.equal(
      writeContentAskRequests.length,
      2,
      'Write content-specific ask run should make tool_use and final requests',
    )
    const writeContentAskResultBlocks = requestContentBlocks(
      writeContentAskRequests[1],
      'tool_result',
    )
    assert(
      writeContentAskResultBlocks.some(block => {
        return (
          typeof block.tool_use_id === 'string' &&
          block.tool_use_id.startsWith('toolu_cli_write_content_ask_') &&
          block.is_error === true &&
          typeof block.content === 'string' &&
          block.content.includes('Claude requested permissions to write to') &&
          block.content.includes("haven't granted it yet")
        )
      }),
      `Write content-specific ask follow-up should include approval-required tool_result: ${JSON.stringify(writeContentAskResultBlocks, null, 2)}`,
    )
    const writeContentAskFileExists = await stat(
      writeContentAskFilePath,
    ).then(
      () => true,
      () => false,
    )
    assert.equal(
      writeContentAskFileExists,
      false,
      'Write content-specific ask should not create the unapproved file',
    )

    const writeHookDenyConfigDir = await mkdtemp(
      join(ARTIFACT_DIR, 'cli-write-hook-deny-config-'),
    )
    await writeFile(
      join(writeHookDenyConfigDir, 'settings.json'),
      JSON.stringify(
        {
          hooks: {
            PreToolUse: [
              {
                matcher: 'Write',
                hooks: [
                  {
                    type: 'http',
                    url: `${server.baseUrl}/hook/pretooluse-block-write`,
                    timeout: 5,
                  },
                ],
              },
            ],
          },
        },
        null,
        2,
      ),
      'utf8',
    )
    const writeHookDenyEnv = {
      ...env,
      CLAUDE_CONFIG_DIR: writeHookDenyConfigDir,
    }
    delete writeHookDenyEnv.CLAUDE_CODE_SIMPLE
    const writeHookDenyArgs = [
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
    await rm(writeHookDenyFilePath, { force: true })
    const beforeWriteHookDenyRequests = server.requests.length
    const writeHookDenyRun = parseJsonOutput(
      (
        await runCli(
          [...writeHookDenyArgs, writeHookDenyPrompt],
          writeHookDenyEnv,
          runCliOptions(),
        )
      ).stdout,
    )
    assert.equal(
      writeHookDenyRun.is_error,
      false,
      'Write PreToolUse hook deny run should complete after model final response',
    )
    assert.equal(
      writeHookDenyRun.result,
      writeHookDenyFinalResponse,
      'Write PreToolUse hook deny final response',
    )
    const writeHookDenyRequests = server.requests
      .slice(beforeWriteHookDenyRequests)
      .filter(request => {
        return request.path.endsWith('/messages') && request.body.stream === true
      })
    assert.equal(
      writeHookDenyRequests.length,
      2,
      'Write PreToolUse hook deny run should make tool_use and final requests',
    )
    const writeHookRequests = server.requests
      .slice(beforeWriteHookDenyRequests)
      .filter(request => request.path === '/hook/pretooluse-block-write')
    assert.equal(
      writeHookRequests.length,
      1,
      'Write PreToolUse hook deny run should call the blocking hook once',
    )
    const writeHookDenyResultBlocks = requestContentBlocks(
      writeHookDenyRequests[1],
      'tool_result',
    )
    assert(
      writeHookDenyResultBlocks.some(block => {
        return (
          typeof block.tool_use_id === 'string' &&
          block.tool_use_id.startsWith('toolu_cli_write_hook_deny_') &&
          block.is_error === true &&
          typeof block.content === 'string' &&
          block.content.includes(writeHookDenyReason)
        )
      }),
      `Write PreToolUse hook deny follow-up should include hook-denied tool_result: ${JSON.stringify(writeHookDenyResultBlocks, null, 2)}`,
    )
    const writeHookDenyFileExists = await stat(writeHookDenyFilePath).then(
      () => true,
      () => false,
    )
    assert.equal(
      writeHookDenyFileExists,
      false,
      'Write PreToolUse hook deny should not create the blocked file',
    )

    const userSettingsDenyConfigDir = await mkdtemp(
      join(ARTIFACT_DIR, 'cli-user-settings-deny-config-'),
    )
    await writeFile(
      join(userSettingsDenyConfigDir, 'settings.json'),
      JSON.stringify(
        {
          permissions: {
            deny: ['Write'],
          },
        },
        null,
        2,
      ),
      'utf8',
    )
    const userSettingsDenyEnv = {
      ...env,
      CLAUDE_CONFIG_DIR: userSettingsDenyConfigDir,
    }
    const beforeUserSettingsWriteDenyRequests = server.requests.length
    const userSettingsWriteDenyArgs = [
      '--bare',
      '--print',
      '--output-format',
      'json',
      '--max-turns',
      '2',
      '--strict-mcp-config',
      '--tools',
      'Write',
      '--model',
      'sonnet',
    ]
    const userSettingsWriteDenyRun = parseJsonOutput(
      (
        await runCli(
          [...userSettingsWriteDenyArgs, userSettingsWriteDenyPrompt],
          userSettingsDenyEnv,
          runCliOptions(),
        )
      ).stdout,
    )
    assert.equal(
      userSettingsWriteDenyRun.is_error,
      false,
      'User settings Write deny run should complete after model final response',
    )
    assert.equal(
      userSettingsWriteDenyRun.result,
      userSettingsWriteDenyFinalResponse,
      'User settings Write deny final response',
    )
    const userSettingsWriteDenyRequests = server.requests
      .slice(beforeUserSettingsWriteDenyRequests)
      .filter(request => {
        return request.path.endsWith('/messages') && request.body.stream === true
      })
    assert.equal(
      userSettingsWriteDenyRequests.length,
      2,
      'User settings Write deny run should make tool_use and final requests',
    )
    const userSettingsWriteDenyResultBlocks = requestContentBlocks(
      userSettingsWriteDenyRequests[1],
      'tool_result',
    )
    assert(
      userSettingsWriteDenyResultBlocks.some(block => {
        return (
          typeof block.tool_use_id === 'string' &&
          block.tool_use_id.startsWith(
            'toolu_cli_user_settings_write_deny_',
          ) &&
          block.is_error === true &&
          typeof block.content === 'string' &&
          block.content.includes('No such tool available: Write')
        )
      }),
      `User settings Write deny follow-up should include unavailable tool result: ${JSON.stringify(userSettingsWriteDenyResultBlocks, null, 2)}`,
    )
    const userSettingsWriteDenyFileExists = await stat(
      userSettingsWriteDenyFilePath,
    ).then(
      () => true,
      () => false,
    )
    assert.equal(
      userSettingsWriteDenyFileExists,
      false,
      'User settings Write deny should not create the denied file',
    )

    const projectSettingsDenyCwd = await mkdtemp(
      join(ARTIFACT_DIR, 'cli-project-settings-deny-cwd-'),
    )
    await mkdir(join(projectSettingsDenyCwd, '.claude'), { recursive: true })
    await writeFile(
      join(projectSettingsDenyCwd, '.claude', 'settings.json'),
      JSON.stringify(
        {
          permissions: {
            deny: ['Write'],
          },
        },
        null,
        2,
      ),
      'utf8',
    )
    const projectSettingsDenyConfigDir = await mkdtemp(
      join(ARTIFACT_DIR, 'cli-project-settings-deny-config-'),
    )
    const projectSettingsDenyEnv = {
      ...env,
      CLAUDE_CONFIG_DIR: projectSettingsDenyConfigDir,
    }
    const beforeProjectSettingsWriteDenyRequests = server.requests.length
    const projectSettingsWriteDenyRun = parseJsonOutput(
      (
        await runCli(
          [...userSettingsWriteDenyArgs, projectSettingsWriteDenyPrompt],
          projectSettingsDenyEnv,
          {
            ...runCliOptions(),
            cwd: projectSettingsDenyCwd,
          },
        )
      ).stdout,
    )
    assert.equal(
      projectSettingsWriteDenyRun.is_error,
      false,
      'Project settings Write deny run should complete after model final response',
    )
    assert.equal(
      projectSettingsWriteDenyRun.result,
      projectSettingsWriteDenyFinalResponse,
      'Project settings Write deny final response',
    )
    const projectSettingsWriteDenyRequests = server.requests
      .slice(beforeProjectSettingsWriteDenyRequests)
      .filter(request => {
        return request.path.endsWith('/messages') && request.body.stream === true
      })
    assert.equal(
      projectSettingsWriteDenyRequests.length,
      2,
      'Project settings Write deny run should make tool_use and final requests',
    )
    const projectSettingsWriteDenyResultBlocks = requestContentBlocks(
      projectSettingsWriteDenyRequests[1],
      'tool_result',
    )
    assert(
      projectSettingsWriteDenyResultBlocks.some(block => {
        return (
          typeof block.tool_use_id === 'string' &&
          block.tool_use_id.startsWith(
            'toolu_cli_project_settings_write_deny_',
          ) &&
          block.is_error === true &&
          typeof block.content === 'string' &&
          block.content.includes('No such tool available: Write')
        )
      }),
      `Project settings Write deny follow-up should include unavailable tool result: ${JSON.stringify(projectSettingsWriteDenyResultBlocks, null, 2)}`,
    )
    const projectSettingsWriteDenyFileExists = await stat(
      projectSettingsWriteDenyFilePath,
    ).then(
      () => true,
      () => false,
    )
    assert.equal(
      projectSettingsWriteDenyFileExists,
      false,
      'Project settings Write deny should not create the denied file',
    )

    const managedSettingsDir = await mkdtemp(
      join(ARTIFACT_DIR, 'cli-managed-settings-'),
    )
    await writeFile(
      join(managedSettingsDir, 'managed-settings.json'),
      JSON.stringify(
        {
          allowManagedPermissionRulesOnly: true,
        },
        null,
        2,
      ),
      'utf8',
    )
    const managedOnlyEnv = {
      ...env,
      CLAUDE_CODE_MANAGED_SETTINGS_PATH: managedSettingsDir,
      USER_TYPE: 'ant',
    }
    const beforeManagedOnlyWriteRequests = server.requests.length
    const managedOnlyWriteArgs = [
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
    const managedOnlyWriteRun = parseJsonOutput(
      (
        await runCli(
          [...managedOnlyWriteArgs, managedOnlyWritePrompt],
          managedOnlyEnv,
          runCliOptions(),
        )
      ).stdout,
    )
    assert.equal(
      managedOnlyWriteRun.is_error,
      false,
      'Managed-only Write rejection run should complete after model final response',
    )
    assert.equal(
      managedOnlyWriteRun.result,
      managedOnlyWriteFinalResponse,
      'Managed-only Write rejection final response',
    )
    const managedOnlyWriteRequests = server.requests
      .slice(beforeManagedOnlyWriteRequests)
      .filter(request => {
        return request.path.endsWith('/messages') && request.body.stream === true
      })
    assert.equal(
      managedOnlyWriteRequests.length,
      2,
      'Managed-only Write rejection run should make tool_use and final requests',
    )
    const managedOnlyWriteResultBlocks = requestContentBlocks(
      managedOnlyWriteRequests[1],
      'tool_result',
    )
    assert(
      managedOnlyWriteResultBlocks.some(block => {
        return (
          typeof block.tool_use_id === 'string' &&
          block.tool_use_id.startsWith('toolu_cli_managed_write_') &&
          block.is_error === true &&
          typeof block.content === 'string' &&
          block.content.includes(
            "Claude requested permissions to write to",
          ) &&
          block.content.includes("haven't granted it yet")
        )
      }),
      `Managed-only Write follow-up should include permission denial result: ${JSON.stringify(managedOnlyWriteResultBlocks, null, 2)}`,
    )
    const managedOnlyWriteFileExists = await stat(
      managedOnlyWriteFilePath,
    ).then(
      () => true,
      () => false,
    )
    assert.equal(
      managedOnlyWriteFileExists,
      false,
      'Managed-only Write denial should ignore CLI allow and not create the file',
    )

    const beforeBinaryReadWriteRequests = server.requests.length
    const binaryReadWriteArgs = [
      '--bare',
      '--print',
      '--output-format',
      'json',
      '--max-turns',
      '4',
      '--strict-mcp-config',
      '--tools',
      'Read,Write',
      '--permission-mode',
      'acceptEdits',
      '--model',
      'sonnet',
    ]
    const binaryReadWriteRun = parseJsonOutput(
      (
        await runCli(
          [...binaryReadWriteArgs, binaryReadWritePrompt],
          env,
          runCliOptions(),
        )
      ).stdout,
    )
    assert.equal(
      binaryReadWriteRun.is_error,
      false,
      'Binary Read then Write rejection run should complete after model final response',
    )
    assert.equal(
      binaryReadWriteRun.result,
      binaryReadWriteFinalResponse,
      'Binary Read then Write rejection final response',
    )
    const binaryReadWriteRequests = server.requests
      .slice(beforeBinaryReadWriteRequests)
      .filter(request => {
        return request.path.endsWith('/messages') && request.body.stream === true
      })
    assert.equal(
      binaryReadWriteRequests.length,
      3,
      'Binary Read then Write rejection run should make Read, Write, and final requests',
    )
    const binaryReadResultBlocks = requestContentBlocks(
      binaryReadWriteRequests[1],
      'tool_result',
    )
    assert(
      binaryReadResultBlocks.some(block => {
        return (
          typeof block.tool_use_id === 'string' &&
          block.tool_use_id.startsWith('toolu_cli_read_') &&
          block.is_error === true &&
          typeof block.content === 'string' &&
          block.content.includes('cannot read binary files')
        )
      }),
      'Binary Read follow-up should include binary-file error result',
    )
    const binaryWriteResultBlocks = requestContentBlocks(
      binaryReadWriteRequests[2],
      'tool_result',
    )
    assert(
      binaryWriteResultBlocks.some(block => {
        return (
          typeof block.tool_use_id === 'string' &&
          block.tool_use_id.startsWith('toolu_cli_binary_write_') &&
          block.is_error === true &&
          typeof block.content === 'string' &&
          block.content.includes('File has not been read yet')
        )
      }),
      'Binary Write follow-up should include read-before-write error result',
    )
    assert.deepEqual(
      await readFile(binaryReadWriteFilePath),
      binaryReadWriteOriginalBytes,
      'Binary Read/Write rejection should leave original bytes unchanged',
    )

    const beforeNotebookEditRequests = server.requests.length
    const notebookEditArgs = [
      '--bare',
      '--print',
      '--output-format',
      'json',
      '--max-turns',
      '3',
      '--strict-mcp-config',
      '--tools',
      'Read,NotebookEdit',
      '--permission-mode',
      'acceptEdits',
      '--model',
      'sonnet',
    ]
    const notebookEditRun = parseJsonOutput(
      (
        await runCli(
          [...notebookEditArgs, notebookEditPrompt],
          env,
          runCliOptions(),
        )
      ).stdout,
    )
    assert.equal(
      notebookEditRun.is_error,
      false,
      'Read then NotebookEdit tool run should succeed',
    )
    assert.equal(
      notebookEditRun.result,
      notebookEditFinalResponse,
      'Read then NotebookEdit final response',
    )
    const notebookEditRequests = server.requests
      .slice(beforeNotebookEditRequests)
      .filter(request => {
        return request.path.endsWith('/messages') && request.body.stream === true
      })
    assert.equal(
      notebookEditRequests.length,
      3,
      'Read then NotebookEdit run should make Read, NotebookEdit, and final requests',
    )
    const notebookReadFollowUpTexts = requestTexts(notebookEditRequests[1])
    assert(
      containsText(notebookReadFollowUpTexts, notebookEditOriginalSource),
      'NotebookEdit follow-up request should include Read notebook content',
    )
    const notebookEditResultBlocks = requestContentBlocks(
      notebookEditRequests[2],
      'tool_result',
    )
    assert(
      notebookEditResultBlocks.some(block => {
        return (
          typeof block.tool_use_id === 'string' &&
          block.tool_use_id.startsWith('toolu_cli_notebook_edit_') &&
          typeof block.content === 'string' &&
          block.content.includes(notebookEditUpdatedSource)
        )
      }),
      'final follow-up request should include NotebookEdit tool_result content',
    )
    const updatedNotebook = JSON.parse(
      await readFile(notebookEditFilePath, 'utf8'),
    )
    assert.equal(
      updatedNotebook.cells[0].source,
      notebookEditUpdatedSource,
      'NotebookEdit tool should update the fixture notebook cell on disk',
    )
    assert.deepEqual(
      updatedNotebook.cells[0].outputs,
      [],
      'NotebookEdit should clear code cell outputs',
    )

    const beforeNotebookVariantRequests = server.requests.length
    const notebookVariantArgs = [
      '--bare',
      '--print',
      '--output-format',
      'json',
      '--max-turns',
      '4',
      '--strict-mcp-config',
      '--tools',
      'Read,NotebookEdit',
      '--permission-mode',
      'acceptEdits',
      '--model',
      'sonnet',
    ]
    const notebookVariantRun = parseJsonOutput(
      (
        await runCli(
          [...notebookVariantArgs, notebookVariantPrompt],
          env,
          runCliOptions(),
        )
      ).stdout,
    )
    assert.equal(
      notebookVariantRun.is_error,
      false,
      'NotebookEdit insert/delete run should succeed',
    )
    assert.equal(
      notebookVariantRun.result,
      notebookVariantFinalResponse,
      'NotebookEdit insert/delete final response',
    )
    const notebookVariantRequests = server.requests
      .slice(beforeNotebookVariantRequests)
      .filter(request => {
        return request.path.endsWith('/messages') && request.body.stream === true
      })
    assert.equal(
      notebookVariantRequests.length,
      4,
      'NotebookEdit insert/delete run should make Read, insert, delete, and final requests',
    )
    const notebookVariantReadFollowUpTexts = requestTexts(
      notebookVariantRequests[1],
    )
    assert(
      containsText(notebookVariantReadFollowUpTexts, notebookVariantBaseSource),
      'NotebookEdit insert follow-up request should include Read notebook content',
    )
    const notebookInsertResultBlocks = requestContentBlocks(
      notebookVariantRequests[2],
      'tool_result',
    )
    assert(
      notebookInsertResultBlocks.some(block => {
        return (
          typeof block.tool_use_id === 'string' &&
          block.tool_use_id.startsWith('toolu_cli_notebook_insert_') &&
          typeof block.content === 'string' &&
          block.content.includes('Inserted cell') &&
          block.content.includes(notebookVariantInsertedSource)
        )
      }),
      'NotebookEdit insert follow-up should include inserted-cell tool_result content',
    )
    const notebookDeleteResultBlocks = requestContentBlocks(
      notebookVariantRequests[3],
      'tool_result',
    )
    assert(
      notebookDeleteResultBlocks.some(block => {
        return (
          typeof block.tool_use_id === 'string' &&
          block.tool_use_id.startsWith('toolu_cli_notebook_delete_') &&
          typeof block.content === 'string' &&
          block.content.includes('Deleted cell cell-1')
        )
      }),
      'NotebookEdit delete follow-up should include deleted-cell tool_result content',
    )
    const variantNotebook = JSON.parse(
      await readFile(notebookVariantFilePath, 'utf8'),
    )
    assert.equal(
      variantNotebook.cells.length,
      1,
      'NotebookEdit delete should remove the inserted cell',
    )
    assert.equal(
      variantNotebook.cells[0].id,
      notebookVariantBaseCellId,
      'NotebookEdit insert/delete should preserve the original base cell',
    )
    assert.equal(
      variantNotebook.cells[0].source,
      notebookVariantBaseSource,
      'NotebookEdit insert/delete should leave the base cell source unchanged',
    )

    const beforeNotebookRejectRequests = server.requests.length
    const notebookRejectArgs = [
      '--bare',
      '--print',
      '--output-format',
      'json',
      '--max-turns',
      '3',
      '--strict-mcp-config',
      '--tools',
      'Read,NotebookEdit',
      '--permission-mode',
      'acceptEdits',
      '--model',
      'sonnet',
    ]
    const notebookRejectRun = parseJsonOutput(
      (
        await runCli(
          [...notebookRejectArgs, notebookRejectPrompt],
          env,
          runCliOptions(),
        )
      ).stdout,
    )
    assert.equal(
      notebookRejectRun.is_error,
      false,
      'NotebookEdit missing-cell rejection run should complete after model final response',
    )
    assert.equal(
      notebookRejectRun.result,
      notebookRejectFinalResponse,
      'NotebookEdit missing-cell rejection final response',
    )
    const notebookRejectRequests = server.requests
      .slice(beforeNotebookRejectRequests)
      .filter(request => {
        return request.path.endsWith('/messages') && request.body.stream === true
      })
    assert.equal(
      notebookRejectRequests.length,
      3,
      'NotebookEdit missing-cell rejection run should make Read, NotebookEdit, and final requests',
    )
    const notebookRejectReadFollowUpTexts = requestTexts(
      notebookRejectRequests[1],
    )
    assert(
      containsText(notebookRejectReadFollowUpTexts, notebookRejectOriginalSource),
      'NotebookEdit missing-cell follow-up should include Read notebook content',
    )
    const notebookRejectResultBlocks = requestContentBlocks(
      notebookRejectRequests[2],
      'tool_result',
    )
    assert(
      notebookRejectResultBlocks.some(block => {
        return (
          typeof block.tool_use_id === 'string' &&
          block.tool_use_id.startsWith('toolu_cli_notebook_reject_') &&
          block.is_error === true &&
          typeof block.content === 'string' &&
          block.content.includes('missing-cell-9027')
        )
      }),
      'NotebookEdit missing-cell follow-up should include error tool_result content',
    )
    const rejectedNotebook = JSON.parse(
      await readFile(notebookRejectFilePath, 'utf8'),
    )
    assert.equal(
      rejectedNotebook.cells[0].source,
      notebookRejectOriginalSource,
      'NotebookEdit missing-cell rejection should leave notebook unchanged',
    )

    const beforeNotebookInvalidRequests = server.requests.length
    const notebookInvalidRun = parseJsonOutput(
      (
        await runCli(
          [...notebookRejectArgs, notebookInvalidPrompt],
          env,
          runCliOptions(),
        )
      ).stdout,
    )
    assert.equal(
      notebookInvalidRun.is_error,
      false,
      'NotebookEdit invalid-json rejection run should complete after model final response',
    )
    assert.equal(
      notebookInvalidRun.result,
      notebookInvalidFinalResponse,
      'NotebookEdit invalid-json rejection final response',
    )
    const notebookInvalidRequests = server.requests
      .slice(beforeNotebookInvalidRequests)
      .filter(request => {
        return request.path.endsWith('/messages') && request.body.stream === true
      })
    assert.equal(
      notebookInvalidRequests.length,
      3,
      'NotebookEdit invalid-json rejection run should make Read, NotebookEdit, and final requests',
    )
    const notebookInvalidReadFollowUpTexts = requestTexts(
      notebookInvalidRequests[1],
    )
    assert(
      containsText(
        notebookInvalidReadFollowUpTexts,
        notebookInvalidOriginalSource,
      ),
      'NotebookEdit invalid-json follow-up should include original Read notebook content',
    )
    const notebookInvalidResultBlocks = requestContentBlocks(
      notebookInvalidRequests[2],
      'tool_result',
    )
    assert(
      notebookInvalidResultBlocks.some(block => {
        return (
          typeof block.tool_use_id === 'string' &&
          block.tool_use_id.startsWith('toolu_cli_notebook_invalid_') &&
          block.is_error === true &&
          typeof block.content === 'string' &&
          block.content.includes('Notebook is not valid JSON')
        )
      }),
      'NotebookEdit invalid-json follow-up should include parse error tool_result',
    )
    assert.equal(
      await readFile(notebookInvalidFilePath, 'utf8'),
      notebookInvalidCorruptContent,
      'NotebookEdit invalid-json rejection should leave corrupted notebook unchanged',
    )

    const beforeNotebookLargeRequests = server.requests.length
    const notebookLargeRun = parseJsonOutput(
      (
        await runCli(
          [...notebookRejectArgs, notebookLargePrompt],
          env,
          runCliOptions(),
        )
      ).stdout,
    )
    assert.equal(
      notebookLargeRun.is_error,
      false,
      'NotebookEdit too-large rejection run should complete after model final response',
    )
    assert.equal(
      notebookLargeRun.result,
      notebookLargeFinalResponse,
      'NotebookEdit too-large rejection final response',
    )
    const notebookLargeRequests = server.requests
      .slice(beforeNotebookLargeRequests)
      .filter(request => {
        return request.path.endsWith('/messages') && request.body.stream === true
      })
    assert.equal(
      notebookLargeRequests.length,
      3,
      'NotebookEdit too-large rejection run should make Read, NotebookEdit, and final requests',
    )
    const notebookLargeReadFollowUpTexts = requestTexts(
      notebookLargeRequests[1],
    )
    assert(
      containsText(notebookLargeReadFollowUpTexts, notebookLargeOriginalSource),
      'NotebookEdit too-large follow-up should include original Read notebook content',
    )
    const notebookLargeResultBlocks = requestContentBlocks(
      notebookLargeRequests[2],
      'tool_result',
    )
    assert(
      notebookLargeResultBlocks.some(block => {
        return (
          typeof block.tool_use_id === 'string' &&
          block.tool_use_id.startsWith('toolu_cli_notebook_large_') &&
          block.is_error === true &&
          typeof block.content === 'string' &&
          block.content.includes('too large to edit')
        )
      }),
      'NotebookEdit too-large follow-up should include size error tool_result',
    )
    const notebookLargeContent = await readFile(notebookLargeFilePath, 'utf8')
    assert(
      notebookLargeContent.includes(notebookLargeExpandedMarker),
      'NotebookEdit too-large rejection should leave expanded notebook content intact',
    )
    assert(
      !notebookLargeContent.includes(notebookLargeAttemptedSource),
      'NotebookEdit too-large rejection should not write attempted source',
    )

    const beforeNotebookUnreadRequests = server.requests.length
    const notebookUnreadArgs = [
      '--bare',
      '--print',
      '--output-format',
      'json',
      '--max-turns',
      '2',
      '--strict-mcp-config',
      '--tools',
      'NotebookEdit',
      '--allowedTools',
      'NotebookEdit',
      '--model',
      'sonnet',
    ]
    const notebookUnreadRun = parseJsonOutput(
      (
        await runCli(
          [...notebookUnreadArgs, notebookUnreadPrompt],
          env,
          runCliOptions(),
        )
      ).stdout,
    )
    assert.equal(
      notebookUnreadRun.is_error,
      false,
      'NotebookEdit unread rejection run should complete after model final response',
    )
    assert.equal(
      notebookUnreadRun.result,
      notebookUnreadFinalResponse,
      'NotebookEdit unread rejection final response',
    )
    const notebookUnreadRequests = server.requests
      .slice(beforeNotebookUnreadRequests)
      .filter(request => {
        return request.path.endsWith('/messages') && request.body.stream === true
      })
    assert.equal(
      notebookUnreadRequests.length,
      2,
      'NotebookEdit unread rejection run should make tool_use and final requests',
    )
    const notebookUnreadResultBlocks = requestContentBlocks(
      notebookUnreadRequests[1],
      'tool_result',
    )
    assert(
      notebookUnreadResultBlocks.some(block => {
        return (
          typeof block.tool_use_id === 'string' &&
          block.tool_use_id.startsWith('toolu_cli_notebook_unread_') &&
          block.is_error === true &&
          typeof block.content === 'string' &&
          block.content.includes('File has not been read yet')
        )
      }),
      'NotebookEdit unread follow-up should include read-before-write error result',
    )
    const unreadNotebook = JSON.parse(
      await readFile(notebookUnreadFilePath, 'utf8'),
    )
    assert.equal(
      unreadNotebook.cells[0].source,
      notebookUnreadOriginalSource,
      'NotebookEdit unread rejection should leave notebook unchanged',
    )

    const beforeNotebookStaleRequests = server.requests.length
    const notebookStaleArgs = [
      '--bare',
      '--print',
      '--output-format',
      'json',
      '--max-turns',
      '3',
      '--strict-mcp-config',
      '--tools',
      'Read,NotebookEdit',
      '--permission-mode',
      'acceptEdits',
      '--model',
      'sonnet',
    ]
    const notebookStaleRun = parseJsonOutput(
      (
        await runCli(
          [...notebookStaleArgs, notebookStalePrompt],
          env,
          runCliOptions(),
        )
      ).stdout,
    )
    assert.equal(
      notebookStaleRun.is_error,
      false,
      'NotebookEdit stale rejection run should complete after model final response',
    )
    assert.equal(
      notebookStaleRun.result,
      notebookStaleFinalResponse,
      'NotebookEdit stale rejection final response',
    )
    const notebookStaleRequests = server.requests
      .slice(beforeNotebookStaleRequests)
      .filter(request => {
        return request.path.endsWith('/messages') && request.body.stream === true
      })
    assert.equal(
      notebookStaleRequests.length,
      3,
      'NotebookEdit stale rejection run should make Read, NotebookEdit, and final requests',
    )
    const notebookStaleReadFollowUpTexts = requestTexts(
      notebookStaleRequests[1],
    )
    assert(
      containsText(notebookStaleReadFollowUpTexts, notebookStaleOriginalSource),
      'NotebookEdit stale follow-up should include Read notebook content before external modification',
    )
    const notebookStaleResultBlocks = requestContentBlocks(
      notebookStaleRequests[2],
      'tool_result',
    )
    assert(
      notebookStaleResultBlocks.some(block => {
        return (
          typeof block.tool_use_id === 'string' &&
          block.tool_use_id.startsWith('toolu_cli_notebook_stale_') &&
          block.is_error === true &&
          typeof block.content === 'string' &&
          block.content.includes('modified since read')
        )
      }),
      'NotebookEdit stale follow-up should include modified-since-read error result',
    )
    const staleNotebook = JSON.parse(
      await readFile(notebookStaleFilePath, 'utf8'),
    )
    assert.equal(
      staleNotebook.cells[0].source,
      notebookStaleExternalSource,
      'NotebookEdit stale rejection should preserve the external modification',
    )

    const notebookContentRuleArgs = [
      '--bare',
      '--print',
      '--output-format',
      'json',
      '--max-turns',
      '3',
      '--strict-mcp-config',
      '--tools',
      'Read,NotebookEdit',
      '--allowedTools',
      'Read,NotebookEdit',
      '--permission-mode',
      'acceptEdits',
      '--model',
      'sonnet',
    ]

    const notebookContentDenyConfigDir = await mkdtemp(
      join(ARTIFACT_DIR, 'cli-notebook-content-deny-config-'),
    )
    await writeFile(
      join(notebookContentDenyConfigDir, 'settings.json'),
      JSON.stringify(
        {
          permissions: {
            deny: [`Edit(${notebookContentDenyRelativePath})`],
          },
        },
        null,
        2,
      ),
      'utf8',
    )
    const notebookContentDenyEnv = {
      ...env,
      CLAUDE_CONFIG_DIR: notebookContentDenyConfigDir,
    }
    const beforeNotebookContentDenyRequests = server.requests.length
    const notebookContentDenyRun = parseJsonOutput(
      (
        await runCli(
          [...notebookContentRuleArgs, notebookContentDenyPrompt],
          notebookContentDenyEnv,
          runCliOptions(),
        )
      ).stdout,
    )
    assert.equal(
      notebookContentDenyRun.is_error,
      false,
      'NotebookEdit content-specific deny run should complete after model final response',
    )
    assert.equal(
      notebookContentDenyRun.result,
      notebookContentDenyFinalResponse,
      'NotebookEdit content-specific deny final response',
    )
    const notebookContentDenyRequests = server.requests
      .slice(beforeNotebookContentDenyRequests)
      .filter(request => {
        return request.path.endsWith('/messages') && request.body.stream === true
      })
    assert.equal(
      notebookContentDenyRequests.length,
      3,
      'NotebookEdit content-specific deny run should make Read, NotebookEdit, and final requests',
    )
    const notebookContentDenyReadFollowUpTexts = requestTexts(
      notebookContentDenyRequests[1],
    )
    assert(
      containsText(
        notebookContentDenyReadFollowUpTexts,
        notebookContentDenyOriginalSource,
      ),
      'NotebookEdit content-specific deny follow-up should include Read notebook content',
    )
    const notebookContentDenyResultBlocks = requestContentBlocks(
      notebookContentDenyRequests[2],
      'tool_result',
    )
    assert(
      notebookContentDenyResultBlocks.some(block => {
        return (
          typeof block.tool_use_id === 'string' &&
          block.tool_use_id.startsWith('toolu_cli_notebook_content_deny_') &&
          block.is_error === true &&
          typeof block.content === 'string' &&
          block.content.includes('Permission to edit') &&
          block.content.includes('has been denied')
        )
      }),
      `NotebookEdit content-specific deny follow-up should include path-denied tool_result: ${JSON.stringify(notebookContentDenyResultBlocks, null, 2)}`,
    )
    const notebookContentDenyNotebook = JSON.parse(
      await readFile(notebookContentDenyFilePath, 'utf8'),
    )
    assert.equal(
      notebookContentDenyNotebook.cells[0].source,
      notebookContentDenyOriginalSource,
      'NotebookEdit content-specific deny should leave notebook unchanged',
    )

    const notebookContentAskConfigDir = await mkdtemp(
      join(ARTIFACT_DIR, 'cli-notebook-content-ask-config-'),
    )
    await writeFile(
      join(notebookContentAskConfigDir, 'settings.json'),
      JSON.stringify(
        {
          permissions: {
            ask: [`Edit(${notebookContentAskRelativePath})`],
          },
        },
        null,
        2,
      ),
      'utf8',
    )
    const notebookContentAskEnv = {
      ...env,
      CLAUDE_CONFIG_DIR: notebookContentAskConfigDir,
    }
    const beforeNotebookContentAskRequests = server.requests.length
    const notebookContentAskRun = parseJsonOutput(
      (
        await runCli(
          [...notebookContentRuleArgs, notebookContentAskPrompt],
          notebookContentAskEnv,
          runCliOptions(),
        )
      ).stdout,
    )
    assert.equal(
      notebookContentAskRun.is_error,
      false,
      'NotebookEdit content-specific ask run should complete after model final response',
    )
    assert.equal(
      notebookContentAskRun.result,
      notebookContentAskFinalResponse,
      'NotebookEdit content-specific ask final response',
    )
    const notebookContentAskRequests = server.requests
      .slice(beforeNotebookContentAskRequests)
      .filter(request => {
        return request.path.endsWith('/messages') && request.body.stream === true
      })
    assert.equal(
      notebookContentAskRequests.length,
      3,
      'NotebookEdit content-specific ask run should make Read, NotebookEdit, and final requests',
    )
    const notebookContentAskReadFollowUpTexts = requestTexts(
      notebookContentAskRequests[1],
    )
    assert(
      containsText(
        notebookContentAskReadFollowUpTexts,
        notebookContentAskOriginalSource,
      ),
      'NotebookEdit content-specific ask follow-up should include Read notebook content',
    )
    const notebookContentAskResultBlocks = requestContentBlocks(
      notebookContentAskRequests[2],
      'tool_result',
    )
    assert(
      notebookContentAskResultBlocks.some(block => {
        return (
          typeof block.tool_use_id === 'string' &&
          block.tool_use_id.startsWith('toolu_cli_notebook_content_ask_') &&
          block.is_error === true &&
          typeof block.content === 'string' &&
          block.content.includes('Claude requested permissions to write to') &&
          block.content.includes("haven't granted it yet")
        )
      }),
      `NotebookEdit content-specific ask follow-up should include approval-required tool_result: ${JSON.stringify(notebookContentAskResultBlocks, null, 2)}`,
    )
    const notebookContentAskNotebook = JSON.parse(
      await readFile(notebookContentAskFilePath, 'utf8'),
    )
    assert.equal(
      notebookContentAskNotebook.cells[0].source,
      notebookContentAskOriginalSource,
      'NotebookEdit content-specific ask should leave notebook unchanged',
    )

    const beforeNotebookDenyRequests = server.requests.length
    const notebookDenyArgs = [
      '--bare',
      '--print',
      '--output-format',
      'json',
      '--max-turns',
      '3',
      '--strict-mcp-config',
      '--tools',
      'Read,NotebookEdit',
      '--permission-mode',
      'acceptEdits',
      '--disallowedTools',
      'NotebookEdit',
      '--model',
      'sonnet',
    ]
    const notebookDenyRun = parseJsonOutput(
      (
        await runCli(
          [...notebookDenyArgs, notebookDenyPrompt],
          env,
          runCliOptions(),
        )
      ).stdout,
    )
    assert.equal(
      notebookDenyRun.is_error,
      false,
      'NotebookEdit permission deny run should complete after model final response',
    )
    assert.equal(
      notebookDenyRun.result,
      notebookDenyFinalResponse,
      'NotebookEdit permission deny final response',
    )
    const notebookDenyRequests = server.requests
      .slice(beforeNotebookDenyRequests)
      .filter(request => {
        return request.path.endsWith('/messages') && request.body.stream === true
      })
    assert.equal(
      notebookDenyRequests.length,
      3,
      'NotebookEdit permission deny run should make Read, NotebookEdit, and final requests',
    )
    const notebookDenyReadFollowUpTexts = requestTexts(notebookDenyRequests[1])
    assert(
      containsText(notebookDenyReadFollowUpTexts, notebookDenyOriginalSource),
      'NotebookEdit permission deny follow-up should include Read notebook content',
    )
    const notebookDenyResultBlocks = requestContentBlocks(
      notebookDenyRequests[2],
      'tool_result',
    )
    assert(
      notebookDenyResultBlocks.some(block => {
        return (
          typeof block.tool_use_id === 'string' &&
          block.tool_use_id.startsWith('toolu_cli_notebook_deny_') &&
          block.is_error === true &&
          typeof block.content === 'string' &&
          block.content.includes('No such tool available: NotebookEdit')
        )
      }),
      `NotebookEdit permission deny follow-up should include explicit deny error result: ${JSON.stringify(notebookDenyResultBlocks, null, 2)}`,
    )
    const deniedNotebook = JSON.parse(
      await readFile(notebookDenyFilePath, 'utf8'),
    )
    assert.equal(
      deniedNotebook.cells[0].source,
      notebookDenyOriginalSource,
      'NotebookEdit permission deny should leave notebook unchanged',
    )

    const beforeNotebookCellIndexRequests = server.requests.length
    const notebookCellIndexArgs = [
      '--bare',
      '--print',
      '--output-format',
      'json',
      '--max-turns',
      '3',
      '--strict-mcp-config',
      '--tools',
      'Read,NotebookEdit',
      '--permission-mode',
      'acceptEdits',
      '--model',
      'sonnet',
    ]
    const notebookCellIndexRun = parseJsonOutput(
      (
        await runCli(
          [...notebookCellIndexArgs, notebookCellIndexPrompt],
          env,
          runCliOptions(),
        )
      ).stdout,
    )
    assert.equal(
      notebookCellIndexRun.is_error,
      false,
      'NotebookEdit cell-index replace run should succeed',
    )
    assert.equal(
      notebookCellIndexRun.result,
      notebookCellIndexFinalResponse,
      'NotebookEdit cell-index replace final response',
    )
    const notebookCellIndexRequests = server.requests
      .slice(beforeNotebookCellIndexRequests)
      .filter(request => {
        return request.path.endsWith('/messages') && request.body.stream === true
      })
    assert.equal(
      notebookCellIndexRequests.length,
      3,
      'NotebookEdit cell-index replace run should make Read, NotebookEdit, and final requests',
    )
    const notebookCellIndexReadFollowUpTexts = requestTexts(
      notebookCellIndexRequests[1],
    )
    assert(
      containsText(
        notebookCellIndexReadFollowUpTexts,
        notebookCellIndexOriginalMarkdown,
      ),
      'NotebookEdit cell-index replace follow-up should include original markdown content',
    )
    const notebookCellIndexResultBlocks = requestContentBlocks(
      notebookCellIndexRequests[2],
      'tool_result',
    )
    assert(
      notebookCellIndexResultBlocks.some(block => {
        return (
          typeof block.tool_use_id === 'string' &&
          block.tool_use_id.startsWith('toolu_cli_notebook_cell_index_') &&
          typeof block.content === 'string' &&
          block.content.includes('Updated cell cell-1') &&
          block.content.includes(notebookCellIndexUpdatedMarkdown)
        )
      }),
      'NotebookEdit cell-index replace follow-up should include updated markdown tool_result',
    )
    const cellIndexNotebook = JSON.parse(
      await readFile(notebookCellIndexFilePath, 'utf8'),
    )
    assert.equal(
      cellIndexNotebook.cells[0].source,
      notebookCellIndexFirstSource,
      'NotebookEdit cell-index replace should preserve the first code cell',
    )
    assert.equal(
      cellIndexNotebook.cells[1].cell_type,
      'markdown',
      'NotebookEdit cell-index replace should keep the target cell as markdown',
    )
    assert.equal(
      cellIndexNotebook.cells[1].source,
      notebookCellIndexUpdatedMarkdown,
      'NotebookEdit cell-index replace should update the markdown cell source',
    )

    console.log('ok - cli print/resume/continue E2E')
    console.log(`ok - local mock captured ${promptRequests.length} streamed prompt requests`)
    console.log('ok - textual tool-call leak is reported without executing a tool')
    console.log('ok - structured Read tool_use executes and sends tool_result')
    console.log('ok - chunked tool_use executes despite non-tool stop_reason')
    console.log('ok - unclosed tool_use block is finalized at stream end')
    console.log('ok - Read respects path-specific deny rules')
    console.log('ok - Read respects path-specific ask rules')
    console.log('ok - out-of-order stream recovers through non-streaming fallback')
    console.log('ok - reactive compact recovers after prompt-too-long')
    console.log('ok - stream-json partial events flush before final result')
    console.log('ok - multiple interleaved tool_use blocks execute and follow up')
    console.log('ok - mixed text, Read, and Bash blocks preserve text and results')
    console.log('ok - triple interleaved Read, Bash, and Read blocks follow up')
    console.log('ok - Bash side-effect tool writes an artifact fixture file')
    console.log('ok - Bash content-specific deny blocks a matching command')
    console.log('ok - Bash content-specific ask requires approval')
    console.log('ok - project Bash content-specific deny blocks a matching command')
    console.log('ok - project Bash content-specific ask requires approval')
    console.log('ok - Read then Edit executes and updates a fixture file')
    console.log('ok - Edit rejects updating a file that was not read first')
    console.log('ok - Edit rejects stale updates after external modification')
    console.log('ok - Edit respects explicit disallowedTools denial')
    console.log('ok - Edit respects path-specific deny rules')
    console.log('ok - Edit respects path-specific ask rules')
    console.log('ok - Edit replace_all updates every matching occurrence')
    console.log('ok - Edit rejects ambiguous multi-match updates')
    console.log('ok - Edit creates a new file when old_string is empty')
    console.log('ok - Edit preserves CRLF line endings')
    console.log('ok - Edit preserves mixed CRLF/LF line endings')
    console.log('ok - Edit preserves UTF-16LE BOM encoding')
    console.log('ok - Edit preserves UTF-8 BOM')
    console.log('ok - Write tool creates an artifact fixture file')
    console.log('ok - Write tool preserves CRLF content when creating a file')
    console.log('ok - Write tool preserves mixed CRLF/LF content')
    console.log('ok - Read then Write updates an existing artifact file')
    console.log('ok - Write preserves UTF-16LE BOM encoding')
    console.log('ok - Write preserves UTF-8 BOM')
    console.log('ok - Write rejects updating a file that was not read first')
    console.log('ok - Write rejects stale updates after external modification')
    console.log('ok - Write respects explicit disallowedTools denial')
    console.log('ok - Write respects Edit path-specific deny rules')
    console.log('ok - Write respects Edit path-specific ask rules')
    console.log('ok - Write respects PreToolUse hook denial')
    console.log('ok - user settings deny removes Write from the tool pool')
    console.log('ok - project settings deny removes Write from the tool pool')
    console.log('ok - managed-only permissions ignore CLI Write allow')
    console.log('ok - Read rejects binary content and Write stays blocked')
    console.log('ok - Read then NotebookEdit updates an artifact notebook')
    console.log('ok - NotebookEdit inserts and deletes an artifact notebook cell')
    console.log('ok - NotebookEdit rejects editing a missing notebook cell')
    console.log('ok - NotebookEdit rejects corrupted notebook JSON')
    console.log('ok - NotebookEdit rejects oversized notebooks before parsing')
    console.log('ok - NotebookEdit rejects editing a notebook that was not read first')
    console.log('ok - NotebookEdit rejects stale notebook edits after external modification')
    console.log('ok - NotebookEdit respects Edit path-specific deny rules')
    console.log('ok - NotebookEdit respects Edit path-specific ask rules')
    console.log('ok - NotebookEdit respects explicit disallowedTools denial')
    console.log('ok - NotebookEdit replaces a markdown cell by cell index')
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
