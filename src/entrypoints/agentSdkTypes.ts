/**
 * Main entrypoint for Claude Code Agent SDK types.
 *
 * This file re-exports the public SDK API from:
 * - sdk/coreTypes.ts - Common serializable types (messages, configs)
 * - sdk/runtimeTypes.ts - Non-serializable types (callbacks, interfaces)
 *
 * SDK builders who need control protocol types should import from
 * sdk/controlTypes.ts directly.
 */

import type {
  CallToolResult,
  JSONRPCMessage,
  ToolAnnotations,
} from '@modelcontextprotocol/sdk/types.js'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'crypto'
import { createInterface } from 'node:readline'
import { hostname } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod/v4'

// Control protocol types for SDK builders (bridge subpath consumers)
/** @alpha */
export type {
  SDKControlRequest,
  SDKControlResponse,
} from './sdk/controlTypes.js'
// Re-export core types (common serializable types)
export * from './sdk/coreTypes.js'
// Re-export runtime types (callbacks, interfaces with methods)
export * from './sdk/runtimeTypes.js'

// Re-export settings types (generated from settings JSON schema)
export type { Settings } from './sdk/settingsTypes.generated.js'
// Re-export tool types (all marked @internal until SDK API stabilizes)
export * from './sdk/toolTypes.js'

// ============================================================================
// Functions
// ============================================================================

import type {
  SDKMessage,
  SDKResultMessage,
  SDKSessionInfo,
  SDKUserMessage,
} from './sdk/coreTypes.js'
import type {
  SDKControlRequest,
  SDKControlResponse,
} from './sdk/controlTypes.js'
import {
  forkSessionImpl,
  getSessionMessagesImpl,
  getSessionInfoImpl,
  listSessionsImpl,
  renameSessionImpl,
  tagSessionImpl,
} from '../utils/listSessionsImpl.js'
import { cronToHuman } from '../utils/cron.js'
import { createCronScheduler } from '../utils/cronScheduler.js'
// Import types needed for function signatures
import type {
  AnyZodRawShape,
  ForkSessionOptions,
  ForkSessionResult,
  GetSessionInfoOptions,
  GetSessionMessagesOptions,
  InferShape,
  InternalOptions,
  InternalQuery,
  ListSessionsOptions,
  McpSdkServerConfigWithInstance,
  Options,
  Query,
  SDKSession,
  SDKSessionOptions,
  SdkMcpToolDefinition,
  SessionMessage,
  SessionMutationOptions,
} from './sdk/runtimeTypes.js'

export type {
  ListSessionsOptions,
  GetSessionInfoOptions,
  SessionMutationOptions,
  ForkSessionOptions,
  ForkSessionResult,
  SDKSessionInfo,
}

export function tool<Schema extends AnyZodRawShape>(
  name: string,
  description: string,
  inputSchema: Schema,
  handler: (
    args: InferShape<Schema>,
    extra: unknown,
  ) => Promise<CallToolResult>,
  extras?: {
    annotations?: ToolAnnotations
    searchHint?: string
    alwaysLoad?: boolean
  },
): SdkMcpToolDefinition<Schema> {
  if (name.trim().length === 0) throw new Error('Tool name cannot be empty')
  return {
    name,
    description,
    inputSchema,
    handler,
    ...(extras?.annotations !== undefined && {
      annotations: extras.annotations,
    }),
    ...(extras?.searchHint !== undefined && { searchHint: extras.searchHint }),
    ...(extras?.alwaysLoad !== undefined && { alwaysLoad: extras.alwaysLoad }),
  }
}

type CreateSdkMcpServerOptions = {
  name: string
  version?: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tools?: Array<SdkMcpToolDefinition<any>>
}

/**
 * Creates an MCP server instance that can be used with the SDK transport.
 * This allows SDK users to define custom tools that run in the same process.
 *
 * If your SDK MCP calls will run longer than 60s, override CLAUDE_CODE_STREAM_CLOSE_TIMEOUT
 */
export function createSdkMcpServer(
  options: CreateSdkMcpServerOptions,
): McpSdkServerConfigWithInstance {
  if (options.name.trim().length === 0) {
    throw new Error('SDK MCP server name cannot be empty')
  }
  const instance = {
    name: options.name,
    version: options.version,
    tools: options.tools ?? [],
  }
  return {
    type: 'sdk',
    name: options.name,
    ...(options.version !== undefined && { version: options.version }),
    tools: instance.tools,
    instance,
  }
}

export class AbortError extends Error {}

type QueryParams = {
  prompt: string | AsyncIterable<SDKUserMessage>
  options?: Options
}

type SdkQueryOptions = Record<string, unknown> & {
  canUseTool?: (
    request: Extract<
      SDKControlRequest['request'],
      { subtype: 'can_use_tool' }
    >,
  ) => Promise<unknown> | unknown
}

type SdkServerRuntime = {
  name: string
  version?: string
  tools: Array<SdkMcpToolDefinition<any>>
}

type CliCommand = {
  command: string
  args: string[]
}

const DEFAULT_STDERR_LIMIT = 20_000

type PendingPrompt = {
  resolve: (message: SDKResultMessage) => void
  reject: (error: unknown) => void
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringOption(
  options: Record<string, unknown>,
  ...names: string[]
): string | undefined {
  for (const name of names) {
    const value = options[name]
    if (typeof value === 'string' && value.length > 0) return value
  }
  return undefined
}

function numberOption(
  options: Record<string, unknown>,
  ...names: string[]
): number | undefined {
  for (const name of names) {
    const value = options[name]
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }
  return undefined
}

function booleanOption(
  options: Record<string, unknown>,
  ...names: string[]
): boolean {
  return names.some(name => options[name] === true)
}

function stringArrayOption(
  options: Record<string, unknown>,
  ...names: string[]
): string[] | undefined {
  for (const name of names) {
    const value = options[name]
    if (Array.isArray(value)) {
      const strings = value
        .filter((item): item is string => typeof item === 'string')
        .filter(item => item.length > 0)
      if (strings.length > 0) return strings
    }
    if (typeof value === 'string' && value.length > 0) {
      return value
        .split(',')
        .map(item => item.trim())
        .filter(Boolean)
    }
  }
  return undefined
}

function appendStringFlag(
  args: string[],
  options: Record<string, unknown>,
  flag: string,
  ...names: string[]
): void {
  const value = stringOption(options, ...names)
  if (value !== undefined) args.push(flag, value)
}

function appendNumberFlag(
  args: string[],
  options: Record<string, unknown>,
  flag: string,
  ...names: string[]
): void {
  const value = numberOption(options, ...names)
  if (value !== undefined) args.push(flag, String(value))
}

function appendBooleanFlag(
  args: string[],
  options: Record<string, unknown>,
  flag: string,
  ...names: string[]
): void {
  if (booleanOption(options, ...names)) args.push(flag)
}

function appendStringArrayFlag(
  args: string[],
  options: Record<string, unknown>,
  flag: string,
  ...names: string[]
): void {
  const values = stringArrayOption(options, ...names)
  if (values && values.length > 0) args.push(flag, ...values)
}

function jsonOption(value: unknown): string | undefined {
  if (typeof value === 'string' && value.length > 0) return value
  if (isRecord(value) || Array.isArray(value)) return JSON.stringify(value)
  return undefined
}

function getDefaultCliPath(): string {
  const envPath = process.env.CLAUDE_CODE_SDK_CLI_PATH
  if (envPath && envPath.length > 0) return envPath
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'dist', 'cli.js')
}

