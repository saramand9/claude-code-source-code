#!/usr/bin/env node

import assert from 'node:assert/strict'
import { readFile, stat } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const DEFAULT_METAFILE = join(ROOT, 'dist-core', 'meta.json')

// The naive query.ts bundle measured 5,187 inputs / 10.44 MiB. The extracted
// core is intentionally kept below 96 KiB; leave enough headroom for
// compatible fixes while preventing the product dependency cycle returning.
const DEFAULT_MAX_INPUTS = 200
const DEFAULT_MAX_BYTES = 96 * 1024

function readPositiveInteger(name, fallback) {
  const value = process.env[name]
  if (value === undefined || value === '') return fallback

  assert.match(value, /^\d+$/, `${name} must be a positive integer, got ${value}`)
  const parsed = Number.parseInt(value, 10)
  assert(
    Number.isSafeInteger(parsed) && parsed > 0,
    `${name} must be a positive safe integer, got ${value}`,
  )
  return parsed
}

function normalizePath(value) {
  return String(value).replaceAll('\\', '/').replace(/^\.\//, '').toLowerCase()
}

function hasPathSuffix(value, suffix) {
  const path = normalizePath(value)
  const expected = normalizePath(suffix)
  return path === expected || path.endsWith(`/${expected}`)
}

function findInput(inputs, suffix) {
  return Object.keys(inputs).find(path => hasPathSuffix(path, suffix))
}

function emittedBytesForInput(outputs, inputPath) {
  return Object.values(outputs).reduce(
    (total, output) => total + (output.inputs?.[inputPath]?.bytesInOutput ?? 0),
    0,
  )
}

function displayPath(path) {
  const repoRelative = relative(ROOT, path)
  return repoRelative.startsWith('..') ? path : repoRelative
}

async function pathExists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

const configuredMetafile = process.env.CORE_METAFILE
const metafilePath = configuredMetafile
  ? isAbsolute(configuredMetafile)
    ? configuredMetafile
    : resolve(ROOT, configuredMetafile)
  : DEFAULT_METAFILE

assert(
  await pathExists(metafilePath),
  `Core metafile is missing at ${displayPath(metafilePath)}; run the core build first`,
)

let metafile
try {
  metafile = JSON.parse(await readFile(metafilePath, 'utf8'))
} catch (error) {
  assert.fail(
    `Could not parse core metafile ${displayPath(metafilePath)}: ${error?.message ?? error}`,
  )
}

assert(
  metafile && typeof metafile === 'object',
  'Core metafile must contain an object',
)
assert(
  metafile.inputs && typeof metafile.inputs === 'object',
  'Core metafile is missing esbuild inputs',
)
assert(
  metafile.outputs && typeof metafile.outputs === 'object',
  'Core metafile is missing esbuild outputs',
)

const inputs = metafile.inputs
const outputs = metafile.outputs
const outputEntries = Object.entries(outputs)
const coreEntry = outputEntries.find(([, output]) =>
  hasPathSuffix(output.entryPoint ?? '', 'src/core/index.ts'),
)

assert(
  coreEntry,
  'Core build must have src/core/index.ts as an esbuild entry point',
)

for (const requiredInput of [
  'src/query.ts',
  'src/Tool.ts',
  'src/core/runtime/messages.ts',
  'src/core/runtime/toolExecution.ts',
  'src/core/runtime/compaction.ts',
  'src/core/runtime/session.ts',
  'src/core/prompt.ts',
  'src/services/compact/prompt.ts',
]) {
  const inputPath = findInput(inputs, requiredInput)
  assert(inputPath, `Core build no longer contains ${requiredInput}`)
  assert(
    emittedBytesForInput(outputs, inputPath) > 0,
    `${requiredInput} was discovered but emitted no code into the core build`,
  )
}

// These are host/product composition modules. Pulling any of them into the
// portable build means the core boundary has regressed, even if the output is
// still under the coarse size budget.
const forbiddenInputs = [
  'src/query/deps.ts',
  'src/services/api/claude.ts',
  'src/tools.ts',
  'src/utils/messages.ts',
  'src/services/tools/toolExecution.ts',
  'src/utils/abortController.ts',
  'src/QueryEngine.ts',
  'src/entrypoints/cli.tsx',
  'src/entrypoints/init.ts',
  'src/components/App.tsx',
  'src/ink/root.ts',
  'src/ink/components/App.tsx',
  'src/screens/REPL.tsx',
]

const boundaryLeaks = forbiddenInputs.flatMap(forbiddenInput => {
  const match = findInput(inputs, forbiddenInput)
  return match ? [`${forbiddenInput} (${match})`] : []
})

assert.deepEqual(
  boundaryLeaks,
  [],
  `Core build contains production/UI composition modules:\n${boundaryLeaks.join('\n')}`,
)

assert.deepEqual(
  coreEntry[1].imports ?? [],
  [],
  'Platform-neutral core must not retain runtime imports',
)

const forbiddenPrefixes = [
  'src/commands/',
  'src/components/',
  'src/ink/',
  'src/screens/',
  'node_modules/react/',
  'node_modules/react-reconciler/',
]
const emittedUILayers = Object.keys(inputs).filter(inputPath => {
  const normalized = normalizePath(inputPath)
  return (
    emittedBytesForInput(outputs, inputPath) > 0 &&
    forbiddenPrefixes.some(prefix => normalized.includes(prefix))
  )
})

assert.deepEqual(
  emittedUILayers,
  [],
  `Core build emits UI/command modules:\n${emittedUILayers.join('\n')}`,
)

const maxInputs = readPositiveInteger('CORE_MAX_INPUTS', DEFAULT_MAX_INPUTS)
const maxBytes = readPositiveInteger('CORE_MAX_BYTES', DEFAULT_MAX_BYTES)
const inputCount = Object.keys(inputs).length
const emittedInputCount = Object.keys(inputs).filter(
  inputPath => emittedBytesForInput(outputs, inputPath) > 0,
).length
// Measure the executable bundle, not its (usually much larger) source map.
const outputBytes = coreEntry[1].bytes ?? 0

assert(outputBytes > 0, 'Core entry output is missing its byte count')
assert(
  inputCount <= maxInputs,
  `Core build has ${inputCount.toLocaleString()} inputs; limit is ${maxInputs.toLocaleString()}`,
)
assert(
  outputBytes <= maxBytes,
  `Core build is ${(outputBytes / 1024 / 1024).toFixed(2)} MiB; limit is ${(maxBytes / 1024 / 1024).toFixed(2)} MiB`,
)

console.log(
  [
    'core boundary OK',
    `${inputCount.toLocaleString()} parsed inputs`,
    `${emittedInputCount.toLocaleString()} emitted inputs`,
    `${(outputBytes / 1024 / 1024).toFixed(2)} MiB`,
    `entry ${coreEntry[0]}`,
  ].join(' - '),
)
