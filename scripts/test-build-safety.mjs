#!/usr/bin/env node

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import * as esbuild from 'esbuild'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const BUILD = join(ROOT, 'build-src')
const DIST_CLI = join(ROOT, 'dist', 'cli.js')
const TEST_DIR = join(BUILD, 'test-artifacts')

const results = []

async function test(name, fn) {
  try {
    await fn()
    results.push({ name, ok: true })
    console.log(`ok - ${name}`)
  } catch (error) {
    results.push({ name, ok: false, error })
    console.error(`not ok - ${name}`)
    console.error(error?.stack || error)
  }
}

async function pathExists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function* walkFiles(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory() && entry.name !== 'node_modules') {
      yield* walkFiles(full)
    } else if (entry.isFile()) {
      yield full
    }
  }
}

async function assertThrowsMessage(fn, pattern, label) {
  let thrown = null
  try {
    await fn()
  } catch (error) {
    thrown = error
  }
  assert(thrown, `${label} should throw`)
  assert.match(String(thrown.message), pattern, label)
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function buildAndRunSnippet(name, contents, options = {}) {
  const { alias: optionAlias, ...buildOptions } = options
  await mkdir(TEST_DIR, { recursive: true })
  const outfile = join(TEST_DIR, `${name}.mjs`)
  await esbuild.build({
    stdin: {
      contents,
      resolveDir: BUILD,
      loader: 'ts',
    },
    bundle: true,
    platform: 'node',
    target: 'node18',
    format: 'esm',
    outfile,
    packages: 'external',
    alias: {
      src: join(BUILD, 'src'),
      '@ant/claude-for-chrome-mcp': join(BUILD, 'stubs', 'claude-for-chrome-mcp.js'),
      'color-diff-napi': join(BUILD, 'src', 'native-ts', 'color-diff', 'index.ts'),
      'vscode-jsonrpc/node.js': 'vscode-jsonrpc/node',
      ...(optionAlias ?? {}),
    },
    logLevel: 'silent',
    ...buildOptions,
  })

  return execFileSync(process.execPath, [outfile], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

await test('build outputs exist before safety tests', async () => {
  assert.equal(await pathExists(BUILD), true, 'build-src missing; run npm run build first')
  assert.equal(await pathExists(DIST_CLI), true, 'dist/cli.js missing; run npm run build first')
})

let manifest
await test('stub manifest exists and covers all stub kinds', async () => {
  const manifestPath = join(BUILD, 'stub-manifest.json')
  manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  assert.equal(Array.isArray(manifest.entries), true)
  assert(manifest.entries.length > 0, 'expected at least one stub manifest entry')

  const kinds = new Set(manifest.entries.map(entry => entry.kind))
  assert(kinds.has('private-package-stub'), 'missing private-package-stub')
  assert(kinds.has('feature-gated-module-stub'), 'missing feature-gated-module-stub')
  assert(kinds.has('empty-asset-stub'), 'missing empty-asset-stub')

  for (const entry of manifest.entries) {
    assert(entry.kind, 'manifest entry missing kind')
    assert(entry.behavior, `manifest entry missing behavior: ${JSON.stringify(entry)}`)
    if (entry.path) {
      assert(!/^[a-zA-Z]:/.test(entry.path), `manifest path should be repo-relative: ${entry.path}`)
    }
  }
})

await test('generated stubs are fail-fast for default exports', async () => {
  const mod = await import(pathToFileURL(join(BUILD, 'src/tools/REPLTool/REPLTool.js')).href)
  await assertThrowsMessage(
    () => mod.default(),
    /Feature-gated module unavailable.*REPLTool\/REPLTool\.js#default/,
    'default export call',
  )
  await assertThrowsMessage(
    () => new mod.default(),
    /Feature-gated module unavailable.*REPLTool\/REPLTool\.js#default/,
    'default export constructor',
  )
  await assertThrowsMessage(
    () => mod.default.someProperty,
    /Feature-gated module unavailable.*REPLTool\/REPLTool\.js#default/,
    'default export property access',
  )
})

await test('generated stubs are fail-fast for missing named exports', async () => {
  const entry = manifest.entries.find(
    item => item.kind === 'missing-export-fail-fast' && item.path && item.exportName,
  )
  if (!entry) return

  const mod = await import(pathToFileURL(join(ROOT, entry.path)).href)
  const exported = mod[entry.exportName]
  assert(exported, `missing generated export ${entry.exportName}`)
  const pattern = new RegExp(
    `Feature-gated (?:export|module) unavailable.*${escapeRegExp(entry.exportName)}`,
  )
  await assertThrowsMessage(() => exported(), pattern, 'named export call')
  await assertThrowsMessage(
    () => Number(exported),
    pattern,
    'named export primitive coercion',
  )
})

await test('lazy tool export loader falls back to fail-fast default stubs', async () => {
  const output = await buildAndRunSnippet(
    'tool-loader-fallback-test',
    `import { loadToolExport } from './src/utils/toolModuleLoader.ts';
const tungsten = await import('./src/tools/TungstenTool/TungstenTool.js');
const tool = loadToolExport(
  tungsten,
  'TungstenTool',
  './src/tools/TungstenTool/TungstenTool.js',
);
let failedFast = false;
try {
  tool.name;
} catch (error) {
  failedFast = String(error.message).includes('Feature-gated module unavailable') &&
    String(error.message).includes('#default');
}
if (!failedFast) throw new Error('expected default tool stub to fail fast');
console.log('tool loader fallback OK');`,
  )
  assert.equal(output, 'tool loader fallback OK')
})

await test('generated build has no undefined export shims', async () => {
  const offenders = []
  for await (const file of walkFiles(BUILD)) {
    if (!/\.[cm]?[jt]sx?$/.test(file)) continue
    const text = await readFile(file, 'utf8')
    if (/export\s+const\s+\w+\s*=\s*undefined\b/.test(text)) {
      offenders.push(relative(ROOT, file).replace(/\\/g, '/'))
    }
  }
  assert.deepEqual(offenders, [])
})

await test('private Chrome MCP package stub is explicit', async () => {
  const mod = await import(pathToFileURL(join(BUILD, 'stubs/claude-for-chrome-mcp.js')).href)
  assert.deepEqual(mod.BROWSER_TOOLS, [])
  await assertThrowsMessage(
    () => mod.createClaudeForChromeMcpServer(),
    /Private package unavailable.*@ant\/claude-for-chrome-mcp/,
    'chrome mcp server creation',
  )
})

await test('optional native loader wraps missing modules', async () => {
  const output = await buildAndRunSnippet(
    'native-optional-test',
    `import { getOptionalNativeModuleMessage, importOptionalNativeModule } from './src/utils/nativeOptional.ts';
let error;
try {
  await importOptionalNativeModule('definitely-missing-native-module', 'test feature');
} catch (err) {
  error = err;
}
if (!error) throw new Error('missing native import should throw');
if (error.name !== 'OptionalNativeModuleUnavailableError') throw new Error('bad error name: ' + error.name);
if (error.moduleName !== 'definitely-missing-native-module') throw new Error('bad module name');
if (error.featureName !== 'test feature') throw new Error('bad feature name');
if (!getOptionalNativeModuleMessage(error).includes('definitely-missing-native-module')) throw new Error('bad message');
console.log('native optional OK');`,
  )
  assert.equal(output, 'native optional OK')
})

await test('runtime native imports use optional loader wrappers', async () => {
  const patterns = [
    [/await\s+import\(['"]audio-capture-napi['"]\)/, 'audio-capture-napi'],
    [/await\s+import\(['"]image-processor-napi['"]\)/, 'image-processor-napi'],
    [/await\s+import\(['"]url-handler-napi['"]\)/, 'url-handler-napi'],
    [/require\(['"]modifiers-napi['"]\)/, 'modifiers-napi'],
  ]
  const offenders = []
  for await (const file of walkFiles(join(ROOT, 'src'))) {
    if (!/\.[jt]sx?$/.test(file)) continue
    const text = await readFile(file, 'utf8')
    for (const [pattern, moduleName] of patterns) {
      if (pattern.test(text)) {
        offenders.push(`${relative(ROOT, file).replace(/\\/g, '/')}: ${moduleName}`)
      }
    }
  }
  assert.deepEqual(offenders, [])
})

await test('modifiers native fallback returns false on missing native package', async () => {
  const output = await buildAndRunSnippet(
    'modifiers-fallback-test',
    `import { isModifierPressed } from './src/utils/modifiers.ts';
Object.defineProperty(process, 'platform', { value: 'darwin' });
if (isModifierPressed('shift') !== false) throw new Error('expected false fallback');
console.log('modifiers fallback OK');`,
  )
  assert.equal(output, 'modifiers fallback OK')
})

await test('image processing handles real PNG and empty buffer guard', async () => {
  const output = await buildAndRunSnippet(
    'image-real-test',
    `import sharp from 'sharp';
import { maybeResizeAndDownsampleImageBuffer } from './src/utils/imageResizer.ts';
const input = await sharp({ create: { width: 10, height: 10, channels: 3, background: { r: 255, g: 0, b: 0 } } }).png().toBuffer();
const result = await maybeResizeAndDownsampleImageBuffer(input, input.length, 'png');
if (result.mediaType !== 'png' || result.buffer.length === 0) throw new Error('bad image result');
let emptyGuard = false;
try {
  await maybeResizeAndDownsampleImageBuffer(Buffer.alloc(0), 0, 'png');
} catch (error) {
  emptyGuard = String(error.message).includes('empty');
}
if (!emptyGuard) throw new Error('empty image guard did not trigger');
console.log('image processing OK');`,
  )
  assert.equal(output, 'image processing OK')
})

await test('voice dependency checks degrade without native audio', async () => {
  const output = await buildAndRunSnippet(
    'voice-fallback-test',
    `import { checkVoiceDependencies, checkRecordingAvailability } from './src/services/voice.ts';
const deps = await checkVoiceDependencies();
if (typeof deps.available !== 'boolean' || !Array.isArray(deps.missing)) throw new Error('bad deps shape');
const availability = await checkRecordingAvailability();
if (typeof availability.available !== 'boolean' || !Object.prototype.hasOwnProperty.call(availability, 'reason')) {
  throw new Error('bad availability shape');
}
console.log('voice fallback OK');`,
  )
  assert.equal(output, 'voice fallback OK')
})

await test('deep link parser accepts valid input and rejects injection-like input', async () => {
  const output = await buildAndRunSnippet(
    'deep-link-parser-test',
    `import { parseDeepLink, buildDeepLink } from './src/utils/deepLink/parseDeepLink.ts';
const parsed = parseDeepLink('claude-cli://open?q=hello+world&repo=owner/repo&cwd=C:/Users/test');
if (parsed.query !== 'hello world' || parsed.repo !== 'owner/repo') throw new Error('valid parse failed');
let badRepo = false;
try { parseDeepLink('claude-cli://open?repo=../../bad'); } catch { badRepo = true; }
if (!badRepo) throw new Error('bad repo accepted');
let badControl = false;
try { parseDeepLink('claude-cli://open?q=hello%0Aworld'); } catch { badControl = true; }
if (!badControl) throw new Error('control char query accepted');
const tooLong = 'a'.repeat(5001);
let longRejected = false;
try { parseDeepLink('claude-cli://open?q=' + tooLong); } catch { longRejected = true; }
if (!longRejected) throw new Error('long query accepted');
if (!buildDeepLink({ query: 'hello world' }).startsWith('claude-cli://open?')) throw new Error('build failed');
console.log('deep link parser OK');`,
  )
  assert.equal(output, 'deep link parser OK')
})

await test('CLI smoke commands still work', async () => {
  const version = execFileSync(process.execPath, [DIST_CLI, '--version'], {
    cwd: ROOT,
    encoding: 'utf8',
  }).trim()
  assert.match(version, /^2\.1\.88/)

  const help = execFileSync(process.execPath, [DIST_CLI, '--help'], {
    cwd: ROOT,
    encoding: 'utf8',
  })
  assert.match(help, /Usage: claude/)

  const doctorHelp = execFileSync(process.execPath, [DIST_CLI, 'doctor', '--help'], {
    cwd: ROOT,
    encoding: 'utf8',
  })
  assert.match(doctorHelp, /Usage: claude doctor/)

  execFileSync(process.execPath, ['--check', DIST_CLI], {
    cwd: ROOT,
    stdio: 'ignore',
  })
})

await rm(TEST_DIR, { recursive: true, force: true })

const failed = results.filter(result => !result.ok)
if (failed.length > 0) {
  console.error(`\n${failed.length}/${results.length} build-safety tests failed.`)
  process.exit(1)
}

console.log(`\n${results.length}/${results.length} build-safety tests passed.`)