function getCliCommand(options: Record<string, unknown>): CliCommand {
  const executable = stringOption(options, 'executable')
  const executableArgs = stringArrayOption(options, 'executableArgs') ?? []
  if (executable) {
    return { command: executable, args: executableArgs }
  }

  const cliPath = stringOption(
    options,
    'pathToClaudeCodeExecutable',
    'cliPath',
  ) ?? getDefaultCliPath()
  return {
    command: process.execPath,
    args: [cliPath],
  }
}

function getSdkServerRuntime(value: unknown): SdkServerRuntime | undefined {
  if (!isRecord(value)) return undefined
  const instance = isRecord(value.instance) ? value.instance : undefined
  const name =
    stringOption(value, 'name') ??
    (instance ? stringOption(instance, 'name') : undefined)
  if (!name) return undefined

  const directTools = Array.isArray(value.tools) ? value.tools : undefined
  const instanceTools =
    instance && Array.isArray(instance.tools) ? instance.tools : undefined
  const tools = (directTools ?? instanceTools ?? []).filter(
    (tool): tool is SdkMcpToolDefinition<any> => isRecord(tool),
  )

  return {
    name,
    version:
      stringOption(value, 'version') ??
      (instance ? stringOption(instance, 'version') : undefined),
    tools,
  }
}

function splitMcpServers(options: Record<string, unknown>): {
  sdkServers: Map<string, SdkServerRuntime>
  externalServers: Record<string, unknown>
} {
  const sdkServers = new Map<string, SdkServerRuntime>()
  const externalServers: Record<string, unknown> = {}
  const raw = options.mcpServers
  if (!isRecord(raw)) {
    return { sdkServers, externalServers }
  }

  for (const [key, value] of Object.entries(raw)) {
    const runtime = getSdkServerRuntime(value)
    if (isRecord(value) && (value.type === 'sdk' || runtime)) {
      if (runtime) {
        sdkServers.set(runtime.name || key, { ...runtime, name: runtime.name || key })
      } else {
        sdkServers.set(key, { name: key, tools: [] })
      }
      continue
    }
    externalServers[key] = value
  }

  return { sdkServers, externalServers }
}

function appendMcpConfigArgs(
  args: string[],
  options: Record<string, unknown>,
  externalServers: Record<string, unknown>,
): void {
  const explicit = options.mcpConfig ?? options.mcpConfigs
  const explicitValues = Array.isArray(explicit) ? explicit : explicit ? [explicit] : []
  for (const value of explicitValues) {
    const encoded = jsonOption(value)
    if (encoded) args.push('--mcp-config', encoded)
  }
  if (Object.keys(externalServers).length > 0) {
    args.push('--mcp-config', JSON.stringify({ mcpServers: externalServers }))
  }
}

function buildCliArgs(
  options: Record<string, unknown>,
  externalServers: Record<string, unknown>,
): string[] {
  const args = [
    '-p',
    '--output-format',
    'stream-json',
    '--input-format',
    'stream-json',
    '--verbose',
  ]

  appendBooleanFlag(args, options, '--bare', 'bare')
  appendBooleanFlag(
    args,
    options,
    '--include-hook-events',
    'includeHookEvents',
  )
  appendBooleanFlag(
    args,
    options,
    '--include-partial-messages',
    'includePartialMessages',
  )
  appendBooleanFlag(args, options, '--replay-user-messages', 'replayUserMessages')
  appendBooleanFlag(args, options, '--enable-auth-status', 'enableAuthStatus')
  appendBooleanFlag(
    args,
    options,
    '--dangerously-skip-permissions',
    'dangerouslySkipPermissions',
  )
  appendBooleanFlag(
    args,
    options,
    '--allow-dangerously-skip-permissions',
    'allowDangerouslySkipPermissions',
  )
  appendBooleanFlag(args, options, '--strict-mcp-config', 'strictMcpConfig')
  appendBooleanFlag(args, options, '--no-session-persistence', 'noSessionPersistence')
  appendBooleanFlag(args, options, '--fork-session', 'forkSession')

  if (options.continue === true) args.push('--continue')
  const resume = options.resume
  if (resume === true) args.push('--resume')
  else if (typeof resume === 'string' && resume.length > 0) {
    args.push('--resume', resume)
  }

  appendStringFlag(args, options, '--model', 'model')
  appendStringFlag(args, options, '--fallback-model', 'fallbackModel')
  appendStringFlag(args, options, '--permission-mode', 'permissionMode')
  appendStringFlag(args, options, '--system-prompt', 'systemPrompt')
  appendStringFlag(args, options, '--append-system-prompt', 'appendSystemPrompt')
  appendStringFlag(args, options, '--permission-prompt-tool', 'permissionPromptTool')
  appendStringFlag(args, options, '--session-id', 'sessionId')
  appendStringFlag(args, options, '--settings', 'settings')
  appendStringFlag(args, options, '--agent', 'agent')
  appendStringFlag(args, options, '--workload', 'workload')
  appendStringFlag(args, options, '--thinking', 'thinking')
  appendStringFlag(args, options, '--resume-session-at', 'resumeSessionAt')
  appendStringFlag(args, options, '--rewind-files', 'rewindFiles')
  appendStringFlag(args, options, '--setting-sources', 'settingSources')
  appendStringFlag(args, options, '--name', 'name')

  appendNumberFlag(args, options, '--max-turns', 'maxTurns')
  appendNumberFlag(args, options, '--max-budget-usd', 'maxBudgetUsd')
  appendNumberFlag(args, options, '--max-thinking-tokens', 'maxThinkingTokens')
  appendNumberFlag(args, options, '--task-budget', 'taskBudget')

  appendStringArrayFlag(args, options, '--allowedTools', 'allowedTools')
  appendStringArrayFlag(args, options, '--disallowedTools', 'disallowedTools')
  appendStringArrayFlag(args, options, '--tools', 'tools')
  appendStringArrayFlag(args, options, '--betas', 'betas')
  appendStringArrayFlag(args, options, '--add-dir', 'addDir', 'addDirs')
  appendStringArrayFlag(args, options, '--plugin-dir', 'pluginDir', 'pluginDirs')

  const agents = jsonOption(options.agents)
  if (agents) args.push('--agents', agents)
  const jsonSchema = jsonOption(options.jsonSchema)
  if (jsonSchema) args.push('--json-schema', jsonSchema)
  appendMcpConfigArgs(args, options, externalServers)

  return args
}

