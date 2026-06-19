#!/usr/bin/env node

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import * as esbuild from 'esbuild'
import {
  ALLOW_UNAUDITED_FEATURES_ENV,
  DEFAULT_PRESERVED_FEATURES,
  PRESERVE_FEATURES_ENV,
  getEnvPreservedFeatures,
  validateFeatureGatePolicy,
} from './feature-gate-policy.mjs'

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

function assertVersionAtLeast(version, minimum, label) {
  const actual = String(version)
    .split('.')
    .map(part => Number.parseInt(part, 10))
  for (let i = 0; i < minimum.length; i += 1) {
    const actualPart = Number.isFinite(actual[i]) ? actual[i] : 0
    if (actualPart > minimum[i]) return
    if (actualPart < minimum[i]) {
      assert.fail(`${label} expected >= ${minimum.join('.')}, got ${version}`)
    }
  }
}

async function buildAndRunSnippet(name, contents, options = {}) {
  const { alias: optionAlias, banner: optionBanner, ...buildOptions } = options
  await mkdir(TEST_DIR, { recursive: true })
  const outfile = join(TEST_DIR, `${name}.mjs`)
  const jsoncStub = join(TEST_DIR, 'jsonc-parser-main-stub.mjs')
  const semverStub = join(TEST_DIR, 'semver-stub.mjs')
  await writeFile(
    jsoncStub,
    `export function parse(json) { return JSON.parse(json); }
export function modify() { return []; }
export function applyEdits(content) { return content; }
`,
  )
  await writeFile(
    semverStub,
    `export function satisfies() { return true; }
export function coerce(value) {
  const version = String(value ?? '0.0.0').match(/\\d+(?:\\.\\d+)?(?:\\.\\d+)?/)?.[0] ?? '0.0.0';
  return { version, raw: version, major: 0, minor: 0, patch: 0 };
}
export function valid(value) { return String(value ?? '0.0.0'); }
export default { coerce, satisfies, valid };
`,
  )
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
    loader: {
      '.txt': 'text',
      '.md': 'text',
      ...(buildOptions.loader ?? {}),
    },
    banner: {
      js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
      ...(optionBanner ?? {}),
    },
    alias: {
      src: join(BUILD, 'src'),
      '@ant/claude-for-chrome-mcp': join(BUILD, 'src', 'stubs', 'claude-for-chrome-mcp.ts'),
      'color-diff-napi': join(BUILD, 'src', 'native-ts', 'color-diff', 'index.ts'),
      'jsonc-parser/lib/esm/main.js': jsoncStub,
      semver: semverStub,
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

await test('feature gate env preservation requires explicit audit override', async () => {
  assert.deepEqual(
    getEnvPreservedFeatures({
      [PRESERVE_FEATURES_ENV]: 'KAIROS, DAEMON\nHISTORY_SNIP KAIROS',
    }),
    ['KAIROS', 'DAEMON', 'HISTORY_SNIP'],
  )

  const sourceFeatures = [...DEFAULT_PRESERVED_FEATURES, 'KAIROS']
  const blocked = validateFeatureGatePolicy({
    sourceFeatures,
    envPreservedFeatures: ['KAIROS'],
    allowUnaudited: false,
  })
  assert.equal(blocked.ok, false)
  assert.deepEqual(blocked.unauditedFeatures, ['KAIROS'])
  assert.match(
    blocked.errors.join('\n'),
    new RegExp(ALLOW_UNAUDITED_FEATURES_ENV),
  )

  const allowed = validateFeatureGatePolicy({
    sourceFeatures,
    envPreservedFeatures: ['KAIROS'],
    allowUnaudited: true,
  })
  assert.equal(allowed.ok, true)

  const unknown = validateFeatureGatePolicy({
    sourceFeatures,
    envPreservedFeatures: ['DOES_NOT_EXIST'],
    allowUnaudited: true,
  })
  assert.equal(unknown.ok, false)
  assert.deepEqual(unknown.unknownFeatures, ['DOES_NOT_EXIST'])
})

await test('build outputs exist before safety tests', async () => {
  assert.equal(await pathExists(BUILD), true, 'build-src missing; run npm run build first')
  assert.equal(await pathExists(DIST_CLI), true, 'dist/cli.js missing; run npm run build first')
})

await test('dependency overrides keep known npm audit fixes in place', async () => {
  const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'))
  const lock = JSON.parse(await readFile(join(ROOT, 'package-lock.json'), 'utf8'))
  assert.equal(pkg.engines?.node, '>=18.17.0')
  assert.equal(pkg.devDependencies?.esbuild, '^0.28.1')
  assert.equal(pkg.dependencies?.undici, '^6.27.0')
  assert.equal(pkg.overrides?.tmp, '^0.2.6')
  assert.equal(pkg.overrides?.['google-auth-library'], '$google-auth-library')

  const packages = lock.packages ?? {}
  assertVersionAtLeast(
    packages['node_modules/esbuild']?.version,
    [0, 28, 1],
    'esbuild',
  )
  assertVersionAtLeast(packages['node_modules/tmp']?.version, [0, 2, 6], 'tmp')
  assertVersionAtLeast(
    packages['node_modules/undici']?.version,
    [6, 27, 0],
    'undici',
  )
  assert.equal(
    String(packages['node_modules/undici']?.version ?? '').startsWith('8.'),
    false,
    'undici 8.x currently requires a newer Node runtime than package engines declare',
  )
  assert.match(
    packages['node_modules/undici']?.engines?.node ?? '',
    /^>=18\.17$/,
    'undici should stay compatible with the package Node engine',
  )
  assert.equal(
    packages[
      'node_modules/@anthropic-ai/vertex-sdk/node_modules/google-auth-library'
    ],
    undefined,
    'vertex-sdk should use the root google-auth-library override',
  )
  const uuidPackage = packages['node_modules/uuid']
  if (uuidPackage) {
    assertVersionAtLeast(uuidPackage.version, [11, 1, 1], 'uuid')
  }
})

await test('undici proxy and mTLS APIs remain available', async () => {
  const output = await buildAndRunSnippet(
    'undici-api-test',
    `import * as undici from 'undici';
for (const name of ['EnvHttpProxyAgent', 'Agent', 'setGlobalDispatcher']) {
  if (typeof undici[name] !== 'function') {
    throw new Error('missing undici API: ' + name);
  }
}
const proxy = new undici.EnvHttpProxyAgent({
  httpProxy: 'http://127.0.0.1:9',
  httpsProxy: 'http://127.0.0.1:9',
  noProxy: '',
});
const agent = new undici.Agent({ connect: {}, pipelining: 1 });
await proxy.close();
await agent.close();
console.log('undici API OK');`,
  )
  assert.equal(output, 'undici API OK')
})

await test('vertex SDK still works with google-auth override', async () => {
  const output = await buildAndRunSnippet(
    'vertex-sdk-override-test',
    `const [{ AnthropicVertex }, { GoogleAuth }] = await Promise.all([
  import('@anthropic-ai/vertex-sdk'),
  import('google-auth-library'),
]);
if (typeof GoogleAuth !== 'function') throw new Error('missing GoogleAuth constructor');
const client = new AnthropicVertex({
  region: 'us-east5',
  projectId: 'test-project',
  googleAuth: {
    getClient: async () => ({
      getRequestHeaders: async () => ({}),
    }),
  },
  fetch: async () => new Response('{}', { status: 200 }),
});
if (!client.messages) throw new Error('missing Vertex messages API');
console.log('vertex SDK OK');`,
  )
  assert.equal(output, 'vertex SDK OK')
})

let manifest
await test('stub manifest exists and records current stub kinds', async () => {
  const manifestPath = join(BUILD, 'stub-manifest.json')
  manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  assert.equal(Array.isArray(manifest.entries), true)

  const kinds = new Set(manifest.entries.map(entry => entry.kind))
  assert(!kinds.has('private-package-stub'), 'private package stubs should be source shims or real modules')
  assert(!kinds.has('empty-asset-stub'), 'empty asset stubs should be restored or made fail-fast')

  for (const entry of manifest.entries) {
    assert(entry.kind, 'manifest entry missing kind')
    assert(entry.behavior, `manifest entry missing behavior: ${JSON.stringify(entry)}`)
    if (entry.path) {
      assert(!/^[a-zA-Z]:/.test(entry.path), `manifest path should be repo-relative: ${entry.path}`)
    }
  }
})

await test('protected namespace guard is implemented and conservative', async () => {
  const protectedNamespaceEntry = manifest.entries.find(entry =>
    String(entry.path ?? '').includes('protectedNamespace'),
  )
  assert.equal(protectedNamespaceEntry, undefined)

  const output = await buildAndRunSnippet(
    'protected-namespace-test',
    `import { checkProtectedNamespace } from './src/utils/protectedNamespace.ts';
const initialEnv = { ...process.env };
const managedKeys = [
  'ASL',
  'ASL_LEVEL',
  'CLAUDE_CODE_HOMESPACE',
  'CLAUDE_CODE_K8S_NAMESPACE_PATH',
  'CLAUDE_CODE_NAMESPACE',
  'CLAUDE_CODE_OPEN_NAMESPACES',
  'CLUSTER',
  'COO_ASL',
  'COO_CLUSTER',
  'COO_CLUSTER_NAME',
  'COO_NAMESPACE',
  'COO_NAMESPACE_SECURITY_LEVEL',
  'COO_RUNNING_ON_HOMESPACE',
  'COO_SECURITY_LEVEL',
  'KUBERNETES_NAMESPACE',
  'KUBERNETES_SERVICE_HOST',
  'NAMESPACE',
  'POD_NAMESPACE',
  'SECURITY_LEVEL',
];
function withEnv(values, expected, label) {
  for (const key of managedKeys) delete process.env[key];
  Object.assign(process.env, values);
  process.env.CLAUDE_CODE_K8S_NAMESPACE_PATH = 'Z:/definitely/missing/namespace';
  const actual = checkProtectedNamespace();
  if (actual !== expected) {
    throw new Error(label + ': expected ' + expected + ', got ' + actual);
  }
}
withEnv({}, false, 'local');
withEnv({ COO_RUNNING_ON_HOMESPACE: '1', COO_NAMESPACE: 'production' }, false, 'homespace');
withEnv({ KUBERNETES_SERVICE_HOST: '10.0.0.1', COO_NAMESPACE: 'default' }, false, 'default namespace');
withEnv({ KUBERNETES_SERVICE_HOST: '10.0.0.1', COO_NAMESPACE: 'production' }, true, 'production namespace');
withEnv({ KUBERNETES_SERVICE_HOST: '10.0.0.1', COO_NAMESPACE: 'unknown-team' }, true, 'unknown namespace');
withEnv({ KUBERNETES_SERVICE_HOST: '10.0.0.1', COO_NAMESPACE: 'default', COO_ASL: '3' }, true, 'asl3 override');
withEnv({ COO_CLUSTER: 'cluster-a' }, true, 'cluster without namespace');
withEnv({ KUBERNETES_SERVICE_HOST: '10.0.0.1', COO_NAMESPACE: 'research', CLAUDE_CODE_OPEN_NAMESPACES: 'research' }, false, 'configured open namespace');
for (const key of managedKeys) delete process.env[key];
Object.assign(process.env, initialEnv);
console.log('protected namespace OK');`,
  )
  assert.equal(output, 'protected namespace OK')
})

await test('ant-only callout components are loadable and conservative', async () => {
  const missingCallouts = manifest.entries.filter(entry =>
    /(?:AntModelSwitchCallout|UndercoverAutoCallout)/.test(String(entry.path ?? '')),
  )
  assert.deepEqual(missingCallouts, [])

  const output = await buildAndRunSnippet(
    'ant-callout-test',
    `import React from 'react';
import { mkdir } from 'node:fs/promises';
import { PassThrough, Writable } from 'node:stream';
import { AntModelSwitchCallout, shouldShowModelSwitchCallout } from './src/components/AntModelSwitchCallout.tsx';
import { UndercoverAutoCallout } from './src/components/UndercoverAutoCallout.tsx';
const initialEnv = { ...process.env };
process.env.USER_TYPE = 'ant';
delete process.env.CLAUDE_CODE_ENABLE_MODEL_SWITCH_CALLOUT;
delete process.env.CLAUDE_CODE_MODEL_SWITCH_TARGET;
if (shouldShowModelSwitchCallout()) throw new Error('model switch should be disabled by default');
process.env.CLAUDE_CODE_ENABLE_MODEL_SWITCH_CALLOUT = '1';
process.env.CLAUDE_CODE_MODEL_SWITCH_TARGET = 'claude-sonnet-4-6';
process.env.CLAUDE_CONFIG_DIR = '${TEST_DIR.replace(/\\/g, '\\\\')}/callout-config';
await mkdir(process.env.CLAUDE_CONFIG_DIR, { recursive: true });
const { enableConfigs } = await import('./src/utils/config.ts');
enableConfigs();
const { renderSync } = await import('./src/ink/root.ts');
if (!shouldShowModelSwitchCallout()) throw new Error('model switch should be opt-in visible');
const modelElement = React.createElement(AntModelSwitchCallout, { onDone: () => {} });
const undercoverElement = React.createElement(UndercoverAutoCallout, { onDone: () => {} });
if (modelElement.type !== AntModelSwitchCallout) throw new Error('bad model callout element');
if (undercoverElement.type !== UndercoverAutoCallout) throw new Error('bad undercover callout element');

class CaptureStream extends Writable {
  constructor() {
    super();
    this.chunks = [];
    this.columns = 100;
    this.rows = 30;
    this.isTTY = true;
  }
  _write(chunk, _encoding, callback) {
    this.chunks.push(Buffer.from(chunk).toString('utf8'));
    callback();
  }
  get output() {
    return this.chunks.join('');
  }
}
function createStdin() {
  const stdin = new PassThrough();
  stdin.isTTY = true;
  stdin.setRawMode = () => stdin;
  stdin.ref = () => stdin;
  stdin.unref = () => stdin;
  stdin.setEncoding('utf8');
  return stdin;
}
function normalizeOutput(output) {
  return output
    .replace(/\\x1b\\[(\\d+)C/g, (_, count) => ' '.repeat(Number(count)))
    .replace(/\\x1b\\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\\r/g, '');
}
async function renderToText(element) {
  const stdout = new CaptureStream();
  const stderr = new CaptureStream();
  const instance = renderSync(element, {
    stdout,
    stderr,
    stdin: createStdin(),
    exitOnCtrlC: false,
    patchConsole: false,
  });
  await new Promise(resolve => setTimeout(resolve, 50));
  instance.unmount();
  instance.cleanup();
  return normalizeOutput(stdout.output);
}
const modelOutput = await renderToText(modelElement);
if (!modelOutput.includes('Model Update')) throw new Error('missing model callout title: ' + JSON.stringify(modelOutput));
if (!modelOutput.includes('claude-sonnet-4-6')) throw new Error('missing model callout target: ' + JSON.stringify(modelOutput));
const undercoverOutput = await renderToText(undercoverElement);
if (!undercoverOutput.includes('Public Repository Safety')) throw new Error('missing undercover title: ' + JSON.stringify(undercoverOutput));
if (!undercoverOutput.includes('public or external')) throw new Error('missing undercover body: ' + JSON.stringify(undercoverOutput));

process.env = initialEnv;
console.log('ant callouts OK');`,
    {
      banner: {
        js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
      },
    },
  )
  assert.match(output, /ant callouts OK$/)
})

await test('generated feature stubs are fail-fast for default exports when present', async () => {
  const entry = manifest.entries.find(
    item => item.kind === 'feature-gated-module-stub' && item.path,
  )
  if (!entry) return

  const mod = await import(pathToFileURL(join(ROOT, entry.path)).href)
  const pathPattern = new RegExp(escapeRegExp(String(entry.path).replace(/^build-src\/src\//, '').replace(/\.js$/, '.js#default')))
  await assertThrowsMessage(
    () => mod.default(),
    pathPattern,
    'default export call',
  )
  await assertThrowsMessage(
    () => new mod.default(),
    pathPattern,
    'default export constructor',
  )
  await assertThrowsMessage(
    () => mod.default.someProperty,
    pathPattern,
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

await test('lazy tool export loader prefers named exports and falls back to default', async () => {
  const output = await buildAndRunSnippet(
    'tool-loader-fallback-test',
    `import { loadToolExport } from './src/utils/toolModuleLoader.ts';
const named = { name: 'NamedTool' };
const fallback = { name: 'DefaultTool' };
if (loadToolExport({ REPLTool: named, default: fallback }, 'REPLTool', 'named').name !== 'NamedTool') {
  throw new Error('named export should win');
}
if (loadToolExport({ default: fallback }, 'MissingTool', 'fallback').name !== 'DefaultTool') {
  throw new Error('default export should be fallback');
}
console.log('tool loader fallback OK');`,
  )
  assert.equal(output, 'tool loader fallback OK')
})

await test('ant-only REPL/background PR/agents-platform fallbacks are loadable', async () => {
  const antStubEntries = manifest.entries.filter(entry =>
    /(?:REPLTool|SuggestBackgroundPRTool|commands\/agents-platform)/.test(
      String(entry.path ?? ''),
    ),
  )
  assert.deepEqual(antStubEntries, [])
  const featureStubEntries = manifest.entries.filter(
    entry => entry.kind === 'feature-gated-module-stub',
  )
  assert.deepEqual(featureStubEntries, [])

  const output = await buildAndRunSnippet(
    'ant-only-tool-command-fallback-test',
    `const initialEnv = { ...process.env };
process.env.USER_TYPE = 'ant';
process.env.CLAUDE_CODE_ENTRYPOINT = 'cli';
delete process.env.CLAUDE_CODE_REPL;
delete process.env.CLAUDE_REPL_MODE;

const { REPLTool } = await import('./src/tools/REPLTool/REPLTool.ts');
const { SuggestBackgroundPRTool } = await import('./src/tools/SuggestBackgroundPRTool/SuggestBackgroundPRTool.ts');
const { default: agentsPlatform } = await import('./src/commands/agents-platform/index.ts');
const { getTools } = await import('./src/tools.ts');
const { getEmptyToolPermissionContext } = await import('./src/Tool.ts');

if (REPLTool.isEnabled()) throw new Error('REPLTool should be disabled');
if (SuggestBackgroundPRTool.isEnabled()) throw new Error('SuggestBackgroundPRTool should be disabled');
if (agentsPlatform.isEnabled?.() !== false || agentsPlatform.isHidden !== true) {
  throw new Error('agents platform command should be hidden and disabled');
}
const replResult = await REPLTool.call({});
if (replResult.data.status !== 'unavailable') throw new Error('bad REPL result');
const prResult = await SuggestBackgroundPRTool.call({});
if (prResult.data.status !== 'unavailable') throw new Error('bad SuggestBackgroundPR result');

const tools = getTools(getEmptyToolPermissionContext());
const names = tools.map(tool => tool.name);
for (const required of ['Read', 'Bash', 'Edit']) {
  if (!names.includes(required)) {
    throw new Error('missing primitive tool when REPL fallback is disabled: ' + required + ' in ' + names.join(','));
  }
}
if (names.includes('REPL') || names.includes('SuggestBackgroundPR')) {
  throw new Error('disabled ant-only tools should not be exposed: ' + names.join(','));
}
process.env = initialEnv;
console.log('ant-only fallbacks OK');`,
    {
      banner: {
        js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
      },
    },
  )
  assert.equal(output, 'ant-only fallbacks OK')
})

await test('devtools and Tungsten external fallbacks are loadable', async () => {
  const missingFallbacks = manifest.entries.filter(entry =>
    /(?:ink\/devtools|TungstenTool\/TungstenTool)/.test(String(entry.path ?? '')),
  )
  assert.deepEqual(missingFallbacks, [])
  const replSource = await readFile(join(BUILD, 'src/screens/REPL.tsx'), 'utf8')
  assert.doesNotMatch(
    replSource,
    /feedbackSurveyModulePath|antOrgWarningNotificationModulePath|tungstenLiveMonitorModulePath/,
    'ant-only REPL fallback modules should not use variable-path requires',
  )

  const output = await buildAndRunSnippet(
    'devtools-tungsten-fallback-test',
    `import React from 'react';
import { connectToDevTools, getDevtoolsStatus } from './src/ink/devtools.ts';
import { useFrustrationDetection } from './src/components/FeedbackSurvey/useFrustrationDetection.ts';
import { useAntOrgWarningNotification } from './src/hooks/notifs/useAntOrgWarningNotification.ts';
import {
  TungstenTool,
  clearSessionsWithTungstenUsage,
  resetInitializationState,
  getTungstenFallbackState,
} from './src/tools/TungstenTool/TungstenTool.ts';
import { TungstenLiveMonitor } from './src/tools/TungstenTool/TungstenLiveMonitor.tsx';

const devtools = await connectToDevTools();
if (devtools.status !== 'unavailable') throw new Error('devtools should be unavailable');
if (getDevtoolsStatus().implementation !== 'external-conservative') {
  throw new Error('bad devtools implementation marker');
}
if (TungstenTool.name !== 'Tungsten') throw new Error('bad Tungsten tool name');
if (TungstenTool.isEnabled()) throw new Error('Tungsten should be disabled by default');
const result = await TungstenTool.call({ command: 'echo hi' });
if (result.data.status !== 'unavailable') throw new Error('Tungsten should return unavailable');
if (result.data.command !== 'echo hi') throw new Error('Tungsten should echo requested command');
clearSessionsWithTungstenUsage();
resetInitializationState();
const state = getTungstenFallbackState();
if (state.usageClearCount !== 1 || state.initializationResetCount !== 1) {
  throw new Error('Tungsten cleanup state was not updated');
}
const element = React.createElement(TungstenLiveMonitor);
if (element.type !== TungstenLiveMonitor) throw new Error('bad Tungsten monitor element');
const frustration = useFrustrationDetection([], false, false, false);
if (frustration.state !== 'closed') throw new Error('frustration fallback should be closed');
useAntOrgWarningNotification();
console.log('devtools tungsten fallback OK');`,
  )
  assert.equal(output, 'devtools tungsten fallback OK')
})

await test('agent frontmatter preserves valid permission metadata only', async () => {
  const output = await buildAndRunSnippet(
    'agent-frontmatter-permission-test',
    `process.env.USER_TYPE = '';

const { parseAgentFromMarkdown } = await import('./src/tools/AgentTool/loadAgentsDir.ts');

const validAgent = parseAgentFromMarkdown(
  'build-src/test-artifacts/agents/strict-agent.md',
  'build-src/test-artifacts/agents',
  {
    name: 'strict-agent',
    description: 'Strict permission agent marker 4837',
    permissionMode: 'dontAsk',
    maxTurns: '7',
    isolation: 'worktree',
    tools: 'Read,Bash',
    disallowedTools: ['Write'],
    effort: 'low',
  },
  'Strict agent system prompt marker 4837',
  'userSettings',
);
if (!validAgent) {
  throw new Error('valid agent should parse');
}
if (validAgent.permissionMode !== 'dontAsk') {
  throw new Error('valid permissionMode should be preserved: ' + JSON.stringify(validAgent));
}
if (validAgent.maxTurns !== 7) {
  throw new Error('valid maxTurns should be parsed: ' + JSON.stringify(validAgent));
}
if (validAgent.isolation !== 'worktree') {
  throw new Error('valid worktree isolation should be preserved: ' + JSON.stringify(validAgent));
}
if (JSON.stringify(validAgent.tools) !== JSON.stringify(['Read', 'Bash'])) {
  throw new Error('tools should be parsed from comma-separated frontmatter: ' + JSON.stringify(validAgent.tools));
}
if (JSON.stringify(validAgent.disallowedTools) !== JSON.stringify(['Write'])) {
  throw new Error('disallowedTools should be preserved: ' + JSON.stringify(validAgent.disallowedTools));
}

const invalidAgent = parseAgentFromMarkdown(
  'build-src/test-artifacts/agents/invalid-agent.md',
  'build-src/test-artifacts/agents',
  {
    name: 'invalid-agent',
    description: 'Invalid permission agent marker 4837',
    permissionMode: 'root',
    maxTurns: '0',
    isolation: 'remote',
  },
  'Invalid agent system prompt marker 4837',
  'projectSettings',
);
if (!invalidAgent) {
  throw new Error('invalid optional fields should not drop the whole agent');
}
if ('permissionMode' in invalidAgent) {
  throw new Error('invalid permissionMode should be ignored: ' + JSON.stringify(invalidAgent));
}
if ('maxTurns' in invalidAgent) {
  throw new Error('invalid maxTurns should be ignored: ' + JSON.stringify(invalidAgent));
}
if ('isolation' in invalidAgent) {
  throw new Error('external build should ignore remote isolation: ' + JSON.stringify(invalidAgent));
}
if (invalidAgent.getSystemPrompt() !== 'Invalid agent system prompt marker 4837') {
  throw new Error('agent prompt should still be available');
}

console.log('agent frontmatter permission metadata OK');`,
  )
  assert.equal(output, 'agent frontmatter permission metadata OK')
})

await test('agent tool filtering scopes plan-mode permissions', async () => {
  const output = await buildAndRunSnippet(
    'agent-tool-filter-permission-test',
    `process.env.USER_TYPE = '';

const [
  { filterToolsForAgent, resolveAgentTools },
  { EXIT_PLAN_MODE_V2_TOOL_NAME },
  { AGENT_TOOL_NAME },
] = await Promise.all([
  import('./src/tools/AgentTool/agentToolFiltering.ts'),
  import('./src/tools/ExitPlanModeTool/constants.ts'),
  import('./src/tools/AgentTool/constants.ts'),
]);

const tool = name => ({ name });
const tools = [
  tool('Read'),
  tool('Bash'),
  tool('TaskOutput'),
  tool(EXIT_PLAN_MODE_V2_TOOL_NAME),
  tool(AGENT_TOOL_NAME),
  tool('mcp__server__tool'),
];
const names = list => list.map(item => item.name).sort();

const defaultNames = names(filterToolsForAgent({
  tools,
  isBuiltIn: false,
  permissionMode: 'default',
}));
if (defaultNames.includes(EXIT_PLAN_MODE_V2_TOOL_NAME)) {
  throw new Error('default custom agents should not expose ExitPlanMode: ' + defaultNames.join(','));
}
if (defaultNames.includes(AGENT_TOOL_NAME)) {
  throw new Error('external custom agents should not expose nested Agent tool: ' + defaultNames.join(','));
}
if (!defaultNames.includes('mcp__server__tool')) {
  throw new Error('MCP tools should remain available to agents: ' + defaultNames.join(','));
}

const planNames = names(filterToolsForAgent({
  tools,
  isBuiltIn: false,
  permissionMode: 'plan',
}));
if (!planNames.includes(EXIT_PLAN_MODE_V2_TOOL_NAME)) {
  throw new Error('plan-mode agents should expose ExitPlanMode: ' + planNames.join(','));
}
if (planNames.includes('TaskOutput')) {
  throw new Error('plan mode should not expose globally disallowed tools: ' + planNames.join(','));
}

const asyncNames = names(filterToolsForAgent({
  tools,
  isBuiltIn: false,
  isAsync: true,
  permissionMode: 'plan',
}));
if (!asyncNames.includes(EXIT_PLAN_MODE_V2_TOOL_NAME)) {
  throw new Error('async plan-mode agents should preserve ExitPlanMode: ' + asyncNames.join(','));
}
if (asyncNames.includes(AGENT_TOOL_NAME)) {
  throw new Error('async custom agents should not expose nested Agent tool: ' + asyncNames.join(','));
}

const resolved = resolveAgentTools(
  {
    source: 'userSettings',
    tools: ['*'],
    disallowedTools: ['Read'],
    permissionMode: 'plan',
  },
  tools,
  true,
  false,
);
const resolvedNames = names(resolved.resolvedTools);
if (!resolved.hasWildcard) {
  throw new Error('wildcard agent tools should be reported as wildcard');
}
if (resolvedNames.includes('Read')) {
  throw new Error('agent disallowedTools should remove Read: ' + resolvedNames.join(','));
}
if (!resolvedNames.includes(EXIT_PLAN_MODE_V2_TOOL_NAME)) {
  throw new Error('resolved plan-mode wildcard should include ExitPlanMode: ' + resolvedNames.join(','));
}
if (!resolvedNames.includes('mcp__server__tool')) {
  throw new Error('resolved plan-mode wildcard should keep MCP tools: ' + resolvedNames.join(','));
}

const mainResolved = resolveAgentTools(
  {
    source: 'userSettings',
    tools: [AGENT_TOOL_NAME + '(reviewer, verifier)', EXIT_PLAN_MODE_V2_TOOL_NAME, 'MissingTool'],
    disallowedTools: [],
  },
  tools,
  false,
  true,
);
if (JSON.stringify(mainResolved.allowedAgentTypes) !== JSON.stringify(['reviewer', 'verifier'])) {
  throw new Error('main thread Agent spec should preserve allowed agent types: ' + JSON.stringify(mainResolved));
}
if (!mainResolved.validTools.includes(EXIT_PLAN_MODE_V2_TOOL_NAME)) {
  throw new Error('main thread resolution should allow explicit ExitPlanMode: ' + JSON.stringify(mainResolved));
}
if (!mainResolved.invalidTools.includes('MissingTool')) {
  throw new Error('main thread resolution should report unknown tools: ' + JSON.stringify(mainResolved));
}

console.log('agent tool filtering permissions OK');`,
  )
  assert.equal(output, 'agent tool filtering permissions OK')
})

await test('resume and user text feature modules use static bundled requires', async () => {
  const resumeSource = await readFile(
    join(BUILD, 'src/screens/ResumeConversation.tsx'),
    'utf8',
  )
  const userTextSource = await readFile(
    join(BUILD, 'src/components/messages/UserTextMessage.tsx'),
    'utf8',
  )
  const distSource = await readFile(DIST_CLI, 'utf8')

  assert.doesNotMatch(
    resumeSource,
    /contextCollapsePersistModulePath|require\(contextCollapsePersistModulePath\)/,
    'ResumeConversation should not use variable-path ContextCollapse persist require',
  )
  assert.doesNotMatch(
    userTextSource,
    /user(?:GitHubWebhook|ForkBoilerplate|CrossSession)ModulePath|require\(user(?:GitHubWebhook|ForkBoilerplate|CrossSession)ModulePath\)/,
    'UserTextMessage feature branches should not use variable-path requires',
  )
  assert.doesNotMatch(
    distSource,
    /contextCollapsePersistModulePath|user(?:GitHubWebhook|ForkBoilerplate|CrossSession)ModulePath/,
    'dist bundle should not retain these runtime variable require paths',
  )

  const output = await buildAndRunSnippet(
    'user-text-feature-renderers-test',
    `import React from 'react';
import { PassThrough, Writable } from 'node:stream';
import { getStats } from './src/services/contextCollapse/index.ts';
import { restoreFromEntries } from './src/services/contextCollapse/persist.ts';
import { Box } from './src/ink.ts';
import { renderSync } from './src/ink/root.ts';
import { UserGitHubWebhookMessage } from './src/components/messages/UserGitHubWebhookMessage.tsx';
import { UserForkBoilerplateMessage } from './src/components/messages/UserForkBoilerplateMessage.tsx';
import { UserCrossSessionMessage } from './src/components/messages/UserCrossSessionMessage.tsx';

if (typeof restoreFromEntries !== 'function') {
  throw new Error('restoreFromEntries should be callable');
}
restoreFromEntries([], undefined);
if (getStats().hasRestoredState !== false) {
  throw new Error('empty restore should remain conservative');
}

class CaptureStream extends Writable {
  constructor() {
    super();
    this.chunks = [];
    this.columns = 120;
    this.rows = 30;
    this.isTTY = true;
  }
  _write(chunk, _encoding, callback) {
    this.chunks.push(Buffer.from(chunk).toString('utf8'));
    callback();
  }
  get output() {
    return this.chunks.join('');
  }
}
function createStdin() {
  const stdin = new PassThrough();
  stdin.isTTY = true;
  stdin.setRawMode = () => stdin;
  stdin.ref = () => stdin;
  stdin.unref = () => stdin;
  stdin.setEncoding('utf8');
  return stdin;
}
function normalizeOutput(output) {
  return output
    .replace(/\\x1b\\[(\\d+)C/g, (_, count) => ' '.repeat(Number(count)))
    .replace(/\\x1b\\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\\r/g, '');
}
function param(text) {
  return { type: 'text', text };
}
const element = React.createElement(
  Box,
  { flexDirection: 'column' },
  React.createElement(UserGitHubWebhookMessage, {
    addMargin: false,
    param: param('<github-webhook-activity>review requested on PR 42</github-webhook-activity>'),
  }),
  React.createElement(UserForkBoilerplateMessage, {
    addMargin: false,
    param: param('<fork-boilerplate>Use the child session context only.</fork-boilerplate>'),
  }),
  React.createElement(UserCrossSessionMessage, {
    addMargin: false,
    param: param('<cross-session-message source="worker-7">handoff is ready</cross-session-message>'),
  }),
);
const stdout = new CaptureStream();
const stderr = new CaptureStream();
const instance = renderSync(element, {
  stdout,
  stderr,
  stdin: createStdin(),
  exitOnCtrlC: false,
  patchConsole: false,
});
await new Promise(resolve => setTimeout(resolve, 50));
instance.unmount();
instance.cleanup();
const rendered = normalizeOutput(stdout.output);
for (const needle of [
  'GitHub activity review requested on PR 42',
  'Fork context Use the child session context only.',
  'Cross-session worker-7: handoff is ready',
]) {
  if (!rendered.includes(needle)) {
    throw new Error('missing rendered text ' + JSON.stringify(needle) + ': ' + JSON.stringify(rendered));
  }
}
console.log('user text feature renderers OK');`,
    {
      banner: {
        js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
      },
    },
  )
  assert.match(output, /user text feature renderers OK$/)
})

await test('context collapse build gate is preserved but runtime-gated', async () => {
  const querySource = await readFile(join(BUILD, 'src/query.ts'), 'utf8')
  const toolsSource = await readFile(join(BUILD, 'src/tools.ts'), 'utf8')
  const commandsSource = await readFile(join(BUILD, 'src/commands.ts'), 'utf8')
  const cliSource = await readFile(join(BUILD, 'src/entrypoints/cli.tsx'), 'utf8')
  const setupSource = await readFile(join(BUILD, 'src/setup.ts'), 'utf8')
  const tokenWarningSource = await readFile(
    join(BUILD, 'src/components/TokenWarning.tsx'),
    'utf8',
  )
  const replSource = await readFile(join(BUILD, 'src/screens/REPL.tsx'), 'utf8')
  const analyzeContextSource = await readFile(
    join(BUILD, 'src/utils/analyzeContext.ts'),
    'utf8',
  )
  assert.match(
    cliSource,
    /if \(true && args\[0\] === '--dump-system-prompt'\)/,
    'DUMP_SYSTEM_PROMPT should stay bundled',
  )
  assert.match(
    querySource,
    /const contextCollapse = true\s+\?\s+\(require\('\.\/services\/contextCollapse\/index\.js'\)/,
    'CONTEXT_COLLAPSE should stay bundled',
  )
  assert.match(
    toolsSource,
    /const CtxInspectTool = true\s+\?\s+loadToolExport/,
    'CtxInspectTool should stay bundled',
  )
  assert.match(
    querySource,
    /const snipModule = true\s+\?\s+\(require\('\.\/services\/compact\/snipCompact\.js'\)/,
    'HISTORY_SNIP should stay bundled',
  )
  assert.match(
    toolsSource,
    /const SnipTool = true\s+\?\s+loadToolExport/,
    'SnipTool should stay bundled',
  )
  assert.match(
    commandsSource,
    /const forceSnip = true\s+\?\s+require\('\.\/commands\/force-snip\.js'\)\.default/,
    'force-snip command should stay bundled',
  )
  assert.match(
    querySource,
    /contextCollapse\?\.isContextCollapseEnabled\(\) &&\s+isWithheld413/,
    'prompt-too-long fallback must remain runtime-gated',
  )
  assert.doesNotMatch(
    setupSource,
    /initContextCollapse\(\)/,
    'setup should not block first render on context collapse initialization',
  )
  for (const [name, source] of [
    ['setup', setupSource],
    ['TokenWarning', tokenWarningSource],
    ['REPL', replSource],
    ['analyzeContext', analyzeContextSource],
  ]) {
    assert.doesNotMatch(
      source,
      /contextCollapseModulePath|require\(contextCollapseModulePath\)/,
      `${name} should not use runtime variable require for contextCollapse`,
    )
  }
  assert.match(
    querySource,
    /const reactiveCompact = true\s+\?\s+\(require\('\.\/services\/compact\/reactiveCompact\.js'\)/,
    'REACTIVE_COMPACT should stay bundled',
  )
})

await test('reactive compact runtime is loadable and guarded', async () => {
  const output = await buildAndRunSnippet(
    'reactive-compact-runtime-test',
    `delete process.env.DISABLE_COMPACT;
delete process.env.DISABLE_AUTO_COMPACT;
delete process.env.DISABLE_REACTIVE_COMPACT;
delete process.env.CLAUDE_CODE_DISABLE_REACTIVE_COMPACT;
delete process.env.CLAUDE_CODE_REACTIVE_COMPACT;
delete process.env.CLAUDE_CODE_REACTIVE_COMPACT_ONLY;
const reactive = await import('./src/services/compact/reactiveCompact.ts');
const { createAssistantAPIErrorMessage } = await import('./src/utils/messages.ts');
const { PROMPT_TOO_LONG_ERROR_MESSAGE } = await import('./src/services/api/errors.ts');

if (!reactive.isReactiveCompactEnabled()) throw new Error('reactive compact should default on');
if (reactive.isReactiveOnlyMode()) throw new Error('reactive-only mode should default off');
process.env.CLAUDE_CODE_REACTIVE_COMPACT_ONLY = '1';
if (!reactive.isReactiveOnlyMode()) throw new Error('reactive-only env should enable compatibility mode');
delete process.env.CLAUDE_CODE_REACTIVE_COMPACT_ONLY;
process.env.DISABLE_AUTO_COMPACT = '1';
if (reactive.isReactiveCompactEnabled()) throw new Error('DISABLE_AUTO_COMPACT should disable reactive compact');
delete process.env.DISABLE_AUTO_COMPACT;
process.env.CLAUDE_CODE_REACTIVE_COMPACT = '0';
if (reactive.isReactiveCompactEnabled()) throw new Error('explicit false should disable reactive compact');
process.env.CLAUDE_CODE_REACTIVE_COMPACT = '1';
if (!reactive.isReactiveCompactEnabled()) throw new Error('explicit true should enable reactive compact');

const ptl = createAssistantAPIErrorMessage({
  content: PROMPT_TOO_LONG_ERROR_MESSAGE,
  error: 'invalid_request',
  errorDetails: 'prompt is too long: 137500 tokens > 135000 maximum',
});
if (!reactive.isWithheldPromptTooLong(ptl)) throw new Error('prompt-too-long should be withheld');
const media = createAssistantAPIErrorMessage({
  content: 'Image was too large',
  error: 'invalid_request',
  errorDetails: 'image exceeds maximum size',
});
if (!reactive.isWithheldMediaSizeError(media)) throw new Error('media size error should be withheld');
const normal = createAssistantAPIErrorMessage({ content: 'API Error: ordinary failure' });
if (reactive.isWithheldPromptTooLong(normal)) throw new Error('ordinary API error should not be withheld');

const context = {
  abortController: new AbortController(),
  options: { querySource: 'repl_main_thread', mainLoopModel: 'claude-sonnet-4-6' },
};
const cacheSafeParams = {
  systemPrompt: [],
  userContext: {},
  systemContext: {},
  toolUseContext: context,
  forkContextMessages: [],
};
const skippedAttempt = await reactive.tryReactiveCompact({
  hasAttempted: true,
  querySource: 'repl_main_thread',
  aborted: false,
  messages: [],
  cacheSafeParams,
});
if (skippedAttempt !== null) throw new Error('hasAttempted should skip retry');
const skippedRecursive = await reactive.tryReactiveCompact({
  hasAttempted: false,
  querySource: 'compact',
  aborted: false,
  messages: [],
  cacheSafeParams,
});
if (skippedRecursive !== null) throw new Error('compact querySource should skip retry');
context.abortController.abort();
const aborted = await reactive.reactiveCompactOnPromptTooLong([], cacheSafeParams);
if (aborted.ok || aborted.reason !== 'aborted') throw new Error('aborted compact should return aborted outcome');
console.log('reactive compact runtime OK');`,
  )
  assert.equal(output, 'reactive compact runtime OK')
})

await test('dump system prompt fast path runs without a model request', async () => {
  const output = execFileSync(
    process.execPath,
    [DIST_CLI, '--dump-system-prompt', '--model', 'sonnet'],
    {
      cwd: ROOT,
      encoding: 'utf8',
      env: {
        ...process.env,
        ANTHROPIC_API_KEY: '',
        ANTHROPIC_AUTH_TOKEN: '',
        ANTHROPIC_BASE_URL: '',
      },
      maxBuffer: 16 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  assert.match(output, /Claude Code/, 'system prompt should identify Claude Code')
  assert.doesNotMatch(output, /Connection error|API error/i)
})

await test('context collapse runtime is loadable and conservative', async () => {
  const output = await buildAndRunSnippet(
    'context-collapse-runtime-test',
    `delete process.env.CLAUDE_CONTEXT_COLLAPSE;
delete process.env.CLAUDE_CODE_CONTEXT_COLLAPSE;
const contextCollapse = await import('./src/services/contextCollapse/index.ts');
const operations = await import('./src/services/contextCollapse/operations.ts');
const persist = await import('./src/services/contextCollapse/persist.ts');

contextCollapse.resetContextCollapse();
if (contextCollapse.isContextCollapseEnabled()) throw new Error('enabled by default');
let stats = contextCollapse.getStats();
if (stats.runtimeRequested || stats.hasRestoredState || stats.collapsedSpans !== 0 || stats.stagedSpans !== 0) {
  throw new Error('bad default stats: ' + JSON.stringify(stats));
}

let notified = 0;
const unsubscribe = contextCollapse.subscribe(() => { notified += 1; });
contextCollapse.resetContextCollapse();
unsubscribe();
if (notified !== 1) throw new Error('subscribe/reset did not notify once: ' + notified);

const messages = [];
if (operations.projectView(messages) !== messages) throw new Error('projectView should preserve array identity');
const applied = await contextCollapse.applyCollapsesIfNeeded(messages, {}, 'repl_main_thread');
if (applied.messages !== messages) throw new Error('applyCollapsesIfNeeded should preserve messages');
const recovered = contextCollapse.recoverFromOverflow(messages, 'repl_main_thread');
if (recovered.committed !== 0 || recovered.messages !== messages) throw new Error('recoverFromOverflow should not fake commits');

const promptTooLong = {
  type: 'assistant',
  isApiErrorMessage: true,
  message: { content: [{ type: 'text', text: 'Prompt is too long' }] },
};
const detector = message => message.message.content[0].text.startsWith('Prompt is too long');
if (contextCollapse.isWithheldPromptTooLong(promptTooLong, detector, 'repl_main_thread')) {
  throw new Error('disabled runtime should not withhold prompt-too-long');
}

persist.restoreFromEntries([
  {
    type: 'marble-origami-commit',
    sessionId: '00000000-0000-0000-0000-000000000001',
    collapseId: '0000000000000001',
    summaryUuid: '00000000-0000-0000-0000-000000000002',
    summaryContent: '<collapsed id="0000000000000001">summary</collapsed>',
    summary: 'summary',
    firstArchivedUuid: '00000000-0000-0000-0000-000000000003',
    lastArchivedUuid: '00000000-0000-0000-0000-000000000004',
  },
], {
  type: 'marble-origami-snapshot',
  sessionId: '00000000-0000-0000-0000-000000000001',
  staged: [{
    startUuid: '00000000-0000-0000-0000-000000000005',
    endUuid: '00000000-0000-0000-0000-000000000006',
    summary: 'staged',
    risk: 1,
    stagedAt: 1,
  }],
  armed: false,
  lastSpawnTokens: 0,
});
stats = contextCollapse.getStats();
if (!stats.hasRestoredState || stats.collapsedSpans !== 1 || stats.stagedSpans !== 1) {
  throw new Error('restore did not update stats: ' + JSON.stringify(stats));
}
if (contextCollapse.isContextCollapseEnabled()) throw new Error('restored state should still require explicit runtime opt-in');
process.env.CLAUDE_CONTEXT_COLLAPSE = '1';
if (!contextCollapse.isContextCollapseEnabled()) throw new Error('runtime opt-in with restored state should enable');
if (!contextCollapse.isWithheldPromptTooLong(promptTooLong, detector, 'repl_main_thread')) {
  throw new Error('enabled runtime should withhold prompt-too-long for recovery');
}
contextCollapse.resetContextCollapse();
delete process.env.CLAUDE_CONTEXT_COLLAPSE;
console.log('context collapse runtime OK');`,
  )
  assert.equal(output, 'context collapse runtime OK')
})

await test('CtxInspectTool is loadable and opt-in', async () => {
  const output = await buildAndRunSnippet(
    'ctx-inspect-tool-test',
    `delete process.env.CLAUDE_CONTEXT_COLLAPSE;
const { CtxInspectTool } = await import('./src/tools/CtxInspectTool/CtxInspectTool.ts');
if (CtxInspectTool.name !== 'CtxInspect') throw new Error('bad tool name');
if (CtxInspectTool.isEnabled()) throw new Error('tool should be disabled unless runtime is requested');
if (!CtxInspectTool.isReadOnly({}) || !CtxInspectTool.isConcurrencySafe({})) {
  throw new Error('tool should be read-only and concurrency-safe');
}
process.env.CLAUDE_CONTEXT_COLLAPSE = '1';
if (!CtxInspectTool.isEnabled()) throw new Error('tool should enable on explicit runtime request');
const result = await CtxInspectTool.call({});
if (!result.data.runtimeRequested || result.data.enabled) {
  throw new Error('unexpected default inspection result: ' + JSON.stringify(result.data));
}
const block = CtxInspectTool.mapToolResultToToolResultBlockParam(result.data, 'toolu_test');
if (block.type !== 'tool_result' || !block.content.includes('external-conservative')) {
  throw new Error('bad tool result block');
}
delete process.env.CLAUDE_CONTEXT_COLLAPSE;
console.log('ctx inspect tool OK');`,
  )
  assert.equal(output, 'ctx inspect tool OK')
})

await test('VerifyPlanExecutionTool is loadable and conservative', async () => {
  const replSource = await readFile(join(BUILD, 'src/screens/REPL.tsx'), 'utf8')
  const exitPlanSource = await readFile(
    join(
      BUILD,
      'src/components/permissions/ExitPlanModePermissionRequest/ExitPlanModePermissionRequest.tsx',
    ),
    'utf8',
  )
  assert.doesNotMatch(
    replSource,
    /isEnvTruthy\(undefined\)/,
    'plan verification state gate should read the runtime env var',
  )
  assert.match(
    replSource,
    /CLAUDE_CODE_VERIFY_PLAN/,
    'REPL should retain the verify-plan runtime env gate',
  )
  assert.doesNotMatch(
    exitPlanSource,
    /undefined === 'true'/,
    'plan verification instruction should not be folded to false',
  )

  const output = await buildAndRunSnippet(
    'verify-plan-tool-test',
    `delete process.env.CLAUDE_CODE_VERIFY_PLAN;
const direct = await import('./src/tools/VerifyPlanExecutionTool/VerifyPlanExecutionTool.ts');
if (direct.VerifyPlanExecutionTool.name !== 'VerifyPlanExecution') throw new Error('bad tool name');
if (direct.VerifyPlanExecutionTool.isEnabled()) throw new Error('tool should be disabled by default');

process.env.CLAUDE_CODE_VERIFY_PLAN = 'true';
const { getAllBaseTools } = await import('./src/tools.ts');
const tool = getAllBaseTools().find(item => item.name === 'VerifyPlanExecution');
if (!tool) throw new Error('VerifyPlanExecution did not enter the tool pool');
if (!tool.isEnabled()) throw new Error('VerifyPlanExecution should be enabled by env');
if (tool.isDestructive({})) throw new Error('VerifyPlanExecution should not be destructive');

let state = {
  pendingPlanVerification: {
    plan: 'Implement the accepted plan',
    verificationStarted: false,
    verificationCompleted: false,
  },
};
const context = {
  getAppState: () => state,
  setAppState: updater => {
    state = updater(state);
  },
};
const result = await tool.call({ notes: 'ran targeted checks' }, context, undefined, undefined);
if (result.data.status !== 'recorded_unavailable') throw new Error('should not claim real verification');
if (result.data.implementation !== 'external-conservative') throw new Error('bad implementation marker');
if (!result.data.planAvailable || !result.data.verificationStarted || result.data.verificationCompleted) {
  throw new Error('bad result state: ' + JSON.stringify(result.data));
}
if (!state.pendingPlanVerification.verificationStarted || state.pendingPlanVerification.verificationCompleted) {
  throw new Error('app state not updated conservatively: ' + JSON.stringify(state));
}
if (!result.data.warning.includes('does not prove')) throw new Error('missing warning');
const block = tool.mapToolResultToToolResultBlockParam(result.data, 'toolu_verify');
if (block.type !== 'tool_result' || !block.content.includes('recorded_unavailable')) {
  throw new Error('bad tool_result block');
}
delete process.env.CLAUDE_CODE_VERIFY_PLAN;
console.log('verify plan tool OK');`,
  )
  assert.equal(output, 'verify plan tool OK')
})

await test('PermissionRequest maps tools to interactive components', async () => {
  const output = await buildAndRunSnippet(
    'permission-request-component-map-test',
    `const [
  { permissionComponentForTool },
  { FallbackPermissionRequest },
  { FileEditTool },
  { FileWriteTool },
  { BashTool },
  { PowerShellTool },
  { WebFetchTool },
  { NotebookEditTool },
  { ExitPlanModeV2Tool },
  { EnterPlanModeTool },
  { SkillTool },
  { AskUserQuestionTool },
  { GlobTool },
  { GrepTool },
  { FileReadTool },
  { FileEditPermissionRequest },
  { FileWritePermissionRequest },
  { BashPermissionRequest },
  { PowerShellPermissionRequest },
  { WebFetchPermissionRequest },
  { NotebookEditPermissionRequest },
  { ExitPlanModePermissionRequest },
  { EnterPlanModePermissionRequest },
  { SkillPermissionRequest },
  { AskUserQuestionPermissionRequest },
  { FilesystemPermissionRequest },
] = await Promise.all([
  import('./src/components/permissions/PermissionRequest.tsx'),
  import('./src/components/permissions/FallbackPermissionRequest.tsx'),
  import('./src/tools/FileEditTool/FileEditTool.ts'),
  import('./src/tools/FileWriteTool/FileWriteTool.ts'),
  import('./src/tools/BashTool/BashTool.tsx'),
  import('./src/tools/PowerShellTool/PowerShellTool.tsx'),
  import('./src/tools/WebFetchTool/WebFetchTool.ts'),
  import('./src/tools/NotebookEditTool/NotebookEditTool.ts'),
  import('./src/tools/ExitPlanModeTool/ExitPlanModeV2Tool.ts'),
  import('./src/tools/EnterPlanModeTool/EnterPlanModeTool.ts'),
  import('./src/tools/SkillTool/SkillTool.ts'),
  import('./src/tools/AskUserQuestionTool/AskUserQuestionTool.tsx'),
  import('./src/tools/GlobTool/GlobTool.ts'),
  import('./src/tools/GrepTool/GrepTool.ts'),
  import('./src/tools/FileReadTool/FileReadTool.ts'),
  import('./src/components/permissions/FileEditPermissionRequest/FileEditPermissionRequest.tsx'),
  import('./src/components/permissions/FileWritePermissionRequest/FileWritePermissionRequest.tsx'),
  import('./src/components/permissions/BashPermissionRequest/BashPermissionRequest.tsx'),
  import('./src/components/permissions/PowerShellPermissionRequest/PowerShellPermissionRequest.tsx'),
  import('./src/components/permissions/WebFetchPermissionRequest/WebFetchPermissionRequest.tsx'),
  import('./src/components/permissions/NotebookEditPermissionRequest/NotebookEditPermissionRequest.tsx'),
  import('./src/components/permissions/ExitPlanModePermissionRequest/ExitPlanModePermissionRequest.tsx'),
  import('./src/components/permissions/EnterPlanModePermissionRequest/EnterPlanModePermissionRequest.tsx'),
  import('./src/components/permissions/SkillPermissionRequest/SkillPermissionRequest.tsx'),
  import('./src/components/permissions/AskUserQuestionPermissionRequest/AskUserQuestionPermissionRequest.tsx'),
  import('./src/components/permissions/FilesystemPermissionRequest/FilesystemPermissionRequest.tsx'),
]);

const expected = [
  [FileEditTool, FileEditPermissionRequest, 'FileEdit'],
  [FileWriteTool, FileWritePermissionRequest, 'FileWrite'],
  [BashTool, BashPermissionRequest, 'Bash'],
  [PowerShellTool, PowerShellPermissionRequest, 'PowerShell'],
  [WebFetchTool, WebFetchPermissionRequest, 'WebFetch'],
  [NotebookEditTool, NotebookEditPermissionRequest, 'NotebookEdit'],
  [ExitPlanModeV2Tool, ExitPlanModePermissionRequest, 'ExitPlanMode'],
  [EnterPlanModeTool, EnterPlanModePermissionRequest, 'EnterPlanMode'],
  [SkillTool, SkillPermissionRequest, 'Skill'],
  [AskUserQuestionTool, AskUserQuestionPermissionRequest, 'AskUserQuestion'],
  [GlobTool, FilesystemPermissionRequest, 'Glob'],
  [GrepTool, FilesystemPermissionRequest, 'Grep'],
  [FileReadTool, FilesystemPermissionRequest, 'Read'],
];
for (const [tool, component, label] of expected) {
  const actual = permissionComponentForTool(tool);
  if (actual !== component) {
    throw new Error(label + ' mapped to wrong permission component: ' + (actual?.name ?? '<unknown>'));
  }
}

const unknownTool = { name: 'UnknownPermissionTool' };
if (permissionComponentForTool(unknownTool) !== FallbackPermissionRequest) {
  throw new Error('unknown tools should use fallback permission request');
}

console.log('permission request component mapping OK');`,
  )
  assert.equal(output, 'permission request component mapping OK')
})

await test('permission sync replaces stale settings-source rules', async () => {
  const output = await buildAndRunSnippet(
    'permission-sync-rules-test',
    `const { syncPermissionRulesFromDisk } = await import('./src/utils/permissions/permissions.ts');
const baseContext = {
  mode: 'default',
  additionalWorkingDirectories: new Map(),
  alwaysAllowRules: {
    cliArg: ['Write'],
    command: ['Read'],
    session: ['Edit'],
    userSettings: ['Bash'],
    flagSettings: ['Glob'],
    policySettings: ['Read'],
  },
  alwaysDenyRules: {
    flagSettings: ['Edit'],
    policySettings: ['Write'],
  },
  alwaysAskRules: {
    policySettings: ['Bash'],
  },
  isBypassPermissionsModeAvailable: false,
};
const updated = syncPermissionRulesFromDisk(baseContext, [
  {
    source: 'policySettings',
    ruleBehavior: 'allow',
    ruleValue: { toolName: 'NotebookEdit' },
  },
  {
    source: 'flagSettings',
    ruleBehavior: 'deny',
    ruleValue: { toolName: 'Bash' },
  },
]);
function rules(kind, source) {
  return updated[kind][source] ?? [];
}
if (JSON.stringify(rules('alwaysAllowRules', 'policySettings')) !== JSON.stringify(['NotebookEdit'])) {
  throw new Error('policy allow rules were not replaced: ' + JSON.stringify(updated.alwaysAllowRules));
}
if (rules('alwaysDenyRules', 'policySettings').length !== 0 || rules('alwaysAskRules', 'policySettings').length !== 0) {
  throw new Error('stale policy deny/ask rules survived: ' + JSON.stringify(updated));
}
if (rules('alwaysAllowRules', 'flagSettings').length !== 0) {
  throw new Error('stale flag allow rule survived: ' + JSON.stringify(updated.alwaysAllowRules));
}
if (JSON.stringify(rules('alwaysDenyRules', 'flagSettings')) !== JSON.stringify(['Bash'])) {
  throw new Error('flag deny rules were not replaced: ' + JSON.stringify(updated.alwaysDenyRules));
}
if (JSON.stringify(rules('alwaysAllowRules', 'cliArg')) !== JSON.stringify(['Write'])) {
  throw new Error('non-settings cliArg rules should remain in normal sync');
}
if (JSON.stringify(rules('alwaysAllowRules', 'command')) !== JSON.stringify(['Read'])) {
  throw new Error('non-settings command rules should remain in normal sync');
}
if (JSON.stringify(rules('alwaysAllowRules', 'session')) !== JSON.stringify(['Edit'])) {
  throw new Error('non-settings session rules should remain in normal sync');
}
console.log('permission sync rules OK');`,
  )
  assert.equal(output, 'permission sync rules OK')
})

await test('PowerShell path constraints respect path-specific ask rules', async () => {
  const output = await buildAndRunSnippet(
    'powershell-path-rules-test',
    `import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parsePowerShellCommand } from './src/utils/powershell/parser.ts';
import { checkPathConstraints } from './src/tools/PowerShellTool/pathValidation.ts';

process.env.NODE_ENV = 'test';

const artifactDir = join('build-src', 'test-artifacts');
await mkdir(artifactDir, { recursive: true });
const readPath = join(artifactDir, 'powershell-path-read-rule.txt').replace(/\\\\/g, '/');
const writePath = join(artifactDir, 'powershell-path-write-rule.txt').replace(/\\\\/g, '/');
await writeFile(readPath, 'read fixture', 'utf8');
await writeFile(writePath, 'write fixture', 'utf8');

function makeContext({ deny = [], ask = [] } = {}) {
  return {
    mode: 'acceptEdits',
    additionalWorkingDirectories: new Map(),
    alwaysAllowRules: {
      cliArg: ['PowerShell(Get-Content:*)', 'PowerShell(Set-Content:*)'],
    },
    alwaysDenyRules: {
      userSettings: deny,
    },
    alwaysAskRules: {
      userSettings: ask,
    },
    isBypassPermissionsModeAvailable: false,
  };
}

async function check(command, context) {
  const parsed = await parsePowerShellCommand(command);
  if (!parsed.valid) {
    if (parsed.errors.some(error => error.errorId === 'NoPowerShell')) {
      return null;
    }
    throw new Error('PowerShell parser failed: ' + JSON.stringify(parsed.errors));
  }
  return checkPathConstraints({ command }, parsed, context, false);
}

function assertBehavior(result, behavior, ruleBehavior, label) {
  if (result === null) return;
  if (result.behavior !== behavior) {
    throw new Error(label + ' expected ' + behavior + ', got ' + JSON.stringify(result));
  }
  if (result.decisionReason?.type !== 'rule') {
    throw new Error(label + ' should include rule decision: ' + JSON.stringify(result));
  }
  if (result.decisionReason.rule.ruleBehavior !== ruleBehavior) {
    throw new Error(label + ' should preserve ' + ruleBehavior + ' rule: ' + JSON.stringify(result.decisionReason.rule));
  }
}

const readCommand = 'Get-Content ' + readPath;
const writeCommand = 'Set-Content -Path ' + writePath + ' -Value updated';

const readDeny = await check(readCommand, makeContext({ deny: ['Read(' + readPath + ')'] }));
assertBehavior(readDeny, 'deny', 'deny', 'read deny');

const readAsk = await check(readCommand, makeContext({ ask: ['Read(' + readPath + ')'] }));
assertBehavior(readAsk, 'ask', 'ask', 'read ask');

const writeDeny = await check(writeCommand, makeContext({ deny: ['Edit(' + writePath + ')'] }));
assertBehavior(writeDeny, 'deny', 'deny', 'write deny');

const writeAsk = await check(writeCommand, makeContext({ ask: ['Edit(' + writePath + ')'] }));
assertBehavior(writeAsk, 'ask', 'ask', 'write ask');

console.log('powershell path rules OK');`,
  )
  assert.equal(output, 'powershell path rules OK')
})

await test('PreToolUse hook allow does not bypass deny rules', async () => {
  const output = await buildAndRunSnippet(
    'pretool-hook-allow-deny-test',
    `import { resolveHookPermissionDecision } from './src/services/tools/toolHooks.ts';

const input = {
  file_path: 'build-src/test-artifacts/pretool-hook-allow-deny.txt',
  content: 'hook allow should not bypass deny rules',
};
const hookAllow = {
  behavior: 'allow',
  updatedInput: input,
  decisionReason: {
    type: 'hook',
    hookName: 'PreToolUse:Write',
  },
};
const basePermissionContext = {
  mode: 'default',
  additionalWorkingDirectories: new Map(),
  alwaysAllowRules: {},
  alwaysDenyRules: {},
  alwaysAskRules: {},
  isBypassPermissionsModeAvailable: false,
};
const assistantMessage = {
  uuid: 'assistant-test-uuid',
  message: {
    id: 'msg_pretool_hook_allow_deny',
    role: 'assistant',
    content: [],
  },
};
function makeContext(toolPermissionContext) {
  return {
    requireCanUseTool: false,
    getAppState() {
      return { toolPermissionContext };
    },
  };
}
let canUseToolCalls = 0;
async function canUseTool() {
  canUseToolCalls += 1;
  throw new Error('canUseTool should not run when deny rules override hook allow');
}
const passthroughTool = {
  name: 'Write',
  inputSchema: {
    parse(value) {
      return value;
    },
  },
  async checkPermissions() {
    return { behavior: 'allow', updatedInput: input };
  },
};
const toolWideDeny = await resolveHookPermissionDecision(
  hookAllow,
  passthroughTool,
  input,
  makeContext({
    ...basePermissionContext,
    alwaysDenyRules: { userSettings: ['Write'] },
  }),
  canUseTool,
  assistantMessage,
  'toolu_pretool_hook_tool_wide_deny',
);
if (toolWideDeny.decision.behavior !== 'deny') {
  throw new Error('tool-wide deny should override hook allow: ' + JSON.stringify(toolWideDeny.decision));
}
if (!toolWideDeny.decision.message.includes('Permission to use Write has been denied')) {
  throw new Error('tool-wide deny should preserve deny message: ' + JSON.stringify(toolWideDeny.decision));
}

const contentDenyTool = {
  name: 'Write',
  inputSchema: {
    parse(value) {
      return value;
    },
  },
  async checkPermissions() {
    return {
      behavior: 'deny',
      message: 'content-specific deny marker from tool check',
      decisionReason: {
        type: 'rule',
        rule: {
          source: 'userSettings',
          ruleBehavior: 'deny',
          ruleValue: {
            toolName: 'Edit',
            ruleContent: input.file_path,
          },
        },
      },
    };
  },
};
const contentDeny = await resolveHookPermissionDecision(
  hookAllow,
  contentDenyTool,
  input,
  makeContext(basePermissionContext),
  canUseTool,
  assistantMessage,
  'toolu_pretool_hook_content_deny',
);
if (contentDeny.decision.behavior !== 'deny') {
  throw new Error('tool-specific deny should override hook allow: ' + JSON.stringify(contentDeny.decision));
}
if (contentDeny.decision.message !== 'content-specific deny marker from tool check') {
  throw new Error('tool-specific deny should preserve tool message: ' + JSON.stringify(contentDeny.decision));
}
if (canUseToolCalls !== 0) {
  throw new Error('canUseTool should not be called for deny overrides: ' + canUseToolCalls);
}
console.log('pretool hook allow deny rules OK');`,
  )
  assert.equal(output, 'pretool hook allow deny rules OK')
})

await test('PreToolUse permission aggregation preserves deny metadata', async () => {
  const output = await buildAndRunSnippet(
    'pretool-hook-deny-metadata-test',
    `const [
  { executePreToolHooks },
  { clearRegisteredHooks, registerHookCallbacks, setIsInteractive },
  { resetHooksConfigSnapshot },
] = await Promise.all([
  import('./src/utils/hooks.ts'),
  import('./src/bootstrap/state.ts'),
  import('./src/utils/hooks/hooksConfigSnapshot.ts'),
]);

setIsInteractive(false);
clearRegisteredHooks();
resetHooksConfigSnapshot();

const input = {
  file_path: 'build-src/test-artifacts/pretool-hook-deny-metadata.txt',
  content: 'pretool deny should keep metadata',
};
const denyReason = 'fast deny should keep its reason';
const allowReason = 'slow allow should not replace deny reason';
let fastDenyCalls = 0;
let slowAllowCalls = 0;

registerHookCallbacks({
  PreToolUse: [
    {
      matcher: 'Write',
      hooks: [
        {
          type: 'callback',
          callback: async () => {
            fastDenyCalls += 1;
            return {
              hookSpecificOutput: {
                hookEventName: 'PreToolUse',
                permissionDecision: 'deny',
                permissionDecisionReason: denyReason,
              },
            };
          },
        },
        {
          type: 'callback',
          callback: async () => {
            slowAllowCalls += 1;
            await new Promise(resolve => setTimeout(resolve, 25));
            return {
              hookSpecificOutput: {
                hookEventName: 'PreToolUse',
                permissionDecision: 'allow',
                permissionDecisionReason: allowReason,
                updatedInput: {
                  ...input,
                  content: 'slow allow input should not attach to deny',
                },
              },
            };
          },
        },
      ],
    },
  ],
});

const context = {
  abortController: new AbortController(),
  options: { isNonInteractiveSession: false },
  getAppState() {
    return {
      sessionHooks: new Map(),
      toolPermissionContext: {
        mode: 'default',
        additionalWorkingDirectories: new Map(),
        alwaysAllowRules: {},
        alwaysDenyRules: {},
        alwaysAskRules: {},
        isBypassPermissionsModeAvailable: false,
      },
    };
  },
};

let lastPermissionResult = null;
for await (const result of executePreToolHooks(
  'Write',
  'toolu_pretool_hook_deny_metadata',
  input,
  context,
  'default',
  context.abortController.signal,
)) {
  if (result.permissionBehavior !== undefined) {
    lastPermissionResult = result;
  }
}

if (fastDenyCalls !== 1 || slowAllowCalls !== 1) {
  throw new Error('both PreToolUse hooks should run: ' + fastDenyCalls + '/' + slowAllowCalls);
}
if (lastPermissionResult?.permissionBehavior !== 'deny') {
  throw new Error('PreToolUse deny should remain final: ' + JSON.stringify(lastPermissionResult));
}
if (lastPermissionResult.hookPermissionDecisionReason !== denyReason) {
  throw new Error('PreToolUse deny reason should survive later allow: ' + JSON.stringify(lastPermissionResult));
}
if (lastPermissionResult.updatedInput !== undefined) {
  throw new Error('PreToolUse deny should not carry lower-priority allow input: ' + JSON.stringify(lastPermissionResult));
}

console.log('pretool hook deny metadata OK');`,
  )
  assert.equal(output, 'pretool hook deny metadata OK')
})

await test('PermissionRequest hooks decide headless permission prompts', async () => {
  const output = await buildAndRunSnippet(
    'permission-request-headless-hook-test',
    `process.env.CLAUDE_CONFIG_DIR = 'build-src/test-artifacts/permission-request-headless-config';
delete process.env.CLAUDE_CODE_SIMPLE;

const [
  { hasPermissionsToUseTool },
  { clearRegisteredHooks, registerHookCallbacks, setIsInteractive },
  { resetHooksConfigSnapshot },
] = await Promise.all([
  import('./src/utils/permissions/permissions.ts'),
  import('./src/bootstrap/state.ts'),
  import('./src/utils/hooks/hooksConfigSnapshot.ts'),
]);

setIsInteractive(false);
clearRegisteredHooks();
resetHooksConfigSnapshot();

const input = {
  file_path: 'build-src/test-artifacts/permission-request-headless.txt',
  content: 'headless permission request hook',
};
const assistantMessage = {
  uuid: 'assistant-test-uuid',
  message: {
    id: 'msg_permission_request_headless_hook',
    role: 'assistant',
    content: [],
  },
};
const tool = {
  name: 'Write',
  inputSchema: {
    parse(value) {
      return value;
    },
  },
  async checkPermissions() {
    return {
      behavior: 'passthrough',
      suggestions: [{ behavior: 'allow', destination: 'userSettings', rule: 'Write' }],
    };
  },
};
function makeContext() {
  let appState = {
    sessionHooks: new Map(),
    toolPermissionContext: {
      mode: 'default',
      shouldAvoidPermissionPrompts: true,
      additionalWorkingDirectories: new Map(),
      alwaysAllowRules: {},
      alwaysDenyRules: {},
      alwaysAskRules: {},
      isBypassPermissionsModeAvailable: false,
    },
  };
  return {
    abortController: new AbortController(),
    options: { isNonInteractiveSession: true },
    getAppState() {
      return appState;
    },
    setAppState(updater) {
      appState = updater(appState);
    },
    updateAttributionState() {},
  };
}
async function runPermissionCheck() {
  return (await runPermissionCheckWithContext()).decision;
}
async function runPermissionCheckWithContext() {
  const context = makeContext();
  const decision = await hasPermissionsToUseTool(
    tool,
    input,
    context,
    assistantMessage,
    'toolu_permission_request_headless_hook',
  );
  return { decision, context };
}

const fallback = await runPermissionCheck();
if (fallback.behavior !== 'deny' || fallback.decisionReason?.type !== 'asyncAgent') {
  throw new Error('headless prompt should auto-deny without hooks: ' + JSON.stringify(fallback));
}

let denyCalls = 0;
registerHookCallbacks({
  PermissionRequest: [
    {
      matcher: 'Write',
      hooks: [
        {
          type: 'callback',
          callback: async hookInput => {
            denyCalls += 1;
            if (hookInput.hook_event_name !== 'PermissionRequest') {
              throw new Error('unexpected hook event: ' + hookInput.hook_event_name);
            }
            if (hookInput.tool_name !== 'Write') {
              throw new Error('unexpected hook tool: ' + hookInput.tool_name);
            }
            if (hookInput.tool_input.file_path !== input.file_path) {
              throw new Error('unexpected hook file path: ' + JSON.stringify(hookInput.tool_input));
            }
            if (!Array.isArray(hookInput.permission_suggestions) || hookInput.permission_suggestions.length !== 1) {
              throw new Error('missing permission suggestions: ' + JSON.stringify(hookInput.permission_suggestions));
            }
            return {
              hookSpecificOutput: {
                hookEventName: 'PermissionRequest',
                decision: {
                  behavior: 'deny',
                  message: 'blocked by PermissionRequest hook',
                },
              },
            };
          },
        },
      ],
    },
  ],
});
const denied = await runPermissionCheck();
if (denyCalls !== 1) {
  throw new Error('deny hook should run once, got ' + denyCalls);
}
if (denied.behavior !== 'deny' || denied.decisionReason?.hookName !== 'PermissionRequest') {
  throw new Error('PermissionRequest hook deny should win: ' + JSON.stringify(denied));
}
if (denied.message !== 'blocked by PermissionRequest hook') {
  throw new Error('PermissionRequest hook deny should preserve message: ' + JSON.stringify(denied));
}

clearRegisteredHooks();
let allowCalls = 0;
registerHookCallbacks({
  PermissionRequest: [
    {
      matcher: 'Write',
      hooks: [
        {
          type: 'callback',
          callback: async () => {
            allowCalls += 1;
            return {
              hookSpecificOutput: {
                hookEventName: 'PermissionRequest',
                decision: {
                  behavior: 'allow',
                  updatedInput: { ...input, content: 'updated by hook' },
                },
              },
            };
          },
        },
      ],
    },
  ],
});
const allowed = await runPermissionCheck();
if (allowCalls !== 1) {
  throw new Error('allow hook should run once, got ' + allowCalls);
}
if (allowed.behavior !== 'allow' || allowed.decisionReason?.hookName !== 'PermissionRequest') {
  throw new Error('PermissionRequest hook allow should win: ' + JSON.stringify(allowed));
}
if (allowed.updatedInput?.content !== 'updated by hook') {
  throw new Error('PermissionRequest hook allow should preserve updated input: ' + JSON.stringify(allowed));
}

clearRegisteredHooks();
let fastAllowCalls = 0;
let slowDenyCalls = 0;
registerHookCallbacks({
  PermissionRequest: [
    {
      matcher: 'Write',
      hooks: [
        {
          type: 'callback',
          callback: async () => {
            fastAllowCalls += 1;
            return {
              hookSpecificOutput: {
                hookEventName: 'PermissionRequest',
                decision: {
                  behavior: 'allow',
                  updatedInput: { ...input, content: 'fast allow should lose' },
                  updatedPermissions: [
                    {
                      type: 'addRules',
                      rules: [{ toolName: 'Write' }],
                      behavior: 'allow',
                      destination: 'userSettings',
                    },
                  ],
                },
              },
            };
          },
        },
        {
          type: 'callback',
          callback: async () => {
            slowDenyCalls += 1;
            await new Promise(resolve => setTimeout(resolve, 25));
            return {
              hookSpecificOutput: {
                hookEventName: 'PermissionRequest',
                decision: {
                  behavior: 'deny',
                  message: 'slow deny should win',
                },
              },
            };
          },
        },
      ],
    },
  ],
});
const {
  decision: concurrentDenied,
  context: concurrentContext,
} = await runPermissionCheckWithContext();
if (fastAllowCalls !== 1 || slowDenyCalls !== 1) {
  throw new Error('concurrent PermissionRequest hooks should both run: ' + fastAllowCalls + '/' + slowDenyCalls);
}
if (concurrentDenied.behavior !== 'deny' || concurrentDenied.decisionReason?.hookName !== 'PermissionRequest') {
  throw new Error('PermissionRequest deny should win over faster allow: ' + JSON.stringify(concurrentDenied));
}
if (concurrentDenied.message !== 'slow deny should win') {
  throw new Error('PermissionRequest deny should preserve slow deny message: ' + JSON.stringify(concurrentDenied));
}
const allowRulesAfterDeny = concurrentContext.getAppState().toolPermissionContext.alwaysAllowRules;
if (Object.keys(allowRulesAfterDeny).length !== 0) {
  throw new Error('denied PermissionRequest should not persist earlier allow updates: ' + JSON.stringify(allowRulesAfterDeny));
}

console.log('permission request headless hook OK');`,
  )
  assert.equal(output, 'permission request headless hook OK')
})

await test('PermissionRequest hooks prefer denials in interactive permission context', async () => {
  const output = await buildAndRunSnippet(
    'permission-request-interactive-hook-test',
    `process.env.CLAUDE_CONFIG_DIR = 'build-src/test-artifacts/permission-request-interactive-config';
delete process.env.CLAUDE_CODE_SIMPLE;

const [
  { createPermissionContext },
  { clearRegisteredHooks, registerHookCallbacks, setIsInteractive },
  { resetHooksConfigSnapshot },
] = await Promise.all([
  import('./src/hooks/toolPermission/PermissionContext.ts'),
  import('./src/bootstrap/state.ts'),
  import('./src/utils/hooks/hooksConfigSnapshot.ts'),
]);

setIsInteractive(false);
clearRegisteredHooks();
resetHooksConfigSnapshot();

const input = {
  file_path: 'build-src/test-artifacts/permission-request-interactive.txt',
  content: 'interactive permission request hook',
};
const suggestions = [
  {
    type: 'addRules',
    rules: [{ toolName: 'Write' }],
    behavior: 'allow',
    destination: 'userSettings',
  },
];
const assistantMessage = {
  uuid: 'assistant-test-uuid',
  message: {
    id: 'msg_permission_request_interactive_hook',
    role: 'assistant',
    content: [],
  },
};
const tool = {
  name: 'Write',
  inputSchema: {
    parse(value) {
      return value;
    },
  },
};

function makeAppState() {
  return {
    sessionHooks: new Map(),
    toolPermissionContext: {
      mode: 'default',
      shouldAvoidPermissionPrompts: false,
      additionalWorkingDirectories: new Map(),
      alwaysAllowRules: {},
      alwaysDenyRules: {},
      alwaysAskRules: {},
      isBypassPermissionsModeAvailable: false,
    },
  };
}

async function runInteractiveHooks(toolUseID) {
  let appState = makeAppState();
  const context = {
    abortController: new AbortController(),
    options: { isNonInteractiveSession: false },
    getAppState() {
      return appState;
    },
    setAppState(updater) {
      appState = updater(appState);
    },
    updateAttributionState() {},
  };
  const setToolPermissionContext = next => {
    appState = { ...appState, toolPermissionContext: next };
  };
  const permissionContext = createPermissionContext(
    tool,
    input,
    context,
    assistantMessage,
    toolUseID,
    setToolPermissionContext,
  );
  const decision = await permissionContext.runHooks(
    'default',
    suggestions,
    undefined,
    Date.now(),
  );
  return { decision, context };
}

const fallback = await runInteractiveHooks('toolu_permission_request_interactive_empty');
if (fallback.decision !== null) {
  throw new Error('interactive PermissionRequest should not decide without hooks: ' + JSON.stringify(fallback.decision));
}

let fastAllowCalls = 0;
let slowDenyCalls = 0;
registerHookCallbacks({
  PermissionRequest: [
    {
      matcher: 'Write',
      hooks: [
        {
          type: 'callback',
          callback: async hookInput => {
            fastAllowCalls += 1;
            if (hookInput.hook_event_name !== 'PermissionRequest') {
              throw new Error('unexpected hook event: ' + hookInput.hook_event_name);
            }
            if (hookInput.tool_name !== 'Write') {
              throw new Error('unexpected hook tool: ' + hookInput.tool_name);
            }
            if (!Array.isArray(hookInput.permission_suggestions) || hookInput.permission_suggestions.length !== 1) {
              throw new Error('missing permission suggestions: ' + JSON.stringify(hookInput.permission_suggestions));
            }
            return {
              hookSpecificOutput: {
                hookEventName: 'PermissionRequest',
                decision: {
                  behavior: 'allow',
                  updatedInput: { ...input, content: 'fast interactive allow should lose' },
                  updatedPermissions: [
                    {
                      type: 'addRules',
                      rules: [{ toolName: 'Write' }],
                      behavior: 'allow',
                      destination: 'userSettings',
                    },
                  ],
                },
              },
            };
          },
        },
        {
          type: 'callback',
          callback: async () => {
            slowDenyCalls += 1;
            await new Promise(resolve => setTimeout(resolve, 25));
            return {
              hookSpecificOutput: {
                hookEventName: 'PermissionRequest',
                decision: {
                  behavior: 'deny',
                  message: 'slow interactive deny should win',
                },
              },
            };
          },
        },
      ],
    },
  ],
});

const { decision, context } = await runInteractiveHooks(
  'toolu_permission_request_interactive_hook',
);
if (fastAllowCalls !== 1 || slowDenyCalls !== 1) {
  throw new Error('interactive PermissionRequest hooks should both run: ' + fastAllowCalls + '/' + slowDenyCalls);
}
if (decision?.behavior !== 'deny' || decision.decisionReason?.hookName !== 'PermissionRequest') {
  throw new Error('interactive PermissionRequest deny should win over faster allow: ' + JSON.stringify(decision));
}
if (decision.message !== 'slow interactive deny should win') {
  throw new Error('interactive PermissionRequest deny should preserve slow deny message: ' + JSON.stringify(decision));
}
const allowRulesAfterDeny = context.getAppState().toolPermissionContext.alwaysAllowRules;
if (Object.keys(allowRulesAfterDeny).length !== 0) {
  throw new Error('interactive denied PermissionRequest should not persist earlier allow updates: ' + JSON.stringify(allowRulesAfterDeny));
}

console.log('permission request interactive hook OK');`,
  )
  assert.equal(output, 'permission request interactive hook OK')
})

await test('interactive PermissionRequest hook failures keep prompt alive', async () => {
  const output = await buildAndRunSnippet(
    'permission-request-interactive-hook-failure-test',
    `delete process.env.CLAUDE_CODE_SIMPLE;

const { handleInteractivePermission } = await import('./src/hooks/toolPermission/handlers/interactiveHandler.ts');

let queuedItem = null;
let resolvedDecision = null;
let removedFromQueue = false;
let unhandledRejection = null;
const onUnhandledRejection = reason => {
  unhandledRejection = reason;
};
process.once('unhandledRejection', onUnhandledRejection);

const ctx = {
  tool: {
    name: 'Write',
  },
  input: {
    file_path: 'build-src/test-artifacts/permission-request-interactive-failure.txt',
    content: 'interactive hook failure',
  },
  toolUseID: 'toolu_permission_request_interactive_hook_failure',
  assistantMessage: {
    uuid: 'assistant-test-uuid',
    message: {
      id: 'msg_permission_request_interactive_hook_failure',
      role: 'assistant',
      content: [],
    },
  },
  toolUseContext: {
    abortController: new AbortController(),
    options: { isNonInteractiveSession: false },
    getAppState() {
      return {
        mcp: { clients: [] },
        toolPermissionContext: {
          mode: 'default',
        },
      };
    },
  },
  pushToQueue(item) {
    queuedItem = item;
  },
  updateQueueItem() {},
  removeFromQueue() {
    removedFromQueue = true;
  },
  async runHooks() {
    throw new Error('interactive hook failure marker');
  },
  logCancelled() {},
  logDecision() {},
  cancelAndAbort(message) {
    return { behavior: 'ask', message: message ?? 'cancelled' };
  },
  async handleUserAllow(updatedInput) {
    return {
      behavior: 'allow',
      updatedInput,
      userModified: false,
    };
  },
  buildAllow(updatedInput) {
    return {
      behavior: 'allow',
      updatedInput,
      userModified: false,
    };
  },
};

handleInteractivePermission(
  {
    ctx,
    description: 'Write file',
    result: {
      behavior: 'ask',
      message: 'permission required',
      suggestions: [],
    },
    awaitAutomatedChecksBeforeDialog: false,
  },
  decision => {
    resolvedDecision = decision;
  },
);

await new Promise(resolve => setTimeout(resolve, 50));
process.removeListener('unhandledRejection', onUnhandledRejection);

if (!queuedItem) {
  throw new Error('interactive prompt was not queued');
}
if (removedFromQueue) {
  throw new Error('hook failure should leave the permission prompt active');
}
if (resolvedDecision) {
  throw new Error('hook failure should not resolve the permission decision: ' + JSON.stringify(resolvedDecision));
}
if (unhandledRejection) {
  throw new Error('hook failure leaked an unhandled rejection: ' + String(unhandledRejection?.message ?? unhandledRejection));
}

console.log('interactive hook failure OK');`,
  )
  assert.equal(output, 'interactive hook failure OK')
})

await test('PermissionRequest command hooks decide Bash headless prompts', async () => {
  const output = await buildAndRunSnippet(
    'permission-request-command-hook-test',
    `const { mkdir, readFile, rm, writeFile } = await import('node:fs/promises');

const configDirRel = 'build-src/test-artifacts/permission-request-command-config';
await rm(configDirRel, { recursive: true, force: true });
await mkdir(configDirRel, { recursive: true });
process.env.CLAUDE_CONFIG_DIR = configDirRel;
delete process.env.CLAUDE_CODE_SIMPLE;

const failingCommandPath = configDirRel + '/permission-request-fail-command.mjs';
const allowCommandPath = configDirRel + '/permission-request-allow-command.mjs';
const timeoutCommandPath = configDirRel + '/permission-request-timeout-command.mjs';
const timeoutMarkerPath = configDirRel + '/permission-request-timeout-flushed.txt';
await writeFile(
  failingCommandPath,
  [
    "let input = '';",
    "for await (const chunk of process.stdin) input += chunk;",
    "const data = JSON.parse(input);",
    "if (data.hook_event_name !== 'PermissionRequest') process.exit(3);",
    "if (data.tool_name !== 'Bash') process.exit(4);",
    "process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow', updatedInput: { command: 'echo should-not-allow-6284' } } } }));",
    "process.exit(1);",
  ].join('\\n'),
  'utf8',
);
await writeFile(
  allowCommandPath,
  [
    "let input = '';",
    "for await (const chunk of process.stdin) input += chunk;",
    "const data = JSON.parse(input);",
    "if (data.hook_event_name !== 'PermissionRequest') { process.stderr.write('bad event'); process.exit(3); }",
    "if (data.tool_name !== 'Bash') { process.stderr.write('bad tool'); process.exit(4); }",
    "if (data.tool_input?.command !== 'echo original permission command 6284') { process.stderr.write('bad command'); process.exit(5); }",
    "if (!Array.isArray(data.permission_suggestions) || data.permission_suggestions[0]?.rule !== 'Bash(echo:*)') { process.stderr.write('bad suggestions'); process.exit(6); }",
    "process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow', updatedInput: { ...data.tool_input, command: 'echo allowed permission command 6284' } } } }));",
  ].join('\\n'),
  'utf8',
);
await writeFile(
  timeoutCommandPath,
  [
    "const { writeFile } = await import('node:fs/promises');",
    "let input = '';",
    "for await (const chunk of process.stdin) input += chunk;",
    "const data = JSON.parse(input);",
    "if (data.hook_event_name !== 'PermissionRequest') process.exit(3);",
    "if (data.tool_name !== 'Bash') process.exit(4);",
    "await new Promise(resolve => process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow', updatedInput: { ...data.tool_input, command: 'echo timed out allow should be ignored 6284' } } } }), resolve));",
    "await writeFile(" + JSON.stringify(timeoutMarkerPath) + ", 'flushed', 'utf8');",
    "await new Promise(resolve => setTimeout(resolve, 2000));",
  ].join('\\n'),
  'utf8',
);

const [
  { hasPermissionsToUseTool },
  { setIsInteractive },
  { resetHooksConfigSnapshot },
  { resetSettingsCache },
] = await Promise.all([
  import('./src/utils/permissions/permissions.ts'),
  import('./src/bootstrap/state.ts'),
  import('./src/utils/hooks/hooksConfigSnapshot.ts'),
  import('./src/utils/settings/settingsCache.ts'),
]);

async function writeSettings(commandPath, timeout = 5) {
  await writeFile(
    configDirRel + '/settings.json',
    JSON.stringify(
      {
        hooks: {
          PermissionRequest: [
            {
              matcher: 'Bash',
              hooks: [
                {
                  type: 'command',
                  command: 'node ' + commandPath,
                  timeout,
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
  );
  setIsInteractive(false);
  resetHooksConfigSnapshot();
  resetSettingsCache();
}

const input = {
  command: 'echo original permission command 6284',
};
const assistantMessage = {
  uuid: 'assistant-permission-command-uuid',
  message: {
    id: 'msg_permission_request_command_hook',
    role: 'assistant',
    content: [],
  },
};
const tool = {
  name: 'Bash',
  inputSchema: {
    parse(value) {
      return value;
    },
  },
  async checkPermissions() {
    return {
      behavior: 'passthrough',
      suggestions: [{ behavior: 'allow', destination: 'userSettings', rule: 'Bash(echo:*)' }],
    };
  },
};
function makeContext() {
  let appState = {
    sessionHooks: new Map(),
    toolPermissionContext: {
      mode: 'default',
      shouldAvoidPermissionPrompts: true,
      additionalWorkingDirectories: new Map(),
      alwaysAllowRules: {},
      alwaysDenyRules: {},
      alwaysAskRules: {},
      isBypassPermissionsModeAvailable: false,
    },
  };
  return {
    abortController: new AbortController(),
    options: { isNonInteractiveSession: true },
    getAppState() {
      return appState;
    },
    setAppState(updater) {
      appState = updater(appState);
    },
    updateAttributionState() {},
  };
}
async function runPermissionCheck() {
  return await hasPermissionsToUseTool(
    tool,
    input,
    makeContext(),
    assistantMessage,
    'toolu_permission_request_command_hook',
  );
}

await writeSettings(failingCommandPath);
const failed = await runPermissionCheck();
if (failed.behavior !== 'deny' || failed.decisionReason?.type !== 'asyncAgent') {
  throw new Error('non-zero PermissionRequest command should not decide permission: ' + JSON.stringify(failed));
}

const timeoutCommandPathForHook = timeoutCommandPath.replace(/\\\\/g, '/');
await writeSettings(timeoutCommandPathForHook, 0.5);
const timedOut = await runPermissionCheck();
if (timedOut.behavior !== 'deny' || timedOut.decisionReason?.type !== 'asyncAgent') {
  throw new Error('timed-out PermissionRequest command should not decide permission: ' + JSON.stringify(timedOut));
}
const timeoutMarker = await readFile(timeoutMarkerPath, 'utf8').catch(() => '');
if (timeoutMarker !== 'flushed') {
  throw new Error('timeout command should flush allow JSON before timeout; marker=' + JSON.stringify(timeoutMarker));
}

await writeSettings(allowCommandPath);
const allowed = await runPermissionCheck();
if (allowed.behavior !== 'allow' || allowed.decisionReason?.hookName !== 'PermissionRequest') {
  throw new Error('PermissionRequest command hook should allow Bash: ' + JSON.stringify(allowed));
}
if (allowed.updatedInput?.command !== 'echo allowed permission command 6284') {
  throw new Error('PermissionRequest command hook should preserve updated Bash input: ' + JSON.stringify(allowed));
}

console.log('permission request command hook OK');`,
  )
  assert.equal(output, 'permission request command hook OK')
})

await test('PostToolUseFailure hooks attach additional context', async () => {
  const output = await buildAndRunSnippet(
    'post-tool-use-failure-hook-test',
    `process.env.CLAUDE_CONFIG_DIR = 'build-src/test-artifacts/post-tool-use-failure-hook-config';
delete process.env.CLAUDE_CODE_SIMPLE;

const [
  { runPostToolUseFailureHooks },
  { clearRegisteredHooks, registerHookCallbacks, setIsInteractive },
  { resetHooksConfigSnapshot },
] = await Promise.all([
  import('./src/services/tools/toolHooks.ts'),
  import('./src/bootstrap/state.ts'),
  import('./src/utils/hooks/hooksConfigSnapshot.ts'),
]);

setIsInteractive(false);
clearRegisteredHooks();
resetHooksConfigSnapshot();

const input = { file_path: 'build-src/test-artifacts/missing-post-failure.txt' };
const failureMessage = 'ENOENT missing-post-failure marker 4318';
const additionalContext = 'post failure hook context marker 4318';
let calls = 0;
registerHookCallbacks({
  PostToolUseFailure: [
    {
      matcher: 'Read',
      hooks: [
        {
          type: 'callback',
          callback: async hookInput => {
            calls += 1;
            if (hookInput.hook_event_name !== 'PostToolUseFailure') {
              throw new Error('unexpected hook event: ' + hookInput.hook_event_name);
            }
            if (hookInput.tool_name !== 'Read') {
              throw new Error('unexpected hook tool: ' + hookInput.tool_name);
            }
            if (hookInput.tool_use_id !== 'toolu_post_failure_hook') {
              throw new Error('unexpected tool use id: ' + hookInput.tool_use_id);
            }
            if (hookInput.tool_input.file_path !== input.file_path) {
              throw new Error('unexpected tool input: ' + JSON.stringify(hookInput.tool_input));
            }
            if (!String(hookInput.error).includes(failureMessage)) {
              throw new Error('missing failure message in hook input: ' + hookInput.error);
            }
            if (hookInput.is_interrupt !== false) {
              throw new Error('unexpected interrupt flag: ' + hookInput.is_interrupt);
            }
            return {
              hookSpecificOutput: {
                hookEventName: 'PostToolUseFailure',
                additionalContext,
              },
            };
          },
        },
      ],
    },
  ],
});

let appState = {
  sessionHooks: new Map(),
  toolPermissionContext: {
    mode: 'default',
    additionalWorkingDirectories: new Map(),
    alwaysAllowRules: {},
    alwaysDenyRules: {},
    alwaysAskRules: {},
    isBypassPermissionsModeAvailable: false,
  },
};
const context = {
  abortController: new AbortController(),
  options: { isNonInteractiveSession: true },
  getAppState() {
    return appState;
  },
  setAppState(updater) {
    appState = updater(appState);
  },
  updateAttributionState() {},
};
const tool = { name: 'Read', isMcp: false };
const updates = [];
for await (const update of runPostToolUseFailureHooks(
  context,
  tool,
  'toolu_post_failure_hook',
  'msg_post_failure_hook',
  input,
  failureMessage,
  false,
  'req_post_failure_hook',
  undefined,
  undefined,
)) {
  updates.push(update);
}
if (calls !== 1) {
  throw new Error('PostToolUseFailure hook should run once, got ' + calls);
}
const contextAttachment = updates.find(update => {
  const attachment = update.message?.attachment;
  return (
    attachment?.type === 'hook_additional_context' &&
    attachment.hookEvent === 'PostToolUseFailure' &&
    attachment.hookName === 'PostToolUseFailure:Read' &&
    Array.isArray(attachment.content) &&
    attachment.content.includes(additionalContext)
  );
});
if (!contextAttachment) {
  throw new Error('missing PostToolUseFailure additional context attachment: ' + JSON.stringify(updates));
}

console.log('post tool use failure hook OK');`,
  )
  assert.equal(output, 'post tool use failure hook OK')
})

await test('PostToolUse hooks can update MCP output', async () => {
  const output = await buildAndRunSnippet(
    'post-tool-use-hook-test',
    `process.env.CLAUDE_CONFIG_DIR = 'build-src/test-artifacts/post-tool-use-hook-config';
delete process.env.CLAUDE_CODE_SIMPLE;

const [
  { runPostToolUseHooks },
  { clearRegisteredHooks, registerHookCallbacks, setIsInteractive },
  { resetHooksConfigSnapshot },
] = await Promise.all([
  import('./src/services/tools/toolHooks.ts'),
  import('./src/bootstrap/state.ts'),
  import('./src/utils/hooks/hooksConfigSnapshot.ts'),
]);

setIsInteractive(false);
clearRegisteredHooks();
resetHooksConfigSnapshot();

const toolName = 'mcp__fixture__lookup';
const input = { query: 'post tool hook input marker 6284' };
const originalOutput = {
  content: [{ type: 'text', text: 'original output marker 6284' }],
};
const replacementOutput = {
  content: [{ type: 'text', text: 'rewritten output marker 6284' }],
  structuredContent: { rewritten: true },
};
const additionalContext = 'post tool hook context marker 6284';
let calls = 0;
registerHookCallbacks({
  PostToolUse: [
    {
      matcher: toolName,
      hooks: [
        {
          type: 'callback',
          callback: async hookInput => {
            calls += 1;
            if (hookInput.hook_event_name !== 'PostToolUse') {
              throw new Error('unexpected hook event: ' + hookInput.hook_event_name);
            }
            if (hookInput.tool_name !== toolName) {
              throw new Error('unexpected hook tool: ' + hookInput.tool_name);
            }
            if (hookInput.tool_use_id !== 'toolu_post_tool_hook') {
              throw new Error('unexpected tool use id: ' + hookInput.tool_use_id);
            }
            if (hookInput.tool_input.query !== input.query) {
              throw new Error('unexpected tool input: ' + JSON.stringify(hookInput.tool_input));
            }
            if (hookInput.tool_response.content?.[0]?.text !== originalOutput.content[0].text) {
              throw new Error('unexpected tool response: ' + JSON.stringify(hookInput.tool_response));
            }
            return {
              hookSpecificOutput: {
                hookEventName: 'PostToolUse',
                additionalContext,
                updatedMCPToolOutput: replacementOutput,
              },
            };
          },
        },
      ],
    },
  ],
});

let appState = {
  sessionHooks: new Map(),
  toolPermissionContext: {
    mode: 'default',
    additionalWorkingDirectories: new Map(),
    alwaysAllowRules: {},
    alwaysDenyRules: {},
    alwaysAskRules: {},
    isBypassPermissionsModeAvailable: false,
  },
};
const context = {
  abortController: new AbortController(),
  options: { isNonInteractiveSession: true },
  getAppState() {
    return appState;
  },
  setAppState(updater) {
    appState = updater(appState);
  },
  updateAttributionState() {},
};
const tool = { name: toolName, isMcp: true };
const updates = [];
for await (const update of runPostToolUseHooks(
  context,
  tool,
  'toolu_post_tool_hook',
  'msg_post_tool_hook',
  input,
  originalOutput,
  'req_post_tool_hook',
  'stdio',
  undefined,
)) {
  updates.push(update);
}
if (calls !== 1) {
  throw new Error('PostToolUse hook should run once, got ' + calls);
}
const contextAttachment = updates.find(update => {
  const attachment = update.message?.attachment;
  return (
    attachment?.type === 'hook_additional_context' &&
    attachment.hookEvent === 'PostToolUse' &&
    attachment.hookName === 'PostToolUse:' + toolName &&
    Array.isArray(attachment.content) &&
    attachment.content.includes(additionalContext)
  );
});
if (!contextAttachment) {
  throw new Error('missing PostToolUse additional context attachment: ' + JSON.stringify(updates));
}
const replacement = updates.find(update => update.updatedMCPToolOutput);
if (!replacement) {
  throw new Error('missing updated MCP output: ' + JSON.stringify(updates));
}
if (replacement.updatedMCPToolOutput.content?.[0]?.text !== replacementOutput.content[0].text) {
  throw new Error('updated MCP output did not preserve replacement: ' + JSON.stringify(replacement));
}
if (replacement.updatedMCPToolOutput.structuredContent?.rewritten !== true) {
  throw new Error('updated MCP output lost structured content: ' + JSON.stringify(replacement));
}

console.log('post tool use hook OK');`,
  )
  assert.equal(output, 'post tool use hook OK')
})

await test('PostToolUse command hooks can update MCP output', async () => {
  const output = await buildAndRunSnippet(
    'post-tool-use-command-hook-test',
    `const { mkdir, rm, writeFile } = await import('node:fs/promises');
const { join } = await import('node:path');

process.env.CLAUDE_CONFIG_DIR = 'build-src/test-artifacts/post-tool-use-command-hook-config';
delete process.env.CLAUDE_CODE_SIMPLE;

const commandDir = join(process.cwd(), 'build-src', 'test-artifacts', 'post-tool-use-command-hook-config');
await rm(commandDir, { recursive: true, force: true });
await mkdir(commandDir, { recursive: true });
const commandPath = join(commandDir, 'post-tool-use-command-hook.mjs');
const commandPathForHook = commandPath.replace(/\\\\/g, '/');
const toolName = 'mcp__fixture__command_lookup';
const inputQuery = 'post tool command input marker 4286';
const originalText = 'original command output marker 4286';
const replacementText = 'rewritten command output marker 4286';
const additionalContext = 'post tool command context marker 4286';
await writeFile(
  commandPath,
  [
    "let input = '';",
    "for await (const chunk of process.stdin) input += chunk;",
    "const data = JSON.parse(input);",
    "if (data.hook_event_name !== 'PostToolUse') { process.stderr.write('bad event ' + data.hook_event_name); process.exit(3); }",
    "if (data.tool_name !== '" + toolName + "') { process.stderr.write('bad tool ' + data.tool_name); process.exit(4); }",
    "if (data.tool_use_id !== 'toolu_post_tool_command_hook') { process.stderr.write('bad tool use id ' + data.tool_use_id); process.exit(5); }",
    "if (data.tool_input.query !== '" + inputQuery + "') { process.stderr.write('bad input ' + JSON.stringify(data.tool_input)); process.exit(6); }",
    "if (data.tool_response.content?.[0]?.text !== '" + originalText + "') { process.stderr.write('bad response ' + JSON.stringify(data.tool_response)); process.exit(7); }",
    "process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: '" + additionalContext + "', updatedMCPToolOutput: { content: [{ type: 'text', text: '" + replacementText + "' }], structuredContent: { commandRewritten: true } } } }));",
    "process.exit(0);",
  ].join('\\n'),
  'utf8',
);

const [
  { runPostToolUseHooks },
  { clearRegisteredHooks, registerHookCallbacks, setIsInteractive },
  { resetHooksConfigSnapshot },
] = await Promise.all([
  import('./src/services/tools/toolHooks.ts'),
  import('./src/bootstrap/state.ts'),
  import('./src/utils/hooks/hooksConfigSnapshot.ts'),
]);

setIsInteractive(false);
clearRegisteredHooks();
resetHooksConfigSnapshot();

registerHookCallbacks({
  PostToolUse: [
    {
      matcher: toolName,
      hooks: [
        {
          type: 'command',
          command: 'node ' + commandPathForHook,
          timeout: 5,
        },
      ],
    },
  ],
});

let appState = {
  sessionHooks: new Map(),
  toolPermissionContext: {
    mode: 'default',
    additionalWorkingDirectories: new Map(),
    alwaysAllowRules: {},
    alwaysDenyRules: {},
    alwaysAskRules: {},
    isBypassPermissionsModeAvailable: false,
  },
};
const context = {
  abortController: new AbortController(),
  options: { isNonInteractiveSession: true },
  getAppState() {
    return appState;
  },
  setAppState(updater) {
    appState = updater(appState);
  },
  updateAttributionState() {},
};
const originalOutput = {
  content: [{ type: 'text', text: originalText }],
};
const tool = { name: toolName, isMcp: true };
const updates = [];
for await (const update of runPostToolUseHooks(
  context,
  tool,
  'toolu_post_tool_command_hook',
  'msg_post_tool_command_hook',
  { query: inputQuery },
  originalOutput,
  'req_post_tool_command_hook',
  'stdio',
  undefined,
)) {
  updates.push(update);
}
const contextAttachment = updates.find(update => {
  const attachment = update.message?.attachment;
  return (
    attachment?.type === 'hook_additional_context' &&
    attachment.hookEvent === 'PostToolUse' &&
    attachment.hookName === 'PostToolUse:' + toolName &&
    Array.isArray(attachment.content) &&
    attachment.content.includes(additionalContext)
  );
});
if (!contextAttachment) {
  throw new Error('missing PostToolUse command additional context attachment: ' + JSON.stringify(updates));
}
const replacement = updates.find(update => update.updatedMCPToolOutput);
if (!replacement) {
  throw new Error('missing command updated MCP output: ' + JSON.stringify(updates));
}
if (replacement.updatedMCPToolOutput.content?.[0]?.text !== replacementText) {
  throw new Error('command updated MCP output did not preserve replacement: ' + JSON.stringify(replacement));
}
if (replacement.updatedMCPToolOutput.structuredContent?.commandRewritten !== true) {
  throw new Error('command updated MCP output lost structured content: ' + JSON.stringify(replacement));
}

const skipped = [];
for await (const update of runPostToolUseHooks(
  context,
  { name: 'mcp__fixture__other_command_lookup', isMcp: true },
  'toolu_post_tool_command_hook_skip',
  'msg_post_tool_command_hook_skip',
  { query: inputQuery },
  originalOutput,
  'req_post_tool_command_hook_skip',
  'stdio',
  undefined,
)) {
  skipped.push(update);
}
if (skipped.length !== 0) {
  throw new Error('PostToolUse command matcher should skip other tools: ' + JSON.stringify(skipped));
}

console.log('post tool use command hook OK');`,
  )
  assert.equal(output, 'post tool use command hook OK')
})

await test('PermissionDenied hooks can request retry', async () => {
  const output = await buildAndRunSnippet(
    'permission-denied-hook-test',
    `process.env.CLAUDE_CONFIG_DIR = 'build-src/test-artifacts/permission-denied-hook-config';
delete process.env.CLAUDE_CODE_SIMPLE;

const [
  { executePermissionDeniedHooks },
  { clearRegisteredHooks, registerHookCallbacks, setIsInteractive },
  { resetHooksConfigSnapshot },
] = await Promise.all([
  import('./src/utils/hooks.ts'),
  import('./src/bootstrap/state.ts'),
  import('./src/utils/hooks/hooksConfigSnapshot.ts'),
]);

setIsInteractive(false);
clearRegisteredHooks();
resetHooksConfigSnapshot();

const input = { command: 'echo permission-denied-hook marker 9821' };
const deniedReason = 'permission denied hook reason marker 9821';
let calls = 0;
registerHookCallbacks({
  PermissionDenied: [
    {
      matcher: 'Bash',
      hooks: [
        {
          type: 'callback',
          callback: async hookInput => {
            calls += 1;
            if (hookInput.hook_event_name !== 'PermissionDenied') {
              throw new Error('unexpected hook event: ' + hookInput.hook_event_name);
            }
            if (hookInput.tool_name !== 'Bash') {
              throw new Error('unexpected hook tool: ' + hookInput.tool_name);
            }
            if (hookInput.tool_use_id !== 'toolu_permission_denied_hook') {
              throw new Error('unexpected tool use id: ' + hookInput.tool_use_id);
            }
            if (hookInput.tool_input.command !== input.command) {
              throw new Error('unexpected tool input: ' + JSON.stringify(hookInput.tool_input));
            }
            if (!String(hookInput.reason).includes(deniedReason)) {
              throw new Error('missing denied reason in hook input: ' + hookInput.reason);
            }
            return {
              hookSpecificOutput: {
                hookEventName: 'PermissionDenied',
                retry: true,
              },
            };
          },
        },
      ],
    },
  ],
});

const context = {
  abortController: new AbortController(),
  options: { isNonInteractiveSession: true },
  getAppState() {
    return {
      sessionHooks: new Map(),
      toolPermissionContext: {
        mode: 'auto',
        additionalWorkingDirectories: new Map(),
        alwaysAllowRules: {},
        alwaysDenyRules: {},
        alwaysAskRules: {},
        isBypassPermissionsModeAvailable: false,
      },
    };
  },
  setAppState() {},
  updateAttributionState() {},
};
const results = [];
for await (const result of executePermissionDeniedHooks(
  'Bash',
  'toolu_permission_denied_hook',
  input,
  deniedReason,
  context,
  'auto',
  context.abortController.signal,
)) {
  results.push(result);
}
if (calls !== 1) {
  throw new Error('PermissionDenied hook should run once, got ' + calls);
}
if (!results.some(result => result.retry === true)) {
  throw new Error('PermissionDenied hook retry flag was not yielded: ' + JSON.stringify(results));
}

console.log('permission denied hook OK');`,
  )
  assert.equal(output, 'permission denied hook OK')
})

await test('ConfigChange hooks cannot block policy settings', async () => {
  const output = await buildAndRunSnippet(
    'config-change-policy-hook-test',
    `const { mkdir, rm, writeFile } = await import('node:fs/promises');
const { join } = await import('node:path');

const configDir = join(process.cwd(), 'build-src', 'test-artifacts', 'config-change-policy-hook-config');
await rm(configDir, { recursive: true, force: true });
await mkdir(configDir, { recursive: true });
process.env.CLAUDE_CONFIG_DIR = configDir;
delete process.env.CLAUDE_CODE_SIMPLE;

await writeFile(
  join(configDir, 'settings.json'),
  JSON.stringify(
    {
      hooks: {
        ConfigChange: [
          {
            matcher: 'user_settings|policy_settings',
            hooks: [
              {
                type: 'command',
                shell: 'powershell',
                command: "[Console]::Error.WriteLine('config change block marker 5086'); exit 2",
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
);

const [
  { executeConfigChangeHooks },
  { setIsInteractive },
  { resetHooksConfigSnapshot },
] = await Promise.all([
  import('./src/utils/hooks.ts'),
  import('./src/bootstrap/state.ts'),
  import('./src/utils/hooks/hooksConfigSnapshot.ts'),
]);

setIsInteractive(false);
resetHooksConfigSnapshot();

const userResults = await executeConfigChangeHooks(
  'user_settings',
  join(configDir, 'settings.json'),
  10000,
);
if (userResults.length !== 1) {
  throw new Error('expected one user settings ConfigChange result: ' + JSON.stringify(userResults));
}
if (userResults[0].blocked !== true) {
  throw new Error('user settings ConfigChange should be blocked: ' + JSON.stringify(userResults));
}
if (!String(userResults[0].output).includes('config change block marker 5086')) {
  throw new Error('user settings ConfigChange should include hook stderr: ' + JSON.stringify(userResults));
}

const policyResults = await executeConfigChangeHooks(
  'policy_settings',
  join(configDir, 'policy-settings.json'),
  10000,
);
if (policyResults.length !== 1) {
  throw new Error('expected one policy settings ConfigChange result: ' + JSON.stringify(policyResults));
}
if (policyResults[0].blocked !== false) {
  throw new Error('policy settings ConfigChange must not be blockable: ' + JSON.stringify(policyResults));
}
if (!String(policyResults[0].output).includes('config change block marker 5086')) {
  throw new Error('policy settings ConfigChange should still execute audit hook: ' + JSON.stringify(policyResults));
}

console.log('config change policy hook OK');`,
  )
  assert.equal(output, 'config change policy hook OK')
})

await test('outside REPL command hooks ignore failed JSON decisions', async () => {
  const output = await buildAndRunSnippet(
    'outside-repl-failed-json-hook-test',
    `const { mkdir, rm, writeFile } = await import('node:fs/promises');
const { join } = await import('node:path');

const configDir = join(process.cwd(), 'build-src', 'test-artifacts', 'outside-repl-failed-json-hook-config');
await rm(configDir, { recursive: true, force: true });
await mkdir(configDir, { recursive: true });
process.env.CLAUDE_CONFIG_DIR = configDir;
delete process.env.CLAUDE_CODE_SIMPLE;

const commandPath = join(configDir, 'failed-json-block-command.mjs');
const commandPathForHook = commandPath.replace(/\\\\/g, '/');
await writeFile(
  commandPath,
  [
    "let input = '';",
    "for await (const chunk of process.stdin) input += chunk;",
    "const data = JSON.parse(input);",
    "if (data.hook_event_name !== 'ConfigChange') { process.stderr.write('bad event'); process.exit(3); }",
    "if (data.source !== 'user_settings') { process.stderr.write('bad source'); process.exit(4); }",
    "process.stdout.write(JSON.stringify({ decision: 'block', reason: 'stdout block should be ignored 9327' }));",
    "process.stderr.write('nonzero config change marker 9327');",
    "process.exit(1);",
  ].join('\\n'),
  'utf8',
);
await writeFile(
  join(configDir, 'settings.json'),
  JSON.stringify(
    {
      hooks: {
        ConfigChange: [
          {
            matcher: 'user_settings',
            hooks: [
              {
                type: 'command',
                command: 'node ' + commandPathForHook,
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
);

const [
  { executeConfigChangeHooks },
  { setIsInteractive },
  { resetHooksConfigSnapshot },
  { resetSettingsCache },
] = await Promise.all([
  import('./src/utils/hooks.ts'),
  import('./src/bootstrap/state.ts'),
  import('./src/utils/hooks/hooksConfigSnapshot.ts'),
  import('./src/utils/settings/settingsCache.ts'),
]);

setIsInteractive(false);
resetHooksConfigSnapshot();
resetSettingsCache();

const results = await executeConfigChangeHooks(
  'user_settings',
  join(configDir, 'settings.json'),
  10000,
);
if (results.length !== 1) {
  throw new Error('expected one ConfigChange result: ' + JSON.stringify(results));
}
if (results[0].succeeded !== false) {
  throw new Error('non-zero ConfigChange command should fail: ' + JSON.stringify(results));
}
if (results[0].blocked !== false) {
  throw new Error('non-zero ConfigChange stdout JSON must not block: ' + JSON.stringify(results));
}
if (!String(results[0].output).includes('nonzero config change marker 9327')) {
  throw new Error('non-zero ConfigChange should return stderr output: ' + JSON.stringify(results));
}
if (String(results[0].output).includes('stdout block should be ignored 9327')) {
  throw new Error('non-zero ConfigChange should not return stdout JSON as output: ' + JSON.stringify(results));
}

console.log('outside repl failed json hooks OK');`,
  )
  assert.equal(output, 'outside repl failed json hooks OK')
})

await test('environment hooks collect watch paths and system messages', async () => {
  const output = await buildAndRunSnippet(
    'environment-watch-hook-test',
    `const { mkdir, rm, writeFile } = await import('node:fs/promises');
const { basename, join } = await import('node:path');

const configDir = join(process.cwd(), 'build-src', 'test-artifacts', 'environment-watch-hook-config');
await rm(configDir, { recursive: true, force: true });
await mkdir(configDir, { recursive: true });
process.env.CLAUDE_CONFIG_DIR = configDir;
delete process.env.CLAUDE_CODE_SIMPLE;

function psWriteJson(value) {
  return "Write-Output '" + JSON.stringify(value).replace(/'/g, "''") + "'";
}

const cwdWatchPath = join(process.cwd(), 'build-src', 'test-artifacts', 'cwd-watch-marker-2741.txt').replace(/\\\\/g, '/');
const fileWatchPath = join(process.cwd(), 'build-src', 'test-artifacts', 'file-watch-marker-2741.txt').replace(/\\\\/g, '/');
const changedFile = join(process.cwd(), 'build-src', 'test-artifacts', 'tracked-env-file-2741.env');
const cwdSystemMessage = 'cwd changed system marker 2741';
const fileSystemMessage = 'file changed system marker 2741';

await writeFile(
  join(configDir, 'settings.json'),
  JSON.stringify(
    {
      hooks: {
        CwdChanged: [
          {
            hooks: [
              {
                type: 'command',
                shell: 'powershell',
                command: psWriteJson({
                  systemMessage: cwdSystemMessage,
                  hookSpecificOutput: {
                    hookEventName: 'CwdChanged',
                    watchPaths: [cwdWatchPath],
                  },
                }),
                timeout: 5,
              },
            ],
          },
        ],
        FileChanged: [
          {
            matcher: basename(changedFile),
            hooks: [
              {
                type: 'command',
                shell: 'powershell',
                command: psWriteJson({
                  systemMessage: fileSystemMessage,
                  hookSpecificOutput: {
                    hookEventName: 'FileChanged',
                    watchPaths: [fileWatchPath],
                  },
                }),
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
);

const [
  { executeCwdChangedHooks, executeFileChangedHooks },
  { setIsInteractive },
  { resetHooksConfigSnapshot },
] = await Promise.all([
  import('./src/utils/hooks.ts'),
  import('./src/bootstrap/state.ts'),
  import('./src/utils/hooks/hooksConfigSnapshot.ts'),
]);

setIsInteractive(false);
resetHooksConfigSnapshot();

const cwdResult = await executeCwdChangedHooks(
  join(process.cwd(), 'old-cwd'),
  process.cwd(),
  10000,
);
if (cwdResult.results.length !== 1 || cwdResult.results[0].succeeded !== true) {
  throw new Error('CwdChanged hook should succeed: ' + JSON.stringify(cwdResult));
}
if (!cwdResult.watchPaths.includes(cwdWatchPath)) {
  throw new Error('CwdChanged hook should return watch path: ' + JSON.stringify(cwdResult.watchPaths));
}
if (!cwdResult.systemMessages.includes(cwdSystemMessage)) {
  throw new Error('CwdChanged hook should return system message: ' + JSON.stringify(cwdResult.systemMessages));
}

const fileResult = await executeFileChangedHooks(changedFile, 'change', 10000);
if (fileResult.results.length !== 1 || fileResult.results[0].succeeded !== true) {
  throw new Error('FileChanged hook should succeed: ' + JSON.stringify(fileResult));
}
if (!fileResult.watchPaths.includes(fileWatchPath)) {
  throw new Error('FileChanged hook should return watch path: ' + JSON.stringify(fileResult.watchPaths));
}
if (!fileResult.systemMessages.includes(fileSystemMessage)) {
  throw new Error('FileChanged hook should return system message: ' + JSON.stringify(fileResult.systemMessages));
}

const skippedFile = join(process.cwd(), 'build-src', 'test-artifacts', 'ignored-env-file-2741.env');
const skippedResult = await executeFileChangedHooks(skippedFile, 'change', 10000);
if (skippedResult.results.length !== 0) {
  throw new Error('FileChanged matcher should skip other basenames: ' + JSON.stringify(skippedResult));
}

console.log('environment watch hooks OK');`,
  )
  assert.equal(output, 'environment watch hooks OK')
})

await test('worktree hooks create and remove paths', async () => {
  const output = await buildAndRunSnippet(
    'worktree-hook-test',
    `process.env.CLAUDE_CONFIG_DIR = 'build-src/test-artifacts/worktree-hook-config';
delete process.env.CLAUDE_CODE_SIMPLE;

const [
  {
    executeWorktreeCreateHook,
    executeWorktreeRemoveHook,
    hasWorktreeCreateHook,
  },
  { clearRegisteredHooks, registerHookCallbacks, setIsInteractive },
  { resetHooksConfigSnapshot },
] = await Promise.all([
  import('./src/utils/hooks.ts'),
  import('./src/bootstrap/state.ts'),
  import('./src/utils/hooks/hooksConfigSnapshot.ts'),
]);

setIsInteractive(false);
clearRegisteredHooks();
resetHooksConfigSnapshot();

if (hasWorktreeCreateHook()) {
  throw new Error('WorktreeCreate hook should not be configured before registration');
}

const expectedName = 'worktree-hook-branch-6119';
const expectedPath = 'build-src/test-artifacts/worktree-hook-created-6119';
let createCalls = 0;
let removeCalls = 0;
registerHookCallbacks({
  WorktreeCreate: [
    {
      hooks: [
        {
          type: 'callback',
          callback: async hookInput => {
            createCalls += 1;
            if (hookInput.hook_event_name !== 'WorktreeCreate') {
              throw new Error('unexpected create event: ' + hookInput.hook_event_name);
            }
            if (hookInput.name !== expectedName) {
              throw new Error('unexpected worktree name: ' + hookInput.name);
            }
            return {
              hookSpecificOutput: {
                hookEventName: 'WorktreeCreate',
                worktreePath: expectedPath,
              },
            };
          },
        },
      ],
    },
  ],
  WorktreeRemove: [
    {
      hooks: [
        {
          type: 'callback',
          callback: async hookInput => {
            removeCalls += 1;
            if (hookInput.hook_event_name !== 'WorktreeRemove') {
              throw new Error('unexpected remove event: ' + hookInput.hook_event_name);
            }
            if (hookInput.worktree_path !== expectedPath) {
              throw new Error('unexpected worktree path: ' + hookInput.worktree_path);
            }
            return { systemMessage: 'worktree removed marker 6119' };
          },
        },
      ],
    },
  ],
});

if (!hasWorktreeCreateHook()) {
  throw new Error('WorktreeCreate hook should be detected after registration');
}

const created = await executeWorktreeCreateHook(expectedName);
if (createCalls !== 1) {
  throw new Error('WorktreeCreate hook should run once, got ' + createCalls);
}
if (created.worktreePath !== expectedPath) {
  throw new Error('WorktreeCreate should return hook path: ' + JSON.stringify(created));
}

const removed = await executeWorktreeRemoveHook(expectedPath);
if (removed !== true) {
  throw new Error('WorktreeRemove hook should report that it ran');
}
if (removeCalls !== 1) {
  throw new Error('WorktreeRemove hook should run once, got ' + removeCalls);
}

clearRegisteredHooks();
const removedWithoutHooks = await executeWorktreeRemoveHook(expectedPath);
if (removedWithoutHooks !== false) {
  throw new Error('WorktreeRemove should return false without hooks');
}

console.log('worktree hooks OK');`,
  )
  assert.equal(output, 'worktree hooks OK')
})

await test('InstructionsLoaded hooks receive load metadata', async () => {
  const output = await buildAndRunSnippet(
    'instructions-loaded-hook-test',
    `process.env.CLAUDE_CONFIG_DIR = 'build-src/test-artifacts/instructions-loaded-hook-config';
delete process.env.CLAUDE_CODE_SIMPLE;

const [
  {
    executeInstructionsLoadedHooks,
    hasInstructionsLoadedHook,
  },
  { clearRegisteredHooks, registerHookCallbacks, setIsInteractive },
  { resetHooksConfigSnapshot },
] = await Promise.all([
  import('./src/utils/hooks.ts'),
  import('./src/bootstrap/state.ts'),
  import('./src/utils/hooks/hooksConfigSnapshot.ts'),
]);

setIsInteractive(false);
clearRegisteredHooks();
resetHooksConfigSnapshot();

if (hasInstructionsLoadedHook()) {
  throw new Error('InstructionsLoaded hook should not be configured before registration');
}

const filePath = 'build-src/test-artifacts/project-rules-3812.md';
const triggerFilePath = 'build-src/test-artifacts/src/app-3812.ts';
const parentFilePath = 'build-src/test-artifacts/CLAUDE.md';
let calls = 0;
registerHookCallbacks({
  InstructionsLoaded: [
    {
      matcher: 'path_glob_match',
      hooks: [
        {
          type: 'callback',
          callback: async hookInput => {
            calls += 1;
            if (hookInput.hook_event_name !== 'InstructionsLoaded') {
              throw new Error('unexpected event: ' + hookInput.hook_event_name);
            }
            if (hookInput.file_path !== filePath) {
              throw new Error('unexpected file path: ' + hookInput.file_path);
            }
            if (hookInput.memory_type !== 'Project') {
              throw new Error('unexpected memory type: ' + hookInput.memory_type);
            }
            if (hookInput.load_reason !== 'path_glob_match') {
              throw new Error('unexpected load reason: ' + hookInput.load_reason);
            }
            if (!Array.isArray(hookInput.globs) || hookInput.globs[0] !== 'src/**/*.ts') {
              throw new Error('unexpected globs: ' + JSON.stringify(hookInput.globs));
            }
            if (hookInput.trigger_file_path !== triggerFilePath) {
              throw new Error('unexpected trigger path: ' + hookInput.trigger_file_path);
            }
            if (hookInput.parent_file_path !== parentFilePath) {
              throw new Error('unexpected parent path: ' + hookInput.parent_file_path);
            }
            return { systemMessage: 'instructions loaded marker 3812' };
          },
        },
      ],
    },
  ],
});

if (!hasInstructionsLoadedHook()) {
  throw new Error('InstructionsLoaded hook should be detected after registration');
}

await executeInstructionsLoadedHooks(filePath, 'Project', 'path_glob_match', {
  globs: ['src/**/*.ts'],
  triggerFilePath,
  parentFilePath,
  timeoutMs: 10000,
});
if (calls !== 1) {
  throw new Error('InstructionsLoaded hook should run once, got ' + calls);
}

await executeInstructionsLoadedHooks(filePath, 'Project', 'session_start', {
  timeoutMs: 10000,
});
if (calls !== 1) {
  throw new Error('InstructionsLoaded matcher should skip other load reasons, got ' + calls);
}

console.log('instructions loaded hook OK');`,
  )
  assert.equal(output, 'instructions loaded hook OK')
})

await test('InstructionsLoaded command hooks receive load metadata', async () => {
  const output = await buildAndRunSnippet(
    'instructions-loaded-command-hook-test',
    `const { mkdir, readFile, rm, stat, writeFile } = await import('node:fs/promises');
const { join } = await import('node:path');

process.env.CLAUDE_CONFIG_DIR = 'build-src/test-artifacts/instructions-loaded-command-hook-config';
delete process.env.CLAUDE_CODE_SIMPLE;

const commandDir = join(process.cwd(), 'build-src', 'test-artifacts', 'instructions-loaded-command-hook-config');
await rm(commandDir, { recursive: true, force: true });
await mkdir(commandDir, { recursive: true });
const commandPath = join(commandDir, 'instructions-loaded-command-hook.mjs');
const commandPathForHook = commandPath.replace(/\\\\/g, '/');
const markerPath = join(commandDir, 'instructions-loaded-marker.json');
const markerPathForScript = markerPath.replace(/\\\\/g, '/');
const filePath = 'build-src/test-artifacts/project-rules-command-3813.md';
const triggerFilePath = 'build-src/test-artifacts/src/app-command-3813.ts';
const parentFilePath = 'build-src/test-artifacts/CLAUDE-command.md';
await writeFile(
  commandPath,
  [
    "const { writeFile } = await import('node:fs/promises');",
    "let input = '';",
    "for await (const chunk of process.stdin) input += chunk;",
    "const data = JSON.parse(input);",
    "if (data.hook_event_name !== 'InstructionsLoaded') { process.stderr.write('bad event ' + data.hook_event_name); process.exit(3); }",
    "if (data.file_path !== '" + filePath + "') { process.stderr.write('bad file path ' + data.file_path); process.exit(4); }",
    "if (data.memory_type !== 'Project') { process.stderr.write('bad memory type ' + data.memory_type); process.exit(5); }",
    "if (data.load_reason !== 'include') { process.stderr.write('bad load reason ' + data.load_reason); process.exit(6); }",
    "if (!Array.isArray(data.globs) || data.globs[0] !== 'docs/**/*.md') { process.stderr.write('bad globs ' + JSON.stringify(data.globs)); process.exit(7); }",
    "if (data.trigger_file_path !== '" + triggerFilePath + "') { process.stderr.write('bad trigger ' + data.trigger_file_path); process.exit(8); }",
    "if (data.parent_file_path !== '" + parentFilePath + "') { process.stderr.write('bad parent ' + data.parent_file_path); process.exit(9); }",
    "await writeFile('" + markerPathForScript + "', JSON.stringify({ loadReason: data.load_reason, memoryType: data.memory_type }), 'utf8');",
  ].join('\\n'),
  'utf8',
);

const [
  {
    executeInstructionsLoadedHooks,
    hasInstructionsLoadedHook,
  },
  { clearRegisteredHooks, registerHookCallbacks, setIsInteractive },
  { resetHooksConfigSnapshot },
] = await Promise.all([
  import('./src/utils/hooks.ts'),
  import('./src/bootstrap/state.ts'),
  import('./src/utils/hooks/hooksConfigSnapshot.ts'),
]);

setIsInteractive(false);
clearRegisteredHooks();
resetHooksConfigSnapshot();

registerHookCallbacks({
  InstructionsLoaded: [
    {
      matcher: 'include',
      hooks: [
        {
          type: 'command',
          command: 'node ' + commandPathForHook,
          timeout: 5,
        },
      ],
    },
  ],
});

if (!hasInstructionsLoadedHook()) {
  throw new Error('InstructionsLoaded command hook should be detected after registration');
}

await executeInstructionsLoadedHooks(filePath, 'Project', 'include', {
  globs: ['docs/**/*.md'],
  triggerFilePath,
  parentFilePath,
  timeoutMs: 10000,
});
const marker = JSON.parse(await readFile(markerPath, 'utf8'));
if (marker.loadReason !== 'include' || marker.memoryType !== 'Project') {
  throw new Error('InstructionsLoaded command marker mismatch: ' + JSON.stringify(marker));
}

await rm(markerPath, { force: true });
await executeInstructionsLoadedHooks(filePath, 'Project', 'session_start', {
  timeoutMs: 10000,
});
let skippedCreated = true;
try {
  await stat(markerPath);
} catch {
  skippedCreated = false;
}
if (skippedCreated) {
  throw new Error('InstructionsLoaded command matcher should skip session_start');
}

console.log('instructions loaded command hook OK');`,
  )
  assert.equal(output, 'instructions loaded command hook OK')
})

await test('SessionEnd hooks receive exit reason metadata', async () => {
  const output = await buildAndRunSnippet(
    'session-end-hook-test',
    `process.env.CLAUDE_CONFIG_DIR = 'build-src/test-artifacts/session-end-hook-config';
delete process.env.CLAUDE_CODE_SIMPLE;

const [
  { executeSessionEndHooks },
  { clearRegisteredHooks, registerHookCallbacks, setIsInteractive },
  { resetHooksConfigSnapshot },
] = await Promise.all([
  import('./src/utils/hooks.ts'),
  import('./src/bootstrap/state.ts'),
  import('./src/utils/hooks/hooksConfigSnapshot.ts'),
]);

setIsInteractive(false);
clearRegisteredHooks();
resetHooksConfigSnapshot();

let calls = 0;
registerHookCallbacks({
  SessionEnd: [
    {
      matcher: 'clear',
      hooks: [
        {
          type: 'callback',
          callback: async hookInput => {
            calls += 1;
            if (hookInput.hook_event_name !== 'SessionEnd') {
              throw new Error('unexpected event: ' + hookInput.hook_event_name);
            }
            if (hookInput.reason !== 'clear') {
              throw new Error('unexpected reason: ' + hookInput.reason);
            }
            return { systemMessage: 'session end marker 7264' };
          },
        },
      ],
    },
  ],
});

const appState = {
  sessionHooks: new Map(),
  toolPermissionContext: {
    mode: 'default',
    additionalWorkingDirectories: new Map(),
    alwaysAllowRules: {},
    alwaysDenyRules: {},
    alwaysAskRules: {},
    isBypassPermissionsModeAvailable: false,
  },
};
await executeSessionEndHooks('clear', {
  getAppState: () => appState,
  setAppState: updater => {
    updater(appState);
  },
  timeoutMs: 10000,
});
if (calls !== 1) {
  throw new Error('SessionEnd hook should run once, got ' + calls);
}

await executeSessionEndHooks('logout', {
  getAppState: () => appState,
  setAppState: updater => {
    updater(appState);
  },
  timeoutMs: 10000,
});
if (calls !== 1) {
  throw new Error('SessionEnd matcher should skip other reasons, got ' + calls);
}

console.log('session end hook OK');`,
  )
  assert.equal(output, 'session end hook OK')
})

await test('SessionEnd command hooks receive exit reason metadata', async () => {
  const output = await buildAndRunSnippet(
    'session-end-command-hook-test',
    `const { mkdir, readFile, rm, stat, writeFile } = await import('node:fs/promises');
const { join } = await import('node:path');

process.env.CLAUDE_CONFIG_DIR = 'build-src/test-artifacts/session-end-command-hook-config';
delete process.env.CLAUDE_CODE_SIMPLE;

const commandDir = join(process.cwd(), 'build-src', 'test-artifacts', 'session-end-command-hook-config');
await rm(commandDir, { recursive: true, force: true });
await mkdir(commandDir, { recursive: true });
const commandPath = join(commandDir, 'session-end-command-hook.mjs');
const commandPathForHook = commandPath.replace(/\\\\/g, '/');
const markerPath = join(commandDir, 'session-end-marker.json');
const markerPathForScript = markerPath.replace(/\\\\/g, '/');
await writeFile(
  commandPath,
  [
    "const { writeFile } = await import('node:fs/promises');",
    "let input = '';",
    "for await (const chunk of process.stdin) input += chunk;",
    "const data = JSON.parse(input);",
    "if (data.hook_event_name !== 'SessionEnd') { process.stderr.write('bad event ' + data.hook_event_name); process.exit(3); }",
    "if (data.reason !== 'clear') { process.stderr.write('bad reason ' + data.reason); process.exit(4); }",
    "await writeFile('" + markerPathForScript + "', JSON.stringify({ reason: data.reason }), 'utf8');",
  ].join('\\n'),
  'utf8',
);

const [
  { executeSessionEndHooks },
  { clearRegisteredHooks, registerHookCallbacks, setIsInteractive },
  { resetHooksConfigSnapshot },
] = await Promise.all([
  import('./src/utils/hooks.ts'),
  import('./src/bootstrap/state.ts'),
  import('./src/utils/hooks/hooksConfigSnapshot.ts'),
]);

setIsInteractive(false);
clearRegisteredHooks();
resetHooksConfigSnapshot();

registerHookCallbacks({
  SessionEnd: [
    {
      matcher: 'clear',
      hooks: [
        {
          type: 'command',
          command: 'node ' + commandPathForHook,
          timeout: 5,
        },
      ],
    },
  ],
});

const appState = {
  sessionHooks: new Map(),
  toolPermissionContext: {
    mode: 'default',
    additionalWorkingDirectories: new Map(),
    alwaysAllowRules: {},
    alwaysDenyRules: {},
    alwaysAskRules: {},
    isBypassPermissionsModeAvailable: false,
  },
};
await executeSessionEndHooks('clear', {
  getAppState: () => appState,
  setAppState: updater => {
    updater(appState);
  },
  timeoutMs: 10000,
});
const marker = JSON.parse(await readFile(markerPath, 'utf8'));
if (marker.reason !== 'clear') {
  throw new Error('SessionEnd command marker mismatch: ' + JSON.stringify(marker));
}

await rm(markerPath, { force: true });
await executeSessionEndHooks('logout', {
  getAppState: () => appState,
  setAppState: updater => {
    updater(appState);
  },
  timeoutMs: 10000,
});
let skippedCreated = true;
try {
  await stat(markerPath);
} catch {
  skippedCreated = false;
}
if (skippedCreated) {
  throw new Error('SessionEnd command matcher should skip logout');
}

console.log('session end command hook OK');`,
  )
  assert.equal(output, 'session end command hook OK')
})

await test('UserPromptSubmit hooks attach context and block prompts', async () => {
  const output = await buildAndRunSnippet(
    'user-prompt-submit-hook-test',
    `process.env.CLAUDE_CONFIG_DIR = 'build-src/test-artifacts/user-prompt-submit-hook-config';
delete process.env.CLAUDE_CODE_SIMPLE;

const [
  { executeUserPromptSubmitHooks },
  { clearRegisteredHooks, registerHookCallbacks, setIsInteractive },
  { resetHooksConfigSnapshot },
] = await Promise.all([
  import('./src/utils/hooks.ts'),
  import('./src/bootstrap/state.ts'),
  import('./src/utils/hooks/hooksConfigSnapshot.ts'),
]);

setIsInteractive(false);
clearRegisteredHooks();
resetHooksConfigSnapshot();

let appState = {
  sessionHooks: new Map(),
  toolPermissionContext: {
    mode: 'default',
    additionalWorkingDirectories: new Map(),
    alwaysAllowRules: {},
    alwaysDenyRules: {},
    alwaysAskRules: {},
    isBypassPermissionsModeAvailable: false,
  },
};
const context = {
  abortController: new AbortController(),
  options: { isNonInteractiveSession: true },
  getAppState() {
    return appState;
  },
  setAppState(updater) {
    appState = updater(appState);
  },
  updateAttributionState() {},
};

const beforeRegistration = [];
for await (const result of executeUserPromptSubmitHooks(
  'prompt before registration',
  'default',
  context,
)) {
  beforeRegistration.push(result);
}
if (beforeRegistration.length !== 0) {
  throw new Error('UserPromptSubmit should not run before hooks are registered: ' + JSON.stringify(beforeRegistration));
}

const prompt = 'user prompt submit marker 9137';
const additionalContext = 'user prompt submit context marker 9137';
let contextCalls = 0;
registerHookCallbacks({
  UserPromptSubmit: [
    {
      hooks: [
        {
          type: 'callback',
          callback: async (hookInput, toolUseID, signal, hookIndex, callbackContext) => {
            contextCalls += 1;
            if (hookInput.hook_event_name !== 'UserPromptSubmit') {
              throw new Error('unexpected hook event: ' + hookInput.hook_event_name);
            }
            if (hookInput.prompt !== prompt) {
              throw new Error('unexpected prompt: ' + hookInput.prompt);
            }
            if (hookInput.permission_mode !== 'default') {
              throw new Error('unexpected permission mode: ' + hookInput.permission_mode);
            }
            if (typeof toolUseID !== 'string' || toolUseID.length === 0) {
              throw new Error('unexpected hook tool use id: ' + toolUseID);
            }
            if (signal.aborted) {
              throw new Error('UserPromptSubmit callback received aborted signal');
            }
            if (hookIndex !== 0) {
              throw new Error('unexpected hook index: ' + hookIndex);
            }
            if (!callbackContext || callbackContext.getAppState() !== appState) {
              throw new Error('callback context should expose current app state');
            }
            return {
              hookSpecificOutput: {
                hookEventName: 'UserPromptSubmit',
                additionalContext,
              },
            };
          },
        },
      ],
    },
  ],
});

const contextResults = [];
for await (const result of executeUserPromptSubmitHooks(
  prompt,
  'default',
  context,
)) {
  contextResults.push(result);
}
if (contextCalls !== 1) {
  throw new Error('UserPromptSubmit context hook should run once, got ' + contextCalls);
}
if (!contextResults.some(result => result.message?.type === 'progress')) {
  throw new Error('UserPromptSubmit should yield hook progress: ' + JSON.stringify(contextResults));
}
const additional = contextResults.find(result =>
  Array.isArray(result.additionalContexts) &&
  result.additionalContexts.includes(additionalContext)
);
if (!additional) {
  throw new Error('missing UserPromptSubmit additional context: ' + JSON.stringify(contextResults));
}
const success = contextResults.find(result => {
  const attachment = result.message?.attachment;
  return (
    attachment?.type === 'hook_success' &&
    attachment.hookEvent === 'UserPromptSubmit' &&
    attachment.hookName === 'UserPromptSubmit:Callback'
  );
});
if (!success) {
  throw new Error('missing UserPromptSubmit success attachment: ' + JSON.stringify(contextResults));
}

clearRegisteredHooks();
let blockCalls = 0;
const blockReason = 'blocked prompt submit marker 9137';
registerHookCallbacks({
  UserPromptSubmit: [
    {
      hooks: [
        {
          type: 'callback',
          callback: async hookInput => {
            blockCalls += 1;
            if (hookInput.prompt !== prompt) {
              throw new Error('block hook saw unexpected prompt: ' + hookInput.prompt);
            }
            return {
              decision: 'block',
              reason: blockReason,
              hookSpecificOutput: {
                hookEventName: 'UserPromptSubmit',
              },
            };
          },
        },
      ],
    },
  ],
});

const blockedResults = [];
for await (const result of executeUserPromptSubmitHooks(
  prompt,
  'default',
  context,
)) {
  blockedResults.push(result);
}
if (blockCalls !== 1) {
  throw new Error('UserPromptSubmit block hook should run once, got ' + blockCalls);
}
const blocking = blockedResults.find(result =>
  result.blockingError?.blockingError === blockReason &&
  result.blockingError?.command === 'callback'
);
if (!blocking) {
  throw new Error('missing UserPromptSubmit blocking result: ' + JSON.stringify(blockedResults));
}
const blockingAttachment = blockedResults.find(result => {
  const attachment = result.message?.attachment;
  return (
    attachment?.type === 'hook_blocking_error' &&
    attachment.hookEvent === 'UserPromptSubmit' &&
    attachment.blockingError?.blockingError === blockReason
  );
});
if (!blockingAttachment) {
  throw new Error('missing UserPromptSubmit blocking attachment: ' + JSON.stringify(blockedResults));
}

console.log('user prompt submit hook OK');`,
  )
  assert.equal(output, 'user prompt submit hook OK')
})

await test('UserPromptSubmit command hooks attach context and block prompts', async () => {
  const output = await buildAndRunSnippet(
    'user-prompt-submit-command-hook-test',
    `const { mkdir, rm, writeFile } = await import('node:fs/promises');
const { join } = await import('node:path');

process.env.CLAUDE_CONFIG_DIR = 'build-src/test-artifacts/user-prompt-submit-command-hook-config';
delete process.env.CLAUDE_CODE_SIMPLE;

const commandDir = join(process.cwd(), 'build-src', 'test-artifacts', 'user-prompt-submit-command-hook-config');
await rm(commandDir, { recursive: true, force: true });
await mkdir(commandDir, { recursive: true });
const commandPath = join(commandDir, 'user-prompt-submit-command-hook.mjs');
const commandPathForHook = commandPath.replace(/\\\\/g, '/');
const contextPrompt = 'user prompt submit command context marker 9138';
const blockPrompt = 'user prompt submit command block marker 9138';
const additionalContext = 'user prompt submit command extra context marker 9138';
const blockReason = 'blocked prompt submit command marker 9138';
await writeFile(
  commandPath,
  [
    "let input = '';",
    "for await (const chunk of process.stdin) input += chunk;",
    "const data = JSON.parse(input);",
    "if (data.hook_event_name !== 'UserPromptSubmit') { process.stderr.write('bad event ' + data.hook_event_name); process.exit(3); }",
    "if (data.permission_mode !== 'default') { process.stderr.write('bad permission mode ' + data.permission_mode); process.exit(4); }",
    "if (data.prompt === '" + contextPrompt + "') {",
    "  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: '" + additionalContext + "' } }));",
    "  process.exit(0);",
    "}",
    "if (data.prompt === '" + blockPrompt + "') {",
    "  process.stdout.write(JSON.stringify({ decision: 'block', reason: '" + blockReason + "', hookSpecificOutput: { hookEventName: 'UserPromptSubmit' } }));",
    "  process.exit(0);",
    "}",
    "process.stderr.write('bad prompt ' + data.prompt);",
    "process.exit(5);",
  ].join('\\n'),
  'utf8',
);

const [
  { executeUserPromptSubmitHooks },
  { clearRegisteredHooks, registerHookCallbacks, setIsInteractive },
  { resetHooksConfigSnapshot },
] = await Promise.all([
  import('./src/utils/hooks.ts'),
  import('./src/bootstrap/state.ts'),
  import('./src/utils/hooks/hooksConfigSnapshot.ts'),
]);

setIsInteractive(false);
clearRegisteredHooks();
resetHooksConfigSnapshot();

let appState = {
  sessionHooks: new Map(),
  toolPermissionContext: {
    mode: 'default',
    additionalWorkingDirectories: new Map(),
    alwaysAllowRules: {},
    alwaysDenyRules: {},
    alwaysAskRules: {},
    isBypassPermissionsModeAvailable: false,
  },
};
const context = {
  abortController: new AbortController(),
  options: { isNonInteractiveSession: true },
  getAppState() {
    return appState;
  },
  setAppState(updater) {
    appState = updater(appState);
  },
  updateAttributionState() {},
};

registerHookCallbacks({
  UserPromptSubmit: [
    {
      hooks: [
        {
          type: 'command',
          command: 'node ' + commandPathForHook,
          timeout: 5,
        },
      ],
    },
  ],
});

const contextResults = [];
for await (const result of executeUserPromptSubmitHooks(
  contextPrompt,
  'default',
  context,
)) {
  contextResults.push(result);
}
if (!contextResults.some(result =>
  Array.isArray(result.additionalContexts) &&
  result.additionalContexts.includes(additionalContext)
)) {
  throw new Error('UserPromptSubmit command should return additional context: ' + JSON.stringify(contextResults));
}

const blockedResults = [];
for await (const result of executeUserPromptSubmitHooks(
  blockPrompt,
  'default',
  context,
)) {
  blockedResults.push(result);
}
const blocking = blockedResults.find(result =>
  result.blockingError?.blockingError === blockReason &&
  String(result.blockingError?.command).includes('user-prompt-submit-command-hook.mjs')
);
if (!blocking) {
  throw new Error('UserPromptSubmit command should return blocking feedback: ' + JSON.stringify(blockedResults));
}
const blockingAttachment = blockedResults.find(result => {
  const attachment = result.message?.attachment;
  return (
    attachment?.type === 'hook_blocking_error' &&
    attachment.hookEvent === 'UserPromptSubmit' &&
    attachment.blockingError?.blockingError === blockReason
  );
});
if (!blockingAttachment) {
  throw new Error('UserPromptSubmit command should return blocking attachment: ' + JSON.stringify(blockedResults));
}

console.log('user prompt submit command hook OK');`,
  )
  assert.equal(output, 'user prompt submit command hook OK')
})

await test('compact hooks rewrite instructions and report summaries', async () => {
  const output = await buildAndRunSnippet(
    'compact-hook-test',
    `process.env.CLAUDE_CONFIG_DIR = 'build-src/test-artifacts/compact-hook-config';
delete process.env.CLAUDE_CODE_SIMPLE;

const [
  { executePreCompactHooks, executePostCompactHooks },
  { clearRegisteredHooks, registerHookCallbacks, setIsInteractive },
  { resetHooksConfigSnapshot },
] = await Promise.all([
  import('./src/utils/hooks.ts'),
  import('./src/bootstrap/state.ts'),
  import('./src/utils/hooks/hooksConfigSnapshot.ts'),
]);

setIsInteractive(false);
clearRegisteredHooks();
resetHooksConfigSnapshot();

const emptyPre = await executePreCompactHooks({
  trigger: 'manual',
  customInstructions: 'unused empty compact instructions',
});
if (Object.keys(emptyPre).length !== 0) {
  throw new Error('PreCompact should be empty before registration: ' + JSON.stringify(emptyPre));
}

const customInstructions = 'existing compact instructions marker 3486';
const rewrittenInstructions = 'rewritten compact instructions marker 3486';
const compactSummary = 'compact summary marker 3486';
const postMessage = 'post compact user message marker 3486';
let preCalls = 0;
let postCalls = 0;
registerHookCallbacks({
  PreCompact: [
    {
      matcher: 'manual',
      hooks: [
        {
          type: 'callback',
          callback: async hookInput => {
            preCalls += 1;
            if (hookInput.hook_event_name !== 'PreCompact') {
              throw new Error('unexpected pre event: ' + hookInput.hook_event_name);
            }
            if (hookInput.trigger !== 'manual') {
              throw new Error('unexpected pre trigger: ' + hookInput.trigger);
            }
            if (hookInput.custom_instructions !== customInstructions) {
              throw new Error('unexpected custom instructions: ' + hookInput.custom_instructions);
            }
            return { systemMessage: rewrittenInstructions };
          },
        },
      ],
    },
  ],
  PostCompact: [
    {
      matcher: 'manual',
      hooks: [
        {
          type: 'callback',
          callback: async hookInput => {
            postCalls += 1;
            if (hookInput.hook_event_name !== 'PostCompact') {
              throw new Error('unexpected post event: ' + hookInput.hook_event_name);
            }
            if (hookInput.trigger !== 'manual') {
              throw new Error('unexpected post trigger: ' + hookInput.trigger);
            }
            if (hookInput.compact_summary !== compactSummary) {
              throw new Error('unexpected compact summary: ' + hookInput.compact_summary);
            }
            return { systemMessage: postMessage };
          },
        },
      ],
    },
  ],
});

const preResult = await executePreCompactHooks({
  trigger: 'manual',
  customInstructions,
});
if (preCalls !== 1) {
  throw new Error('PreCompact hook should run once, got ' + preCalls);
}
if (preResult.newCustomInstructions !== rewrittenInstructions) {
  throw new Error('PreCompact should return rewritten instructions: ' + JSON.stringify(preResult));
}
if (!String(preResult.userDisplayMessage).includes('PreCompact [callback] completed successfully: ' + rewrittenInstructions)) {
  throw new Error('PreCompact should report callback output: ' + JSON.stringify(preResult));
}

const skippedPre = await executePreCompactHooks({
  trigger: 'auto',
  customInstructions,
});
if (preCalls !== 1) {
  throw new Error('PreCompact manual matcher should skip auto trigger, got ' + preCalls);
}
if (Object.keys(skippedPre).length !== 0) {
  throw new Error('skipped PreCompact should be empty: ' + JSON.stringify(skippedPre));
}

const postResult = await executePostCompactHooks({
  trigger: 'manual',
  compactSummary,
});
if (postCalls !== 1) {
  throw new Error('PostCompact hook should run once, got ' + postCalls);
}
if (!String(postResult.userDisplayMessage).includes('PostCompact [callback] completed successfully: ' + postMessage)) {
  throw new Error('PostCompact should report callback output: ' + JSON.stringify(postResult));
}

const skippedPost = await executePostCompactHooks({
  trigger: 'auto',
  compactSummary,
});
if (postCalls !== 1) {
  throw new Error('PostCompact manual matcher should skip auto trigger, got ' + postCalls);
}
if (Object.keys(skippedPost).length !== 0) {
  throw new Error('skipped PostCompact should be empty: ' + JSON.stringify(skippedPost));
}

console.log('compact hooks OK');`,
  )
  assert.equal(output, 'compact hooks OK')
})

await test('compact command hooks rewrite instructions and report summaries', async () => {
  const output = await buildAndRunSnippet(
    'compact-command-hook-test',
    `const { mkdir, rm, writeFile } = await import('node:fs/promises');
const { join } = await import('node:path');

process.env.CLAUDE_CONFIG_DIR = 'build-src/test-artifacts/compact-command-hook-config';
delete process.env.CLAUDE_CODE_SIMPLE;

const commandDir = join(process.cwd(), 'build-src', 'test-artifacts', 'compact-command-hook-config');
await rm(commandDir, { recursive: true, force: true });
await mkdir(commandDir, { recursive: true });
const commandPath = join(commandDir, 'compact-command-hook.mjs');
const commandPathForHook = commandPath.replace(/\\\\/g, '/');
const customInstructions = 'existing compact command instructions marker 3487';
const rewrittenInstructions = 'rewritten compact command instructions marker 3487';
const compactSummary = 'compact command summary marker 3487';
const postMessage = 'post compact command user message marker 3487';
await writeFile(
  commandPath,
  [
    "let input = '';",
    "for await (const chunk of process.stdin) input += chunk;",
    "const data = JSON.parse(input);",
    "if (data.hook_event_name === 'PreCompact') {",
    "  if (data.trigger !== 'manual') { process.stderr.write('bad pre trigger ' + data.trigger); process.exit(3); }",
    "  if (data.custom_instructions !== '" + customInstructions + "') { process.stderr.write('bad custom instructions ' + data.custom_instructions); process.exit(4); }",
    "  process.stdout.write('" + rewrittenInstructions + "');",
    "  process.exit(0);",
    "}",
    "if (data.hook_event_name === 'PostCompact') {",
    "  if (data.trigger !== 'manual') { process.stderr.write('bad post trigger ' + data.trigger); process.exit(5); }",
    "  if (data.compact_summary !== '" + compactSummary + "') { process.stderr.write('bad compact summary ' + data.compact_summary); process.exit(6); }",
    "  process.stdout.write('" + postMessage + "');",
    "  process.exit(0);",
    "}",
    "process.stderr.write('bad event ' + data.hook_event_name);",
    "process.exit(7);",
  ].join('\\n'),
  'utf8',
);

const [
  { executePreCompactHooks, executePostCompactHooks },
  { clearRegisteredHooks, registerHookCallbacks, setIsInteractive },
  { resetHooksConfigSnapshot },
] = await Promise.all([
  import('./src/utils/hooks.ts'),
  import('./src/bootstrap/state.ts'),
  import('./src/utils/hooks/hooksConfigSnapshot.ts'),
]);

setIsInteractive(false);
clearRegisteredHooks();
resetHooksConfigSnapshot();

registerHookCallbacks({
  PreCompact: [
    {
      matcher: 'manual',
      hooks: [
        {
          type: 'command',
          command: 'node ' + commandPathForHook,
          timeout: 5,
        },
      ],
    },
  ],
  PostCompact: [
    {
      matcher: 'manual',
      hooks: [
        {
          type: 'command',
          command: 'node ' + commandPathForHook,
          timeout: 5,
        },
      ],
    },
  ],
});

const preResult = await executePreCompactHooks({
  trigger: 'manual',
  customInstructions,
});
if (preResult.newCustomInstructions !== rewrittenInstructions) {
  throw new Error('PreCompact command should return rewritten instructions: ' + JSON.stringify(preResult));
}
if (!String(preResult.userDisplayMessage).includes('PreCompact [node ')) {
  throw new Error('PreCompact command should report command name: ' + JSON.stringify(preResult));
}
if (!String(preResult.userDisplayMessage).includes(rewrittenInstructions)) {
  throw new Error('PreCompact command should report output: ' + JSON.stringify(preResult));
}

const skippedPre = await executePreCompactHooks({
  trigger: 'auto',
  customInstructions,
});
if (Object.keys(skippedPre).length !== 0) {
  throw new Error('PreCompact command matcher should skip auto trigger: ' + JSON.stringify(skippedPre));
}

const postResult = await executePostCompactHooks({
  trigger: 'manual',
  compactSummary,
});
if (!String(postResult.userDisplayMessage).includes('PostCompact [node ')) {
  throw new Error('PostCompact command should report command name: ' + JSON.stringify(postResult));
}
if (!String(postResult.userDisplayMessage).includes(postMessage)) {
  throw new Error('PostCompact command should report output: ' + JSON.stringify(postResult));
}

const skippedPost = await executePostCompactHooks({
  trigger: 'auto',
  compactSummary,
});
if (Object.keys(skippedPost).length !== 0) {
  throw new Error('PostCompact command matcher should skip auto trigger: ' + JSON.stringify(skippedPost));
}

console.log('compact command hooks OK');`,
  )
  assert.equal(output, 'compact command hooks OK')
})

await test('subagent lifecycle hooks attach context and block stop', async () => {
  const output = await buildAndRunSnippet(
    'subagent-lifecycle-hook-test',
    `process.env.CLAUDE_CONFIG_DIR = 'build-src/test-artifacts/subagent-lifecycle-hook-config';
delete process.env.CLAUDE_CODE_SIMPLE;

const [
  { executeSubagentStartHooks, executeStopHooks },
  { clearRegisteredHooks, registerHookCallbacks, setIsInteractive },
  { resetHooksConfigSnapshot },
] = await Promise.all([
  import('./src/utils/hooks.ts'),
  import('./src/bootstrap/state.ts'),
  import('./src/utils/hooks/hooksConfigSnapshot.ts'),
]);

setIsInteractive(false);
clearRegisteredHooks();
resetHooksConfigSnapshot();

const agentId = 'agent-lifecycle-7135';
const agentType = 'reviewer-lifecycle-7135';
const startContext = 'subagent start context marker 7135';
const lastAssistantText = 'subagent final assistant marker 7135';
const blockReason = 'subagent stop block marker 7135';
let startCalls = 0;
let stopCalls = 0;
registerHookCallbacks({
  SubagentStart: [
    {
      matcher: agentType,
      hooks: [
        {
          type: 'callback',
          callback: async hookInput => {
            startCalls += 1;
            if (hookInput.hook_event_name !== 'SubagentStart') {
              throw new Error('unexpected start event: ' + hookInput.hook_event_name);
            }
            if (hookInput.agent_id !== agentId) {
              throw new Error('unexpected start agent id: ' + hookInput.agent_id);
            }
            if (hookInput.agent_type !== agentType) {
              throw new Error('unexpected start agent type: ' + hookInput.agent_type);
            }
            return {
              hookSpecificOutput: {
                hookEventName: 'SubagentStart',
                additionalContext: startContext,
              },
            };
          },
        },
      ],
    },
  ],
  SubagentStop: [
    {
      matcher: agentType,
      hooks: [
        {
          type: 'callback',
          callback: async hookInput => {
            stopCalls += 1;
            if (hookInput.hook_event_name !== 'SubagentStop') {
              throw new Error('unexpected stop event: ' + hookInput.hook_event_name);
            }
            if (hookInput.agent_id !== agentId) {
              throw new Error('unexpected stop agent id: ' + hookInput.agent_id);
            }
            if (hookInput.agent_type !== agentType) {
              throw new Error('unexpected stop agent type: ' + hookInput.agent_type);
            }
            if (!String(hookInput.agent_transcript_path).endsWith('agent-' + agentId + '.jsonl')) {
              throw new Error('unexpected transcript path: ' + hookInput.agent_transcript_path);
            }
            if (hookInput.stop_hook_active !== true) {
              throw new Error('unexpected stop hook active flag: ' + hookInput.stop_hook_active);
            }
            if (hookInput.last_assistant_message !== lastAssistantText) {
              throw new Error('unexpected last assistant text: ' + hookInput.last_assistant_message);
            }
            return {
              decision: 'block',
              reason: blockReason,
            };
          },
        },
      ],
    },
  ],
});

const startResults = [];
for await (const result of executeSubagentStartHooks(
  agentId,
  agentType,
  undefined,
  10000,
)) {
  startResults.push(result);
}
if (startCalls !== 1) {
  throw new Error('SubagentStart hook should run once, got ' + startCalls);
}
if (!startResults.some(result =>
  Array.isArray(result.additionalContexts) &&
  result.additionalContexts.includes(startContext)
)) {
  throw new Error('SubagentStart should return additional context: ' + JSON.stringify(startResults));
}

const skippedStart = [];
for await (const result of executeSubagentStartHooks(
  agentId,
  'other-agent-type-7135',
  undefined,
  10000,
)) {
  skippedStart.push(result);
}
if (startCalls !== 1) {
  throw new Error('SubagentStart matcher should skip other agent type, got ' + startCalls);
}
if (skippedStart.length !== 0) {
  throw new Error('skipped SubagentStart should produce no results: ' + JSON.stringify(skippedStart));
}

let appState = {
  sessionHooks: new Map(),
  toolPermissionContext: {
    mode: 'default',
    additionalWorkingDirectories: new Map(),
    alwaysAllowRules: {},
    alwaysDenyRules: {},
    alwaysAskRules: {},
    isBypassPermissionsModeAvailable: false,
  },
};
const context = {
  abortController: new AbortController(),
  agentId,
  agentType,
  options: { isNonInteractiveSession: true },
  messages: [],
  getAppState() {
    return appState;
  },
  setAppState(updater) {
    appState = updater(appState);
  },
  updateAttributionState() {},
};
const messages = [
  {
    type: 'assistant',
    uuid: '00000000-0000-0000-0000-000000007135',
    timestamp: '2026-06-19T00:00:00.000Z',
    message: {
      id: 'msg_subagent_lifecycle_7135',
      role: 'assistant',
      content: [{ type: 'text', text: lastAssistantText }],
    },
  },
];
const stopResults = [];
for await (const result of executeStopHooks(
  'default',
  context.abortController.signal,
  10000,
  true,
  agentId,
  context,
  messages,
  agentType,
)) {
  stopResults.push(result);
}
if (stopCalls !== 1) {
  throw new Error('SubagentStop hook should run once, got ' + stopCalls);
}
const blocking = stopResults.find(result =>
  result.blockingError?.blockingError === blockReason &&
  result.blockingError?.command === 'callback'
);
if (!blocking) {
  throw new Error('SubagentStop should return blocking feedback: ' + JSON.stringify(stopResults));
}
const blockingAttachment = stopResults.find(result => {
  const attachment = result.message?.attachment;
  return (
    attachment?.type === 'hook_blocking_error' &&
    attachment.hookEvent === 'SubagentStop' &&
    attachment.blockingError?.blockingError === blockReason
  );
});
if (!blockingAttachment) {
  throw new Error('SubagentStop should return blocking attachment: ' + JSON.stringify(stopResults));
}

console.log('subagent lifecycle hooks OK');`,
  )
  assert.equal(output, 'subagent lifecycle hooks OK')
})

await test('SubagentStart command hooks attach context with agent metadata', async () => {
  const output = await buildAndRunSnippet(
    'subagent-start-command-hook-test',
    `const { mkdir, rm, writeFile } = await import('node:fs/promises');
const { join } = await import('node:path');

process.env.CLAUDE_CONFIG_DIR = 'build-src/test-artifacts/subagent-start-command-hook-config';
delete process.env.CLAUDE_CODE_SIMPLE;

const commandDir = join(process.cwd(), 'build-src', 'test-artifacts', 'subagent-start-command-hook-config');
await rm(commandDir, { recursive: true, force: true });
await mkdir(commandDir, { recursive: true });
const commandPath = join(commandDir, 'subagent-start-command-hook.mjs');
const commandPathForHook = commandPath.replace(/\\\\/g, '/');
const agentId = 'agent-start-command-7143';
const agentType = 'reviewer-start-command-7143';
const additionalContext = 'subagent start command context marker 7143';
await writeFile(
  commandPath,
  [
    "let input = '';",
    "for await (const chunk of process.stdin) input += chunk;",
    "const data = JSON.parse(input);",
    "if (data.hook_event_name !== 'SubagentStart') { process.stderr.write('bad event ' + data.hook_event_name); process.exit(3); }",
    "if (data.agent_id !== '" + agentId + "') { process.stderr.write('bad agent id ' + data.agent_id); process.exit(4); }",
    "if (data.agent_type !== '" + agentType + "') { process.stderr.write('bad agent type ' + data.agent_type); process.exit(5); }",
    "process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SubagentStart', additionalContext: '" + additionalContext + "' } }));",
  ].join('\\n'),
  'utf8',
);

const [
  { executeSubagentStartHooks },
  { clearRegisteredHooks, registerHookCallbacks, setIsInteractive },
  { resetHooksConfigSnapshot },
] = await Promise.all([
  import('./src/utils/hooks.ts'),
  import('./src/bootstrap/state.ts'),
  import('./src/utils/hooks/hooksConfigSnapshot.ts'),
]);

setIsInteractive(false);
clearRegisteredHooks();
resetHooksConfigSnapshot();

registerHookCallbacks({
  SubagentStart: [
    {
      matcher: agentType,
      hooks: [
        {
          type: 'command',
          command: 'node ' + commandPathForHook,
          timeout: 5,
        },
      ],
    },
  ],
});

const startResults = [];
for await (const result of executeSubagentStartHooks(
  agentId,
  agentType,
  undefined,
  10000,
)) {
  startResults.push(result);
}
if (!startResults.some(result =>
  Array.isArray(result.additionalContexts) &&
  result.additionalContexts.includes(additionalContext)
)) {
  throw new Error('SubagentStart command hook should return additional context: ' + JSON.stringify(startResults));
}

const skippedStart = [];
for await (const result of executeSubagentStartHooks(
  agentId,
  'other-agent-type-command-7143',
  undefined,
  10000,
)) {
  skippedStart.push(result);
}
if (skippedStart.length !== 0) {
  throw new Error('SubagentStart command matcher should skip other agent type: ' + JSON.stringify(skippedStart));
}

console.log('subagent start command hook OK');`,
  )
  assert.equal(output, 'subagent start command hook OK')
})

await test('SubagentStop command hooks block with agent metadata', async () => {
  const output = await buildAndRunSnippet(
    'subagent-stop-command-hook-test',
    `const { mkdir, rm, writeFile } = await import('node:fs/promises');
const { join } = await import('node:path');

process.env.CLAUDE_CONFIG_DIR = 'build-src/test-artifacts/subagent-stop-command-hook-config';
delete process.env.CLAUDE_CODE_SIMPLE;

const commandDir = join(process.cwd(), 'build-src', 'test-artifacts', 'subagent-stop-command-hook-config');
await rm(commandDir, { recursive: true, force: true });
await mkdir(commandDir, { recursive: true });
const commandPath = join(commandDir, 'subagent-stop-command-hook.mjs');
const commandPathForHook = commandPath.replace(/\\\\/g, '/');
const agentId = 'agent-command-7142';
const agentType = 'reviewer-command-7142';
const lastAssistantText = 'subagent command final assistant marker 7142';
const blockReason = 'subagent command stop block marker 7142';
await writeFile(
  commandPath,
  [
    "let input = '';",
    "for await (const chunk of process.stdin) input += chunk;",
    "const data = JSON.parse(input);",
    "if (data.hook_event_name !== 'SubagentStop') { process.stderr.write('bad event ' + data.hook_event_name); process.exit(3); }",
    "if (data.agent_id !== '" + agentId + "') { process.stderr.write('bad agent id ' + data.agent_id); process.exit(4); }",
    "if (data.agent_type !== '" + agentType + "') { process.stderr.write('bad agent type ' + data.agent_type); process.exit(5); }",
    "if (!String(data.agent_transcript_path).endsWith('agent-" + agentId + ".jsonl')) { process.stderr.write('bad transcript ' + data.agent_transcript_path); process.exit(6); }",
    "if (data.stop_hook_active !== true) { process.stderr.write('bad active flag'); process.exit(7); }",
    "if (data.last_assistant_message !== '" + lastAssistantText + "') { process.stderr.write('bad assistant text'); process.exit(8); }",
    "process.stdout.write(JSON.stringify({ decision: 'block', reason: '" + blockReason + "' }));",
  ].join('\\n'),
  'utf8',
);

const [
  { executeStopHooks },
  { clearRegisteredHooks, registerHookCallbacks, setIsInteractive },
  { resetHooksConfigSnapshot },
] = await Promise.all([
  import('./src/utils/hooks.ts'),
  import('./src/bootstrap/state.ts'),
  import('./src/utils/hooks/hooksConfigSnapshot.ts'),
]);

setIsInteractive(false);
clearRegisteredHooks();
resetHooksConfigSnapshot();

registerHookCallbacks({
  SubagentStop: [
    {
      matcher: agentType,
      hooks: [
        {
          type: 'command',
          command: 'node ' + commandPathForHook,
          timeout: 5,
        },
      ],
    },
  ],
});

let appState = {
  sessionHooks: new Map(),
  toolPermissionContext: {
    mode: 'default',
    additionalWorkingDirectories: new Map(),
    alwaysAllowRules: {},
    alwaysDenyRules: {},
    alwaysAskRules: {},
    isBypassPermissionsModeAvailable: false,
  },
};
const context = {
  abortController: new AbortController(),
  agentId,
  agentType,
  options: { isNonInteractiveSession: true },
  messages: [],
  getAppState() {
    return appState;
  },
  setAppState(updater) {
    appState = updater(appState);
  },
  updateAttributionState() {},
};
const messages = [
  {
    type: 'assistant',
    uuid: '00000000-0000-0000-0000-000000007142',
    timestamp: '2026-06-19T00:00:00.000Z',
    message: {
      id: 'msg_subagent_stop_command_7142',
      role: 'assistant',
      content: [{ type: 'text', text: lastAssistantText }],
    },
  },
];

const stopResults = [];
for await (const result of executeStopHooks(
  'default',
  context.abortController.signal,
  10000,
  true,
  agentId,
  context,
  messages,
  agentType,
)) {
  stopResults.push(result);
}

const blocking = stopResults.find(result =>
  result.blockingError?.blockingError === blockReason &&
  String(result.blockingError?.command).includes('subagent-stop-command-hook.mjs')
);
if (!blocking) {
  throw new Error('SubagentStop command hook should return blocking feedback: ' + JSON.stringify(stopResults));
}
const blockingAttachment = stopResults.find(result => {
  const attachment = result.message?.attachment;
  return (
    attachment?.type === 'hook_blocking_error' &&
    attachment.hookEvent === 'SubagentStop' &&
    attachment.blockingError?.blockingError === blockReason
  );
});
if (!blockingAttachment) {
  throw new Error('SubagentStop command hook should return blocking attachment: ' + JSON.stringify(stopResults));
}

console.log('subagent stop command hook OK');`,
  )
  assert.equal(output, 'subagent stop command hook OK')
})

await test('teammate task lifecycle hooks block with metadata', async () => {
  const output = await buildAndRunSnippet(
    'teammate-task-lifecycle-hook-test',
    `process.env.CLAUDE_CONFIG_DIR = 'build-src/test-artifacts/teammate-task-lifecycle-hook-config';
delete process.env.CLAUDE_CODE_SIMPLE;

const [
  {
    executeTeammateIdleHooks,
    executeTaskCreatedHooks,
    executeTaskCompletedHooks,
    getTeammateIdleHookMessage,
    getTaskCreatedHookMessage,
    getTaskCompletedHookMessage,
  },
  { clearRegisteredHooks, registerHookCallbacks, setIsInteractive },
  { resetHooksConfigSnapshot },
] = await Promise.all([
  import('./src/utils/hooks.ts'),
  import('./src/bootstrap/state.ts'),
  import('./src/utils/hooks/hooksConfigSnapshot.ts'),
]);

setIsInteractive(false);
clearRegisteredHooks();
resetHooksConfigSnapshot();

const teammateName = 'researcher-8294';
const teamName = 'analysis-team-8294';
const taskId = 'task-8294';
const taskSubject = 'Review lifecycle hooks 8294';
const taskDescription = 'Task lifecycle hook metadata marker 8294';
const idleReason = 'teammate idle block marker 8294';
const createReason = 'task created block marker 8294';
const completeReason = 'task completed block marker 8294';
let idleCalls = 0;
let createCalls = 0;
let completeCalls = 0;
registerHookCallbacks({
  TeammateIdle: [
    {
      hooks: [
        {
          type: 'callback',
          callback: async hookInput => {
            idleCalls += 1;
            if (hookInput.hook_event_name !== 'TeammateIdle') {
              throw new Error('unexpected idle event: ' + hookInput.hook_event_name);
            }
            if (hookInput.teammate_name !== teammateName || hookInput.team_name !== teamName) {
              throw new Error('unexpected idle teammate metadata: ' + JSON.stringify(hookInput));
            }
            if (hookInput.permission_mode !== 'default') {
              throw new Error('unexpected idle permission mode: ' + hookInput.permission_mode);
            }
            return { decision: 'block', reason: idleReason };
          },
        },
      ],
    },
  ],
  TaskCreated: [
    {
      hooks: [
        {
          type: 'callback',
          callback: async hookInput => {
            createCalls += 1;
            if (hookInput.hook_event_name !== 'TaskCreated') {
              throw new Error('unexpected create event: ' + hookInput.hook_event_name);
            }
            if (hookInput.task_id !== taskId || hookInput.task_subject !== taskSubject) {
              throw new Error('unexpected created task metadata: ' + JSON.stringify(hookInput));
            }
            if (hookInput.task_description !== taskDescription) {
              throw new Error('unexpected created task description: ' + hookInput.task_description);
            }
            if (hookInput.teammate_name !== teammateName || hookInput.team_name !== teamName) {
              throw new Error('unexpected created teammate metadata: ' + JSON.stringify(hookInput));
            }
            return { decision: 'block', reason: createReason };
          },
        },
      ],
    },
  ],
  TaskCompleted: [
    {
      hooks: [
        {
          type: 'callback',
          callback: async hookInput => {
            completeCalls += 1;
            if (hookInput.hook_event_name !== 'TaskCompleted') {
              throw new Error('unexpected complete event: ' + hookInput.hook_event_name);
            }
            if (hookInput.task_id !== taskId || hookInput.task_subject !== taskSubject) {
              throw new Error('unexpected completed task metadata: ' + JSON.stringify(hookInput));
            }
            if (hookInput.task_description !== taskDescription) {
              throw new Error('unexpected completed task description: ' + hookInput.task_description);
            }
            if (hookInput.teammate_name !== teammateName || hookInput.team_name !== teamName) {
              throw new Error('unexpected completed teammate metadata: ' + JSON.stringify(hookInput));
            }
            return { decision: 'block', reason: completeReason };
          },
        },
      ],
    },
  ],
});

let appState = {
  sessionHooks: new Map(),
  toolPermissionContext: {
    mode: 'default',
    additionalWorkingDirectories: new Map(),
    alwaysAllowRules: {},
    alwaysDenyRules: {},
    alwaysAskRules: {},
    isBypassPermissionsModeAvailable: false,
  },
};
const context = {
  abortController: new AbortController(),
  options: { isNonInteractiveSession: true },
  messages: [],
  getAppState() {
    return appState;
  },
  setAppState(updater) {
    appState = updater(appState);
  },
  updateAttributionState() {},
};

async function collect(generator) {
  const results = [];
  for await (const result of generator) {
    results.push(result);
  }
  return results;
}
function assertBlocked(results, eventName, reason) {
  const blocking = results.find(result =>
    result.blockingError?.blockingError === reason &&
    result.blockingError?.command === 'callback'
  );
  if (!blocking) {
    throw new Error(eventName + ' should return blocking feedback: ' + JSON.stringify(results));
  }
  const attachment = results.find(result => {
    const candidate = result.message?.attachment;
    return (
      candidate?.type === 'hook_blocking_error' &&
      candidate.hookEvent === eventName &&
      candidate.blockingError?.blockingError === reason
    );
  });
  if (!attachment) {
    throw new Error(eventName + ' should return blocking attachment: ' + JSON.stringify(results));
  }
}

const idleResults = await collect(executeTeammateIdleHooks(
  teammateName,
  teamName,
  'default',
  context.abortController.signal,
  10000,
));
if (idleCalls !== 1) {
  throw new Error('TeammateIdle hook should run once, got ' + idleCalls);
}
assertBlocked(idleResults, 'TeammateIdle', idleReason);

const createdResults = await collect(executeTaskCreatedHooks(
  taskId,
  taskSubject,
  taskDescription,
  teammateName,
  teamName,
  'default',
  context.abortController.signal,
  10000,
  context,
));
if (createCalls !== 1) {
  throw new Error('TaskCreated hook should run once, got ' + createCalls);
}
assertBlocked(createdResults, 'TaskCreated', createReason);

const completedResults = await collect(executeTaskCompletedHooks(
  taskId,
  taskSubject,
  taskDescription,
  teammateName,
  teamName,
  'default',
  context.abortController.signal,
  10000,
  context,
));
if (completeCalls !== 1) {
  throw new Error('TaskCompleted hook should run once, got ' + completeCalls);
}
assertBlocked(completedResults, 'TaskCompleted', completeReason);

if (!getTeammateIdleHookMessage({ blockingError: idleReason, command: 'callback' }).includes(idleReason)) {
  throw new Error('TeammateIdle helper should include block reason');
}
if (!getTaskCreatedHookMessage({ blockingError: createReason, command: 'callback' }).includes(createReason)) {
  throw new Error('TaskCreated helper should include block reason');
}
if (!getTaskCompletedHookMessage({ blockingError: completeReason, command: 'callback' }).includes(completeReason)) {
  throw new Error('TaskCompleted helper should include block reason');
}

console.log('teammate task lifecycle hooks OK');`,
  )
  assert.equal(output, 'teammate task lifecycle hooks OK')
})

await test('teammate task lifecycle command hooks block with metadata', async () => {
  const output = await buildAndRunSnippet(
    'teammate-task-lifecycle-command-hook-test',
    `const { mkdir, rm, writeFile } = await import('node:fs/promises');
const { join } = await import('node:path');

process.env.CLAUDE_CONFIG_DIR = 'build-src/test-artifacts/teammate-task-lifecycle-command-hook-config';
delete process.env.CLAUDE_CODE_SIMPLE;

const commandDir = join(process.cwd(), 'build-src', 'test-artifacts', 'teammate-task-lifecycle-command-hook-config');
await rm(commandDir, { recursive: true, force: true });
await mkdir(commandDir, { recursive: true });
const commandPath = join(commandDir, 'teammate-task-lifecycle-command-hook.mjs');
const commandPathForHook = commandPath.replace(/\\\\/g, '/');
const teammateName = 'researcher-command-8391';
const teamName = 'analysis-team-command-8391';
const taskId = 'task-command-8391';
const taskSubject = 'Review command lifecycle hooks 8391';
const taskDescription = 'Task command lifecycle hook metadata marker 8391';
const idleReason = 'teammate idle command block marker 8391';
const createReason = 'task created command block marker 8391';
const completeReason = 'task completed command block marker 8391';
await writeFile(
  commandPath,
  [
    "let input = '';",
    "for await (const chunk of process.stdin) input += chunk;",
    "const data = JSON.parse(input);",
    "if (data.hook_event_name === 'TeammateIdle') {",
    "  if (data.teammate_name !== '" + teammateName + "' || data.team_name !== '" + teamName + "') { process.stderr.write('bad idle metadata ' + JSON.stringify(data)); process.exit(3); }",
    "  if (data.permission_mode !== 'default') { process.stderr.write('bad idle permission ' + data.permission_mode); process.exit(4); }",
    "  process.stdout.write(JSON.stringify({ decision: 'block', reason: '" + idleReason + "' }));",
    "  process.exit(0);",
    "}",
    "if (data.hook_event_name === 'TaskCreated') {",
    "  if (data.task_id !== '" + taskId + "' || data.task_subject !== '" + taskSubject + "') { process.stderr.write('bad created task ' + JSON.stringify(data)); process.exit(5); }",
    "  if (data.task_description !== '" + taskDescription + "') { process.stderr.write('bad created description ' + data.task_description); process.exit(6); }",
    "  if (data.teammate_name !== '" + teammateName + "' || data.team_name !== '" + teamName + "') { process.stderr.write('bad created teammate ' + JSON.stringify(data)); process.exit(7); }",
    "  process.stdout.write(JSON.stringify({ decision: 'block', reason: '" + createReason + "' }));",
    "  process.exit(0);",
    "}",
    "if (data.hook_event_name === 'TaskCompleted') {",
    "  if (data.task_id !== '" + taskId + "' || data.task_subject !== '" + taskSubject + "') { process.stderr.write('bad completed task ' + JSON.stringify(data)); process.exit(8); }",
    "  if (data.task_description !== '" + taskDescription + "') { process.stderr.write('bad completed description ' + data.task_description); process.exit(9); }",
    "  if (data.teammate_name !== '" + teammateName + "' || data.team_name !== '" + teamName + "') { process.stderr.write('bad completed teammate ' + JSON.stringify(data)); process.exit(10); }",
    "  process.stdout.write(JSON.stringify({ decision: 'block', reason: '" + completeReason + "' }));",
    "  process.exit(0);",
    "}",
    "process.stderr.write('bad event ' + data.hook_event_name);",
    "process.exit(11);",
  ].join('\\n'),
  'utf8',
);

const [
  {
    executeTeammateIdleHooks,
    executeTaskCreatedHooks,
    executeTaskCompletedHooks,
    getTeammateIdleHookMessage,
    getTaskCreatedHookMessage,
    getTaskCompletedHookMessage,
  },
  { clearRegisteredHooks, registerHookCallbacks, setIsInteractive },
  { resetHooksConfigSnapshot },
] = await Promise.all([
  import('./src/utils/hooks.ts'),
  import('./src/bootstrap/state.ts'),
  import('./src/utils/hooks/hooksConfigSnapshot.ts'),
]);

setIsInteractive(false);
clearRegisteredHooks();
resetHooksConfigSnapshot();

registerHookCallbacks({
  TeammateIdle: [
    {
      hooks: [
        {
          type: 'command',
          command: 'node ' + commandPathForHook,
          timeout: 5,
        },
      ],
    },
  ],
  TaskCreated: [
    {
      hooks: [
        {
          type: 'command',
          command: 'node ' + commandPathForHook,
          timeout: 5,
        },
      ],
    },
  ],
  TaskCompleted: [
    {
      hooks: [
        {
          type: 'command',
          command: 'node ' + commandPathForHook,
          timeout: 5,
        },
      ],
    },
  ],
});

let appState = {
  sessionHooks: new Map(),
  toolPermissionContext: {
    mode: 'default',
    additionalWorkingDirectories: new Map(),
    alwaysAllowRules: {},
    alwaysDenyRules: {},
    alwaysAskRules: {},
    isBypassPermissionsModeAvailable: false,
  },
};
const context = {
  abortController: new AbortController(),
  options: { isNonInteractiveSession: true },
  messages: [],
  getAppState() {
    return appState;
  },
  setAppState(updater) {
    appState = updater(appState);
  },
  updateAttributionState() {},
};

async function collect(generator) {
  const results = [];
  for await (const result of generator) {
    results.push(result);
  }
  return results;
}
function assertCommandBlocked(results, eventName, reason) {
  const blocking = results.find(result =>
    result.blockingError?.blockingError === reason &&
    String(result.blockingError?.command).includes('teammate-task-lifecycle-command-hook.mjs')
  );
  if (!blocking) {
    throw new Error(eventName + ' command hook should return blocking feedback: ' + JSON.stringify(results));
  }
  const attachment = results.find(result => {
    const candidate = result.message?.attachment;
    return (
      candidate?.type === 'hook_blocking_error' &&
      candidate.hookEvent === eventName &&
      candidate.blockingError?.blockingError === reason
    );
  });
  if (!attachment) {
    throw new Error(eventName + ' command hook should return blocking attachment: ' + JSON.stringify(results));
  }
}

const idleResults = await collect(executeTeammateIdleHooks(
  teammateName,
  teamName,
  'default',
  context.abortController.signal,
  10000,
));
assertCommandBlocked(idleResults, 'TeammateIdle', idleReason);

const createdResults = await collect(executeTaskCreatedHooks(
  taskId,
  taskSubject,
  taskDescription,
  teammateName,
  teamName,
  'default',
  context.abortController.signal,
  10000,
  context,
));
assertCommandBlocked(createdResults, 'TaskCreated', createReason);

const completedResults = await collect(executeTaskCompletedHooks(
  taskId,
  taskSubject,
  taskDescription,
  teammateName,
  teamName,
  'default',
  context.abortController.signal,
  10000,
  context,
));
assertCommandBlocked(completedResults, 'TaskCompleted', completeReason);

if (!getTeammateIdleHookMessage({ blockingError: idleReason, command: commandPathForHook }).includes(idleReason)) {
  throw new Error('TeammateIdle command helper should include block reason');
}
if (!getTaskCreatedHookMessage({ blockingError: createReason, command: commandPathForHook }).includes(createReason)) {
  throw new Error('TaskCreated command helper should include block reason');
}
if (!getTaskCompletedHookMessage({ blockingError: completeReason, command: commandPathForHook }).includes(completeReason)) {
  throw new Error('TaskCompleted command helper should include block reason');
}

console.log('teammate task lifecycle command hooks OK');`,
  )
  assert.equal(output, 'teammate task lifecycle command hooks OK')
})

await test('elicitation hooks can answer and block results', async () => {
  const output = await buildAndRunSnippet(
    'elicitation-hook-test',
    `process.env.CLAUDE_CONFIG_DIR = 'build-src/test-artifacts/elicitation-hook-config';
delete process.env.CLAUDE_CODE_SIMPLE;

const [
  { executeElicitationHooks, executeElicitationResultHooks },
  { clearRegisteredHooks, registerHookCallbacks, setIsInteractive },
  { resetHooksConfigSnapshot },
] = await Promise.all([
  import('./src/utils/hooks.ts'),
  import('./src/bootstrap/state.ts'),
  import('./src/utils/hooks/hooksConfigSnapshot.ts'),
]);

setIsInteractive(false);
clearRegisteredHooks();
resetHooksConfigSnapshot();

const serverName = 'fixture-elicit-server-6412';
const elicitationId = 'elicit-6412';
const requestedSchema = {
  type: 'object',
  properties: {
    approved: { type: 'boolean' },
    note: { type: 'string' },
  },
};
const acceptedContent = { approved: true, note: 'accepted by hook 6412' };
const resultOverrideContent = { approved: false, note: 'declined by hook 6412' };
const declineReason = 'elicitation result decline marker 6412';
let requestCalls = 0;
let resultCalls = 0;
registerHookCallbacks({
  Elicitation: [
    {
      matcher: serverName,
      hooks: [
        {
          type: 'callback',
          callback: async hookInput => {
            requestCalls += 1;
            if (hookInput.hook_event_name !== 'Elicitation') {
              throw new Error('unexpected elicitation event: ' + hookInput.hook_event_name);
            }
            if (hookInput.mcp_server_name !== serverName) {
              throw new Error('unexpected elicitation server: ' + hookInput.mcp_server_name);
            }
            if (hookInput.message !== 'Approve fixture access?') {
              throw new Error('unexpected elicitation message: ' + hookInput.message);
            }
            if (hookInput.mode !== 'form' || hookInput.url !== 'https://example.invalid/form') {
              throw new Error('unexpected elicitation mode/url: ' + JSON.stringify(hookInput));
            }
            if (hookInput.elicitation_id !== elicitationId) {
              throw new Error('unexpected elicitation id: ' + hookInput.elicitation_id);
            }
            if (hookInput.requested_schema?.properties?.approved?.type !== 'boolean') {
              throw new Error('unexpected requested schema: ' + JSON.stringify(hookInput.requested_schema));
            }
            return {
              systemMessage: JSON.stringify({
                hookSpecificOutput: {
                  hookEventName: 'Elicitation',
                  action: 'accept',
                  content: acceptedContent,
                },
              }),
            };
          },
        },
      ],
    },
  ],
  ElicitationResult: [
    {
      matcher: serverName,
      hooks: [
        {
          type: 'callback',
          callback: async hookInput => {
            resultCalls += 1;
            if (hookInput.hook_event_name !== 'ElicitationResult') {
              throw new Error('unexpected elicitation result event: ' + hookInput.hook_event_name);
            }
            if (hookInput.mcp_server_name !== serverName) {
              throw new Error('unexpected elicitation result server: ' + hookInput.mcp_server_name);
            }
            if (hookInput.elicitation_id !== elicitationId) {
              throw new Error('unexpected elicitation result id: ' + hookInput.elicitation_id);
            }
            if (hookInput.mode !== 'form' || hookInput.action !== 'accept') {
              throw new Error('unexpected elicitation result action: ' + JSON.stringify(hookInput));
            }
            if (hookInput.content?.approved !== true) {
              throw new Error('unexpected elicitation result content: ' + JSON.stringify(hookInput.content));
            }
            return {
              systemMessage: JSON.stringify({
                reason: declineReason,
                hookSpecificOutput: {
                  hookEventName: 'ElicitationResult',
                  action: 'decline',
                  content: resultOverrideContent,
                },
              }),
            };
          },
        },
      ],
    },
  ],
});

const requestResult = await executeElicitationHooks({
  serverName,
  message: 'Approve fixture access?',
  requestedSchema,
  permissionMode: 'default',
  mode: 'form',
  url: 'https://example.invalid/form',
  elicitationId,
  timeoutMs: 10000,
});
if (requestCalls !== 1) {
  throw new Error('Elicitation hook should run once, got ' + requestCalls);
}
if (requestResult.blockingError) {
  throw new Error('Elicitation accept hook should not block: ' + JSON.stringify(requestResult));
}
if (requestResult.elicitationResponse?.action !== 'accept') {
  throw new Error('Elicitation hook should accept: ' + JSON.stringify(requestResult));
}
if (requestResult.elicitationResponse.content?.note !== acceptedContent.note) {
  throw new Error('Elicitation hook should preserve accepted content: ' + JSON.stringify(requestResult));
}

const skippedRequest = await executeElicitationHooks({
  serverName: 'other-elicit-server-6412',
  message: 'ignored',
  permissionMode: 'default',
  timeoutMs: 10000,
});
if (requestCalls !== 1) {
  throw new Error('Elicitation matcher should skip other server, got ' + requestCalls);
}
if (skippedRequest.elicitationResponse || skippedRequest.blockingError) {
  throw new Error('skipped Elicitation should be empty: ' + JSON.stringify(skippedRequest));
}

const resultResult = await executeElicitationResultHooks({
  serverName,
  elicitationId,
  mode: 'form',
  action: 'accept',
  content: acceptedContent,
  permissionMode: 'default',
  timeoutMs: 10000,
});
if (resultCalls !== 1) {
  throw new Error('ElicitationResult hook should run once, got ' + resultCalls);
}
if (resultResult.elicitationResultResponse?.action !== 'decline') {
  throw new Error('ElicitationResult hook should decline: ' + JSON.stringify(resultResult));
}
if (resultResult.elicitationResultResponse.content?.note !== resultOverrideContent.note) {
  throw new Error('ElicitationResult hook should preserve override content: ' + JSON.stringify(resultResult));
}
if (resultResult.blockingError?.blockingError !== declineReason) {
  throw new Error('ElicitationResult decline should block with reason: ' + JSON.stringify(resultResult));
}

console.log('elicitation hooks OK');`,
  )
  assert.equal(output, 'elicitation hooks OK')
})

await test('elicitation command hooks can answer and block results', async () => {
  const output = await buildAndRunSnippet(
    'elicitation-command-hook-test',
    `const { mkdir, rm, writeFile } = await import('node:fs/promises');
const { join } = await import('node:path');

process.env.CLAUDE_CONFIG_DIR = 'build-src/test-artifacts/elicitation-command-hook-config';
delete process.env.CLAUDE_CODE_SIMPLE;

const commandDir = join(process.cwd(), 'build-src', 'test-artifacts', 'elicitation-command-hook-config');
await rm(commandDir, { recursive: true, force: true });
await mkdir(commandDir, { recursive: true });
const commandPath = join(commandDir, 'elicitation-command-hook.mjs');
const commandPathForHook = commandPath.replace(/\\\\/g, '/');
const serverName = 'fixture-elicit-command-server-7521';
const elicitationId = 'elicit-command-7521';
const acceptedNote = 'accepted by command hook 7521';
const declinedNote = 'declined by command hook 7521';
const declineReason = 'elicitation command decline marker 7521';
await writeFile(
  commandPath,
  [
    "let input = '';",
    "for await (const chunk of process.stdin) input += chunk;",
    "const data = JSON.parse(input);",
    "if (data.hook_event_name === 'Elicitation') {",
    "  if (data.mcp_server_name !== '" + serverName + "') { process.stderr.write('bad elicit server ' + data.mcp_server_name); process.exit(3); }",
    "  if (data.message !== 'Approve command fixture access?') { process.stderr.write('bad elicit message ' + data.message); process.exit(4); }",
    "  if (data.mode !== 'form' || data.url !== 'https://example.invalid/command-form') { process.stderr.write('bad elicit mode url ' + JSON.stringify(data)); process.exit(5); }",
    "  if (data.elicitation_id !== '" + elicitationId + "') { process.stderr.write('bad elicit id ' + data.elicitation_id); process.exit(6); }",
    "  if (data.requested_schema?.properties?.approved?.type !== 'boolean') { process.stderr.write('bad elicit schema ' + JSON.stringify(data.requested_schema)); process.exit(7); }",
    "  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'Elicitation', action: 'accept', content: { approved: true, note: '" + acceptedNote + "' } } }));",
    "  process.exit(0);",
    "}",
    "if (data.hook_event_name === 'ElicitationResult') {",
    "  if (data.mcp_server_name !== '" + serverName + "') { process.stderr.write('bad result server ' + data.mcp_server_name); process.exit(8); }",
    "  if (data.elicitation_id !== '" + elicitationId + "') { process.stderr.write('bad result id ' + data.elicitation_id); process.exit(9); }",
    "  if (data.mode !== 'form' || data.action !== 'accept') { process.stderr.write('bad result action ' + JSON.stringify(data)); process.exit(10); }",
    "  if (data.content?.note !== '" + acceptedNote + "') { process.stderr.write('bad result content ' + JSON.stringify(data.content)); process.exit(11); }",
    "  process.stdout.write(JSON.stringify({ reason: '" + declineReason + "', hookSpecificOutput: { hookEventName: 'ElicitationResult', action: 'decline', content: { approved: false, note: '" + declinedNote + "' } } }));",
    "  process.exit(0);",
    "}",
    "process.stderr.write('bad event ' + data.hook_event_name);",
    "process.exit(12);",
  ].join('\\n'),
  'utf8',
);

const [
  { executeElicitationHooks, executeElicitationResultHooks },
  { clearRegisteredHooks, registerHookCallbacks, setIsInteractive },
  { resetHooksConfigSnapshot },
] = await Promise.all([
  import('./src/utils/hooks.ts'),
  import('./src/bootstrap/state.ts'),
  import('./src/utils/hooks/hooksConfigSnapshot.ts'),
]);

setIsInteractive(false);
clearRegisteredHooks();
resetHooksConfigSnapshot();

registerHookCallbacks({
  Elicitation: [
    {
      matcher: serverName,
      hooks: [
        {
          type: 'command',
          command: 'node ' + commandPathForHook,
          timeout: 5,
        },
      ],
    },
  ],
  ElicitationResult: [
    {
      matcher: serverName,
      hooks: [
        {
          type: 'command',
          command: 'node ' + commandPathForHook,
          timeout: 5,
        },
      ],
    },
  ],
});

const requestedSchema = {
  type: 'object',
  properties: {
    approved: { type: 'boolean' },
    note: { type: 'string' },
  },
};
const requestResult = await executeElicitationHooks({
  serverName,
  message: 'Approve command fixture access?',
  requestedSchema,
  permissionMode: 'default',
  mode: 'form',
  url: 'https://example.invalid/command-form',
  elicitationId,
  timeoutMs: 10000,
});
if (requestResult.blockingError) {
  throw new Error('Elicitation command accept should not block: ' + JSON.stringify(requestResult));
}
if (requestResult.elicitationResponse?.action !== 'accept') {
  throw new Error('Elicitation command should accept: ' + JSON.stringify(requestResult));
}
if (requestResult.elicitationResponse.content?.note !== acceptedNote) {
  throw new Error('Elicitation command should preserve accepted content: ' + JSON.stringify(requestResult));
}

const skippedRequest = await executeElicitationHooks({
  serverName: 'other-elicit-command-server-7521',
  message: 'ignored',
  permissionMode: 'default',
  timeoutMs: 10000,
});
if (skippedRequest.elicitationResponse || skippedRequest.blockingError) {
  throw new Error('skipped Elicitation command should be empty: ' + JSON.stringify(skippedRequest));
}

const resultResult = await executeElicitationResultHooks({
  serverName,
  elicitationId,
  mode: 'form',
  action: 'accept',
  content: requestResult.elicitationResponse.content,
  permissionMode: 'default',
  timeoutMs: 10000,
});
if (resultResult.elicitationResultResponse?.action !== 'decline') {
  throw new Error('ElicitationResult command should decline: ' + JSON.stringify(resultResult));
}
if (resultResult.elicitationResultResponse.content?.note !== declinedNote) {
  throw new Error('ElicitationResult command should preserve override content: ' + JSON.stringify(resultResult));
}
if (resultResult.blockingError?.blockingError !== declineReason) {
  throw new Error('ElicitationResult command decline should block with reason: ' + JSON.stringify(resultResult));
}

const skippedResult = await executeElicitationResultHooks({
  serverName: 'other-elicit-command-server-7521',
  elicitationId,
  mode: 'form',
  action: 'accept',
  content: requestResult.elicitationResponse.content,
  permissionMode: 'default',
  timeoutMs: 10000,
});
if (skippedResult.elicitationResultResponse || skippedResult.blockingError) {
  throw new Error('skipped ElicitationResult command should be empty: ' + JSON.stringify(skippedResult));
}

console.log('elicitation command hooks OK');`,
  )
  assert.equal(output, 'elicitation command hooks OK')
})

await test('status line and file suggestion commands consume JSON input', async () => {
  const output = await buildAndRunSnippet(
    'status-line-file-suggestion-command-test',
    `const { mkdir, rm, writeFile } = await import('node:fs/promises');

const configDirRel = 'build-src/test-artifacts/status-line-file-suggestion-config';
await rm(configDirRel, { recursive: true, force: true });
await mkdir(configDirRel, { recursive: true });
process.env.CLAUDE_CONFIG_DIR = configDirRel;
delete process.env.CLAUDE_CODE_SIMPLE;

const statusCommandPath = configDirRel + '/status-line-command.mjs';
const fileSuggestionCommandPath = configDirRel + '/file-suggestion-command.mjs';
await writeFile(
  statusCommandPath,
  [
    "let input = '';",
    "for await (const chunk of process.stdin) input += chunk;",
    "const data = JSON.parse(input);",
    "if (data.marker !== 'status-marker-5208') { process.stderr.write('bad status marker'); process.exit(2); }",
    "if (data.model?.id !== 'model-5208') { process.stderr.write('bad status model'); process.exit(2); }",
    "if (!String(data.transcriptPath).endsWith('status-transcript-5208.jsonl')) { process.stderr.write('bad status transcript'); process.exit(2); }",
    "process.stdout.write('  status marker 5208  \\\\n\\\\n second status line 5208  \\\\n');",
  ].join('\\n'),
  'utf8',
);
await writeFile(
  fileSuggestionCommandPath,
  [
    "let input = '';",
    "for await (const chunk of process.stdin) input += chunk;",
    "const data = JSON.parse(input);",
    "if (data.command !== '@fi') { process.stderr.write('bad suggestion command'); process.exit(2); }",
    "if (!Array.isArray(data.paths) || data.paths[0] !== 'src/app.ts') { process.stderr.write('bad suggestion paths'); process.exit(2); }",
    "process.stdout.write(' src/app.ts \\\\n\\\\n README.md \\\\n docs/guide.md \\\\n');",
  ].join('\\n'),
  'utf8',
);
await writeFile(
  configDirRel + '/settings.json',
  JSON.stringify(
    {
      statusLine: {
        type: 'command',
        command: 'node ' + statusCommandPath,
      },
      fileSuggestion: {
        type: 'command',
        command: 'node ' + fileSuggestionCommandPath,
      },
    },
    null,
    2,
  ),
  'utf8',
);

const [
  { executeStatusLineCommand, executeFileSuggestionCommand },
  { setIsInteractive },
  { resetHooksConfigSnapshot },
  { resetSettingsCache },
] = await Promise.all([
  import('./src/utils/hooks.ts'),
  import('./src/bootstrap/state.ts'),
  import('./src/utils/hooks/hooksConfigSnapshot.ts'),
  import('./src/utils/settings/settingsCache.ts'),
]);

setIsInteractive(false);
resetHooksConfigSnapshot();
resetSettingsCache();

const statusLine = await executeStatusLineCommand(
  {
    marker: 'status-marker-5208',
    cwd: process.cwd(),
    model: { id: 'model-5208', display_name: 'Model 5208' },
    transcriptPath: 'build-src/test-artifacts/status-transcript-5208.jsonl',
  },
  undefined,
  10000,
  true,
);
if (statusLine !== 'status marker 5208\\nsecond status line 5208') {
  throw new Error('unexpected status line output: ' + JSON.stringify(statusLine));
}

const suggestions = await executeFileSuggestionCommand(
  {
    command: '@fi',
    cwd: process.cwd(),
    paths: ['src/app.ts'],
  },
  undefined,
  10000,
);
if (JSON.stringify(suggestions) !== JSON.stringify(['src/app.ts', 'README.md', 'docs/guide.md'])) {
  throw new Error('unexpected file suggestions: ' + JSON.stringify(suggestions));
}

console.log('status line file suggestion commands OK');`,
  )
  assert.equal(output, 'status line file suggestion commands OK')
})

await test('status line and file suggestion commands ignore failed or empty output', async () => {
  const output = await buildAndRunSnippet(
    'status-line-file-suggestion-fallback-test',
    `const { mkdir, rm, writeFile } = await import('node:fs/promises');

const configDirRel = 'build-src/test-artifacts/status-line-file-suggestion-fallback-config';
await rm(configDirRel, { recursive: true, force: true });
await mkdir(configDirRel, { recursive: true });
process.env.CLAUDE_CONFIG_DIR = configDirRel;
delete process.env.CLAUDE_CODE_SIMPLE;

const statusFailCommandPath = configDirRel + '/status-line-fail-command.mjs';
const suggestionFailCommandPath = configDirRel + '/file-suggestion-fail-command.mjs';
const statusBlankCommandPath = configDirRel + '/status-line-blank-command.mjs';
const suggestionBlankCommandPath = configDirRel + '/file-suggestion-blank-command.mjs';
await writeFile(
  statusFailCommandPath,
  "process.stdout.write('failed status should be ignored');\\nprocess.exit(7);\\n",
  'utf8',
);
await writeFile(
  suggestionFailCommandPath,
  "process.stdout.write('failed-suggestion.ts');\\nprocess.exit(7);\\n",
  'utf8',
);
await writeFile(
  statusBlankCommandPath,
  "process.stdout.write('  \\\\n  \\\\n');\\n",
  'utf8',
);
await writeFile(
  suggestionBlankCommandPath,
  "process.stdout.write('  \\\\n\\\\n');\\n",
  'utf8',
);

const [
  { executeStatusLineCommand, executeFileSuggestionCommand },
  { setIsInteractive },
  { resetHooksConfigSnapshot },
  { resetSettingsCache },
] = await Promise.all([
  import('./src/utils/hooks.ts'),
  import('./src/bootstrap/state.ts'),
  import('./src/utils/hooks/hooksConfigSnapshot.ts'),
  import('./src/utils/settings/settingsCache.ts'),
]);

function resetHookSettings() {
  setIsInteractive(false);
  resetHooksConfigSnapshot();
  resetSettingsCache();
}

async function writeSettings(statusCommand, suggestionCommand) {
  await writeFile(
    configDirRel + '/settings.json',
    JSON.stringify(
      {
        statusLine: {
          type: 'command',
          command: 'node ' + statusCommand,
        },
        fileSuggestion: {
          type: 'command',
          command: 'node ' + suggestionCommand,
        },
      },
      null,
      2,
    ),
    'utf8',
  );
  resetHookSettings();
}

const statusInput = {
  marker: 'status-marker-8519',
  cwd: process.cwd(),
  model: { id: 'model-8519', display_name: 'Model 8519' },
  transcriptPath: 'build-src/test-artifacts/status-transcript-8519.jsonl',
};
const suggestionInput = {
  command: '@ig',
  cwd: process.cwd(),
  paths: ['src/index.ts'],
};

await writeSettings(statusFailCommandPath, suggestionFailCommandPath);
const failedStatusLine = await executeStatusLineCommand(statusInput, undefined, 10000, true);
if (failedStatusLine !== undefined) {
  throw new Error('failed status line output should be ignored: ' + JSON.stringify(failedStatusLine));
}
const failedSuggestions = await executeFileSuggestionCommand(suggestionInput, undefined, 10000);
if (JSON.stringify(failedSuggestions) !== JSON.stringify([])) {
  throw new Error('failed file suggestions should be empty: ' + JSON.stringify(failedSuggestions));
}

await writeSettings(statusBlankCommandPath, suggestionBlankCommandPath);
const blankStatusLine = await executeStatusLineCommand(statusInput, undefined, 10000, true);
if (blankStatusLine !== undefined) {
  throw new Error('blank status line output should be ignored: ' + JSON.stringify(blankStatusLine));
}
const blankSuggestions = await executeFileSuggestionCommand(suggestionInput, undefined, 10000);
if (JSON.stringify(blankSuggestions) !== JSON.stringify([])) {
  throw new Error('blank file suggestions should be empty: ' + JSON.stringify(blankSuggestions));
}

console.log('status line file suggestion fallback OK');`,
  )
  assert.equal(output, 'status line file suggestion fallback OK')
})

await test('status line and file suggestion commands respect pre-aborted signals', async () => {
  const output = await buildAndRunSnippet(
    'status-line-file-suggestion-aborted-test',
    `const { mkdir, rm, stat, writeFile } = await import('node:fs/promises');

const configDirRel = 'build-src/test-artifacts/status-line-file-suggestion-aborted-config';
await rm(configDirRel, { recursive: true, force: true });
await mkdir(configDirRel, { recursive: true });
process.env.CLAUDE_CONFIG_DIR = configDirRel;
delete process.env.CLAUDE_CODE_SIMPLE;

const statusCommandPath = configDirRel + '/status-line-aborted-command.mjs';
const suggestionCommandPath = configDirRel + '/file-suggestion-aborted-command.mjs';
const statusMarkerPath = configDirRel + '/status-command-ran.txt';
const suggestionMarkerPath = configDirRel + '/suggestion-command-ran.txt';

await writeFile(
  statusCommandPath,
  [
    "import { writeFileSync } from 'node:fs';",
    "writeFileSync(" + JSON.stringify(statusMarkerPath) + ", 'ran');",
    "process.stdout.write('aborted status should not render');",
  ].join('\\n'),
  'utf8',
);
await writeFile(
  suggestionCommandPath,
  [
    "import { writeFileSync } from 'node:fs';",
    "writeFileSync(" + JSON.stringify(suggestionMarkerPath) + ", 'ran');",
    "process.stdout.write('aborted-suggestion.ts');",
  ].join('\\n'),
  'utf8',
);
await writeFile(
  configDirRel + '/settings.json',
  JSON.stringify(
    {
      statusLine: {
        type: 'command',
        command: 'node ' + statusCommandPath,
      },
      fileSuggestion: {
        type: 'command',
        command: 'node ' + suggestionCommandPath,
      },
    },
    null,
    2,
  ),
  'utf8',
);

const [
  { executeStatusLineCommand, executeFileSuggestionCommand },
  { setIsInteractive },
  { resetHooksConfigSnapshot },
  { resetSettingsCache },
] = await Promise.all([
  import('./src/utils/hooks.ts'),
  import('./src/bootstrap/state.ts'),
  import('./src/utils/hooks/hooksConfigSnapshot.ts'),
  import('./src/utils/settings/settingsCache.ts'),
]);

setIsInteractive(false);
resetHooksConfigSnapshot();
resetSettingsCache();

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

const controller = new AbortController();
controller.abort('pre-aborted status helper marker 4871');

const statusLine = await executeStatusLineCommand(
  {
    marker: 'status-marker-4871',
    cwd: process.cwd(),
    model: { id: 'model-4871', display_name: 'Model 4871' },
    transcriptPath: 'build-src/test-artifacts/status-transcript-4871.jsonl',
  },
  controller.signal,
  10000,
  true,
);
if (statusLine !== undefined) {
  throw new Error('aborted status line output should be ignored: ' + JSON.stringify(statusLine));
}
const suggestions = await executeFileSuggestionCommand(
  {
    command: '@ab',
    cwd: process.cwd(),
    paths: ['src/aborted.ts'],
  },
  controller.signal,
  10000,
);
if (JSON.stringify(suggestions) !== JSON.stringify([])) {
  throw new Error('aborted file suggestions should be empty: ' + JSON.stringify(suggestions));
}
if (await exists(statusMarkerPath)) {
  throw new Error('pre-aborted status command should not be spawned');
}
if (await exists(suggestionMarkerPath)) {
  throw new Error('pre-aborted file suggestion command should not be spawned');
}

console.log('status line file suggestion aborted OK');`,
  )
  assert.equal(output, 'status line file suggestion aborted OK')
})

await test('StopFailure hooks receive error metadata', async () => {
  const output = await buildAndRunSnippet(
    'stop-failure-hook-test',
    `process.env.CLAUDE_CONFIG_DIR = 'build-src/test-artifacts/stop-failure-hook-config';
delete process.env.CLAUDE_CODE_SIMPLE;

const [
  { executeStopFailureHooks },
  { clearRegisteredHooks, registerHookCallbacks, setIsInteractive },
  { resetHooksConfigSnapshot },
] = await Promise.all([
  import('./src/utils/hooks.ts'),
  import('./src/bootstrap/state.ts'),
  import('./src/utils/hooks/hooksConfigSnapshot.ts'),
]);

setIsInteractive(false);
clearRegisteredHooks();
resetHooksConfigSnapshot();

const error = 'stop failure marker 2746';
const errorDetails = 'stop failure details marker 2746';
const lastAssistantText = 'last assistant before stop failure marker 2746';
let calls = 0;
registerHookCallbacks({
  StopFailure: [
    {
      matcher: error,
      hooks: [
        {
          type: 'callback',
          callback: async hookInput => {
            calls += 1;
            if (hookInput.hook_event_name !== 'StopFailure') {
              throw new Error('unexpected stop failure event: ' + hookInput.hook_event_name);
            }
            if (hookInput.error !== error) {
              throw new Error('unexpected stop failure error: ' + hookInput.error);
            }
            if (hookInput.error_details !== errorDetails) {
              throw new Error('unexpected stop failure details: ' + hookInput.error_details);
            }
            if (hookInput.last_assistant_message !== lastAssistantText) {
              throw new Error('unexpected stop failure assistant text: ' + hookInput.last_assistant_message);
            }
            return { systemMessage: 'stop failure hook observed 2746' };
          },
        },
      ],
    },
  ],
});

const appState = {
  sessionHooks: new Map(),
  toolPermissionContext: {
    mode: 'default',
    additionalWorkingDirectories: new Map(),
    alwaysAllowRules: {},
    alwaysDenyRules: {},
    alwaysAskRules: {},
    isBypassPermissionsModeAvailable: false,
  },
};
const context = {
  abortController: new AbortController(),
  options: { isNonInteractiveSession: true },
  getAppState() {
    return appState;
  },
  setAppState(updater) {
    updater(appState);
  },
  updateAttributionState() {},
};
const lastMessage = {
  type: 'assistant',
  uuid: '00000000-0000-0000-0000-000000002746',
  timestamp: '2026-06-19T00:00:00.000Z',
  error,
  errorDetails,
  message: {
    id: 'msg_stop_failure_2746',
    role: 'assistant',
    content: [{ type: 'text', text: lastAssistantText }],
  },
};

await executeStopFailureHooks(lastMessage, context, 10000);
if (calls !== 1) {
  throw new Error('StopFailure hook should run once, got ' + calls);
}

await executeStopFailureHooks(
  { ...lastMessage, error: 'different failure marker 9172' },
  context,
  10000,
);
if (calls !== 1) {
  throw new Error('StopFailure matcher should skip other errors, got ' + calls);
}

await executeStopFailureHooks(
  { ...lastMessage, error: undefined, errorDetails: undefined },
  context,
  10000,
);
if (calls !== 1) {
  throw new Error('StopFailure matcher should skip default unknown errors, got ' + calls);
}

console.log('stop failure hooks OK');`,
  )
  assert.equal(output, 'stop failure hooks OK')
})

await test('StopFailure command hooks receive error metadata', async () => {
  const output = await buildAndRunSnippet(
    'stop-failure-command-hook-test',
    `const { mkdir, readFile, rm, stat, writeFile } = await import('node:fs/promises');
const { join } = await import('node:path');

process.env.CLAUDE_CONFIG_DIR = 'build-src/test-artifacts/stop-failure-command-hook-config';
delete process.env.CLAUDE_CODE_SIMPLE;

const commandDir = join(process.cwd(), 'build-src', 'test-artifacts', 'stop-failure-command-hook-config');
await rm(commandDir, { recursive: true, force: true });
await mkdir(commandDir, { recursive: true });
const commandPath = join(commandDir, 'stop-failure-command-hook.mjs');
const commandPathForHook = commandPath.replace(/\\\\/g, '/');
const markerPath = join(commandDir, 'stop-failure-marker.json');
const markerPathForScript = markerPath.replace(/\\\\/g, '/');
const error = 'stop failure command marker 2747';
const errorDetails = 'stop failure command details marker 2747';
const lastAssistantText = 'last assistant before stop failure command marker 2747';
await writeFile(
  commandPath,
  [
    "const { writeFile } = await import('node:fs/promises');",
    "let input = '';",
    "for await (const chunk of process.stdin) input += chunk;",
    "const data = JSON.parse(input);",
    "if (data.hook_event_name !== 'StopFailure') { process.stderr.write('bad event ' + data.hook_event_name); process.exit(3); }",
    "if (data.error !== '" + error + "') { process.stderr.write('bad error ' + data.error); process.exit(4); }",
    "if (data.error_details !== '" + errorDetails + "') { process.stderr.write('bad details ' + data.error_details); process.exit(5); }",
    "if (data.last_assistant_message !== '" + lastAssistantText + "') { process.stderr.write('bad assistant text ' + data.last_assistant_message); process.exit(6); }",
    "await writeFile('" + markerPathForScript + "', JSON.stringify({ error: data.error, details: data.error_details }), 'utf8');",
  ].join('\\n'),
  'utf8',
);

const [
  { executeStopFailureHooks },
  { clearRegisteredHooks, registerHookCallbacks, setIsInteractive },
  { resetHooksConfigSnapshot },
] = await Promise.all([
  import('./src/utils/hooks.ts'),
  import('./src/bootstrap/state.ts'),
  import('./src/utils/hooks/hooksConfigSnapshot.ts'),
]);

setIsInteractive(false);
clearRegisteredHooks();
resetHooksConfigSnapshot();

registerHookCallbacks({
  StopFailure: [
    {
      matcher: error,
      hooks: [
        {
          type: 'command',
          command: 'node ' + commandPathForHook,
          timeout: 5,
        },
      ],
    },
  ],
});

const appState = {
  sessionHooks: new Map(),
  toolPermissionContext: {
    mode: 'default',
    additionalWorkingDirectories: new Map(),
    alwaysAllowRules: {},
    alwaysDenyRules: {},
    alwaysAskRules: {},
    isBypassPermissionsModeAvailable: false,
  },
};
const context = {
  abortController: new AbortController(),
  options: { isNonInteractiveSession: true },
  getAppState() {
    return appState;
  },
  setAppState(updater) {
    updater(appState);
  },
  updateAttributionState() {},
};
const lastMessage = {
  type: 'assistant',
  uuid: '00000000-0000-0000-0000-000000002747',
  timestamp: '2026-06-19T00:00:00.000Z',
  error,
  errorDetails,
  message: {
    id: 'msg_stop_failure_command_2747',
    role: 'assistant',
    content: [{ type: 'text', text: lastAssistantText }],
  },
};

await executeStopFailureHooks(lastMessage, context, 10000);
const marker = JSON.parse(await readFile(markerPath, 'utf8'));
if (marker.error !== error || marker.details !== errorDetails) {
  throw new Error('StopFailure command marker mismatch: ' + JSON.stringify(marker));
}

await rm(markerPath, { force: true });
await executeStopFailureHooks(
  { ...lastMessage, error: 'different failure marker 9173' },
  context,
  10000,
);
let skippedCreated = true;
try {
  await stat(markerPath);
} catch {
  skippedCreated = false;
}
if (skippedCreated) {
  throw new Error('StopFailure command matcher should skip other errors');
}

console.log('stop failure command hook OK');`,
  )
  assert.equal(output, 'stop failure command hook OK')
})

await test('Notification hooks receive title and type metadata', async () => {
  const output = await buildAndRunSnippet(
    'notification-hook-test',
    `process.env.CLAUDE_CONFIG_DIR = 'build-src/test-artifacts/notification-hook-config';
delete process.env.CLAUDE_CODE_SIMPLE;

const [
  { executeNotificationHooks },
  { clearRegisteredHooks, registerHookCallbacks, setIsInteractive },
  { resetHooksConfigSnapshot },
] = await Promise.all([
  import('./src/utils/hooks.ts'),
  import('./src/bootstrap/state.ts'),
  import('./src/utils/hooks/hooksConfigSnapshot.ts'),
]);

setIsInteractive(false);
clearRegisteredHooks();
resetHooksConfigSnapshot();

const notificationType = 'permission_prompt';
const message = 'notification hook message marker 8126';
const title = 'notification hook title marker 8126';
let calls = 0;
registerHookCallbacks({
  Notification: [
    {
      matcher: notificationType,
      hooks: [
        {
          type: 'callback',
          callback: async hookInput => {
            calls += 1;
            if (hookInput.hook_event_name !== 'Notification') {
              throw new Error('unexpected notification event: ' + hookInput.hook_event_name);
            }
            if (hookInput.notification_type !== notificationType) {
              throw new Error('unexpected notification type: ' + hookInput.notification_type);
            }
            if (hookInput.message !== message) {
              throw new Error('unexpected notification message: ' + hookInput.message);
            }
            if (hookInput.title !== title) {
              throw new Error('unexpected notification title: ' + hookInput.title);
            }
            return { systemMessage: 'notification hook observed 8126' };
          },
        },
      ],
    },
  ],
});

await executeNotificationHooks(
  {
    notificationType,
    message,
    title,
  },
  10000,
);
if (calls !== 1) {
  throw new Error('Notification hook should run once, got ' + calls);
}

await executeNotificationHooks(
  {
    notificationType: 'idle_prompt',
    message,
    title,
  },
  10000,
);
if (calls !== 1) {
  throw new Error('Notification matcher should skip other types, got ' + calls);
}

console.log('notification hooks OK');`,
  )
  assert.equal(output, 'notification hooks OK')
})

await test('Notification command hooks receive title and type metadata', async () => {
  const output = await buildAndRunSnippet(
    'notification-command-hook-test',
    `const { mkdir, readFile, rm, stat, writeFile } = await import('node:fs/promises');
const { join } = await import('node:path');

process.env.CLAUDE_CONFIG_DIR = 'build-src/test-artifacts/notification-command-hook-config';
delete process.env.CLAUDE_CODE_SIMPLE;

const commandDir = join(process.cwd(), 'build-src', 'test-artifacts', 'notification-command-hook-config');
await rm(commandDir, { recursive: true, force: true });
await mkdir(commandDir, { recursive: true });
const commandPath = join(commandDir, 'notification-command-hook.mjs');
const commandPathForHook = commandPath.replace(/\\\\/g, '/');
const markerPath = join(commandDir, 'notification-marker.json');
const markerPathForScript = markerPath.replace(/\\\\/g, '/');
const notificationType = 'permission_prompt';
const message = 'notification command message marker 8127';
const title = 'notification command title marker 8127';
await writeFile(
  commandPath,
  [
    "const { writeFile } = await import('node:fs/promises');",
    "let input = '';",
    "for await (const chunk of process.stdin) input += chunk;",
    "const data = JSON.parse(input);",
    "if (data.hook_event_name !== 'Notification') { process.stderr.write('bad event ' + data.hook_event_name); process.exit(3); }",
    "if (data.notification_type !== '" + notificationType + "') { process.stderr.write('bad type ' + data.notification_type); process.exit(4); }",
    "if (data.message !== '" + message + "') { process.stderr.write('bad message ' + data.message); process.exit(5); }",
    "if (data.title !== '" + title + "') { process.stderr.write('bad title ' + data.title); process.exit(6); }",
    "await writeFile('" + markerPathForScript + "', JSON.stringify({ type: data.notification_type, title: data.title }), 'utf8');",
  ].join('\\n'),
  'utf8',
);

const [
  { executeNotificationHooks },
  { clearRegisteredHooks, registerHookCallbacks, setIsInteractive },
  { resetHooksConfigSnapshot },
] = await Promise.all([
  import('./src/utils/hooks.ts'),
  import('./src/bootstrap/state.ts'),
  import('./src/utils/hooks/hooksConfigSnapshot.ts'),
]);

setIsInteractive(false);
clearRegisteredHooks();
resetHooksConfigSnapshot();

registerHookCallbacks({
  Notification: [
    {
      matcher: notificationType,
      hooks: [
        {
          type: 'command',
          command: 'node ' + commandPathForHook,
          timeout: 5,
        },
      ],
    },
  ],
});

await executeNotificationHooks(
  {
    notificationType,
    message,
    title,
  },
  10000,
);
const marker = JSON.parse(await readFile(markerPath, 'utf8'));
if (marker.type !== notificationType || marker.title !== title) {
  throw new Error('Notification command marker mismatch: ' + JSON.stringify(marker));
}

await rm(markerPath, { force: true });
await executeNotificationHooks(
  {
    notificationType: 'idle_prompt',
    message,
    title,
  },
  10000,
);
let skippedCreated = true;
try {
  await stat(markerPath);
} catch {
  skippedCreated = false;
}
if (skippedCreated) {
  throw new Error('Notification command matcher should skip idle_prompt');
}

console.log('notification command hooks OK');`,
  )
  assert.equal(output, 'notification command hooks OK')
})

await test('SessionStart and Setup hooks expose startup context', async () => {
  const output = await buildAndRunSnippet(
    'session-start-setup-hook-test',
    `process.env.CLAUDE_CONFIG_DIR = 'build-src/test-artifacts/session-start-setup-hook-config';
delete process.env.CLAUDE_CODE_SIMPLE;

const [
  { executeSessionStartHooks, executeSetupHooks },
  { clearRegisteredHooks, registerHookCallbacks, setIsInteractive },
  { resetHooksConfigSnapshot },
] = await Promise.all([
  import('./src/utils/hooks.ts'),
  import('./src/bootstrap/state.ts'),
  import('./src/utils/hooks/hooksConfigSnapshot.ts'),
]);

setIsInteractive(false);
clearRegisteredHooks();
resetHooksConfigSnapshot();

const sessionId = '00000000-0000-4000-8000-000000008451';
const sessionContext = 'session start context marker 8451';
const initialUserMessage = 'session start initial user marker 8451';
const watchPath = (process.cwd() + '/build-src/test-artifacts/session-start-watch-8451.txt').replace(/\\\\/g, '/');
const setupContext = 'setup context marker 8451';
let sessionCalls = 0;
let setupCalls = 0;
registerHookCallbacks({
  SessionStart: [
    {
      matcher: 'startup',
      hooks: [
        {
          type: 'callback',
          callback: async hookInput => {
            sessionCalls += 1;
            if (hookInput.hook_event_name !== 'SessionStart') {
              throw new Error('unexpected session event: ' + hookInput.hook_event_name);
            }
            if (hookInput.source !== 'startup') {
              throw new Error('unexpected session source: ' + hookInput.source);
            }
            if (hookInput.session_id !== sessionId) {
              throw new Error('unexpected session id: ' + hookInput.session_id);
            }
            if (hookInput.agent_type !== 'review-agent-8451') {
              throw new Error('unexpected session agent type: ' + hookInput.agent_type);
            }
            if (hookInput.model !== 'model-8451') {
              throw new Error('unexpected session model: ' + hookInput.model);
            }
            return {
              hookSpecificOutput: {
                hookEventName: 'SessionStart',
                additionalContext: sessionContext,
                initialUserMessage,
                watchPaths: [watchPath],
              },
            };
          },
        },
      ],
    },
  ],
  Setup: [
    {
      matcher: 'init',
      hooks: [
        {
          type: 'callback',
          callback: async hookInput => {
            setupCalls += 1;
            if (hookInput.hook_event_name !== 'Setup') {
              throw new Error('unexpected setup event: ' + hookInput.hook_event_name);
            }
            if (hookInput.trigger !== 'init') {
              throw new Error('unexpected setup trigger: ' + hookInput.trigger);
            }
            return {
              hookSpecificOutput: {
                hookEventName: 'Setup',
                additionalContext: setupContext,
              },
            };
          },
        },
      ],
    },
  ],
});

const sessionResults = [];
for await (const result of executeSessionStartHooks(
  'startup',
  sessionId,
  'review-agent-8451',
  'model-8451',
  undefined,
  10000,
)) {
  sessionResults.push(result);
}
if (sessionCalls !== 1) {
  throw new Error('SessionStart hook should run once, got ' + sessionCalls);
}
if (!sessionResults.some(result =>
  Array.isArray(result.additionalContexts) &&
  result.additionalContexts.includes(sessionContext)
)) {
  throw new Error('SessionStart should return additional context: ' + JSON.stringify(sessionResults));
}
if (!sessionResults.some(result => result.initialUserMessage === initialUserMessage)) {
  throw new Error('SessionStart should return initial user message: ' + JSON.stringify(sessionResults));
}
if (!sessionResults.some(result =>
  Array.isArray(result.watchPaths) &&
  result.watchPaths.includes(watchPath)
)) {
  throw new Error('SessionStart should return watch paths: ' + JSON.stringify(sessionResults));
}

const skippedSession = [];
for await (const result of executeSessionStartHooks(
  'resume',
  sessionId,
  'review-agent-8451',
  'model-8451',
  undefined,
  10000,
)) {
  skippedSession.push(result);
}
if (sessionCalls !== 1) {
  throw new Error('SessionStart matcher should skip resume, got ' + sessionCalls);
}
if (skippedSession.length !== 0) {
  throw new Error('skipped SessionStart should produce no results: ' + JSON.stringify(skippedSession));
}

const setupResults = [];
for await (const result of executeSetupHooks('init', undefined, 10000)) {
  setupResults.push(result);
}
if (setupCalls !== 1) {
  throw new Error('Setup hook should run once, got ' + setupCalls);
}
if (!setupResults.some(result =>
  Array.isArray(result.additionalContexts) &&
  result.additionalContexts.includes(setupContext)
)) {
  throw new Error('Setup should return additional context: ' + JSON.stringify(setupResults));
}

const skippedSetup = [];
for await (const result of executeSetupHooks('maintenance', undefined, 10000)) {
  skippedSetup.push(result);
}
if (setupCalls !== 1) {
  throw new Error('Setup matcher should skip maintenance, got ' + setupCalls);
}
if (skippedSetup.length !== 0) {
  throw new Error('skipped Setup should produce no results: ' + JSON.stringify(skippedSetup));
}

console.log('session start setup hooks OK');`,
  )
  assert.equal(output, 'session start setup hooks OK')
})

await test('SessionStart and Setup command hooks expose startup context', async () => {
  const output = await buildAndRunSnippet(
    'session-start-setup-command-hook-test',
    `const { mkdir, rm, writeFile } = await import('node:fs/promises');
const { join } = await import('node:path');

process.env.CLAUDE_CONFIG_DIR = 'build-src/test-artifacts/session-start-setup-command-hook-config';
delete process.env.CLAUDE_CODE_SIMPLE;

const commandDir = join(process.cwd(), 'build-src', 'test-artifacts', 'session-start-setup-command-hook-config');
await rm(commandDir, { recursive: true, force: true });
await mkdir(commandDir, { recursive: true });
const commandPath = join(commandDir, 'startup-command-hook.mjs');
const commandPathForHook = commandPath.replace(/\\\\/g, '/');
const sessionContext = 'session command context marker 8712';
const setupContext = 'setup command context marker 8712';
const initialUserMessage = 'session command initial user marker 8712';
const watchPath = commandDir.replace(/\\\\/g, '/') + '/watched.txt';
await writeFile(
  commandPath,
  [
    "let input = '';",
    "for await (const chunk of process.stdin) input += chunk;",
    "const data = JSON.parse(input);",
    "if (data.hook_event_name === 'SessionStart') {",
    "  if (data.source !== 'startup') { process.stderr.write('bad source ' + data.source); process.exit(3); }",
    "  if (data.agent_type !== 'command-agent-8712') { process.stderr.write('bad agent type ' + data.agent_type); process.exit(4); }",
    "  if (data.model !== 'model-command-8712') { process.stderr.write('bad model ' + data.model); process.exit(5); }",
    "  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: '" + sessionContext + "', initialUserMessage: '" + initialUserMessage + "', watchPaths: ['" + watchPath + "'] } }));",
    "  process.exit(0);",
    "}",
    "if (data.hook_event_name === 'Setup') {",
    "  if (data.trigger !== 'init') { process.stderr.write('bad trigger ' + data.trigger); process.exit(6); }",
    "  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'Setup', additionalContext: '" + setupContext + "' } }));",
    "  process.exit(0);",
    "}",
    "process.stderr.write('bad event ' + data.hook_event_name);",
    "process.exit(7);",
  ].join('\\n'),
  'utf8',
);

const [
  { executeSessionStartHooks, executeSetupHooks },
  { clearRegisteredHooks, registerHookCallbacks, setIsInteractive },
  { resetHooksConfigSnapshot },
] = await Promise.all([
  import('./src/utils/hooks.ts'),
  import('./src/bootstrap/state.ts'),
  import('./src/utils/hooks/hooksConfigSnapshot.ts'),
]);

setIsInteractive(false);
clearRegisteredHooks();
resetHooksConfigSnapshot();

registerHookCallbacks({
  SessionStart: [
    {
      matcher: 'startup',
      hooks: [
        {
          type: 'command',
          command: 'node ' + commandPathForHook,
          timeout: 5,
        },
      ],
    },
  ],
  Setup: [
    {
      matcher: 'init',
      hooks: [
        {
          type: 'command',
          command: 'node ' + commandPathForHook,
          timeout: 5,
        },
      ],
    },
  ],
});

const sessionResults = [];
for await (const result of executeSessionStartHooks(
  'startup',
  'session-command-8712',
  'command-agent-8712',
  'model-command-8712',
  undefined,
  10000,
)) {
  sessionResults.push(result);
}
if (!sessionResults.some(result =>
  Array.isArray(result.additionalContexts) &&
  result.additionalContexts.includes(sessionContext)
)) {
  throw new Error('SessionStart command hook should return additional context: ' + JSON.stringify(sessionResults));
}
if (!sessionResults.some(result => result.initialUserMessage === initialUserMessage)) {
  throw new Error('SessionStart command hook should return initial user message: ' + JSON.stringify(sessionResults));
}
if (!sessionResults.some(result =>
  Array.isArray(result.watchPaths) &&
  result.watchPaths.includes(watchPath)
)) {
  throw new Error('SessionStart command hook should return watch paths: ' + JSON.stringify(sessionResults));
}

const skippedSession = [];
for await (const result of executeSessionStartHooks(
  'resume',
  'session-command-8712',
  'command-agent-8712',
  'model-command-8712',
  undefined,
  10000,
)) {
  skippedSession.push(result);
}
if (skippedSession.length !== 0) {
  throw new Error('SessionStart command matcher should skip resume: ' + JSON.stringify(skippedSession));
}

const setupResults = [];
for await (const result of executeSetupHooks('init', undefined, 10000)) {
  setupResults.push(result);
}
if (!setupResults.some(result =>
  Array.isArray(result.additionalContexts) &&
  result.additionalContexts.includes(setupContext)
)) {
  throw new Error('Setup command hook should return additional context: ' + JSON.stringify(setupResults));
}

const skippedSetup = [];
for await (const result of executeSetupHooks('maintenance', undefined, 10000)) {
  skippedSetup.push(result);
}
if (skippedSetup.length !== 0) {
  throw new Error('Setup command matcher should skip maintenance: ' + JSON.stringify(skippedSetup));
}

console.log('session start setup command hooks OK');`,
  )
  assert.equal(output, 'session start setup command hooks OK')
})

await test('Stop hooks block and prevent continuation', async () => {
  const output = await buildAndRunSnippet(
    'stop-hook-test',
    `process.env.CLAUDE_CONFIG_DIR = 'build-src/test-artifacts/stop-hook-config';
delete process.env.CLAUDE_CODE_SIMPLE;

const [
  { executeStopHooks, getStopHookMessage },
  { clearRegisteredHooks, registerHookCallbacks, setIsInteractive },
  { resetHooksConfigSnapshot },
] = await Promise.all([
  import('./src/utils/hooks.ts'),
  import('./src/bootstrap/state.ts'),
  import('./src/utils/hooks/hooksConfigSnapshot.ts'),
]);

setIsInteractive(false);
clearRegisteredHooks();
resetHooksConfigSnapshot();

const lastAssistantText = 'main stop assistant message marker 5831';
const blockReason = 'main stop block marker 5831';
const stopReason = 'main stop continuation marker 5831';
let calls = 0;
registerHookCallbacks({
  Stop: [
    {
      hooks: [
        {
          type: 'callback',
          callback: async hookInput => {
            calls += 1;
            if (hookInput.hook_event_name !== 'Stop') {
              throw new Error('unexpected stop event: ' + hookInput.hook_event_name);
            }
            if (hookInput.stop_hook_active !== false) {
              throw new Error('unexpected stop active flag: ' + hookInput.stop_hook_active);
            }
            if (hookInput.last_assistant_message !== lastAssistantText) {
              throw new Error('unexpected stop assistant text: ' + hookInput.last_assistant_message);
            }
            if (hookInput.permission_mode !== 'default') {
              throw new Error('unexpected stop permission mode: ' + hookInput.permission_mode);
            }
            return {
              continue: false,
              stopReason,
              decision: 'block',
              reason: blockReason,
            };
          },
        },
      ],
    },
  ],
});

let appState = {
  sessionHooks: new Map(),
  toolPermissionContext: {
    mode: 'default',
    additionalWorkingDirectories: new Map(),
    alwaysAllowRules: {},
    alwaysDenyRules: {},
    alwaysAskRules: {},
    isBypassPermissionsModeAvailable: false,
  },
};
const context = {
  abortController: new AbortController(),
  options: { isNonInteractiveSession: true },
  messages: [],
  getAppState() {
    return appState;
  },
  setAppState(updater) {
    appState = updater(appState);
  },
  updateAttributionState() {},
};
const messages = [
  {
    type: 'assistant',
    uuid: '00000000-0000-0000-0000-000000005831',
    timestamp: '2026-06-19T00:00:00.000Z',
    message: {
      id: 'msg_stop_5831',
      role: 'assistant',
      content: [{ type: 'text', text: lastAssistantText }],
    },
  },
];

const results = [];
for await (const result of executeStopHooks(
  'default',
  context.abortController.signal,
  10000,
  false,
  undefined,
  context,
  messages,
)) {
  results.push(result);
}
if (calls !== 1) {
  throw new Error('Stop hook should run once, got ' + calls);
}
const blocking = results.find(result =>
  result.blockingError?.blockingError === blockReason &&
  result.blockingError?.command === 'callback'
);
if (!blocking) {
  throw new Error('Stop hook should return blocking feedback: ' + JSON.stringify(results));
}
const blockedAttachment = results.find(result => {
  const attachment = result.message?.attachment;
  return (
    attachment?.type === 'hook_blocking_error' &&
    attachment.hookEvent === 'Stop' &&
    attachment.blockingError?.blockingError === blockReason
  );
});
if (!blockedAttachment) {
  throw new Error('Stop hook should return blocking attachment: ' + JSON.stringify(results));
}
const prevented = results.find(result =>
  result.preventContinuation === true &&
  result.stopReason === stopReason
);
if (!prevented) {
  throw new Error('Stop hook should prevent continuation: ' + JSON.stringify(results));
}
if (!getStopHookMessage({ blockingError: blockReason, command: 'callback' }).includes(blockReason)) {
  throw new Error('Stop hook message helper should include block reason');
}

console.log('stop hooks OK');`,
  )
  assert.equal(output, 'stop hooks OK')
})

await test('Stop command hooks block and prevent continuation', async () => {
  const output = await buildAndRunSnippet(
    'stop-command-hook-test',
    `const { mkdir, rm, writeFile } = await import('node:fs/promises');
const { join } = await import('node:path');

process.env.CLAUDE_CONFIG_DIR = 'build-src/test-artifacts/stop-command-hook-config';
delete process.env.CLAUDE_CODE_SIMPLE;

const commandDir = join(process.cwd(), 'build-src', 'test-artifacts', 'stop-command-hook-config');
await rm(commandDir, { recursive: true, force: true });
await mkdir(commandDir, { recursive: true });
const commandPath = join(commandDir, 'stop-command-hook.mjs');
const commandPathForHook = commandPath.replace(/\\\\/g, '/');
const lastAssistantText = 'main stop command assistant marker 1964';
const blockReason = 'main stop command block marker 1964';
const stopReason = 'main stop command continuation marker 1964';
await writeFile(
  commandPath,
  [
    "let input = '';",
    "for await (const chunk of process.stdin) input += chunk;",
    "const data = JSON.parse(input);",
    "if (data.hook_event_name !== 'Stop') { process.stderr.write('bad event ' + data.hook_event_name); process.exit(3); }",
    "if (data.stop_hook_active !== true) { process.stderr.write('bad active flag'); process.exit(4); }",
    "if (data.last_assistant_message !== '" + lastAssistantText + "') { process.stderr.write('bad assistant text'); process.exit(5); }",
    "if (data.permission_mode !== 'default') { process.stderr.write('bad permission mode'); process.exit(6); }",
    "process.stdout.write(JSON.stringify({ continue: false, stopReason: '" + stopReason + "', decision: 'block', reason: '" + blockReason + "' }));",
  ].join('\\n'),
  'utf8',
);

const [
  { executeStopHooks, getStopHookMessage },
  { clearRegisteredHooks, registerHookCallbacks, setIsInteractive },
  { resetHooksConfigSnapshot },
] = await Promise.all([
  import('./src/utils/hooks.ts'),
  import('./src/bootstrap/state.ts'),
  import('./src/utils/hooks/hooksConfigSnapshot.ts'),
]);

setIsInteractive(false);
clearRegisteredHooks();
resetHooksConfigSnapshot();

registerHookCallbacks({
  Stop: [
    {
      hooks: [
        {
          type: 'command',
          command: 'node ' + commandPathForHook,
          timeout: 5,
        },
      ],
    },
  ],
});

let appState = {
  sessionHooks: new Map(),
  toolPermissionContext: {
    mode: 'default',
    additionalWorkingDirectories: new Map(),
    alwaysAllowRules: {},
    alwaysDenyRules: {},
    alwaysAskRules: {},
    isBypassPermissionsModeAvailable: false,
  },
};
const context = {
  abortController: new AbortController(),
  options: { isNonInteractiveSession: true },
  messages: [],
  getAppState() {
    return appState;
  },
  setAppState(updater) {
    appState = updater(appState);
  },
  updateAttributionState() {},
};
const messages = [
  {
    type: 'assistant',
    uuid: '00000000-0000-0000-0000-000000001964',
    timestamp: '2026-06-19T00:00:00.000Z',
    message: {
      id: 'msg_stop_command_1964',
      role: 'assistant',
      content: [{ type: 'text', text: lastAssistantText }],
    },
  },
];

const results = [];
for await (const result of executeStopHooks(
  'default',
  context.abortController.signal,
  10000,
  true,
  undefined,
  context,
  messages,
)) {
  results.push(result);
}

const blocking = results.find(result =>
  result.blockingError?.blockingError === blockReason &&
  String(result.blockingError?.command).includes('stop-command-hook.mjs')
);
if (!blocking) {
  throw new Error('Stop command hook should return blocking feedback: ' + JSON.stringify(results));
}
const prevented = results.find(result =>
  result.preventContinuation === true &&
  result.stopReason === stopReason
);
if (!prevented) {
  throw new Error('Stop command hook should prevent continuation: ' + JSON.stringify(results));
}
if (!getStopHookMessage({ blockingError: blockReason, command: commandPathForHook }).includes(blockReason)) {
  throw new Error('Stop command hook message helper should include block reason');
}

console.log('stop command hook OK');`,
  )
  assert.equal(output, 'stop command hook OK')
})

await test('verify bundled skill assets are real text', async () => {
  const output = await buildAndRunSnippet(
    'verify-skill-assets-test',
    `const verifyContent = await import('./src/skills/bundled/verifyContent.ts');
if (!verifyContent.SKILL_MD.includes('description:')) throw new Error('missing skill frontmatter');
if (!verifyContent.SKILL_MD.includes('VerifyPlanExecution')) throw new Error('missing verify tool guidance');
if (!verifyContent.SKILL_FILES['examples/cli.md']?.includes('npm run check')) {
  throw new Error('missing CLI verification example');
}
if (!verifyContent.SKILL_FILES['examples/server.md']?.includes('server')) {
  throw new Error('missing server verification example');
}
console.log('verify skill assets OK');`,
  )
  assert.equal(output, 'verify skill assets OK')
})

await test('ultraplan prompt asset is real text', async () => {
  const promptPath = join(BUILD, 'src/utils/ultraplan/prompt.txt')
  const prompt = await readFile(promptPath, 'utf8')
  assert.match(prompt, /advanced remote planning session/)
  assert.match(prompt, /ExitPlanMode/)
  assert.doesNotMatch(prompt, /\bultraplan\b/i)

  const manifestEntry = manifest.entries.find(entry =>
    String(entry.path ?? '').includes('ultraplan/prompt.txt'),
  )
  assert.equal(manifestEntry, undefined)

  const output = await buildAndRunSnippet(
    'ultraplan-prompt-test',
    `import prompt from './src/utils/ultraplan/prompt.txt';
if (!prompt.includes('advanced remote planning session')) throw new Error('missing planning guidance');
if (!prompt.includes('ExitPlanMode')) throw new Error('missing ExitPlanMode guidance');
if (/\\bultraplan\\b/i.test(prompt)) throw new Error('prompt self-triggers keyword detection');
console.log('ultraplan prompt OK');`,
  )
  assert.equal(output, 'ultraplan prompt OK')
})

await test('snip runtime projects removed ranges and preserves tool pairs', async () => {
  const output = await buildAndRunSnippet(
    'snip-runtime-test',
    `process.env.CLAUDE_CODE_SNIP_TRIGGER_TOKENS = '1';
process.env.CLAUDE_CODE_SNIP_PROTECTED_TAIL_MESSAGES = '4';
process.env.CLAUDE_CODE_SNIP_MIN_REMOVED_MESSAGES = '2';
const snip = await import('./src/services/compact/snipCompact.ts');
const projection = await import('./src/services/compact/snipProjection.ts');

const user = (n, text = 'user message') => ({
  type: 'user',
  uuid: '00000000-0000-0000-0000-0000000000' + String(n).padStart(2, '0'),
  timestamp: '2026-06-16T00:00:00.000Z',
  message: { role: 'user', content: text.repeat(30) },
});
const assistant = n => ({
  type: 'assistant',
  uuid: '00000000-0000-0000-0000-0000000001' + String(n).padStart(2, '0'),
  timestamp: '2026-06-16T00:00:00.000Z',
  message: {
    id: 'msg_' + n,
    role: 'assistant',
    content: [{ type: 'text', text: ('assistant ' + n + ' ').repeat(30) }],
  },
});
const messages = [
  user(1), assistant(1),
  user(2), assistant(2),
  user(3), assistant(3),
  user(4), assistant(4),
  user(5), assistant(5),
  user(6), assistant(6),
];
const result = snip.snipCompactIfNeeded(messages);
if (!result.executed) throw new Error('snip should execute above threshold');
if (result.messages.length !== 4) throw new Error('expected protected tail only, got ' + result.messages.length);
if (!result.boundaryMessage?.snipMetadata?.removedUuids?.includes(messages[0].uuid)) {
  throw new Error('boundary did not record removed uuids');
}
const projected = projection.projectSnippedView([...messages, result.boundaryMessage]);
if (projected.some(message => message.uuid === messages[0].uuid)) {
  throw new Error('projection kept removed message');
}
if (!projected.some(message => message.uuid === result.boundaryMessage.uuid)) {
  throw new Error('projection should keep the boundary message');
}

process.env.CLAUDE_CODE_SNIP_PROTECTED_TAIL_MESSAGES = '9';
const toolMessages = [
  user(11),
  {
    type: 'assistant',
    uuid: '00000000-0000-0000-0000-000000000120',
    timestamp: '2026-06-16T00:00:00.000Z',
    message: {
      id: 'msg_tool',
      role: 'assistant',
      content: [{ type: 'tool_use', id: 'toolu_1', name: 'Read', input: {} }],
    },
  },
  {
    type: 'user',
    uuid: '00000000-0000-0000-0000-000000000121',
    timestamp: '2026-06-16T00:00:00.000Z',
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'ok' }] },
  },
  user(12), assistant(12), user(13), assistant(13), user(14), assistant(14), user(15), assistant(15),
];
const splitAttempt = snip.snipCompactIfNeeded(toolMessages, { force: true });
if (
  splitAttempt.boundaryMessage?.snipMetadata?.removedUuids?.includes('00000000-0000-0000-0000-000000000120') ||
  splitAttempt.boundaryMessage?.snipMetadata?.removedUuids?.includes('00000000-0000-0000-0000-000000000121')
) {
  throw new Error('snip should not remove only part of a tool_use/tool_result pair');
}

delete process.env.CLAUDE_CODE_SNIP_TRIGGER_TOKENS;
delete process.env.CLAUDE_CODE_SNIP_PROTECTED_TAIL_MESSAGES;
delete process.env.CLAUDE_CODE_SNIP_MIN_REMOVED_MESSAGES;
console.log('snip runtime OK');`,
  )
  assert.equal(output, 'snip runtime OK')
})

await test('snip targeted ids and boundary replay are deterministic', async () => {
  const output = await buildAndRunSnippet(
    'snip-targeted-replay-test',
    `process.env.CLAUDE_CODE_SNIP_PROTECTED_TAIL_MESSAGES = '2';
const snip = await import('./src/services/compact/snipCompact.ts');
const projection = await import('./src/services/compact/snipProjection.ts');

const user = n => ({
  type: 'user',
  uuid: '2000000' + n + '-0000-0000-0000-0000000000' + String(n).padStart(2, '0'),
  timestamp: '2026-06-16T00:00:00.000Z',
  message: { role: 'user', content: ('target user ' + n + ' ').repeat(20) },
});
const assistant = n => ({
  type: 'assistant',
  uuid: '3000000' + n + '-0000-0000-0000-0000000001' + String(n).padStart(2, '0'),
  timestamp: '2026-06-16T00:00:00.000Z',
  message: { id: 'msg_target_' + n, role: 'assistant', content: [{ type: 'text', text: ('target assistant ' + n + ' ').repeat(20) }] },
});
const messages = [
  user(1), assistant(1),
  user(2), assistant(2),
  user(3), assistant(3),
  user(4), assistant(4),
  user(5), assistant(5),
];
const targetId = snip.shortMessageIdForSnip(messages[2]);
const result = snip.snipCompactIfNeeded(messages, {
  force: true,
  trigger: 'tool',
  targetMessageIds: [targetId],
  reason: 'targeted cleanup',
});
if (!result.executed) throw new Error('targeted snip should execute');
if (result.strategy !== 'targeted_segments') throw new Error('bad strategy: ' + result.strategy);
if (!result.boundaryMessage.snipMetadata.targetMessageIds.includes(targetId)) {
  throw new Error('target id missing from metadata');
}
if (!result.boundaryMessage.snipMetadata.removedUuids.includes(messages[2].uuid)) {
  throw new Error('target user was not removed');
}
if (!result.boundaryMessage.snipMetadata.removedUuids.includes(messages[3].uuid)) {
  throw new Error('target assistant turn mate was not removed');
}
if (result.boundaryMessage.snipMetadata.removedUuids.includes(messages[0].uuid)) {
  throw new Error('unrelated old turn should not be removed by targeted snip');
}
const projected = projection.projectSnippedView([...messages, result.boundaryMessage]);
if (projected.some(message => message.uuid === messages[2].uuid || message.uuid === messages[3].uuid)) {
  throw new Error('projection kept targeted messages');
}
if (!projected.some(message => message.uuid === messages[0].uuid)) {
  throw new Error('projection removed unrelated message');
}

const replay = snip.replaySnipBoundary(messages, result.boundaryMessage);
if (!replay?.executed) throw new Error('boundary replay should execute');
if (!replay.messages.some(message => message.uuid === result.boundaryMessage.uuid)) {
  throw new Error('replay should append the original boundary');
}
if (replay.messages.some(message => message.uuid === messages[2].uuid || message.uuid === messages[3].uuid)) {
  throw new Error('replay did not remove boundary uuids');
}
if (!replay.messages.some(message => message.uuid === messages[0].uuid)) {
  throw new Error('replay recomputed and removed unrelated history');
}

delete process.env.CLAUDE_CODE_SNIP_PROTECTED_TAIL_MESSAGES;
console.log('snip targeted replay OK');`,
  )
  assert.equal(output, 'snip targeted replay OK')
})

await test('snip transcript resume filters removed ranges and relinks parents', async () => {
  const output = await buildAndRunSnippet(
    'snip-transcript-resume-test',
    `import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
const { buildConversationChain, loadTranscriptFile } = await import('./src/utils/sessionStorage.ts');

const sessionId = '40000000-0000-4000-8000-000000000001';
const timestamp = '2026-06-17T00:00:00.000Z';
const base = { timestamp, sessionId, cwd: process.cwd(), version: '2.1.88', userType: 'external' };
const user = (uuid, parentUuid, text) => ({
  ...base,
  type: 'user',
  uuid,
  parentUuid,
  message: { role: 'user', content: text },
});
const assistant = (uuid, parentUuid, text) => ({
  ...base,
  type: 'assistant',
  uuid,
  parentUuid,
  message: { id: 'msg_' + uuid.slice(0, 8), role: 'assistant', content: [{ type: 'text', text }] },
});
const ids = {
  u1: '40000000-0000-4000-8000-000000000101',
  a1: '40000000-0000-4000-8000-000000000102',
  u2: '40000000-0000-4000-8000-000000000103',
  a2: '40000000-0000-4000-8000-000000000104',
  u3: '40000000-0000-4000-8000-000000000105',
  a3: '40000000-0000-4000-8000-000000000106',
  u4: '40000000-0000-4000-8000-000000000107',
  a4: '40000000-0000-4000-8000-000000000108',
  boundary: '40000000-0000-4000-8000-000000000109',
  u5: '40000000-0000-4000-8000-000000000110',
  a5: '40000000-0000-4000-8000-000000000111',
};
const entries = [
  user(ids.u1, null, 'keep one'),
  assistant(ids.a1, ids.u1, 'keep one answer'),
  user(ids.u2, ids.a1, 'remove two'),
  assistant(ids.a2, ids.u2, 'remove two answer'),
  user(ids.u3, ids.a2, 'keep three'),
  assistant(ids.a3, ids.u3, 'keep three answer'),
  user(ids.u4, ids.a3, 'remove four'),
  assistant(ids.a4, ids.u4, 'remove four answer'),
  {
    ...base,
    type: 'system',
    subtype: 'snip_boundary',
    uuid: ids.boundary,
    parentUuid: ids.a4,
    content: 'Conversation history snipped',
    level: 'info',
    snipMetadata: {
      trigger: 'auto',
      strategy: 'auto_segments',
      removedUuids: [ids.u2, ids.a2, ids.u4, ids.a4],
      removedMessages: 4,
      tokensFreed: 123,
      removedRanges: [
        { startUuid: ids.u2, endUuid: ids.a2, messages: 2, tokensFreed: 50 },
        { startUuid: ids.u4, endUuid: ids.a4, messages: 2, tokensFreed: 73 },
      ],
    },
  },
  user(ids.u5, ids.boundary, 'keep five'),
  assistant(ids.a5, ids.u5, 'keep five answer'),
];
const file = join(process.cwd(), 'build-src', 'test-artifacts', 'snip-resume.jsonl');
await writeFile(file, entries.map(entry => JSON.stringify(entry)).join('\\n'));

const loaded = await loadTranscriptFile(file);
for (const removed of [ids.u2, ids.a2, ids.u4, ids.a4]) {
  if (loaded.messages.has(removed)) throw new Error('removed message survived resume: ' + removed);
}
if (loaded.messages.get(ids.u3)?.parentUuid !== ids.a1) {
  throw new Error('first survivor was not relinked across removed range');
}
if (loaded.messages.get(ids.boundary)?.parentUuid !== ids.a3) {
  throw new Error('snip boundary was not relinked across removed tail');
}
if (!loaded.leafUuids.has(ids.a5)) {
  throw new Error('latest assistant should remain resume leaf');
}
const chain = buildConversationChain(loaded.messages, loaded.messages.get(ids.a5));
const chainIds = chain.map(message => message.uuid);
const expected = [ids.u1, ids.a1, ids.u3, ids.a3, ids.boundary, ids.u5, ids.a5];
if (JSON.stringify(chainIds) !== JSON.stringify(expected)) {
  throw new Error('bad resumed chain: ' + JSON.stringify(chainIds));
}
console.log('snip transcript resume OK');`,
  )
  assert.equal(output, 'snip transcript resume OK')
})

await test('resume entrypoints load snipped jsonl without removed history', async () => {
  const output = await buildAndRunSnippet(
    'snip-resume-entrypoints-test',
    `process.env.CLAUDE_CODE_SIMPLE = '1';
import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
const { loadConversationForResume } = await import('./src/utils/conversationRecovery.ts');
const { getSessionIdFromLog, loadTranscriptFromFile } = await import('./src/utils/sessionStorage.ts');

const sessionId = '42000000-0000-4000-8000-000000000001';
const base = { sessionId, cwd: process.cwd(), version: '2.1.88', userType: 'external' };
const ts = n => '2026-06-17T00:00:' + String(n).padStart(2, '0') + '.000Z';
const user = (uuid, parentUuid, n, text) => ({
  ...base,
  type: 'user',
  uuid,
  parentUuid,
  timestamp: ts(n),
  message: { role: 'user', content: text },
});
const assistant = (uuid, parentUuid, n, text) => ({
  ...base,
  type: 'assistant',
  uuid,
  parentUuid,
  timestamp: ts(n),
  message: { id: 'msg_' + uuid.slice(0, 8), role: 'assistant', content: [{ type: 'text', text }] },
});
const ids = {
  u1: '42000000-0000-4000-8000-000000000101',
  a1: '42000000-0000-4000-8000-000000000102',
  u2: '42000000-0000-4000-8000-000000000103',
  a2: '42000000-0000-4000-8000-000000000104',
  u3: '42000000-0000-4000-8000-000000000105',
  a3: '42000000-0000-4000-8000-000000000106',
  boundary: '42000000-0000-4000-8000-000000000107',
  u4: '42000000-0000-4000-8000-000000000108',
  a4: '42000000-0000-4000-8000-000000000109',
};
const entries = [
  user(ids.u1, null, 1, 'keep one'),
  assistant(ids.a1, ids.u1, 2, 'keep one answer'),
  user(ids.u2, ids.a1, 3, 'remove two'),
  assistant(ids.a2, ids.u2, 4, 'remove two answer'),
  user(ids.u3, ids.a2, 5, 'keep three'),
  assistant(ids.a3, ids.u3, 6, 'keep three answer'),
  {
    ...base,
    type: 'system',
    subtype: 'snip_boundary',
    uuid: ids.boundary,
    parentUuid: ids.a3,
    timestamp: ts(7),
    content: 'Conversation history snipped',
    level: 'info',
    snipMetadata: {
      trigger: 'auto',
      strategy: 'auto_segments',
      removedUuids: [ids.u2, ids.a2],
      removedMessages: 2,
      tokensFreed: 80,
    },
  },
  user(ids.u4, ids.boundary, 8, 'keep four'),
  assistant(ids.a4, ids.u4, 9, 'keep four answer'),
];
const file = join(process.cwd(), 'build-src', 'test-artifacts', 'snip-resume-entrypoints.jsonl');
await rm(file, { force: true });
await writeFile(file, entries.map(entry => JSON.stringify(entry)).join('\\n') + '\\n');

function assertExpected(messages, label) {
  const idsInResult = messages.map(message => message.uuid).filter(Boolean);
  for (const removed of [ids.u2, ids.a2]) {
    if (idsInResult.includes(removed)) {
      throw new Error(label + ' brought back removed message ' + removed);
    }
  }
  const expected = [ids.u1, ids.a1, ids.u3, ids.a3, ids.boundary, ids.u4, ids.a4];
  if (JSON.stringify(idsInResult) !== JSON.stringify(expected)) {
    throw new Error(label + ' bad message chain: ' + JSON.stringify(idsInResult));
  }
}

const resumed = await loadConversationForResume('unused-session-id', file);
if (!resumed) throw new Error('loadConversationForResume returned null');
if (resumed.sessionId !== sessionId) {
  throw new Error('resume should report leaf session id');
}
if (resumed.turnInterruptionState.kind !== 'none') {
  throw new Error('resume should not synthesize interruption state');
}
assertExpected(resumed.messages, 'loadConversationForResume');

const imported = await loadTranscriptFromFile(file);
if (getSessionIdFromLog(imported) !== sessionId) {
  throw new Error('loadTranscriptFromFile should report leaf session id');
}
assertExpected(imported.messages, 'loadTranscriptFromFile');

console.log('snip resume entrypoints OK');`,
  )
  assert.equal(output, 'snip resume entrypoints OK')
})

await test('resume detects prompt interrupted before assistant response', async () => {
  const output = await buildAndRunSnippet(
    'interrupted-prompt-resume-test',
    `process.env.CLAUDE_CODE_SIMPLE = '1';
import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
const { loadConversationForResume } = await import('./src/utils/conversationRecovery.ts');

const sessionId = '42500000-0000-4000-8000-000000000001';
const prompt = 'interrupted prompt should auto resume exactly once';
const userUuid = '42500000-0000-4000-8000-000000000101';
const entry = {
  sessionId,
  cwd: process.cwd(),
  version: '2.1.88',
  userType: 'external',
  type: 'user',
  uuid: userUuid,
  parentUuid: null,
  timestamp: '2026-06-17T00:00:00.000Z',
  message: { role: 'user', content: prompt },
};
const file = join(process.cwd(), 'build-src', 'test-artifacts', 'interrupted-prompt-resume.jsonl');
await rm(file, { force: true });
await writeFile(file, JSON.stringify(entry) + '\\n');

const resumed = await loadConversationForResume('unused-session-id', file);
if (!resumed) throw new Error('loadConversationForResume returned null');
if (resumed.sessionId !== sessionId) {
  throw new Error('resume should preserve interrupted session id');
}
if (resumed.turnInterruptionState.kind !== 'interrupted_prompt') {
  throw new Error('expected interrupted_prompt, got ' + resumed.turnInterruptionState.kind);
}
if (resumed.turnInterruptionState.message.uuid !== userUuid) {
  throw new Error('interrupted state should point at original user message');
}

const textFromContent = content => {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map(block => block?.text ?? '').join('\\n');
};
const visibleUsers = resumed.messages.filter(
  message => message.type === 'user' && !message.isMeta,
);
if (visibleUsers.length !== 1) {
  throw new Error('expected one visible user message, got ' + visibleUsers.length);
}
if (textFromContent(visibleUsers[0].message.content) !== prompt) {
  throw new Error('visible user prompt changed during resume');
}
const assistantSentinels = resumed.messages.filter(
  message =>
    message.type === 'assistant' &&
    textFromContent(message.message.content) === 'No response requested.',
);
if (assistantSentinels.length !== 1) {
  throw new Error('expected one synthetic assistant sentinel, got ' + assistantSentinels.length);
}
console.log('interrupted prompt resume OK');`,
  )
  assert.equal(output, 'interrupted prompt resume OK')
})

await test('resume drops unresolved trailing tool use after interrupted tool execution', async () => {
  const output = await buildAndRunSnippet(
    'interrupted-tool-use-resume-test',
    `process.env.CLAUDE_CODE_SIMPLE = '1';
import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
const { loadConversationForResume } = await import('./src/utils/conversationRecovery.ts');

const sessionId = '42600000-0000-4000-8000-000000000001';
const prompt = 'interrupted tool use should not resume with orphan tool_use';
const ids = {
  user: '42600000-0000-4000-8000-000000000101',
  assistantTool: '42600000-0000-4000-8000-000000000102',
};
const base = {
  sessionId,
  cwd: process.cwd(),
  version: '2.1.88',
  userType: 'external',
};
const entries = [
  {
    ...base,
    type: 'user',
    uuid: ids.user,
    parentUuid: null,
    timestamp: '2026-06-17T00:00:00.000Z',
    message: { role: 'user', content: prompt },
  },
  {
    ...base,
    type: 'assistant',
    uuid: ids.assistantTool,
    parentUuid: ids.user,
    timestamp: '2026-06-17T00:00:01.000Z',
    message: {
      id: 'msg_interrupted_tool',
      role: 'assistant',
      content: [
        { type: 'tool_use', id: 'toolu_interrupted_read', name: 'Read', input: { file_path: 'missing.txt' } },
      ],
      stop_reason: null,
      stop_sequence: null,
      usage: {
        input_tokens: 10,
        output_tokens: 5,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    },
  },
];
const file = join(process.cwd(), 'build-src', 'test-artifacts', 'interrupted-tool-use-resume.jsonl');
await rm(file, { force: true });
await writeFile(file, entries.map(entry => JSON.stringify(entry)).join('\\n') + '\\n');

const resumed = await loadConversationForResume('unused-session-id', file);
if (!resumed) throw new Error('loadConversationForResume returned null');
if (resumed.turnInterruptionState.kind !== 'interrupted_prompt') {
  throw new Error('expected interrupted_prompt, got ' + resumed.turnInterruptionState.kind);
}
if (resumed.turnInterruptionState.message.uuid !== ids.user) {
  throw new Error('interrupted state should resume original user prompt');
}

const textFromContent = content => {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map(block => block?.text ?? '').join('\\n');
};
const serialized = JSON.stringify(resumed.messages);
if (serialized.includes('toolu_interrupted_read')) {
  throw new Error('orphan tool_use survived resume');
}
const visibleUsers = resumed.messages.filter(
  message => message.type === 'user' && !message.isMeta,
);
if (visibleUsers.length !== 1 || textFromContent(visibleUsers[0].message.content) !== prompt) {
  throw new Error('original prompt should be preserved exactly once');
}
const assistantSentinels = resumed.messages.filter(
  message =>
    message.type === 'assistant' &&
    textFromContent(message.message.content) === 'No response requested.',
);
if (assistantSentinels.length !== 1) {
  throw new Error('expected one synthetic assistant sentinel, got ' + assistantSentinels.length);
}
console.log('interrupted tool use resume OK');`,
  )
  assert.equal(output, 'interrupted tool use resume OK')
})

await test('resume session id and continue load snipped project session', async () => {
  const output = await buildAndRunSnippet(
    'snip-resume-session-continue-test',
    `import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const configDir = join(process.cwd(), 'build-src', 'test-artifacts', 'snip-resume-config');
await rm(configDir, { recursive: true, force: true });
process.env.CLAUDE_CONFIG_DIR = configDir;
process.env.CLAUDE_CODE_SIMPLE = '1';

const { loadConversationForResume } = await import('./src/utils/conversationRecovery.ts');
const { getProjectDir } = await import('./src/utils/sessionStorage.ts');

const sessionId = '43000000-0000-4000-8000-000000000001';
const base = { sessionId, cwd: process.cwd(), version: '2.1.88', userType: 'external' };
const ts = n => '2026-06-17T00:01:' + String(n).padStart(2, '0') + '.000Z';
const user = (uuid, parentUuid, n, text) => ({
  ...base,
  type: 'user',
  uuid,
  parentUuid,
  timestamp: ts(n),
  message: { role: 'user', content: text },
});
const assistant = (uuid, parentUuid, n, text) => ({
  ...base,
  type: 'assistant',
  uuid,
  parentUuid,
  timestamp: ts(n),
  message: { id: 'msg_' + uuid.slice(0, 8), role: 'assistant', content: [{ type: 'text', text }] },
});
const ids = {
  u1: '43000000-0000-4000-8000-000000000101',
  a1: '43000000-0000-4000-8000-000000000102',
  u2: '43000000-0000-4000-8000-000000000103',
  a2: '43000000-0000-4000-8000-000000000104',
  u3: '43000000-0000-4000-8000-000000000105',
  a3: '43000000-0000-4000-8000-000000000106',
  boundary: '43000000-0000-4000-8000-000000000107',
  u4: '43000000-0000-4000-8000-000000000108',
  a4: '43000000-0000-4000-8000-000000000109',
};
const entries = [
  user(ids.u1, null, 1, 'resume session keep one'),
  assistant(ids.a1, ids.u1, 2, 'resume session keep one answer'),
  user(ids.u2, ids.a1, 3, 'resume session remove two'),
  assistant(ids.a2, ids.u2, 4, 'resume session remove two answer'),
  user(ids.u3, ids.a2, 5, 'resume session keep three'),
  assistant(ids.a3, ids.u3, 6, 'resume session keep three answer'),
  {
    ...base,
    type: 'system',
    subtype: 'snip_boundary',
    uuid: ids.boundary,
    parentUuid: ids.a3,
    timestamp: ts(7),
    content: 'Conversation history snipped',
    level: 'info',
    snipMetadata: {
      trigger: 'auto',
      strategy: 'auto_segments',
      removedUuids: [ids.u2, ids.a2],
      removedMessages: 2,
      tokensFreed: 64,
    },
  },
  user(ids.u4, ids.boundary, 8, 'resume session keep four'),
  assistant(ids.a4, ids.u4, 9, 'resume session keep four answer'),
];
const projectDir = getProjectDir(process.cwd());
await mkdir(projectDir, { recursive: true });
const file = join(projectDir, sessionId + '.jsonl');
await writeFile(file, entries.map(entry => JSON.stringify(entry)).join('\\n') + '\\n');

function assertExpected(result, label) {
  if (!result) throw new Error(label + ' returned null');
  if (result.sessionId !== sessionId) {
    throw new Error(label + ' should preserve session id, got ' + result.sessionId);
  }
  if (result.turnInterruptionState.kind !== 'none') {
    throw new Error(label + ' should not synthesize interruption state');
  }
  const idsInResult = result.messages.map(message => message.uuid).filter(Boolean);
  for (const removed of [ids.u2, ids.a2]) {
    if (idsInResult.includes(removed)) {
      throw new Error(label + ' brought back removed message ' + removed);
    }
  }
  const expected = [ids.u1, ids.a1, ids.u3, ids.a3, ids.boundary, ids.u4, ids.a4];
  if (JSON.stringify(idsInResult) !== JSON.stringify(expected)) {
    throw new Error(label + ' bad message chain: ' + JSON.stringify(idsInResult));
  }
}

assertExpected(await loadConversationForResume(sessionId, undefined), 'session-id resume');
assertExpected(await loadConversationForResume(undefined, undefined), 'continue resume');

console.log('snip resume session continue OK');`,
  )
  assert.equal(output, 'snip resume session continue OK')
})

await test('snip resume composes with preserved compact boundary', async () => {
  const output = await buildAndRunSnippet(
    'snip-compact-compose-resume-test',
    `process.env.CLAUDE_CODE_SIMPLE = '1';
import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
const { loadConversationForResume } = await import('./src/utils/conversationRecovery.ts');
const { buildConversationChain, loadTranscriptFile } = await import('./src/utils/sessionStorage.ts');

const sessionId = '44000000-0000-4000-8000-000000000001';
const base = { sessionId, cwd: process.cwd(), version: '2.1.88', userType: 'external' };
const ts = n => '2026-06-17T00:02:' + String(n).padStart(2, '0') + '.000Z';
const user = (uuid, parentUuid, n, text) => ({
  ...base,
  type: 'user',
  uuid,
  parentUuid,
  timestamp: ts(n),
  message: { role: 'user', content: text },
});
const assistant = (uuid, parentUuid, n, text) => ({
  ...base,
  type: 'assistant',
  uuid,
  parentUuid,
  timestamp: ts(n),
  message: { id: 'msg_' + uuid.slice(0, 8), role: 'assistant', content: [{ type: 'text', text }] },
});
const ids = {
  u1: '44000000-0000-4000-8000-000000000101',
  a1: '44000000-0000-4000-8000-000000000102',
  u2: '44000000-0000-4000-8000-000000000103',
  a2: '44000000-0000-4000-8000-000000000104',
  compact: '44000000-0000-4000-8000-000000000105',
  u3: '44000000-0000-4000-8000-000000000106',
  a3: '44000000-0000-4000-8000-000000000107',
  u4: '44000000-0000-4000-8000-000000000108',
  a4: '44000000-0000-4000-8000-000000000109',
  snip: '44000000-0000-4000-8000-000000000110',
  u5: '44000000-0000-4000-8000-000000000111',
  a5: '44000000-0000-4000-8000-000000000112',
};
const entries = [
  user(ids.u1, null, 1, 'pre compact prune one'),
  assistant(ids.a1, ids.u1, 2, 'pre compact prune one answer'),
  user(ids.u2, ids.a1, 3, 'pre compact preserved two'),
  assistant(ids.a2, ids.u2, 4, 'pre compact preserved two answer'),
  {
    ...base,
    type: 'system',
    subtype: 'compact_boundary',
    uuid: ids.compact,
    parentUuid: null,
    logicalParentUuid: ids.a2,
    timestamp: ts(5),
    content: 'Conversation compacted',
    level: 'info',
    compactMetadata: {
      trigger: 'auto',
      messagesSummarized: 2,
      preservedSegment: {
        anchorUuid: ids.compact,
        headUuid: ids.u2,
        tailUuid: ids.a2,
      },
    },
  },
  user(ids.u3, ids.compact, 6, 'post compact snip remove three'),
  assistant(ids.a3, ids.u3, 7, 'post compact snip remove three answer'),
  user(ids.u4, ids.a3, 8, 'post compact keep four'),
  assistant(ids.a4, ids.u4, 9, 'post compact keep four answer'),
  {
    ...base,
    type: 'system',
    subtype: 'snip_boundary',
    uuid: ids.snip,
    parentUuid: ids.a4,
    timestamp: ts(10),
    content: 'Conversation history snipped',
    level: 'info',
    snipMetadata: {
      trigger: 'auto',
      strategy: 'auto_segments',
      removedUuids: [ids.u3, ids.a3],
      removedMessages: 2,
      tokensFreed: 72,
    },
  },
  user(ids.u5, ids.snip, 11, 'post snip keep five'),
  assistant(ids.a5, ids.u5, 12, 'post snip keep five answer'),
];
const file = join(process.cwd(), 'build-src', 'test-artifacts', 'snip-compact-compose.jsonl');
await rm(file, { force: true });
await writeFile(file, entries.map(entry => JSON.stringify(entry)).join('\\n') + '\\n');

const loaded = await loadTranscriptFile(file);
for (const removed of [ids.u1, ids.a1, ids.u3, ids.a3]) {
  if (loaded.messages.has(removed)) {
    throw new Error('compact+snip resume kept removed message ' + removed);
  }
}
if (loaded.messages.get(ids.u2)?.parentUuid !== ids.compact) {
  throw new Error('preserved compact head should relink to compact boundary');
}
if (loaded.messages.get(ids.u4)?.parentUuid !== ids.a2) {
  throw new Error('snip survivor should relink through compact preserved tail');
}
const chain = buildConversationChain(loaded.messages, loaded.messages.get(ids.a5));
const chainIds = chain.map(message => message.uuid);
const expected = [ids.compact, ids.u2, ids.a2, ids.u4, ids.a4, ids.snip, ids.u5, ids.a5];
if (JSON.stringify(chainIds) !== JSON.stringify(expected)) {
  throw new Error('bad compact+snip chain: ' + JSON.stringify(chainIds));
}

const resumed = await loadConversationForResume('unused-session-id', file);
if (!resumed) throw new Error('loadConversationForResume returned null');
const resumedIds = resumed.messages.map(message => message.uuid).filter(Boolean);
if (JSON.stringify(resumedIds) !== JSON.stringify(expected)) {
  throw new Error('bad compact+snip resumed messages: ' + JSON.stringify(resumedIds));
}

console.log('snip compact compose resume OK');`,
  )
  assert.equal(output, 'snip compact compose resume OK')
})

await test('recordTranscript persists snip boundary once and chains survivors', async () => {
  const output = await buildAndRunSnippet(
    'snip-record-transcript-test',
    `import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { switchSession } from './src/bootstrap/state.ts';
const {
  buildConversationChain,
  clearSessionMessagesCache,
  flushSessionStorage,
  loadTranscriptFile,
  recordTranscript,
  resetProjectForTesting,
  setSessionFileForTesting,
} = await import('./src/utils/sessionStorage.ts');

const sessionId = '41000000-0000-4000-8000-000000000001';
const file = join(process.cwd(), 'build-src', 'test-artifacts', 'snip-record.jsonl');
await rm(file, { force: true });
switchSession(sessionId, null);
resetProjectForTesting();
clearSessionMessagesCache();
setSessionFileForTesting(file);

const timestamp = '2026-06-17T00:00:00.000Z';
const user = (uuid, text) => ({
  type: 'user',
  uuid,
  timestamp,
  message: { role: 'user', content: text },
});
const assistant = (uuid, text) => ({
  type: 'assistant',
  uuid,
  timestamp,
  message: { id: 'msg_' + uuid.slice(0, 8), role: 'assistant', content: [{ type: 'text', text }] },
});
const ids = {
  u1: '41000000-0000-4000-8000-000000000101',
  a1: '41000000-0000-4000-8000-000000000102',
  u2: '41000000-0000-4000-8000-000000000103',
  a2: '41000000-0000-4000-8000-000000000104',
  boundary: '41000000-0000-4000-8000-000000000105',
  u3: '41000000-0000-4000-8000-000000000106',
  a3: '41000000-0000-4000-8000-000000000107',
};
const baseMessages = [
  user(ids.u1, 'keep one'),
  assistant(ids.a1, 'keep one answer'),
  user(ids.u2, 'remove two'),
  assistant(ids.a2, 'remove two answer'),
];
const boundary = {
  type: 'system',
  subtype: 'snip_boundary',
  uuid: ids.boundary,
  timestamp,
  content: 'Conversation history snipped',
  level: 'info',
  snipMetadata: {
    trigger: 'auto',
    strategy: 'auto_segments',
    removedUuids: [ids.u2, ids.a2],
    removedMessages: 2,
    tokensFreed: 99,
  },
};
const tail = [user(ids.u3, 'keep three'), assistant(ids.a3, 'keep three answer')];

await recordTranscript(baseMessages);
await recordTranscript([baseMessages[0], baseMessages[1], boundary, ...tail]);
await recordTranscript([baseMessages[0], baseMessages[1], boundary, ...tail]);
await flushSessionStorage();

const lines = (await readFile(file, 'utf8')).trim().split('\\n').filter(Boolean);
const entries = lines.map(line => JSON.parse(line));
const counts = new Map();
for (const entry of entries) {
  if (!entry.uuid) continue;
  counts.set(entry.uuid, (counts.get(entry.uuid) ?? 0) + 1);
}
for (const [uuid, count] of counts) {
  if (count !== 1) throw new Error('duplicate transcript uuid ' + uuid + ': ' + count);
}
const boundaryEntry = entries.find(entry => entry.uuid === ids.boundary);
if (boundaryEntry?.parentUuid !== ids.a1) {
  throw new Error('boundary parent should chain from last kept prefix');
}
const u3Entry = entries.find(entry => entry.uuid === ids.u3);
if (u3Entry?.parentUuid !== ids.boundary) {
  throw new Error('tail user should chain from boundary');
}

const loaded = await loadTranscriptFile(file);
if (loaded.messages.has(ids.u2) || loaded.messages.has(ids.a2)) {
  throw new Error('resume load should filter removed messages');
}
const chain = buildConversationChain(loaded.messages, loaded.messages.get(ids.a3));
const chainIds = chain.map(message => message.uuid);
const expected = [ids.u1, ids.a1, ids.boundary, ids.u3, ids.a3];
if (JSON.stringify(chainIds) !== JSON.stringify(expected)) {
  throw new Error('bad persisted chain: ' + JSON.stringify(chainIds));
}
console.log('snip record transcript OK');
process.exit(0);`,
  )
  assert.equal(output, 'snip record transcript OK')
})

await test('SnipTool and force-snip command are loadable', async () => {
  const output = await buildAndRunSnippet(
    'snip-tool-command-test',
    `process.env.CLAUDE_CODE_SNIP_PROTECTED_TAIL_MESSAGES = '4';
const { SnipTool } = await import('./src/tools/SnipTool/SnipTool.ts');
const forceSnip = (await import('./src/commands/force-snip.ts')).default;
const snip = await import('./src/services/compact/snipCompact.ts');

const user = n => ({
  type: 'user',
  uuid: '10000000-0000-0000-0000-0000000000' + String(n).padStart(2, '0'),
  timestamp: '2026-06-16T00:00:00.000Z',
  message: { role: 'user', content: ('user ' + n + ' ').repeat(25) },
});
const assistant = n => ({
  type: 'assistant',
  uuid: '10000000-0000-0000-0000-0000000001' + String(n).padStart(2, '0'),
  timestamp: '2026-06-16T00:00:00.000Z',
  message: { id: 'msg_' + n, role: 'assistant', content: [{ type: 'text', text: ('assistant ' + n + ' ').repeat(25) }] },
});
const messages = [
  user(1), assistant(1), user(2), assistant(2), user(3), assistant(3),
  user(4), assistant(4), user(5), assistant(5), user(6), assistant(6),
];

if (SnipTool.name !== 'Snip') throw new Error('bad tool name');
if (!SnipTool.isEnabled()) throw new Error('SnipTool should be enabled by default');
if (!SnipTool.isReadOnly({}) || !SnipTool.isConcurrencySafe({})) {
  throw new Error('SnipTool should be read-only and concurrency-safe');
}
const result = await SnipTool.call({ reason: 'stale context' }, { messages });
if (!result.data.executed || result.data.removedMessages <= 0 || result.newMessages?.length !== 1) {
  throw new Error('SnipTool did not append a boundary: ' + JSON.stringify(result.data));
}
if (result.data.strategy !== 'auto_segments') {
  throw new Error('SnipTool should use auto segment strategy by default');
}

const targetId = snip.shortMessageIdForSnip(messages[2]);
const targetedResult = await SnipTool.call({ reason: 'targeted stale context', targetIds: [targetId] }, { messages });
if (targetedResult.data.strategy !== 'targeted_segments' || targetedResult.newMessages?.length !== 1) {
  throw new Error('SnipTool targetIds did not use targeted strategy');
}
if (!targetedResult.newMessages[0].snipMetadata.removedUuids.includes(messages[2].uuid)) {
  throw new Error('SnipTool targetIds did not remove requested turn');
}

let appended = 0;
const module = await forceSnip.load();
const commandResult = await module.call('--id ' + targetId + ' manual test', {
  messages,
  setMessages(updater) {
    const next = updater(messages);
    appended = next.length - messages.length;
  },
});
if (commandResult.type !== 'text' || !commandResult.value.includes('Snipped') || appended !== 1) {
  throw new Error('force-snip command failed');
}

delete process.env.CLAUDE_CODE_SNIP_PROTECTED_TAIL_MESSAGES;
console.log('snip tool command OK');`,
  )
  assert.equal(output, 'snip tool command OK')
})

await test('textual tool-call leak detector is conservative', async () => {
  const output = await buildAndRunSnippet(
    'textual-tool-call-leak-test',
    `import { detectTextualToolCallLeak } from './src/utils/textualToolCallLeak.ts';
const tools = [
  { name: 'Read' },
  { name: 'Bash', aliases: ['Shell'] },
];
const leaked = detectTextualToolCallLeak('I will inspect the file.\\nCalling: Read\\n{"file_path":"src/index.ts"}', tools);
if (!leaked || leaked.toolName !== 'Read' || leaked.callCount !== 1) {
  throw new Error('failed to detect textual Read call leak: ' + JSON.stringify(leaked));
}
const sameLine = detectTextualToolCallLeak('Calling: Shell {"command":"pwd"}', tools);
if (!sameLine || sameLine.toolName !== 'Bash') {
  throw new Error('failed to resolve alias textual call leak');
}
const unknown = detectTextualToolCallLeak('Calling: Unknown\\n{"x":1}', tools);
if (unknown !== null) throw new Error('unknown tool should not trigger');
const malformed = detectTextualToolCallLeak('Calling: Read\\nnot json', tools);
if (malformed !== null) throw new Error('malformed JSON should not trigger');
const quoted = detectTextualToolCallLeak('The log line was Calling: Read and it means a tool would be called.', tools);
if (quoted !== null) throw new Error('plain discussion should not trigger');
console.log('textual tool call leak OK');`,
  )
  assert.equal(output, 'textual tool call leak OK')
})

await test('interactive streaming text stays visible and live-pinned', async () => {
  const replSource = await readFile(join(BUILD, 'src/screens/REPL.tsx'), 'utf8')
  assert.match(
    replSource,
    /const visibleStreamingText = streamingText && showStreamingText \? streamingText : null/,
    'interactive streaming text should not be truncated to complete lines',
  )
  assert.doesNotMatch(
    replSource,
    /visibleStreamingText[\s\S]{0,200}lastIndexOf\('\\n'\)/,
    'visible streaming text should not hide the unfinished line',
  )
  assert.match(
    replSource,
    /const maybeRepinLiveScroll = useCallback/,
    'interactive UI should keep live output pinned when the user has not scrolled away',
  )
  assert.match(
    replSource,
    /lastMsgIsAssistant[\s\S]{0,200}maybeRepinLiveScroll\(\)/,
    'assistant message commits should have a live-scroll backstop',
  )
  assert.match(
    replSource,
    /streamingText && showStreamingText[\s\S]{0,200}maybeRepinLiveScroll\(\)/,
    'streaming text updates should have a live-scroll backstop',
  )
})

await test('interactive Messages renders unfinished streaming text', async () => {
  const output = await buildAndRunSnippet(
    'messages-streaming-text-render-test',
    `import * as React from 'react';
import { PassThrough, Writable } from 'node:stream';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

process.env.CLAUDE_CONFIG_DIR = join(process.cwd(), 'build-src', 'test-artifacts', 'messages-config');
await mkdir(process.env.CLAUDE_CONFIG_DIR, { recursive: true });

const { enableConfigs } = await import('./src/utils/config.ts');
enableConfigs();
const { renderSync } = await import('./src/ink/root.ts');
const { Messages } = await import('./src/components/Messages.tsx');
const { AppStateProvider, getDefaultAppState } = await import('./src/state/AppState.tsx');

class CaptureStream extends Writable {
  constructor() {
    super();
    this.chunks = [];
    this.columns = 100;
    this.rows = 30;
    this.isTTY = true;
  }
  _write(chunk, _encoding, callback) {
    this.chunks.push(Buffer.from(chunk).toString('utf8'));
    callback();
  }
  get output() {
    return this.chunks.join('');
  }
}

const stdout = new CaptureStream();
const stderr = new CaptureStream();
const stdin = new PassThrough();
stdin.isTTY = true;
stdin.setRawMode = () => stdin;
stdin.ref = () => stdin;
stdin.unref = () => stdin;
stdin.setEncoding('utf8');

const tail = 'streaming tail without newline marker-9421';
const instance = renderSync(
  React.createElement(
    AppStateProvider,
    { initialState: getDefaultAppState() },
    React.createElement(Messages, {
      messages: [],
      tools: [],
      commands: [],
      verbose: false,
      toolJSX: null,
      toolUseConfirmQueue: [],
      inProgressToolUseIDs: new Set(),
      isMessageSelectorVisible: false,
      conversationId: 'test-conversation',
      screen: 'main',
      streamingToolUses: [],
      isLoading: true,
      hideLogo: true,
      streamingText: tail,
      disableRenderCap: true,
    }),
  ),
  { stdout, stderr, stdin, exitOnCtrlC: false, patchConsole: false },
);

await new Promise(resolve => setTimeout(resolve, 50));
instance.unmount();
instance.cleanup();

const normalizedOutput = stdout.output
  .replace(/\\x1b\\[(\\d+)C/g, (_, count) => ' '.repeat(Number(count)))
  .replace(/\\x1b\\[[0-?]*[ -/]*[@-~]/g, '')
  .replace(/\\r/g, '');
if (!normalizedOutput.includes(tail)) {
  throw new Error('missing streaming tail in rendered output: ' + JSON.stringify(stdout.output));
}
console.log('messages streaming render OK');`,
    {
      banner: {
        js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
      },
    },
  )
  assert.match(output, /messages streaming render OK$/)
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

await test('generated build has no snip variable-path requires', async () => {
  const text = await readFile(DIST_CLI, 'utf8')
  assert.doesNotMatch(text, /__require\(\s*snip(?:Projection|Compact|BoundaryMessage)ModulePath/)
  assert.doesNotMatch(text, /snip(?:Projection|Compact|BoundaryMessage)ModulePath\s*=/)
})

await test('generated build has no MCP skill variable-path requires', async () => {
  const text = await readFile(DIST_CLI, 'utf8')
  assert.doesNotMatch(text, /mcpSkillsModulePath\s*=/)
  assert.doesNotMatch(text, /__require\(\s*mcpSkillsModulePath/)
})

await test('skill search is preserved and wired into the tool pool', async () => {
  const text = await readFile(DIST_CLI, 'utf8')
  assert.match(text, /DiscoverSkills/, 'dist should include DiscoverSkills when skill search is preserved')
  assert.doesNotMatch(text, /services\/skillSearch\/localSearch\.d\.ts/)

  const output = await buildAndRunSnippet(
    'skill-search-tool-pool-test',
    `import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
process.env.CLAUDE_CONFIG_DIR = join(process.cwd(), 'build-src', 'test-artifacts', 'skill-search-tool-pool-config');
await mkdir(process.env.CLAUDE_CONFIG_DIR, { recursive: true });
const { enableConfigs } = await import('./src/utils/config.ts');
enableConfigs();
const { getTools } = await import('./src/tools.ts');
const { getEmptyToolPermissionContext } = await import('./src/Tool.ts');
const { DISCOVER_SKILLS_TOOL_NAME } = await import('./src/tools/DiscoverSkillsTool/prompt.ts');
const { isSkillSearchEnabled } = await import('./src/services/skillSearch/featureCheck.ts');
delete process.env.CLAUDE_CODE_DISABLE_SKILL_SEARCH;
delete process.env.DISABLE_SKILL_SEARCH;
delete process.env.CLAUDE_CODE_EXPERIMENTAL_SKILL_SEARCH;
if (!isSkillSearchEnabled()) throw new Error('skill search should be enabled by default');
process.env.CLAUDE_CODE_DISABLE_SKILL_SEARCH = '1';
if (isSkillSearchEnabled()) throw new Error('disable env should turn skill search off');
delete process.env.CLAUDE_CODE_DISABLE_SKILL_SEARCH;
const names = getTools(getEmptyToolPermissionContext()).map(tool => tool.name);
if (!names.includes(DISCOVER_SKILLS_TOOL_NAME)) {
  throw new Error('DiscoverSkills missing from tool pool: ' + names.join(','));
}
console.log('skill search tool pool OK');`,
  )
  assert.equal(output, 'skill search tool pool OK')
})

await test('local skill search and DiscoverSkills surface matching MCP skills', async () => {
  const output = await buildAndRunSnippet(
    'skill-search-runtime-test',
    `import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
process.env.CLAUDE_CONFIG_DIR = join(process.cwd(), 'build-src', 'test-artifacts', 'skill-search-config');
await mkdir(process.env.CLAUDE_CONFIG_DIR, { recursive: true });
const { enableConfigs } = await import('./src/utils/config.ts');
enableConfigs();
const { normalizeSkillSearchQuery, normalizeSkillSearchOutputText, searchSkillIndex, clearSkillIndexCache } = await import('./src/services/skillSearch/localSearch.ts');
const { getTurnZeroSkillDiscovery, startSkillDiscoveryPrefetch } = await import('./src/services/skillSearch/prefetch.ts');
const { DiscoverSkillsTool } = await import('./src/tools/DiscoverSkillsTool/DiscoverSkillsTool.ts');
const normalizedSearchQuery = normalizeSkillSearchQuery(' alpha' + String.fromCharCode(10, 0) + 'metrics' + String.fromCharCode(9) + 'x'.repeat(1200));
if (
  normalizedSearchQuery.includes(String.fromCharCode(10)) ||
  normalizedSearchQuery.includes(String.fromCharCode(9)) ||
  normalizedSearchQuery.includes(String.fromCharCode(0))
) {
  throw new Error('skill search query normalization kept control chars');
}
if (normalizedSearchQuery.length !== 1000) {
  throw new Error('skill search query normalization did not cap length: ' + normalizedSearchQuery.length);
}
const normalizedOutputText = normalizeSkillSearchOutputText(' alpha' + String.fromCharCode(10, 9, 0) + 'metrics ' + 'x'.repeat(1200), 1000);
if (
  normalizedOutputText.includes(String.fromCharCode(10)) ||
  normalizedOutputText.includes(String.fromCharCode(9)) ||
  normalizedOutputText.includes(String.fromCharCode(0))
) {
  throw new Error('skill search output normalization kept control chars');
}
if (normalizedOutputText.length !== 1000) {
  throw new Error('skill search output normalization did not cap length: ' + normalizedOutputText.length);
}
const fakeSkill = {
  type: 'prompt',
  name: 'mcp:alpha-observability',
  description: 'Inspect alpha' + String.fromCharCode(10, 0) + 'observability telemetry pipelines',
  whenToUse: 'Use for frobnicate latency traces' + String.fromCharCode(9) + 'and alpha metrics review ' + 'z'.repeat(1200),
  progressMessage: 'Loading alpha skill',
  contentLength: 10,
  source: 'mcp',
  loadedFrom: 'mcp',
  getPromptForCommand: async () => [],
};
const appState = { mcp: { commands: [fakeSkill] } };
const context = {
  discoveredSkillNames: new Set(),
  getAppState: () => appState,
  setAppState: () => {},
  options: { tools: [], commands: [], mainLoopModel: 'claude-sonnet-4-6' },
};
clearSkillIndexCache();
const direct = await searchSkillIndex(process.cwd(), 'frobnicate telemetry alpha', {
  extraCommands: [fakeSkill],
  maxResults: 3,
});
if (direct[0]?.name !== fakeSkill.name) {
  throw new Error('direct search missed fake skill: ' + direct.map(result => result.name).join(','));
}
const clamped = await searchSkillIndex(process.cwd(), 'frobnicate telemetry alpha', {
  extraCommands: [fakeSkill],
  maxResults: -10,
});
if (clamped[0]?.name !== fakeSkill.name) {
  throw new Error('negative maxResults should clamp to at least one result');
}
const discovered = await getTurnZeroSkillDiscovery('Need frobnicate latency telemetry', [], context);
if (discovered.length !== 1 || discovered[0].type !== 'skill_discovery') {
  throw new Error('expected one skill discovery attachment');
}
if (discovered[0].skills[0]?.name !== fakeSkill.name) {
  throw new Error('wrong discovered skill: ' + JSON.stringify(discovered[0]));
}
const discoveredDescription = discovered[0].skills[0]?.description ?? '';
if (
  discoveredDescription.includes(String.fromCharCode(10)) ||
  discoveredDescription.includes(String.fromCharCode(9)) ||
  discoveredDescription.includes(String.fromCharCode(0))
) {
  throw new Error('skill discovery attachment leaked control chars: ' + JSON.stringify(discoveredDescription));
}
if (discoveredDescription.length > 1000) {
  throw new Error('skill discovery attachment description was not capped: ' + discoveredDescription.length);
}
const repeated = await getTurnZeroSkillDiscovery('Need frobnicate latency telemetry', [], context);
if (repeated.length !== 0) {
  throw new Error('discovered skills should be de-duplicated');
}
const emptyDiscovery = await getTurnZeroSkillDiscovery(null, [], context);
if (emptyDiscovery.length !== 0) {
  throw new Error('null turn-zero input should not discover skills');
}
context.discoveredSkillNames.clear();
const toolResult = await DiscoverSkillsTool.call({ query: 'alpha metrics review', max_results: 99 }, context);
if (toolResult.data.skills[0]?.name !== fakeSkill.name) {
  throw new Error('DiscoverSkills missed fake skill: ' + JSON.stringify(toolResult.data));
}
const toolDescription = toolResult.data.skills[0]?.description ?? '';
if (
  toolDescription.includes(String.fromCharCode(10)) ||
  toolDescription.includes(String.fromCharCode(9)) ||
  toolDescription.includes(String.fromCharCode(0))
) {
  throw new Error('DiscoverSkills output leaked control chars: ' + JSON.stringify(toolDescription));
}
if (toolDescription.length > 1000) {
  throw new Error('DiscoverSkills output description was not capped: ' + toolDescription.length);
}
const toolBlock = DiscoverSkillsTool.mapToolResultToToolResultBlockParam(toolResult.data, 'toolu_1');
if (typeof toolBlock.content !== 'string' || !toolBlock.content.includes(fakeSkill.name)) {
  throw new Error('DiscoverSkills tool result did not mention skill');
}
if (String(toolBlock.content).includes(String.fromCharCode(9)) || String(toolBlock.content).includes(String.fromCharCode(0))) {
  throw new Error('DiscoverSkills tool result leaked a control character');
}
const noisyQuery = '  alpha' + String.fromCharCode(10, 0) + 'metrics' + String.fromCharCode(9) + 'x'.repeat(1200);
const noisyResult = await DiscoverSkillsTool.call({ query: noisyQuery, max_results: 1 }, context);
if (
  noisyResult.data.query.includes(String.fromCharCode(10)) ||
  noisyResult.data.query.includes(String.fromCharCode(9)) ||
  noisyResult.data.query.includes(String.fromCharCode(0))
) {
  throw new Error('DiscoverSkills query was not sanitized: ' + JSON.stringify(noisyResult.data.query));
}
if (noisyResult.data.query.length !== 1000) {
  throw new Error('DiscoverSkills query was not capped: ' + noisyResult.data.query.length);
}
const noisyBlock = DiscoverSkillsTool.mapToolResultToToolResultBlockParam(noisyResult.data, 'toolu_2');
if (String(noisyBlock.content).includes(String.fromCharCode(9)) || String(noisyBlock.content).includes(String.fromCharCode(0))) {
  throw new Error('DiscoverSkills tool result leaked a control character');
}
const nullPrefetch = startSkillDiscoveryPrefetch(null, [{
  type: 'user',
  uuid: '00000000-0000-4000-8000-000000000001',
  timestamp: new Date().toISOString(),
  message: { role: 'user', content: null },
}], context);
if (nullPrefetch !== null) {
  throw new Error('null user text should not start skill prefetch');
}
console.log('skill search runtime OK');`,
  )
  assert.equal(output, 'skill search runtime OK')
})

await test('Chrome MCP external shim starts empty in-process server', async () => {
  const output = await buildAndRunSnippet(
    'chrome-mcp-shim-test',
    `import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { createClaudeForChromeMcpServer, BROWSER_TOOLS } from '@ant/claude-for-chrome-mcp';
import { createLinkedTransportPair } from './src/services/mcp/InProcessTransport.ts';
const warnings = [];
const server = createClaudeForChromeMcpServer({
  serverName: 'Chrome shim test',
  logger: { warn(message) { warnings.push(String(message)); } },
});
if (!Array.isArray(BROWSER_TOOLS) || BROWSER_TOOLS.length !== 0) throw new Error('shim should expose zero browser tools');
if (typeof server.connect !== 'function') throw new Error('shim server is not connectable');
const client = new Client({ name: 'chrome-shim-test-client', version: '0.0.0' }, { capabilities: {} });
const [clientTransport, serverTransport] = createLinkedTransportPair();
await server.connect(serverTransport);
await client.connect(clientTransport);
const listed = await client.listTools();
if (!listed || !Array.isArray(listed.tools)) throw new Error('missing tools list');
if (listed.tools.length !== 0) throw new Error('shim should list zero tools');
let callError;
try {
  await client.callTool({ name: 'browser_snapshot', arguments: {} });
} catch (error) {
  callError = error;
}
if (!callError || !String(callError.message).includes('browser_snapshot')) throw new Error('missing explicit tool-call error');
if (!warnings.some(message => message.includes('private package is unavailable'))) throw new Error('missing shim warning');
await client.close();
await server.close();
console.log('chrome mcp shim OK');`,
  )
  assert.equal(output, 'chrome mcp shim OK')
})

await test('MCP skill resources become safe prompt commands', async () => {
  const output = await buildAndRunSnippet(
    'mcp-skills-test',
    `import './src/skills/loadSkillsDir.ts';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { ListResourcesRequestSchema, ReadResourceRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { createLinkedTransportPair } from './src/services/mcp/InProcessTransport.ts';
import { fetchMcpSkillsForClient, getMcpSkillCacheKey, getSkillResourceSkipReason } from './src/skills/mcpSkills.ts';
import { getMcpSkillCommands } from './src/commands.ts';

let listCount = 0;
let alphaReadCount = 0;
let blobReadCount = 0;
let hugeReadCount = 0;
let betaListCount = 0;
let betaReadCount = 0;
if (getSkillResourceSkipReason({ uri: 'skill://alpha/SKILL.md' }) !== null) throw new Error('valid skill uri rejected');
if (!getSkillResourceSkipReason({ uri: 'skill://' })?.includes('no skill identifier')) throw new Error('empty skill uri accepted');
if (!getSkillResourceSkipReason({ uri: 'skill://bad\\nname/SKILL.md' })?.includes('control characters')) throw new Error('control char uri accepted');
if (!getSkillResourceSkipReason({ uri: 'skill://' + 'a'.repeat(2050) })?.includes('exceeds')) throw new Error('long skill uri accepted');
const server = new Server(
  { name: 'mcp-skill-fixture', version: '0.0.0' },
  { capabilities: { resources: { listChanged: true } } },
);
server.setRequestHandler(ListResourcesRequestSchema, () => {
  listCount += 1;
  return {
    resources: [
      {
        uri: 'skill://alpha/SKILL.md',
        name: 'Alpha Skill',
        description: 'resource fallback description',
        mimeType: 'text/markdown',
      },
      {
        uri: 'skill://blob/SKILL.md',
        name: 'Blob Skill',
        description: 'blob should be skipped',
        mimeType: 'application/octet-stream',
      },
      {
        uri: 'skill://huge/SKILL.md',
        name: 'Huge Skill',
        description: 'oversized text should be skipped',
        mimeType: 'text/markdown',
      },
      {
        uri: 'file://regular-note.md',
        name: 'Regular note',
        description: 'not a skill resource',
        mimeType: 'text/markdown',
      },
    ],
  };
});
server.setRequestHandler(ReadResourceRequestSchema, request => {
  if (request.params.uri === 'skill://alpha/SKILL.md') {
    alphaReadCount += 1;
    return {
      contents: [
        {
          uri: request.params.uri,
          mimeType: 'text/markdown',
          text: [
            '---',
            'name: Alpha Display',
            'description: Run alpha task',
            'allowed-tools:',
            '  - Read',
            '  - Bash',
            'arguments: target',
            'model: sonnet',
            'context: fork',
            'agent: general-purpose',
            'effort: high',
            'shell: powershell',
            'user-invocable: false',
            '---',
            'Use $target to inspect.',
            '',
            '!\`echo should-not-run\`',
          ].join('\\n'),
        },
      ],
    };
  }
  if (request.params.uri === 'skill://blob/SKILL.md') {
    blobReadCount += 1;
    return {
      contents: [
        {
          uri: request.params.uri,
          mimeType: 'application/octet-stream',
          blob: 'AQID',
        },
      ],
    };
  }
  if (request.params.uri === 'skill://huge/SKILL.md') {
    hugeReadCount += 1;
    return {
      contents: [
        {
          uri: request.params.uri,
          mimeType: 'text/markdown',
          text: 'x'.repeat(100001),
        },
      ],
    };
  }
  throw new Error('unexpected resource read: ' + request.params.uri);
});

const client = new Client({ name: 'mcp-skill-client', version: '0.0.0' }, { capabilities: {} });
const [clientTransport, serverTransport] = createLinkedTransportPair();
await server.connect(serverTransport);
await client.connect(clientTransport);

const connection = {
  name: 'Skill Server',
  type: 'connected',
  client,
  capabilities: { resources: { listChanged: true } },
  config: { type: 'sdk' },
  cleanup: async () => {},
};
const commands = await fetchMcpSkillsForClient(connection);
if (commands.length !== 1) throw new Error('expected one text skill, got ' + commands.length);
const skill = commands[0];
if (skill.name !== 'Skill_Server:Alpha_Skill') throw new Error('bad skill name: ' + skill.name);
if (skill.userFacingName() !== 'Alpha Display') throw new Error('bad display name: ' + skill.userFacingName());
if (skill.description !== 'Run alpha task') throw new Error('bad description: ' + skill.description);
if (skill.loadedFrom !== 'mcp' || skill.source !== 'mcp') throw new Error('bad mcp markers');
if (!skill.isHidden || skill.userInvocable !== false) throw new Error('user-invocable=false should hide skill');
if (skill.allowedTools?.length) throw new Error('mcp skills must not grant allowed tools');
if (skill.model !== undefined) throw new Error('mcp skills must not override model');
if (skill.context !== undefined || skill.agent !== undefined) throw new Error('mcp skills must not force forked execution');
if (skill.effort !== undefined) throw new Error('mcp skills must not override effort');
if (skill.hooks !== undefined) throw new Error('mcp skills must not register hooks');
if (!getMcpSkillCommands(commands).some(command => command.name === skill.name)) throw new Error('mcp skill filter missed command');
const prompt = await skill.getPromptForCommand('target-file', {});
const text = prompt.map(block => block.type === 'text' ? block.text : '').join('\\n');
if (!text.includes('Use target-file to inspect.')) throw new Error('argument substitution failed: ' + text);
if (!text.includes('should-not-run')) throw new Error('mcp skill shell syntax should remain inert text');

await fetchMcpSkillsForClient(connection);
if (listCount !== 1 || alphaReadCount !== 1 || blobReadCount !== 1 || hugeReadCount !== 1) {
  throw new Error('cache miss unexpectedly repeated list/read calls');
}
const cacheKey = getMcpSkillCacheKey(connection);
if (cacheKey === connection.name) throw new Error('mcp skill cache key should include config hash');
fetchMcpSkillsForClient.cache.delete(cacheKey);
await fetchMcpSkillsForClient(connection);
if (listCount !== 2 || alphaReadCount !== 2 || blobReadCount !== 2 || hugeReadCount !== 2) {
  throw new Error('cache delete did not force refresh');
}

const server2 = new Server(
  { name: 'mcp-skill-fixture-2', version: '0.0.0' },
  { capabilities: { resources: { listChanged: true } } },
);
server2.setRequestHandler(ListResourcesRequestSchema, () => {
  betaListCount += 1;
  return {
    resources: [
      {
        uri: 'skill://beta/SKILL.md',
        name: 'Beta Skill',
        description: 'second server skill',
        mimeType: 'text/markdown',
      },
    ],
  };
});
server2.setRequestHandler(ReadResourceRequestSchema, request => {
  if (request.params.uri !== 'skill://beta/SKILL.md') {
    throw new Error('unexpected second resource read: ' + request.params.uri);
  }
  betaReadCount += 1;
  return {
    contents: [
      {
        uri: request.params.uri,
        mimeType: 'text/markdown',
        text: [
          '---',
          'name: Beta Display',
          'description: Run beta task',
          '---',
          'Use beta skill.',
        ].join('\\n'),
      },
    ],
  };
});
const client2 = new Client({ name: 'mcp-skill-client-2', version: '0.0.0' }, { capabilities: {} });
const [clientTransport2, serverTransport2] = createLinkedTransportPair();
await server2.connect(serverTransport2);
await client2.connect(clientTransport2);
const connection2 = {
  name: 'Skill Server',
  type: 'connected',
  client: client2,
  capabilities: { resources: { listChanged: true } },
  config: { type: 'sdk', name: 'second' },
  cleanup: async () => {},
};
const betaCommands = await fetchMcpSkillsForClient(connection2);
if (betaCommands[0]?.name !== 'Skill_Server:Beta_Skill') {
  throw new Error('same-name mcp skill cache reused another server result: ' + betaCommands.map(command => command.name).join(','));
}
if (betaListCount !== 1 || betaReadCount !== 1) {
  throw new Error('same-name mcp skill server was not fetched independently');
}
await client2.close();
await server2.close();
await client.close();
await server.close();
console.log('mcp skills OK');`,
    {
      banner: {
        js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
      },
    },
  )
  assert.equal(output, 'mcp skills OK')
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

await test('ripgrep command avoids missing vendored binary', async () => {
  const output = await buildAndRunSnippet(
    'ripgrep-command-test',
    `import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { ripgrepCommand, getRipgrepStatus } from './src/utils/ripgrep.ts';
const { rgPath, rgArgs } = ripgrepCommand();
if (rgPath.includes('vendor') && !existsSync(rgPath)) {
  throw new Error('ripgrep points at missing vendor binary: ' + rgPath);
}
const result = spawnSync(rgPath, [...rgArgs, '--version'], { encoding: 'utf8' });
if (result.status !== 0 || !String(result.stdout).startsWith('ripgrep ')) {
  throw new Error('ripgrep version check failed: ' + JSON.stringify({
    rgPath,
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    error: result.error?.message,
  }));
}
const status = getRipgrepStatus();
if (status.mode === 'builtin' && !existsSync(status.path)) {
  throw new Error('builtin ripgrep status points at missing binary: ' + status.path);
}
console.log('ripgrep command OK');`,
  )
  assert.equal(output, 'ripgrep command OK')
})

await test('markdown config loader preflights missing directories before ripgrep', async () => {
  const source = await readFile(
    join(BUILD, 'src/utils/markdownConfigLoader.ts'),
    'utf8',
  )
  assert.match(
    source,
    /async function canSearchMarkdownDir/,
    'markdown loader should have a directory preflight helper',
  )
  assert.match(
    source,
    /if \(!\(await canSearchMarkdownDir\(dir\)\)\) {\s+return \[\]\s+}/,
    'markdown loader should skip missing dirs before spawning ripgrep',
  )
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
