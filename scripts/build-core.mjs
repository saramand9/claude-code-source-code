#!/usr/bin/env node
/**
 * Build the headless agent core without changing Claude Code's query loop.
 *
 * The core entry reuses query() and Tool directly. The only production edge
 * replaced here is query.ts -> query/deps.ts: the standalone bundle must be
 * given QueryParams.deps explicitly instead of silently loading Claude Code's
 * default API/runtime stack.
 *
 * Outputs:
 *   dist-core/index.js
 *   dist-core/index.js.map
 *   dist-core/meta.json
 */

import { gzipSync } from 'node:zlib'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import {
  dirname,
  extname,
  isAbsolute,
  join,
  normalize,
  relative,
  resolve,
} from 'node:path'
import { fileURLToPath } from 'node:url'
import * as esbuild from 'esbuild'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(SCRIPT_DIR, '..')
const SOURCE_DIR = join(ROOT, 'src')
const ENTRY = join(SOURCE_DIR, 'core', 'index.ts')
const QUERY_FILE = join(SOURCE_DIR, 'query.ts')
const CLAUDE_API_FILE = join(SOURCE_DIR, 'services', 'api', 'claude.ts')
const DEFAULT_TOOLS_FILE = join(SOURCE_DIR, 'tools.ts')
const INK_ROOT_FILE = join(SOURCE_DIR, 'ink', 'root.ts')
const PRODUCT_MESSAGES_FILE = join(SOURCE_DIR, 'utils', 'messages.ts')
const CORE_MESSAGES_FILE = join(
  SOURCE_DIR,
  'core',
  'runtime',
  'messages.ts',
)
const PRODUCT_TOOL_EXECUTION_FILE = join(
  SOURCE_DIR,
  'services',
  'tools',
  'toolExecution.ts',
)
const CORE_TOOL_EXECUTION_FILE = join(
  SOURCE_DIR,
  'core',
  'runtime',
  'toolExecution.ts',
)
const STREAMING_TOOL_EXECUTOR_FILE = join(
  SOURCE_DIR,
  'services',
  'tools',
  'StreamingToolExecutor.ts',
)
const PRODUCT_ABORT_CONTROLLER_FILE = join(
  SOURCE_DIR,
  'utils',
  'abortController.ts',
)
const CORE_ABORT_CONTROLLER_FILE = join(
  SOURCE_DIR,
  'core',
  'runtime',
  'abortController.ts',
)
const OUT_DIR = join(ROOT, 'dist-core')
const OUT_FILE = join(OUT_DIR, 'index.js')
const META_FILE = join(OUT_DIR, 'meta.json')
const VERSION = '2.1.88'

