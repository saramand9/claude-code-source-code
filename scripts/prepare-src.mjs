#!/usr/bin/env node
/**
 * prepare-src.mjs - Pre-build source transformation.
 *
 * This script writes a prepared copy to build-src/prepared by default.
 * It intentionally leaves src/ and root stubs/ untouched.
 *
 * Usage:
 *   node scripts/prepare-src.mjs
 *   node scripts/prepare-src.mjs --out build-src/custom
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const SRC = path.join(ROOT, 'src')
const STUBS = path.join(ROOT, 'stubs')
const VERSION = '2.1.88'

function parseOutDir(argv) {
  const outIndex = argv.indexOf('--out')
  if (outIndex !== -1) {
    const value = argv[outIndex + 1]
    if (!value) throw new Error('--out requires a directory')
    return path.resolve(ROOT, value)
  }
  return path.join(ROOT, 'build-src', 'prepared')
}

const OUT = parseOutDir(process.argv.slice(2))
const OUT_SRC = path.join(OUT, 'src')
const OUT_STUBS = path.join(OUT, 'stubs')

function walk(dir) {
  const results = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory() && entry.name !== 'node_modules') {
      results.push(...walk(full))
    } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
      results.push(full)
    }
  }
  return results
}

function modulePath(fromFile, toFile) {
  let rel = path.relative(path.dirname(fromFile), toFile).replace(/\\/g, '/')
  if (!rel.startsWith('.')) rel = `./${rel}`
  return rel
}

function patchFile(filePath) {
  let src = fs.readFileSync(filePath, 'utf8')
  let changed = false

  if (src.includes("from 'bun:bundle'") || src.includes('from "bun:bundle"')) {
    const stubImport = modulePath(filePath, path.join(OUT_STUBS, 'bun-bundle.js'))
    src = src.replace(
      /import\s*\{\s*feature\s*\}\s*from\s*['"]bun:bundle['"]/g,
      `import { feature } from '${stubImport}'`,
    )
    changed = true
  }

  const macroReplacements = {
    'MACRO.VERSION': `'${VERSION}'`,
    'MACRO.BUILD_TIME': `'${new Date().toISOString()}'`,
    'MACRO.FEEDBACK_CHANNEL': `'https://github.com/anthropics/claude-code/issues'`,
    'MACRO.ISSUES_EXPLAINER': `'https://github.com/anthropics/claude-code/issues/new/choose'`,
    'MACRO.FEEDBACK_CHANNEL_URL': `'https://github.com/anthropics/claude-code/issues'`,
    'MACRO.ISSUES_EXPLAINER_URL': `'https://github.com/anthropics/claude-code/issues/new/choose'`,
    'MACRO.NATIVE_PACKAGE_URL': `'@anthropic-ai/claude-code'`,
    'MACRO.PACKAGE_URL': `'@anthropic-ai/claude-code'`,
    'MACRO.VERSION_CHANGELOG': `''`,
  }

  for (const [macro, replacement] of Object.entries(macroReplacements)) {
    if (src.includes(macro)) {
      src = src.replace(
        new RegExp(`(?<![\\w'"])${macro.replace('.', '\\.')}(?![\\w'" ])`, 'g'),
        replacement,
      )
      changed = true
    }
  }

  if (changed) {
    fs.writeFileSync(filePath, src, 'utf8')
    return true
  }
  return false
}

console.log(`Preparing source copy in ${path.relative(ROOT, OUT)}`)

fs.rmSync(OUT, { recursive: true, force: true })
fs.mkdirSync(OUT, { recursive: true })
fs.cpSync(SRC, OUT_SRC, { recursive: true })
fs.cpSync(STUBS, OUT_STUBS, { recursive: true })

const ffiStub = path.join(OUT_STUBS, 'bun-ffi.ts')
if (!fs.existsSync(ffiStub)) {
  fs.writeFileSync(
    ffiStub,
    `// Stub for bun:ffi - not available outside Bun runtime\nexport const ffi = {} as any\nexport function dlopen() { return {} }\n`,
  )
}

const macroDecl = path.join(OUT_STUBS, 'global.d.ts')
fs.writeFileSync(
  macroDecl,
  `// Global compile-time macros (normally injected by Bun bundler)
declare const MACRO: {
  VERSION: string
  BUILD_TIME: string
  FEEDBACK_CHANNEL: string
  ISSUES_EXPLAINER: string
  FEEDBACK_CHANNEL_URL: string
  ISSUES_EXPLAINER_URL: string
  NATIVE_PACKAGE_URL: string
  PACKAGE_URL: string
  VERSION_CHANGELOG: string
}
`,
)

const files = walk(OUT_SRC)
let patched = 0
for (const file of files) {
  if (patchFile(file)) patched++
}

console.log(`Patched ${patched} / ${files.length} copied source files`)