function makeUserMessage(content: string): SDKUserMessage {
  return {
    type: 'user',
    session_id: '',
    message: {
      role: 'user',
      content,
    },
    parent_tool_use_id: null,
  }
}

function normalizeUserMessage(message: string | SDKUserMessage): SDKUserMessage {
  return typeof message === 'string' ? makeUserMessage(message) : message
}

function makeInitializeMessage(
  options: Record<string, unknown>,
  sdkServerNames: string[],
): SDKControlRequest {
  const request: SDKControlRequest['request'] = {
    subtype: 'initialize',
  }
  if (sdkServerNames.length > 0) {
    request.sdkMcpServers = sdkServerNames
  }
  if (isRecord(options.hooks)) request.hooks = options.hooks as never
  if (isRecord(options.jsonSchema)) request.jsonSchema = options.jsonSchema
  if (typeof options.systemPrompt === 'string') {
    request.systemPrompt = options.systemPrompt
  }
  if (typeof options.appendSystemPrompt === 'string') {
    request.appendSystemPrompt = options.appendSystemPrompt
  }
  if (isRecord(options.agents)) request.agents = options.agents as never
  if (typeof options.promptSuggestions === 'boolean') {
    request.promptSuggestions = options.promptSuggestions
  }
  if (typeof options.agentProgressSummaries === 'boolean') {
    request.agentProgressSummaries = options.agentProgressSummaries
  }
  return {
    type: 'control_request',
    request_id: randomUUID(),
    request,
  }
}

function writeLine(
  child: ChildProcessWithoutNullStreams,
  value: unknown,
): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    child.stdin.write(`${JSON.stringify(value)}\n`, error => {
      if (error) reject(error)
      else resolvePromise()
    })
  })
}

async function writeQueryInput(
  child: ChildProcessWithoutNullStreams,
  params: QueryParams,
  options: Record<string, unknown>,
  sdkServerNames: string[],
): Promise<boolean> {
  let wroteUserMessage = false
  await writeLine(child, makeInitializeMessage(options, sdkServerNames))
  if (typeof params.prompt === 'string') {
    if (params.prompt.length > 0) {
      await writeLine(child, makeUserMessage(params.prompt))
      wroteUserMessage = true
    }
  } else {
    for await (const message of params.prompt) {
      await writeLine(child, message)
      wroteUserMessage = true
    }
  }
  return wroteUserMessage
}

function writeControlResponse(
  child: ChildProcessWithoutNullStreams,
  response: SDKControlResponse,
): Promise<void> {
  return writeLine(child, response)
}

function controlSuccess(
  request: SDKControlRequest,
  response?: Record<string, unknown>,
): SDKControlResponse {
  return {
    type: 'control_response',
    response: {
      subtype: 'success',
      request_id: request.request_id,
      ...(response !== undefined && { response }),
    },
  }
}

function controlError(
  request: SDKControlRequest,
  message: string,
): SDKControlResponse {
  return {
    type: 'control_response',
    response: {
      subtype: 'error',
      request_id: request.request_id,
      error: message,
    },
  }
}

function isJsonRpcRequest(
  message: JSONRPCMessage,
): message is JSONRPCMessage & {
  id?: string | number | null
  method: string
  params?: Record<string, unknown>
} {
  return isRecord(message) && typeof message['method'] === 'string'
}

function jsonRpcResult(
  message: JSONRPCMessage,
  result: Record<string, unknown>,
): JSONRPCMessage {
  const id = isRecord(message) && 'id' in message ? message.id : null
  return { jsonrpc: '2.0', id, result } as JSONRPCMessage
}

function jsonRpcError(message: JSONRPCMessage, error: string): JSONRPCMessage {
  const id = isRecord(message) && 'id' in message ? message.id : null
  return {
    jsonrpc: '2.0',
    id,
    error: {
      code: -32603,
      message: error,
    },
  } as JSONRPCMessage
}

function sdkToolInputSchema(tool: SdkMcpToolDefinition<any>): Record<string, unknown> {
  try {
    return z.object(tool.inputSchema).toJSONSchema() as Record<string, unknown>
  } catch {
    return {
      type: 'object',
      properties: {},
      additionalProperties: true,
    }
  }
}

async function handleSdkMcpMessage(
  server: SdkServerRuntime,
  message: JSONRPCMessage,
): Promise<JSONRPCMessage> {
  if (!isJsonRpcRequest(message)) {
    return jsonRpcResult(message, {})
  }

  const method = message.method
  switch (method) {
    case 'initialize':
      return jsonRpcResult(message, {
        protocolVersion: '2024-11-05',
        capabilities: server.tools.length > 0 ? { tools: {} } : {},
        serverInfo: {
          name: server.name,
          version: server.version ?? '0.0.0',
        },
      })
    case 'notifications/initialized':
      return jsonRpcResult(message, {})
    case 'tools/list':
      return jsonRpcResult(message, {
        tools: server.tools.map(tool => ({
          name: tool.name,
          description: tool.description,
          inputSchema: sdkToolInputSchema(tool),
          ...(tool.annotations !== undefined && {
            annotations: tool.annotations,
          }),
        })),
      })
    case 'tools/call': {
      const params = isRecord(message.params) ? message.params : {}
      const name = typeof params.name === 'string' ? params.name : ''
      const tool = server.tools.find(candidate => candidate.name === name)
      if (!tool || typeof tool.handler !== 'function') {
        return jsonRpcError(message, `SDK MCP tool not found: ${name}`)
      }
      const args = isRecord(params.arguments) ? params.arguments : {}
      const parsed = z.object(tool.inputSchema).safeParse(args)
      if (!parsed.success) {
        return jsonRpcError(message, parsed.error.message)
      }
      try {
        return jsonRpcResult(
          message,
          (await tool.handler(parsed.data, {})) as Record<string, unknown>,
        )
      } catch (error) {
        return jsonRpcError(
          message,
          error instanceof Error ? error.message : String(error),
        )
      }
    }
    default:
      return jsonRpcError(message, `Unsupported MCP method: ${method}`)
  }
}

