#!/usr/bin/env node

import { readFile, readdir, stat } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const SRC = join(ROOT, 'src')
const BUILD_SCRIPT = join(ROOT, 'scripts', 'build.mjs')
const STUB_MANIFEST = join(ROOT, 'build-src', 'stub-manifest.json')
const FEATURE_RE = /\bfeature\s*\(\s*['"]([A-Z0-9_]+)['"]\s*,?\s*\)/g

async function exists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory() && entry.name !== 'node_modules') {
      yield* walk(full)
    } else if (entry.isFile() && /\.[tj]sx?$/.test(entry.name)) {
      yield full
    }
  }
}

function repoPath(path) {
  return relative(ROOT, path).replace(/\\/g, '/')
}

function parsePreservedFromBuildScript(source) {
  const match = source.match(
    /const\s+DEFAULT_PRESERVED_FEATURES\s*=\s*\[([\s\S]*?)\]/,
  )
  if (!match) return []
  return Array.from(match[1].matchAll(/['"]([A-Z0-9_]+)['"]/g), item => item[1])
}

function parseEnvPreserved() {
  return (process.env.CLAUDE_CODE_PRESERVE_FEATURES ?? '')
    .split(/[,\s]+/)
    .map(item => item.trim())
    .filter(Boolean)
}

function compactList(values, limit = 3) {
  const shown = values.slice(0, limit)
  const suffix = values.length > limit ? ` +${values.length - limit}` : ''
  return `${shown.join(', ')}${suffix}`
}

function pad(value, width) {
  const text = String(value)
  return text.length >= width ? text : `${text}${' '.repeat(width - text.length)}`
}

async function collectFeatureCalls() {
  const features = new Map()
  let totalCalls = 0

  for await (const file of walk(SRC)) {
    const source = await readFile(file, 'utf8')
    const filePath = repoPath(file)
    for (const match of source.matchAll(FEATURE_RE)) {
      const name = match[1]
      totalCalls++
      if (!features.has(name)) {
        features.set(name, {
          name,
          calls: 0,
          files: new Map(),
        })
      }
      const entry = features.get(name)
      entry.calls++
      entry.files.set(filePath, (entry.files.get(filePath) ?? 0) + 1)
    }
  }

  return { features, totalCalls }
}

async function readStubSummary() {
  if (!(await exists(STUB_MANIFEST))) return null
  const manifest = JSON.parse(await readFile(STUB_MANIFEST, 'utf8'))
  const byKind = new Map()
  for (const entry of manifest.entries ?? []) {
    byKind.set(entry.kind, (byKind.get(entry.kind) ?? 0) + 1)
  }
  return {
    generatedAt: manifest.generatedAt,
    entries: manifest.entries ?? [],
    byKind: Object.fromEntries([...byKind.entries()].sort()),
  }
}

function buildRows(features, defaultPreserved, envPreserved) {
  const defaultSet = new Set(defaultPreserved)
  const envSet = new Set(envPreserved)
  return [...features.values()]
    .map(feature => {
      const files = [...feature.files.keys()].sort()
      let status = 'off-by-default'
      if (defaultSet.has(feature.name)) status = 'preserved-default'
      else if (envSet.has(feature.name)) status = 'preserved-env'
      return {
        name: feature.name,
        status,
        calls: feature.calls,
        files: files.length,
        sampleFiles: files,
      }
    })
    .sort((a, b) => {
      if (a.status !== b.status) return a.status.localeCompare(b.status)
      if (b.calls !== a.calls) return b.calls - a.calls
      return a.name.localeCompare(b.name)
    })
}

const asJson = process.argv.includes('--json')
const buildSource = await readFile(BUILD_SCRIPT, 'utf8')
const defaultPreserved = parsePreservedFromBuildScript(buildSource)
const envPreserved = parseEnvPreserved()
const { features, totalCalls } = await collectFeatureCalls()
const rows = buildRows(features, defaultPreserved, envPreserved)
const stubs = await readStubSummary()

if (asJson) {
  console.log(
    JSON.stringify(
      {
        totalFeatures: rows.length,
        totalCalls,
        defaultPreserved,
        envPreserved,
        features: rows,
        stubs,
      },
      null,
      2,
    ),
  )
} else {
  console.log('Feature audit')
  console.log(`- source gates: ${rows.length} features, ${totalCalls} calls`)
  console.log(
    `- default preserved: ${
      defaultPreserved.length ? defaultPreserved.join(', ') : '(none)'
    }`,
  )
  console.log(
    `- env preserved: ${envPreserved.length ? envPreserved.join(', ') : '(none)'}`,
  )
  if (stubs) {
    console.log(
      `- current stub manifest: ${stubs.entries.length} entries, generated ${stubs.generatedAt}`,
    )
  } else {
    console.log('- current stub manifest: missing; run npm run build first')
  }
  console.log('')
  console.log(
    `${pad('FEATURE', 30)} ${pad('STATUS', 18)} ${pad('CALLS', 5)} ${pad(
      'FILES',
      5,
    )} SAMPLE FILES`,
  )
  for (const row of rows) {
    console.log(
      `${pad(row.name, 30)} ${pad(row.status, 18)} ${pad(
        row.calls,
        5,
      )} ${pad(row.files, 5)} ${compactList(row.sampleFiles)}`,
    )
  }
  if (stubs) {
    console.log('')
    console.log('Stub kinds')
    for (const [kind, count] of Object.entries(stubs.byKind)) {
      console.log(`- ${kind}: ${count}`)
    }
  }
}
