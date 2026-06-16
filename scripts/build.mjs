#!/usr/bin/env node
/**
 * build.mjs — Best-effort build of Claude Code v2.1.88 from source
 *
 * ⚠️  IMPORTANT: A complete rebuild requires the Bun runtime's compile-time
 *     intrinsics (feature(), MACRO, bun:bundle). This script provides a
 *     best-effort build using esbuild. See KNOWN_ISSUES.md for details.
 *
 * What this script does:
 *   1. Copy src/ → build-src/ (original untouched)
 *   2. Replace `feature('X')` → `false`  (compile-time → runtime)
 *   3. Replace `MACRO.VERSION` etc → string literals
 *   4. Replace `import from 'bun:bundle'` → stub
 *   5. Create stubs for missing feature-gated modules
 *   6. Bundle with esbuild → dist/cli.js
 *
 * Requirements: Node.js >= 18, npm
 * Usage:       node scripts/build.mjs
 */

import { readdir, readFile, writeFile, mkdir, cp, rm, stat } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const VERSION = '2.1.88'
const BUILD = join(ROOT, 'build-src')
const ENTRY = join(BUILD, 'entry.ts')

// ── Helpers ────────────────────────────────────────────────────────────────

async function* walk(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory() && e.name !== 'node_modules') yield* walk(p)
    else yield p
  }
}

async function exists(p) { try { await stat(p); return true } catch { return false } }