async function handleControlRequest(
  child: ChildProcessWithoutNullStreams,
  request: SDKControlRequest,
  options: SdkQueryOptions,
  sdkServers: Map<string, SdkServerRuntime>,
): Promise<void> {
  switch (request.request.subtype) {
    case 'mcp_message': {
      const server = sdkServers.get(request.request.server_name)
      if (!server) {
        await writeControlResponse(
          child,
          controlSuccess(request, {
            mcp_response: jsonRpcError(
              request.request.message as JSONRPCMessage,
              `SDK MCP server not found: ${request.request.server_name}`,
            ),
          }),
        )
        return
      }
      const response = await handleSdkMcpMessage(
        server,
        request.request.message as JSONRPCMessage,
      )
      await writeControlResponse(
        child,
        controlSuccess(request, {
          mcp_response: response as unknown as Record<string, unknown>,
        }),
      )
      return
    }
    case 'can_use_tool': {
      if (typeof options.canUseTool === 'function') {
        try {
          const result = await options.canUseTool(request.request)
          await writeControlResponse(
            child,
            controlSuccess(request, isRecord(result) ? result : {}),
          )
        } catch (error) {
          await writeControlResponse(
            child,
            controlError(
              request,
              error instanceof Error ? error.message : String(error),
            ),
          )
        }
        return
      }
      await writeControlResponse(
        child,
        controlSuccess(request, {
          behavior: 'deny',
          message: 'Tool permission request requires an SDK canUseTool handler.',
          toolUseID: request.request.tool_use_id,
        }),
      )
      return
    }
    case 'hook_callback':
      await writeControlResponse(child, controlSuccess(request, {}))
      return
    default:
      await writeControlResponse(
        child,
        controlError(
          request,
          `Unsupported SDK control request: ${request.request.subtype}`,
        ),
      )
  }
}

function isControlRequest(message: unknown): message is SDKControlRequest {
  return (
    isRecord(message) &&
    message.type === 'control_request' &&
    typeof message.request_id === 'string' &&
    isRecord(message.request) &&
    typeof message.request.subtype === 'string'
  )
}

function isControlResponse(message: unknown): message is SDKControlResponse {
  return isRecord(message) && message.type === 'control_response'
}

function isSdkOutputMessage(message: unknown): message is SDKMessage {
  if (!isRecord(message) || typeof message.type !== 'string') return false
  return (
    message.type === 'assistant' ||
    message.type === 'user' ||
    message.type === 'result' ||
    message.type === 'system' ||
    message.type === 'stream_event'
  )
}

function childClosePromise(
  child: ChildProcessWithoutNullStreams,
): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolvePromise, reject) => {
    child.once('error', reject)
    child.once('close', (code, signal) => resolvePromise({ code, signal }))
  })
}

function getAbortSignal(options: Record<string, unknown>): AbortSignal | undefined {
  const signal = options.signal
  if (signal instanceof AbortSignal) return signal
  const controller = options.abortController
  if (isRecord(controller) && controller.signal instanceof AbortSignal) {
    return controller.signal
  }
  return undefined
}

class AsyncQueue<T> implements AsyncIterable<T>, AsyncIterator<T> {
  private readonly values: T[] = []
  private readonly waiters: Array<{
    resolve: (result: IteratorResult<T>) => void
    reject: (error: unknown) => void
  }> = []
  private closed = false
  private error: unknown

  push(value: T): void {
    if (this.closed) {
      throw new Error('SDK session queue is closed')
    }
    const waiter = this.waiters.shift()
    if (waiter) {
      waiter.resolve({ value, done: false })
      return
    }
    this.values.push(value)
  }

  end(): void {
    if (this.closed) return
    this.closed = true
    while (this.waiters.length > 0) {
      this.waiters.shift()?.resolve({ value: undefined, done: true })
    }
  }

  fail(error: unknown): void {
    if (this.closed) return
    this.error = error
    this.closed = true
    while (this.waiters.length > 0) {
      this.waiters.shift()?.reject(error)
    }
  }

  next(): Promise<IteratorResult<T>> {
    if (this.values.length > 0) {
      return Promise.resolve({ value: this.values.shift()!, done: false })
    }
    if (this.error !== undefined) {
      return Promise.reject(this.error)
    }
    if (this.closed) {
      return Promise.resolve({ value: undefined, done: true })
    }
    return new Promise<IteratorResult<T>>((resolvePromise, reject) => {
      this.waiters.push({ resolve: resolvePromise, reject })
    })
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return this
  }
}

class CliQuery implements Query {
  [key: string]: unknown

  private started = false
  private readonly abortController = new AbortController()
  private child: ChildProcessWithoutNullStreams | undefined

  constructor(private readonly params: QueryParams) {}

  abort(): void {
    this.abortController.abort()
    this.child?.kill()
  }

  async *[Symbol.asyncIterator](): AsyncIterator<SDKMessage> {
    if (this.started) {
      throw new Error('SDK query objects can only be iterated once')
    }
    this.started = true

    const options = (this.params.options ?? {}) as SdkQueryOptions
    const { sdkServers, externalServers } = splitMcpServers(options)
    const cli = getCliCommand(options)
    const args = [...cli.args, ...buildCliArgs(options, externalServers)]
    const cwd = stringOption(options, 'cwd') ?? process.cwd()
    const env = {
      ...process.env,
      ...(isRecord(options.env) ? options.env : {}),
    } as NodeJS.ProcessEnv
    const child = spawn(cli.command, args, {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })
    this.child = child

    let stderr = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', chunk => {
      stderr += String(chunk)
      if (stderr.length > DEFAULT_STDERR_LIMIT) {
        stderr = stderr.slice(-DEFAULT_STDERR_LIMIT)
      }
    })

    const close = childClosePromise(child)
    const externalSignal = getAbortSignal(options)
    const abort = () => {
      child.kill()
    }
    this.abortController.signal.addEventListener('abort', abort, { once: true })
    externalSignal?.addEventListener('abort', abort, { once: true })

    let inputDone = false
    let inputWroteUserMessage = false
    let seenResult = false
    const endInput = () => {
      if (!child.stdin.destroyed && !child.stdin.writableEnded) {
        child.stdin.end()
      }
    }
    const input = writeQueryInput(
      child,
      this.params,
      options,
      Array.from(sdkServers.keys()),
    ).then(wroteUserMessage => {
      inputDone = true
      inputWroteUserMessage = wroteUserMessage
      if (!wroteUserMessage || seenResult) {
        endInput()
      }
    })

    const rl = createInterface({
      input: child.stdout,
      crlfDelay: Infinity,
    })

    try {
      for await (const line of rl) {
        if (line.length === 0) continue
        let message: unknown
        try {
          message = JSON.parse(line)
        } catch (error) {
          throw new Error(
            `Failed to parse SDK stream-json line: ${
              error instanceof Error ? error.message : String(error)
            }`,
          )
        }

        if (isControlRequest(message)) {
          await handleControlRequest(child, message, options, sdkServers)
          continue
        }
        if (isControlResponse(message) || (isRecord(message) && message.type === 'keep_alive')) {
          continue
        }
        if (isSdkOutputMessage(message)) {
          if (message.type === 'result') {
            seenResult = true
            if (inputDone && inputWroteUserMessage) {
              endInput()
            }
          }
          yield message
        }
      }

      await input
      endInput()
      const result = await close
      if (
        result.code !== 0 &&
        !this.abortController.signal.aborted &&
        !externalSignal?.aborted
      ) {
        const detail = stderr.trim()
        throw new Error(
          `Claude Code SDK query exited with code ${result.code}${
            detail ? `: ${detail}` : ''
          }`,
        )
      }
    } finally {
      rl.close()
      this.abortController.signal.removeEventListener('abort', abort)
      externalSignal?.removeEventListener('abort', abort)
      if (!child.killed && child.exitCode === null) {
        child.kill()
      }
      this.child = undefined
    }
  }
}