const FEATURE_RE = /\bfeature\s*\(\s*['"]([A-Z0-9_]+)['"]\s*,?\s*\)/g
const BUN_FEATURE_IMPORT_RE =
  /import\s*\{\s*feature\s*\}\s*from\s*['"]bun:bundle['"];?\s*/g
const GLOBAL_TYPE_IMPORT_RE =
  /import\s*['"][.\/]*global\.d\.ts['"];?\s*/g

const MACROS = {
  'MACRO.VERSION_CHANGELOG': "''",
  'MACRO.FEEDBACK_CHANNEL_URL':
    "'https://github.com/anthropics/claude-code/issues'",
  'MACRO.ISSUES_EXPLAINER_URL':
    "'https://github.com/anthropics/claude-code/issues/new/choose'",
  'MACRO.FEEDBACK_CHANNEL':
    "'https://github.com/anthropics/claude-code/issues'",
  'MACRO.ISSUES_EXPLAINER':
    "'https://github.com/anthropics/claude-code/issues/new/choose'",
  'MACRO.NATIVE_PACKAGE_URL': "'@anthropic-ai/claude-code'",
  'MACRO.PACKAGE_URL': "'@anthropic-ai/claude-code'",
  'MACRO.BUILD_TIME': "''",
  'MACRO.VERSION': JSON.stringify(VERSION),
}

const SOURCE_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx'])
const CORE_DEPS_NAMESPACE = 'claude-code-core-query-deps'
const CORE_DEPS_MODULE = 'query-deps'
const CORE_CLAUDE_API_NAMESPACE = 'claude-code-core-unavailable-claude-api'
const CORE_CLAUDE_API_MODULE = 'claude-api'
const CORE_DEFAULT_TOOLS_NAMESPACE = 'claude-code-core-no-default-tools'
const CORE_DEFAULT_TOOLS_MODULE = 'default-tools'
const CORE_INK_ROOT_NAMESPACE = 'claude-code-core-no-ink-root'
const CORE_INK_ROOT_MODULE = 'ink-root'

function normalizedPath(path) {
  const value = normalize(resolve(path))
  return process.platform === 'win32' ? value.toLowerCase() : value
}

function isInside(parent, child) {
  const pathFromParent = relative(parent, child)
  return (
    pathFromParent === '' ||
    (!pathFromParent.startsWith('..') && !isAbsolute(pathFromParent))
  )
}

function loaderFor(path) {
  switch (extname(path).toLowerCase()) {
    case '.tsx':
      return 'tsx'
    case '.jsx':
      return 'jsx'
    case '.ts':
      return 'ts'
    default:
      return 'js'
  }
}

function transformCoreSource(source) {
  let transformed = source
    .replace(FEATURE_RE, 'false')
    .replace(BUN_FEATURE_IMPORT_RE, '')
    .replace(GLOBAL_TYPE_IMPORT_RE, '')

  for (const [macro, value] of Object.entries(MACROS).sort(
    ([left], [right]) => right.length - left.length,
  )) {
    transformed = transformed.replaceAll(macro, value)
  }

  return transformed
}

function coreSourcePlugin() {
  return {
    name: 'claude-code-core-source',
    setup(build) {
      build.onLoad({ filter: /\.[cm]?[jt]sx?$/ }, async args => {
        if (!isInside(SOURCE_DIR, args.path)) return undefined
        if (!SOURCE_EXTENSIONS.has(extname(args.path).toLowerCase())) {
          return undefined
        }

        const source = await readFile(args.path, 'utf8')
        return {
          contents: transformCoreSource(source),
          loader: loaderFor(args.path),
          resolveDir: dirname(args.path),
        }
      })
    },
  }
}

function coreRuntimeBoundaryPlugin() {
  const normalizedQueryFile = normalizedPath(QUERY_FILE)
  const normalizedClaudeApiFile = normalizedPath(CLAUDE_API_FILE)
  const normalizedDefaultToolsFile = normalizedPath(DEFAULT_TOOLS_FILE)
  const normalizedInkRootFile = normalizedPath(INK_ROOT_FILE)
  const normalizedProductMessagesFile = normalizedPath(PRODUCT_MESSAGES_FILE)
  const normalizedProductToolExecutionFile = normalizedPath(
    PRODUCT_TOOL_EXECUTION_FILE,
  )
  const normalizedProductAbortControllerFile = normalizedPath(
    PRODUCT_ABORT_CONTROLLER_FILE,
  )
  const coreMessageImporters = new Set([
    normalizedQueryFile,
    normalizedPath(STREAMING_TOOL_EXECUTOR_FILE),
  ])

  return {
    name: 'claude-code-core-runtime-boundary',
    setup(build) {
      build.onResolve({ filter: /^\.\/query\/deps\.js$/ }, args => {
        if (normalizedPath(args.importer) !== normalizedQueryFile) {
          return undefined
        }

        return {
          path: CORE_DEPS_MODULE,
          namespace: CORE_DEPS_NAMESPACE,
        }
      })

      build.onResolve({ filter: /claude\.js$/ }, args => {
        const importTarget = args.path.startsWith('src/')
          ? resolve(ROOT, args.path)
          : resolve(args.resolveDir, args.path)
        const sourceTarget = importTarget.replace(/\.js$/i, '.ts')

        if (normalizedPath(sourceTarget) !== normalizedClaudeApiFile) {
          return undefined
        }

        return {
          path: CORE_CLAUDE_API_MODULE,
          namespace: CORE_CLAUDE_API_NAMESPACE,
        }
      })

      build.onResolve({ filter: /tools\.js$/ }, args => {
        const importTarget = args.path.startsWith('src/')
          ? resolve(ROOT, args.path)
          : resolve(args.resolveDir, args.path)
        const sourceTarget = importTarget.replace(/\.js$/i, '.ts')

        if (normalizedPath(sourceTarget) !== normalizedDefaultToolsFile) {
          return undefined
        }

        return {
          path: CORE_DEFAULT_TOOLS_MODULE,
          namespace: CORE_DEFAULT_TOOLS_NAMESPACE,
        }
      })

      build.onResolve({ filter: /root\.js$/ }, args => {
        const importTarget = args.path.startsWith('src/')
          ? resolve(ROOT, args.path)
          : resolve(args.resolveDir, args.path)
        const sourceTarget = importTarget.replace(/\.js$/i, '.ts')

        if (normalizedPath(sourceTarget) !== normalizedInkRootFile) {
          return undefined
        }

        return {
          path: CORE_INK_ROOT_MODULE,
          namespace: CORE_INK_ROOT_NAMESPACE,
        }
      })

      build.onResolve({ filter: /messages\.js$/ }, args => {
        if (!coreMessageImporters.has(normalizedPath(args.importer))) {
          return undefined
        }

        const importTarget = args.path.startsWith('src/')
          ? resolve(ROOT, args.path)
          : resolve(args.resolveDir, args.path)
        const sourceTarget = importTarget.replace(/\.js$/i, '.ts')
        if (normalizedPath(sourceTarget) !== normalizedProductMessagesFile) {
          return undefined
        }

        return { path: CORE_MESSAGES_FILE }
      })

      build.onResolve({ filter: /toolExecution\.js$/ }, args => {
        const importTarget = args.path.startsWith('src/')
          ? resolve(ROOT, args.path)
          : resolve(args.resolveDir, args.path)
        const sourceTarget = importTarget.replace(/\.js$/i, '.ts')
        if (
          normalizedPath(sourceTarget) !== normalizedProductToolExecutionFile
        ) {
          return undefined
        }

        return { path: CORE_TOOL_EXECUTION_FILE }
      })

      build.onResolve({ filter: /abortController\.js$/ }, args => {
        if (
          normalizedPath(args.importer) !==
          normalizedPath(STREAMING_TOOL_EXECUTOR_FILE)
        ) {
          return undefined
        }

        const importTarget = args.path.startsWith('src/')
          ? resolve(ROOT, args.path)
          : resolve(args.resolveDir, args.path)
        const sourceTarget = importTarget.replace(/\.js$/i, '.ts')
        if (
          normalizedPath(sourceTarget) !==
          normalizedProductAbortControllerFile
        ) {
          return undefined
        }

        return { path: CORE_ABORT_CONTROLLER_FILE }
      })

      build.onLoad(
        { filter: /.*/, namespace: CORE_DEPS_NAMESPACE },
        () => ({
          contents: `
const MESSAGE =
  'Claude Code headless core requires QueryParams.deps. ' +
  'Pass every QueryDeps field explicitly.'

export function productionDeps() {
  throw new Error(MESSAGE)
}
`,
          loader: 'js',
        }),
      )

      build.onLoad(
        { filter: /.*/, namespace: CORE_CLAUDE_API_NAMESPACE },
        () => ({
          contents: `
const MESSAGE =
  'The Claude Code production API adapter is not available in the headless core. ' +
  'Route model calls through QueryParams.deps.'

function unavailable() {
  throw new Error(MESSAGE)
}

export const MAX_NON_STREAMING_TOKENS = 64_000
export const accumulateUsage = unavailable
export const addCacheBreakpoints = unavailable
export const adjustParamsForNonStreaming = unavailable
export const assistantMessageToMessageParam = unavailable
export const buildSystemPromptBlocks = unavailable
export const cleanupStream = unavailable
export const configureTaskBudgetParams = unavailable
export const executeNonStreamingRequest = unavailable
export const getAPIMetadata = unavailable
export const getCacheControl = unavailable
export const getExtraBodyParams = unavailable
export const getMaxOutputTokensForModel = unavailable
export const getPromptCachingEnabled = unavailable
export const queryHaiku = unavailable
export const queryModelWithoutStreaming = unavailable
export const queryModelWithStreaming = unavailable
export const queryWithModel = unavailable
export const stripExcessMediaItems = unavailable
export const updateUsage = unavailable
export const userMessageToMessageParam = unavailable
export const verifyApiKey = unavailable
`,
          loader: 'js',
        }),
      )

      build.onLoad(
        { filter: /.*/, namespace: CORE_DEFAULT_TOOLS_NAMESPACE },
        () => ({
          contents: `
// A headless host supplies Tool[] through ToolUseContext. The product-wide
// default registry is a host concern and must not enter this bundle.
export function getAllBaseTools() {
  return []
}

export function getTools() {
  return []
}

export function assembleToolPool(_permissionContext, suppliedTools = []) {
  return [...suppliedTools]
}

export const ALL_AGENT_DISALLOWED_TOOLS = new Set()

export function getToolsForDefaultPreset() {
  return []
}

export function parseToolPreset() {
  return null
}
`,
          loader: 'js',
        }),
      )

      build.onLoad(
        { filter: /.*/, namespace: CORE_INK_ROOT_NAMESPACE },
        () => ({
          contents: `
const MESSAGE =
  'The Ink/TUI renderer is not available in the Claude Code headless core.'

function unavailable() {
  throw new Error(MESSAGE)
}

export default unavailable
export const createRoot = unavailable
export const renderSync = unavailable
`,
          loader: 'js',
        }),
      )
    },
  }
}

async function assertEntryExists() {
  try {
    await stat(ENTRY)
  } catch {
    throw new Error(
      `Core entry not found: ${relative(ROOT, ENTRY).replace(/\\/g, '/')}`,
    )
  }
}

await assertEntryExists()
await mkdir(OUT_DIR, { recursive: true })

const result = await esbuild.build({
  entryPoints: [ENTRY],
  absWorkingDir: ROOT,
  bundle: true,
  platform: 'neutral',
  target: 'es2022',
  format: 'esm',
  outfile: OUT_FILE,
  metafile: true,
  sourcemap: true,
  minify: true,
  treeShaking: true,
  legalComments: 'none',
  allowOverwrite: true,
  logLevel: 'info',
  alias: {
    src: SOURCE_DIR,
    '@ant/claude-for-chrome-mcp': join(
      SOURCE_DIR,
      'stubs',
      'claude-for-chrome-mcp.ts',
    ),
    'color-diff-napi': join(SOURCE_DIR, 'native-ts', 'color-diff', 'index.ts'),
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
  plugins: [coreRuntimeBoundaryPlugin(), coreSourcePlugin()],
})

const inputPaths = new Set(
  Object.keys(result.metafile.inputs).map(path => path.replace(/\\/g, '/')),
)
const forbiddenInputs = [
  'src/query/deps.ts',
  'src/services/api/claude.ts',
  'src/tools.ts',
  'src/utils/messages.ts',
  'src/services/tools/toolExecution.ts',
  'src/utils/abortController.ts',
  'src/ink/root.ts',
  'src/ink/components/App.tsx',
  'src/screens/REPL.tsx',
].filter(path => inputPaths.has(path))

if (forbiddenInputs.length > 0) {
  throw new Error(
    `Core bundle unexpectedly contains production dependencies: ${forbiddenInputs.join(', ')}`,
  )
}

await writeFile(META_FILE, `${JSON.stringify(result.metafile, null, 2)}\n`, 'utf8')

const bundle = await readFile(OUT_FILE)
const rawBytes = bundle.byteLength
const gzipBytes = gzipSync(bundle, { level: 9 }).byteLength
const inputCount = Object.keys(result.metafile.inputs).length
const emittedInputCount = Object.values(result.metafile.outputs).reduce(
  (paths, output) => {
    for (const [path, contribution] of Object.entries(output.inputs ?? {})) {
      if (contribution.bytesInOutput > 0) paths.add(path)
    }
    return paths
  },
  new Set(),
).size

function formatSize(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(2)} MiB`
}

console.log('\nHeadless core build complete')
console.log(`  Bundle: ${relative(ROOT, OUT_FILE).replace(/\\/g, '/')}`)
console.log(`  Metafile: ${relative(ROOT, META_FILE).replace(/\\/g, '/')}`)
console.log(`  Raw: ${formatSize(rawBytes)} (${rawBytes} bytes)`)
console.log(`  Gzip: ${formatSize(gzipBytes)} (${gzipBytes} bytes)`)
console.log(`  Inputs: ${inputCount} parsed / ${emittedInputCount} emitted`)