async function ensureEsbuild() {
  try { execSync('npx esbuild --version', { stdio: 'pipe' }) }
  catch {
    console.log('📦 Installing esbuild...')
    execSync('npm install --save-dev esbuild', { cwd: ROOT, stdio: 'inherit' })
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// PHASE 1: Copy source
// ══════════════════════════════════════════════════════════════════════════════

await rm(BUILD, { recursive: true, force: true })
await mkdir(BUILD, { recursive: true })
await cp(join(ROOT, 'src'), join(BUILD, 'src'), { recursive: true })
console.log('✅ Phase 1: Copied src/ → build-src/')

// ══════════════════════════════════════════════════════════════════════════════
// PHASE 2: Transform source
// ══════════════════════════════════════════════════════════════════════════════

let transformCount = 0

// MACRO replacements
const MACROS = {
  'MACRO.VERSION_CHANGELOG': `''`,
  'MACRO.BUILD_TIME': `''`,
  'MACRO.FEEDBACK_CHANNEL': `'https://github.com/anthropics/claude-code/issues'`,
  'MACRO.ISSUES_EXPLAINER': `'https://github.com/anthropics/claude-code/issues/new/choose'`,
  'MACRO.FEEDBACK_CHANNEL_URL': `'https://github.com/anthropics/claude-code/issues'`,
  'MACRO.ISSUES_EXPLAINER_URL': `'https://github.com/anthropics/claude-code/issues/new/choose'`,
  'MACRO.NATIVE_PACKAGE_URL': `'@anthropic-ai/claude-code'`,
  'MACRO.PACKAGE_URL': `'@anthropic-ai/claude-code'`,
  'MACRO.VERSION': `'${VERSION}'`,
}

for await (const file of walk(join(BUILD, 'src'))) {
  if (!file.match(/\.[tj]sx?$/)) continue

  let src = await readFile(file, 'utf8')
  let changed = false

  // 2a. feature('X') → false
  if (/\bfeature\s*\(\s*['"][A-Z0-9_]+['"]\s*,?\s*\)/.test(src)) {
    src = src.replace(/\bfeature\s*\(\s*['"][A-Z0-9_]+['"]\s*,?\s*\)/g, 'false')
    changed = true
  }

  // 2b. MACRO.X → literals
  for (const [k, v] of Object.entries(MACROS).sort((a, b) => b[0].length - a[0].length)) {
    if (src.includes(k)) {
      src = src.replaceAll(k, v)
      changed = true
    }
  }

  // 2c. Remove bun:bundle import (feature() is already replaced)
  if (src.includes("from 'bun:bundle'") || src.includes('from "bun:bundle"')) {
    src = src.replace(/import\s*\{\s*feature\s*\}\s*from\s*['"]bun:bundle['"];?\n?/g, '// feature() replaced with false at build time\n')
    changed = true
  }

  // 2d. Remove type-only import of global.d.ts
  if (src.includes("import '../global.d.ts'") || src.includes("import './global.d.ts'")) {
    src = src.replace(/import\s*['"][.\/]*global\.d\.ts['"];?\n?/g, '')
    changed = true
  }

  if (changed) {
    await writeFile(file, src, 'utf8')
    transformCount++
  }
}
console.log(`✅ Phase 2: Transformed ${transformCount} files`)

// ══════════════════════════════════════════════════════════════════════════════
// PHASE 3: Create entry wrapper
// ══════════════════════════════════════════════════════════════════════════════

await writeFile(ENTRY, `#!/usr/bin/env node
// Claude Code v${VERSION} — built from source
// Copyright (c) Anthropic PBC. All rights reserved.
import './src/entrypoints/cli.tsx'
`, 'utf8')
await mkdir(join(BUILD, 'stubs'), { recursive: true })
await writeFile(
  join(BUILD, 'stubs', 'claude-for-chrome-mcp.js'),
  `// Auto-generated stub for private @ant/claude-for-chrome-mcp package
export const BROWSER_TOOLS = []
export function createClaudeForChromeMcpServer() {
  return { connect: async () => {} }
}
`,
  'utf8',
)
console.log('✅ Phase 3: Created entry wrapper')

// ══════════════════════════════════════════════════════════════════════════════
// PHASE 4: Iterative stub + bundle
// ══════════════════════════════════════════════════════════════════════════════

await ensureEsbuild()
const esbuild = await import('esbuild')

const OUT_DIR = join(ROOT, 'dist')
await mkdir(OUT_DIR, { recursive: true })
const OUT_FILE = join(OUT_DIR, 'cli.js')

async function writeStub(targetPath) {
  await mkdir(dirname(targetPath), { recursive: true }).catch(() => {})
  if (await exists(targetPath)) return false

  if (/\.(txt|md)$/.test(targetPath)) {
    await writeFile(targetPath, '', 'utf8')
  } else if (/\.json$/.test(targetPath)) {
    await writeFile(targetPath, '{}', 'utf8')
  } else {
    await writeFile(
      targetPath,
      `// Auto-generated stub for missing feature-gated module\nexport default function stub() {}\nexport const __stub = true\n`,
      'utf8',
    )
  }
  return true
}

function missingModulesFromErrors(errors) {
  const missing = []
  for (const error of errors ?? []) {
    const match = /Could not resolve "([^"]+)"/.exec(error.text ?? '')
    if (!match || !error.location?.file) continue
    missing.push({ specifier: match[1], importer: error.location.file })
  }
  return missing
}

function missingExportsFromErrors(errors) {
  const missing = []
  for (const error of errors ?? []) {
    const match = /No matching export in "([^"]+)" for import "([^"]+)"/.exec(
      error.text ?? '',
    )
    if (!match) continue
    missing.push({ modulePath: match[1], exportName: match[2] })
  }
  return missing
}

async function addNamedExport(modulePath, exportName) {
  const targetPath = modulePath.startsWith(BUILD)
    ? modulePath
    : join(ROOT, modulePath)
  if (!targetPath.startsWith(BUILD) || !(await exists(targetPath))) return false

  const src = await readFile(targetPath, 'utf8')
  const exportRe = new RegExp(`\\bexport\\s+(?:const|let|var|function|class)\\s+${exportName}\\b`)
  if (exportRe.test(src)) return false

  await writeFile(targetPath, `${src}\nexport const ${exportName} = undefined\n`, 'utf8')
  return true
}

// Run up to 5 rounds of: esbuild → collect missing → create stubs → retry
const MAX_ROUNDS = 5
let succeeded = false

for (let round = 1; round <= MAX_ROUNDS; round++) {
  console.log(`\n🔨 Phase 4 round ${round}/${MAX_ROUNDS}: Bundling...`)

  let esbuildErrors = []
  try {
    await esbuild.build({
      entryPoints: [ENTRY],
      bundle: true,
      platform: 'node',
      target: 'node18',
      format: 'esm',
      outfile: OUT_FILE,
      banner: {
        js: `import { createRequire as __createRequire } from "node:module";\nconst require = __createRequire(import.meta.url);\n// Claude Code v${VERSION} (built from source)\n// Copyright (c) Anthropic PBC. All rights reserved.\n`,
      },
      alias: {
        src: join(BUILD, 'src'),
        '@ant/claude-for-chrome-mcp': join(BUILD, 'stubs', 'claude-for-chrome-mcp.js'),
        'color-diff-napi': join(BUILD, 'src', 'native-ts', 'color-diff', 'index.ts'),
        'vscode-jsonrpc/node.js': 'vscode-jsonrpc/node',
      },
      external: [
        'bun:*',
        '*.node',
        'audio-capture-napi',
        'image-processor-napi',
        'modifiers-napi',
        'url-handler-napi',
      ],
      loader: {
        '.md': 'text',
        '.txt': 'text',
      },
      allowOverwrite: true,
      logLevel: 'silent',
      logLimit: 0,
      sourcemap: true,
    })
    succeeded = true
    break
  } catch (e) {
    esbuildErrors = e.errors ?? []
  }

  // Parse missing modules
  const missing = missingModulesFromErrors(esbuildErrors).filter(
    ({ specifier }) =>
      !specifier.startsWith('node:') &&
      !specifier.startsWith('bun:') &&
      !specifier.startsWith('/'),
  )
  const missingExports = missingExportsFromErrors(esbuildErrors)

  if (missing.length === 0 && missingExports.length === 0) {
    // No more missing modules but still errors — check what
    console.log('❌ Unrecoverable errors:')
    esbuildErrors.slice(0, 20).forEach(error => {
      const loc = error.location
        ? `${error.location.file}:${error.location.line}:${error.location.column}`
        : 'unknown'
      console.log(`   ${loc}: ${error.text}`)
    })
    break
  }

  console.log(
    `   Found ${missing.length} missing modules and ${missingExports.length} missing exports, updating stubs...`,
  )

  let stubCount = 0
  for (const { specifier, importer } of missing) {
    if (!specifier.startsWith('.')) continue

    const importerPath = join(ROOT, importer)
    const targetPath = join(dirname(importerPath), specifier)
    const relativeTarget = targetPath.startsWith(BUILD) ? targetPath : null
    if (!relativeTarget) continue

    if (await writeStub(relativeTarget)) stubCount++
  }

  let exportCount = 0
  for (const { modulePath, exportName } of missingExports) {
    if (await addNamedExport(modulePath, exportName)) exportCount++
  }
  console.log(`   Created ${stubCount} stubs, added ${exportCount} exports`)
  if (stubCount === 0 && exportCount === 0) {
    console.log('   No stub changes were possible. Remaining missing modules:')
    missing.slice(0, 30).forEach(({ specifier, importer }) => {
      console.log(`   - ${specifier} imported by ${importer}`)
    })
    break
  }
}

if (succeeded) {
  const size = (await stat(OUT_FILE)).size
  console.log(`\n✅ Build succeeded: ${OUT_FILE}`)
  console.log(`   Size: ${(size / 1024 / 1024).toFixed(1)}MB`)
  console.log(`\n   Usage:  node ${OUT_FILE} --version`)
  console.log(`           node ${OUT_FILE} -p "Hello"`)
} else {
  console.error('\n❌ Build failed after all rounds.')
  console.error('   The transformed source is in build-src/ for inspection.')
  console.error('\n   To fix manually:')
  console.error('   1. Check build-src/ for the transformed files')
  console.error('   2. Create missing stubs in build-src/src/')
  console.error('   3. Re-run: node scripts/build.mjs')
  process.exit(1)
}