class CliSdkSession implements SDKSession {
  [key: string]: unknown

  id?: string

  private readonly input = new AsyncQueue<SDKUserMessage>()
  private readonly output = new AsyncQueue<SDKMessage>()
  private readonly pendingPrompts: PendingPrompt[] = []
  private queryHandle: Query | undefined
  private pump: Promise<void> | undefined
  private closed = false

  constructor(
    private readonly options: SDKSessionOptions,
    initialId?: string,
  ) {
    this.id = initialId
  }

  prompt(message: string | SDKUserMessage): Promise<SDKResultMessage> {
    if (this.closed) {
      return Promise.reject(new Error('SDK session is closed'))
    }
    this.start()
    const result = new Promise<SDKResultMessage>((resolvePromise, reject) => {
      this.pendingPrompts.push({ resolve: resolvePromise, reject })
    })
    try {
      this.input.push(normalizeUserMessage(message))
    } catch (error) {
      const pending = this.pendingPrompts.pop()
      pending?.reject(error)
    }
    return result
  }

  send(message: string | SDKUserMessage): void {
    if (this.closed) {
      throw new Error('SDK session is closed')
    }
    this.start()
    this.input.push(normalizeUserMessage(message))
  }

  abort(): void {
    this.close()
    ;(this.queryHandle as { abort?: () => void } | undefined)?.abort?.()
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.input.end()
    while (this.pendingPrompts.length > 0) {
      this.pendingPrompts.shift()?.reject(new AbortError('SDK session closed'))
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKMessage> {
    this.start()
    return this.output[Symbol.asyncIterator]()
  }

  private start(): void {
    if (this.pump) return
    this.queryHandle = query({
      prompt: this.input,
      options: this.options,
    })
    this.pump = this.run()
  }

  private async run(): Promise<void> {
    try {
      for await (const message of this.queryHandle!) {
        if (
          'session_id' in message &&
          typeof message.session_id === 'string' &&
          message.session_id.length > 0
        ) {
          this.id = message.session_id
        }
        this.output.push(message)
        if (message.type === 'result') {
          this.pendingPrompts.shift()?.resolve(message)
        }
      }
      this.output.end()
      while (this.pendingPrompts.length > 0) {
        this.pendingPrompts
          .shift()
          ?.reject(new Error('SDK session ended before returning a result'))
      }
    } catch (error) {
      this.output.fail(error)
      while (this.pendingPrompts.length > 0) {
        this.pendingPrompts.shift()?.reject(error)
      }
    } finally {
      this.closed = true
      this.input.end()
    }
  }
}

function buildResumeOptions(
  sessionId: string,
  options: SDKSessionOptions,
): SDKSessionOptions {
  return {
    ...options,
    resume: sessionId,
  }
}

/** @internal */
export function query(params: {
  prompt: string | AsyncIterable<SDKUserMessage>
  options?: InternalOptions
}): InternalQuery
export function query(params: {
  prompt: string | AsyncIterable<SDKUserMessage>
  options?: Options
}): Query
export function query(params: QueryParams): Query {
  if (!params || !('prompt' in params)) {
    throw new Error('query requires a prompt')
  }
  return new CliQuery(params)
}

/**
 * V2 API - UNSTABLE
 * Create a persistent session for multi-turn conversations.
 * @alpha
 */
export function unstable_v2_createSession(
  options: SDKSessionOptions,
): SDKSession {
  return new CliSdkSession(options)
}

/**
 * V2 API - UNSTABLE
 * Resume an existing session by ID.
 * @alpha
 */
export function unstable_v2_resumeSession(
  sessionId: string,
  options: SDKSessionOptions,
): SDKSession {
  if (!sessionId || sessionId.trim().length === 0) {
    throw new Error('unstable_v2_resumeSession requires a session ID')
  }
  return new CliSdkSession(buildResumeOptions(sessionId, options), sessionId)
}

// @[MODEL LAUNCH]: Update the example model ID in this docstring.
/**
 * V2 API - UNSTABLE
 * One-shot convenience function for single prompts.
 * @alpha
 *
 * @example
 * ```typescript
 * const result = await unstable_v2_prompt("What files are here?", {
 *   model: 'claude-sonnet-4-6'
 * })
 * ```
 */
export async function unstable_v2_prompt(
  message: string,
  options: SDKSessionOptions,
): Promise<SDKResultMessage> {
  let result: SDKResultMessage | undefined
  for await (const sdkMessage of query({ prompt: message, options })) {
    if (sdkMessage.type === 'result') {
      result = sdkMessage
    }
  }
  if (!result) {
    throw new Error('Claude Code SDK query finished without a result message')
  }
  return result
}

/**
 * Reads a session's conversation messages from its JSONL transcript file.
 *
 * Parses the transcript, builds the conversation chain via parentUuid links,
 * and returns user/assistant messages in chronological order. Set
 * `includeSystemMessages: true` in options to also include system messages.
 *
 * @param sessionId - UUID of the session to read
 * @param options - Optional dir, limit, offset, and includeSystemMessages
 * @returns Array of messages, or empty array if session not found
 */
export async function getSessionMessages(
  sessionId: string,
  options?: GetSessionMessagesOptions,
): Promise<SessionMessage[]> {
  return getSessionMessagesImpl(sessionId, options)
}

/**
 * List sessions with metadata.
 *
 * When `dir` is provided, returns sessions for that project directory
 * and its git worktrees. When omitted, returns sessions across all
 * projects.
 *
 * Use `limit` and `offset` for pagination.
 *
 * @example
 * ```typescript
 * // List sessions for a specific project
 * const sessions = await listSessions({ dir: '/path/to/project' })
 *
 * // Paginate
 * const page1 = await listSessions({ limit: 50 })
 * const page2 = await listSessions({ limit: 50, offset: 50 })
 * ```
 */
export async function listSessions(
  options?: ListSessionsOptions,
): Promise<SDKSessionInfo[]> {
  return listSessionsImpl(options)
}

/**
 * Reads metadata for a single session by ID. Unlike `listSessions`, this only
 * reads the single session file rather than every session in the project.
 * Returns undefined if the session file is not found, is a sidechain session,
 * or has no extractable summary.
 *
 * @param sessionId - UUID of the session
 * @param options - `{ dir?: string }` project path; omit to search all project directories
 */
export async function getSessionInfo(
  sessionId: string,
  options?: GetSessionInfoOptions,
): Promise<SDKSessionInfo | undefined> {
  return getSessionInfoImpl(sessionId, options)
}

/**
 * Rename a session. Appends a custom-title entry to the session's JSONL file.
 * @param sessionId - UUID of the session
 * @param title - New title
 * @param options - `{ dir?: string }` project path; omit to search all projects
 */
export async function renameSession(
  sessionId: string,
  title: string,
  options?: SessionMutationOptions,
): Promise<void> {
  return renameSessionImpl(sessionId, title, options)
}

/**
 * Tag a session. Pass null to clear the tag.
 * @param sessionId - UUID of the session
 * @param tag - Tag string, or null to clear
 * @param options - `{ dir?: string }` project path; omit to search all projects
 */
export async function tagSession(
  sessionId: string,
  tag: string | null,
  options?: SessionMutationOptions,
): Promise<void> {
  return tagSessionImpl(sessionId, tag, options)
}

/**
 * Fork a session into a new branch with fresh UUIDs.
 *
 * Copies transcript messages from the source session into a new session file,
 * remapping every message UUID and preserving the parentUuid chain. Supports
 * `upToMessageId` for branching from a specific point in the conversation.
 *
 * Forked sessions start without undo history (file-history snapshots are not
 * copied).
 *
 * @param sessionId - UUID of the source session
 * @param options - `{ dir?, upToMessageId?, title? }`
 * @returns `{ sessionId }` — UUID of the new forked session
 */
export async function forkSession(
  sessionId: string,
  options?: ForkSessionOptions,
): Promise<ForkSessionResult> {
  return forkSessionImpl(sessionId, options)
}

// ============================================================================
// Assistant daemon primitives (internal)
// ============================================================================

/**
 * A scheduled task from `<dir>/.claude/scheduled_tasks.json`.
 * @internal
 */
export type CronTask = {
  id: string
  cron: string
  prompt: string
  createdAt: number
  recurring?: boolean
}

/**
 * Cron scheduler tuning knobs (jitter + expiry). Sourced at runtime from the
 * `tengu_kairos_cron_config` GrowthBook config in CLI sessions; daemon hosts
 * pass this through `watchScheduledTasks({ getJitterConfig })` to get the
 * same tuning.
 * @internal
 */
export type CronJitterConfig = {
  recurringFrac: number
  recurringCapMs: number
  oneShotMaxMs: number
  oneShotFloorMs: number
  oneShotMinuteMod: number
  recurringMaxAgeMs: number
}

/**
 * Event yielded by `watchScheduledTasks()`.
 * @internal
 */
export type ScheduledTaskEvent =
  | { type: 'fire'; task: CronTask }
  | { type: 'missed'; tasks: CronTask[] }

/**
 * Handle returned by `watchScheduledTasks()`.
 * @internal
 */
export type ScheduledTasksHandle = {
  /** Async stream of fire/missed events. Drain with `for await`. */
  events(): AsyncGenerator<ScheduledTaskEvent>
  /**
   * Epoch ms of the soonest scheduled fire across all loaded tasks, or null
   * if nothing is scheduled. Useful for deciding whether to tear down an
   * idle agent subprocess or keep it warm for an imminent fire.
   */
  getNextFireTime(): number | null
}

/**
 * Watch `<dir>/.claude/scheduled_tasks.json` and yield events as tasks fire.
 *
 * Acquires the per-directory scheduler lock (PID-based liveness) so a REPL
 * session in the same dir won't double-fire. Releases the lock and closes
 * the file watcher when the signal aborts.
 *
 * - `fire` — a task whose cron schedule was met. One-shot tasks are already
 *   deleted from the file when this yields; recurring tasks are rescheduled
 *   (or deleted if aged out).
 * - `missed` — one-shot tasks whose window passed while the daemon was down.
 *   Yielded once on initial load; a background delete removes them from the
 *   file shortly after.
 *
 * Intended for daemon architectures that own the scheduler externally and
 * spawn the agent via `query()`; the agent subprocess (`-p` mode) does not
 * run its own scheduler.
 *
 * @internal
 */
export function watchScheduledTasks(opts: {
  dir: string
  signal: AbortSignal
  getJitterConfig?: () => CronJitterConfig
}): ScheduledTasksHandle {
  const queue: ScheduledTaskEvent[] = []
  const waiters: Array<(result: IteratorResult<ScheduledTaskEvent>) => void> =
    []
  let closed = false

  const push = (event: ScheduledTaskEvent): void => {
    if (closed) return
    const waiter = waiters.shift()
    if (waiter) waiter({ value: event, done: false })
    else queue.push(event)
  }

  const scheduler = createCronScheduler({
    onFire: prompt =>
      push({
        type: 'fire',
        task: {
          id: '',
          cron: '',
          prompt,
          createdAt: Date.now(),
          recurring: false,
        },
      }),
    onFireTask: task => push({ type: 'fire', task }),
    onMissed: tasks => push({ type: 'missed', tasks }),
    isLoading: () => false,
    assistantMode: true,
    dir: opts.dir,
    lockIdentity: randomUUID(),
    getJitterConfig: opts.getJitterConfig,
    isKilled: () => opts.signal.aborted,
  })

  const close = (): void => {
    if (closed) return
    closed = true
    scheduler.stop()
    while (waiters.length > 0) {
      waiters.shift()?.({ value: undefined, done: true })
    }
  }

  if (opts.signal.aborted) close()
  else {
    opts.signal.addEventListener('abort', close, { once: true })
    scheduler.start()
  }

  return {
    async *events(): AsyncGenerator<ScheduledTaskEvent> {
      try {
        while (true) {
          if (queue.length > 0) {
            yield queue.shift()!
            continue
          }
          if (closed) return
          const next = await new Promise<IteratorResult<ScheduledTaskEvent>>(
            resolve => {
              waiters.push(resolve)
            },
          )
          if (next.done) return
          yield next.value
        }
      } finally {
        close()
      }
    },
    getNextFireTime(): number | null {
      return scheduler.getNextFireTime()
    },
  }
}

/**
 * Format missed one-shot tasks into a prompt that asks the model to confirm
 * with the user (via AskUserQuestion) before executing.
 * @internal
 */
export function buildMissedTaskNotification(missed: CronTask[]): string {
  const plural = missed.length > 1
  const header =
    `The following one-shot scheduled task${plural ? 's were' : ' was'} missed while Claude was not running. ` +
    `${plural ? 'They have' : 'It has'} already been removed from .claude/scheduled_tasks.json.\n\n` +
    `Do NOT execute ${plural ? 'these prompts' : 'this prompt'} yet. ` +
    `First use the AskUserQuestion tool to ask whether to run ${plural ? 'each one' : 'it'} now. ` +
    `Only execute if the user confirms.`

  const blocks = missed.map(task => {
    const meta = `[${cronToHuman(task.cron)}, created ${new Date(task.createdAt).toLocaleString()}]`
    const prompt = String(task.prompt)
    let longestRun = 0
    let currentRun = 0
    for (const char of prompt) {
      if (char === '`') {
        currentRun++
        longestRun = Math.max(longestRun, currentRun)
      } else {
        currentRun = 0
      }
    }
    const fence = '`'.repeat(Math.max(3, longestRun + 1))
    return `${meta}\n${fence}\n${prompt}\n${fence}`
  })

  return `${header}\n\n${blocks.join('\n\n')}`
}

/**
 * A user message typed on claude.ai, extracted from the bridge WS.
 * @internal
 */
export type InboundPrompt = {
  content: string | unknown[]
  uuid?: string
}

/**
 * Options for connectRemoteControl.
 * @internal
 */
export type ConnectRemoteControlOptions = {
  dir: string
  name?: string
  workerType?: string
  branch?: string
  gitRepoUrl?: string | null
  getAccessToken: () => string | undefined
  baseUrl: string
  orgUUID: string
  model: string
}

type BridgeCreateSession = (opts: {
  environmentId: string
  title: string
  gitRepoUrl: string | null
  branch: string
  signal: AbortSignal
}) => Promise<string | null>

type BridgeCoreLikeHandle = {
  bridgeSessionId: string
  environmentId: string
  writeSdkMessages(messages: SDKMessage[]): void
  sendControlRequest(request: SDKControlRequest): void
  sendControlResponse(response: SDKControlResponse): void
  sendControlCancelRequest(requestId: string): void
  sendResult(): void
  teardown(): Promise<void>
}

type BridgeCoreLikeParams = {
  dir: string
  machineName: string
  branch: string
  gitRepoUrl: string | null
  title: string
  baseUrl: string
  sessionIngressUrl: string
  workerType: string
  getAccessToken: () => string | undefined
  createSession: BridgeCreateSession
  archiveSession: (sessionId: string) => Promise<void>
  getCurrentTitle?: () => string
  onInboundMessage?: (msg: SDKMessage) => void
  onPermissionResponse?: (response: SDKControlResponse) => void
  onInterrupt?: () => void
  onSetModel?: (model: string | undefined) => void
  onSetMaxThinkingTokens?: (maxTokens: number | null) => void
  onSetPermissionMode?: (
    mode: string,
  ) => { ok: true } | { ok: false; error: string }
  onStateChange?: (
    state: 'ready' | 'connected' | 'reconnecting' | 'failed',
    detail?: string,
  ) => void
}

type ConnectRemoteControlDeps = {
  initBridgeCore?: (
    params: BridgeCoreLikeParams,
  ) => Promise<BridgeCoreLikeHandle | null>
  createSession?: BridgeCreateSession
  archiveSession?: (sessionId: string) => Promise<void>
  getRemoteSessionUrl?: (sessionId: string, ingressUrl?: string) => string
}

function sdkMessageToInboundPrompt(msg: SDKMessage): InboundPrompt | undefined {
  if (msg.type !== 'user') return undefined
  const message = isRecord(msg.message) ? msg.message : {}
  const content = message.content
  if (typeof content !== 'string' && !Array.isArray(content)) return undefined
  return {
    content,
    ...('uuid' in msg && typeof msg.uuid === 'string'
      ? { uuid: msg.uuid }
      : {}),
  }
}

function pushQueue<T>(queue: AsyncQueue<T>, value: T): void {
  try {
    queue.push(value)
  } catch {
    // Ignore late bridge events after teardown.
  }
}

async function* drainQueue<T>(queue: AsyncQueue<T>): AsyncGenerator<T> {
  for await (const item of queue) {
    yield item
  }
}

function remoteControlRequest(
  request: SDKControlRequest['request'],
): SDKControlRequest {
  return {
    type: 'control_request',
    request_id: randomUUID(),
    request,
  }
}

function remoteControlHeaders(
  accessToken: string,
  orgUUID: string,
): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    'anthropic-version': '2023-06-01',
    'anthropic-beta': 'ccr-byoc-2025-07-29',
    'x-organization-uuid': orgUUID,
  }
}

async function createRemoteControlSessionLean(
  connectOptions: ConnectRemoteControlOptions,
  opts: Parameters<BridgeCreateSession>[0],
): Promise<string | null> {
  const accessToken = connectOptions.getAccessToken()
  if (!accessToken) return null

  const { default: axios } = await import('axios')
  const response = await axios.post(
    `${connectOptions.baseUrl}/v1/sessions`,
    {
      title: opts.title,
      events: [],
      session_context: {
        sources: [],
        outcomes: [],
        model: connectOptions.model,
      },
      environment_id: opts.environmentId,
      source: 'remote-control',
    },
    {
      headers: remoteControlHeaders(accessToken, connectOptions.orgUUID),
      signal: opts.signal,
      validateStatus: status => status < 500,
    },
  )
  if (response.status !== 200 && response.status !== 201) return null
  const data: unknown = response.data
  if (!isRecord(data) || typeof data.id !== 'string') return null
  return data.id
}

async function archiveRemoteControlSessionLean(
  connectOptions: ConnectRemoteControlOptions,
  sessionId: string,
): Promise<void> {
  const accessToken = connectOptions.getAccessToken()
  if (!accessToken) return
  const { default: axios } = await import('axios')
  await axios.post(
    `${connectOptions.baseUrl}/v1/sessions/${encodeURIComponent(sessionId)}/archive`,
    {},
    {
      headers: remoteControlHeaders(accessToken, connectOptions.orgUUID),
      validateStatus: status => status < 500,
    },
  )
}

/**
 * Handle returned by connectRemoteControl. Write query() yields in,
 * read inbound prompts out. See src/assistant/daemonBridge.ts for full
 * field documentation.
 * @internal
 */
export type RemoteControlHandle = {
  sessionUrl: string
  environmentId: string
  bridgeSessionId: string
  write(msg: SDKMessage): void
  sendResult(): void
  sendControlRequest(req: unknown): void
  sendControlResponse(res: unknown): void
  sendControlCancelRequest(requestId: string): void
  inboundPrompts(): AsyncGenerator<InboundPrompt>
  controlRequests(): AsyncGenerator<unknown>
  permissionResponses(): AsyncGenerator<unknown>
  onStateChange(
    cb: (
      state: 'ready' | 'connected' | 'reconnecting' | 'failed',
      detail?: string,
    ) => void,
  ): void
  teardown(): Promise<void>
}

/**
 * Hold a claude.ai remote-control bridge connection from a daemon process.
 *
 * The daemon owns the WebSocket in the PARENT process — if the agent
 * subprocess (spawned via `query()`) crashes, the daemon respawns it while
 * claude.ai keeps the same session. Contrast with `query.enableRemoteControl`
 * which puts the WS in the CHILD process (dies with the agent).
 *
 * Pipe `query()` yields through `write()` + `sendResult()`. Read
 * `inboundPrompts()` (user typed on claude.ai) into `query()`'s input
 * stream. Handle `controlRequests()` locally (interrupt → abort, set_model
 * → reconfigure).
 *
 * Skips the `tengu_ccr_bridge` gate and policy-limits check — @internal
 * caller is pre-entitled. OAuth is still required (env var or keychain).
 *
 * Returns null on no-OAuth or registration failure.
 *
 * @internal
 */
export async function connectRemoteControl(
  opts: ConnectRemoteControlOptions,
): Promise<RemoteControlHandle | null> {
  if (!opts.getAccessToken()) return null

  const deps = (opts as ConnectRemoteControlOptions & {
    deps?: ConnectRemoteControlDeps
  }).deps
  const inboundQueue = new AsyncQueue<InboundPrompt>()
  const controlQueue = new AsyncQueue<unknown>()
  const permissionQueue = new AsyncQueue<unknown>()
  const stateCallbacks = new Set<
    (
      state: 'ready' | 'connected' | 'reconnecting' | 'failed',
      detail?: string,
    ) => void
  >()

  const title = opts.name?.trim() || 'Claude Code Remote Control'
  const branch = opts.branch ?? ''
  const gitRepoUrl = opts.gitRepoUrl ?? null
  const sessionIngressUrl = opts.baseUrl
  const createSession =
    deps?.createSession ??
    ((sessionOpts: Parameters<BridgeCreateSession>[0]) =>
      createRemoteControlSessionLean(opts, sessionOpts))
  const archiveSession =
    deps?.archiveSession ??
    ((sessionId: string) => archiveRemoteControlSessionLean(opts, sessionId))
  const initBridgeCore =
    deps?.initBridgeCore ??
    ((await import('../bridge/replBridge.js')).initBridgeCore as unknown as (
      params: BridgeCoreLikeParams,
    ) => Promise<BridgeCoreLikeHandle | null>)

  const bridge = await initBridgeCore({
    dir: opts.dir,
    machineName: opts.name ?? hostname(),
    branch,
    gitRepoUrl,
    title,
    baseUrl: opts.baseUrl,
    sessionIngressUrl,
    workerType: opts.workerType ?? 'claude_code_assistant',
    getAccessToken: opts.getAccessToken,
    createSession,
    archiveSession,
    getCurrentTitle: () => title,
    onInboundMessage: msg => {
      const prompt = sdkMessageToInboundPrompt(msg)
      if (prompt) pushQueue(inboundQueue, prompt)
    },
    onPermissionResponse: response => {
      pushQueue(permissionQueue, response)
    },
    onInterrupt: () => {
      pushQueue(
        controlQueue,
        remoteControlRequest(
          { subtype: 'interrupt' } as SDKControlRequest['request'],
        ),
      )
    },
    onSetModel: model => {
      pushQueue(
        controlQueue,
        remoteControlRequest(
          { subtype: 'set_model', model } as SDKControlRequest['request'],
        ),
      )
    },
    onSetMaxThinkingTokens: maxTokens => {
      pushQueue(
        controlQueue,
        remoteControlRequest({
          subtype: 'set_max_thinking_tokens',
          max_thinking_tokens: maxTokens,
        } as SDKControlRequest['request']),
      )
    },
    onSetPermissionMode: mode => {
      pushQueue(
        controlQueue,
        remoteControlRequest({
          subtype: 'set_permission_mode',
          mode,
        } as SDKControlRequest['request']),
      )
      return { ok: true }
    },
    onStateChange: (state, detail) => {
      for (const callback of stateCallbacks) {
        callback(state, detail)
      }
    },
  })

  if (!bridge) {
    inboundQueue.end()
    controlQueue.end()
    permissionQueue.end()
    return null
  }

  const getRemoteSessionUrl =
    deps?.getRemoteSessionUrl ??
    (await import('../constants/product.js')).getRemoteSessionUrl

  return {
    sessionUrl: getRemoteSessionUrl(bridge.bridgeSessionId, sessionIngressUrl),
    environmentId: bridge.environmentId,
    bridgeSessionId: bridge.bridgeSessionId,
    write(msg: SDKMessage): void {
      bridge.writeSdkMessages([msg])
    },
    sendResult(): void {
      bridge.sendResult()
    },
    sendControlRequest(req: unknown): void {
      bridge.sendControlRequest(req as SDKControlRequest)
    },
    sendControlResponse(res: unknown): void {
      bridge.sendControlResponse(res as SDKControlResponse)
    },
    sendControlCancelRequest(requestId: string): void {
      bridge.sendControlCancelRequest(requestId)
    },
    inboundPrompts(): AsyncGenerator<InboundPrompt> {
      return drainQueue(inboundQueue)
    },
    controlRequests(): AsyncGenerator<unknown> {
      return drainQueue(controlQueue)
    },
    permissionResponses(): AsyncGenerator<unknown> {
      return drainQueue(permissionQueue)
    },
    onStateChange(callback): void {
      stateCallbacks.add(callback)
    },
    async teardown(): Promise<void> {
      try {
        await bridge.teardown()
      } finally {
        inboundQueue.end()
        controlQueue.end()
        permissionQueue.end()
        stateCallbacks.clear()
      }
    },
  }
}
