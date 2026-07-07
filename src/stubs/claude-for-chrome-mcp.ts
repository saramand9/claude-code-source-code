import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
  type CallToolResult,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js'
import { connect, type Socket } from 'net'

export type PermissionMode = 'ask' | 'skip_all_permission_checks' | 'follow_a_plan'

export type Logger = {
  silly?(message: string, ...args: unknown[]): void
  debug?(message: string, ...args: unknown[]): void
  info?(message: string, ...args: unknown[]): void
  warn?(message: string, ...args: unknown[]): void
  error?(message: string, ...args: unknown[]): void
}

export type ChromeBridgeConfig = {
  url: string
  getUserId?: () => string | Promise<string>
  getOAuthToken?: () => string | Promise<string>
  devUserId?: string
}

export type ClaudeForChromeContext = {
  serverName?: string
  logger?: Logger
  socketPath?: string
  getSocketPaths?: () => string[]
  bridgeConfig?: ChromeBridgeConfig
  clientTypeId?: string
  initialPermissionMode?: PermissionMode
  onAuthenticationError?: () => void
  onToolCallDisconnected?: () => string
  onExtensionPaired?: (deviceId: string, name: string) => void
  getPersistedDeviceId?: () => string | undefined
  trackEvent?: (eventName: string, metadata?: Record<string, unknown>) => void
  [key: string]: unknown
}

type JsonSchema = Tool['inputSchema']

const REQUEST_TIMEOUT_MS = 60_000
const MAX_FRAME_BYTES = 16 * 1024 * 1024

function objectSchema(
  properties: Record<string, object> = {},
  required: string[] = [],
): JsonSchema {
  return {
    type: 'object',
    properties,
    required,
    additionalProperties: true,
  }
}

function stringEnum(values: string[]): Record<string, unknown> {
  return { type: 'string', enum: values }
}

export const BROWSER_TOOLS: ReadonlyArray<Tool> = Object.freeze([
  {
    name: 'tabs_context_mcp',
    description:
      'List the current Chrome tabs and their basic page context. Use this first in a browser automation session.',
    inputSchema: objectSchema({
      includeScreenshots: { type: 'boolean' },
    }),
  },
  {
    name: 'tabs_create_mcp',
    description: 'Create a new Chrome tab, optionally navigating it to a URL.',
    inputSchema: objectSchema({
      url: { type: 'string', description: 'URL to open in the new tab.' },
      active: { type: 'boolean' },
    }),
  },
  {
    name: 'navigate',
    description: 'Navigate an existing Chrome tab to a URL.',
    inputSchema: objectSchema({
      tabId: { type: 'number' },
      url: { type: 'string' },
    }),
  },
  {
    name: 'read_page',
    description:
      'Read the visible page structure or accessibility snapshot for a Chrome tab.',
    inputSchema: objectSchema({
      tabId: { type: 'number' },
    }),
  },
  {
    name: 'get_page_text',
    description: 'Extract text content from the current page in a Chrome tab.',
    inputSchema: objectSchema({
      tabId: { type: 'number' },
    }),
  },
  {
    name: 'find',
    description: 'Find text or page elements in a Chrome tab.',
    inputSchema: objectSchema(
      {
        tabId: { type: 'number' },
        query: { type: 'string' },
      },
      ['query'],
    ),
  },
  {
    name: 'form_input',
    description: 'Fill or update a form field in a Chrome tab.',
    inputSchema: objectSchema({
      tabId: { type: 'number' },
      ref: { type: 'string' },
      text: { type: 'string' },
      value: {},
    }),
  },
  {
    name: 'computer',
    description:
      'Interact with the browser using mouse, keyboard, scroll, drag, and wait actions.',
    inputSchema: objectSchema(
      {
        tabId: { type: 'number' },
        action: stringEnum([
          'left_click',
          'right_click',
          'double_click',
          'middle_click',
          'left_click_drag',
          'type',
          'key',
          'scroll',
          'wait',
        ]),
        ref: { type: 'string' },
        coordinate: {
          type: 'array',
          items: { type: 'number' },
          minItems: 2,
          maxItems: 2,
        },
        text: { type: 'string' },
        scroll_direction: stringEnum(['up', 'down', 'left', 'right']),
        duration: { type: 'number' },
      },
      ['action'],
    ),
  },
  {
    name: 'javascript_tool',
    description: 'Run JavaScript in a Chrome tab and return the result.',
    inputSchema: objectSchema({
      tabId: { type: 'number' },
      text: { type: 'string', description: 'JavaScript source to execute.' },
      code: { type: 'string', description: 'JavaScript source to execute.' },
    }),
  },
  {
    name: 'resize_window',
    description: 'Resize the Chrome window for a tab.',
    inputSchema: objectSchema(
      {
        tabId: { type: 'number' },
        width: { type: 'number' },
        height: { type: 'number' },
      },
      ['width', 'height'],
    ),
  },
  {
    name: 'gif_creator',
    description: 'Start, stop, or capture frames for a browser automation GIF.',
    inputSchema: objectSchema({
      tabId: { type: 'number' },
      action: { type: 'string' },
      filename: { type: 'string' },
      path: { type: 'string' },
    }),
  },
  {
    name: 'upload_image',
    description: 'Upload or attach an image into the active browser workflow.',
    inputSchema: objectSchema({
      tabId: { type: 'number' },
      path: { type: 'string' },
      image: {},
    }),
  },
  {
    name: 'read_console_messages',
    description:
      'Read console messages from a Chrome tab, optionally filtering by pattern or errors.',
    inputSchema: objectSchema({
      tabId: { type: 'number' },
      pattern: { type: 'string' },
      onlyErrors: { type: 'boolean' },
      limit: { type: 'number' },
    }),
  },
  {
    name: 'read_network_requests',
    description:
      'Read captured network requests from a Chrome tab, optionally filtering by URL pattern.',
    inputSchema: objectSchema({
      tabId: { type: 'number' },
      urlPattern: { type: 'string' },
      limit: { type: 'number' },
    }),
  },
  {
    name: 'shortcuts_list',
    description: 'List browser extension shortcuts available in Chrome.',
    inputSchema: objectSchema({
      tabId: { type: 'number' },
    }),
  },
  {
    name: 'shortcuts_execute',
    description: 'Execute a browser extension shortcut.',
    inputSchema: objectSchema(
      {
        tabId: { type: 'number' },
        shortcutId: { type: 'string' },
      },
      ['shortcutId'],
    ),
  },
  {
    name: 'update_plan',
    description: 'Update the browser automation plan shown by the extension.',
    inputSchema: objectSchema({
      tabId: { type: 'number' },
      plan: {},
      status: { type: 'string' },
    }),
  },
])

const TOOL_NAMES = new Set(BROWSER_TOOLS.map(tool => tool.name))

export function createClaudeForChromeMcpServer(
  context: ClaudeForChromeContext = {},
): Server {
  context.logger?.info?.(
    'Starting source-build Claude in Chrome MCP server backed by the native host bridge.',
  )
  context.trackEvent?.('tengu_chrome_mcp_source_shim_started', {
    tool_count: BROWSER_TOOLS.length,
  })

  const server = new Server(
    {
      name: context.serverName ?? 'Claude in Chrome',
      version: '0.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    },
  )

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: BROWSER_TOOLS,
  }))

  server.setRequestHandler(CallToolRequestSchema, async request => {
    const toolName = request.params.name
    if (!TOOL_NAMES.has(toolName)) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Unknown Claude in Chrome tool "${toolName}".`,
      )
    }

    const args = request.params.arguments ?? {}
    if (typeof args !== 'object' || args === null || Array.isArray(args)) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Claude in Chrome tool "${toolName}" expects an object argument payload.`,
      )
    }

    context.trackEvent?.('tengu_chrome_mcp_source_shim_tool_call_started', {
      tool_name: toolName,
    })

    try {
      const response = await callChromeTool(context, toolName, args)
      context.trackEvent?.('tengu_chrome_mcp_source_shim_tool_call_completed', {
        tool_name: toolName,
      })
      return normalizeToolResult(response)
    } catch (error) {
      context.trackEvent?.('tengu_chrome_mcp_source_shim_tool_call_error', {
        tool_name: toolName,
      })
      if (error instanceof McpError) {
        throw error
      }
      const message = error instanceof Error ? error.message : String(error)
      throw new McpError(ErrorCode.InternalError, message)
    }
  })

  return server
}

async function callChromeTool(
  context: ClaudeForChromeContext,
  method: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  const socketPaths = getCandidateSocketPaths(context)
  if (socketPaths.length === 0) {
    throwDisconnected(context, 'No Chrome native-host socket path is configured.')
  }

  let lastError: unknown
  for (const socketPath of socketPaths) {
    try {
      return await sendFramedRequest(socketPath, { method, params })
    } catch (error) {
      lastError = error
      context.logger?.debug?.(
        `Claude in Chrome native-host request failed for ${socketPath}: ${String(
          error,
        )}`,
      )
    }
  }

  const suffix =
    lastError instanceof Error ? ` Last connection error: ${lastError.message}` : ''
  throwDisconnected(context, `Chrome native host is not connected.${suffix}`)
}

function getCandidateSocketPaths(context: ClaudeForChromeContext): string[] {
  const paths = [
    ...(context.getSocketPaths?.() ?? []),
    ...(context.socketPath ? [context.socketPath] : []),
  ]
  return [...new Set(paths.filter(path => typeof path === 'string' && path))]
}

function throwDisconnected(context: ClaudeForChromeContext, fallback: string): never {
  let message = context.onToolCallDisconnected?.() ?? fallback
  if (hasChromeBridgeConfig(context)) {
    context.logger?.warn?.(
      `Chrome bridge is configured at ${context.bridgeConfig.url}, but the source-build Claude in Chrome MCP shim only supports the local native-host socket.`,
    )
    context.trackEvent?.('tengu_chrome_mcp_source_shim_bridge_unsupported', {
      bridge_url: context.bridgeConfig.url,
    })
    message += `\n\nRemote Chrome bridge is configured (${context.bridgeConfig.url}), but this source build can only forward Chrome MCP calls through the local native-host socket. Start or reconnect the Chrome extension native host for this build.`
  }
  throw new McpError(ErrorCode.InternalError, message)
}

function hasChromeBridgeConfig(
  context: ClaudeForChromeContext,
): context is ClaudeForChromeContext & { bridgeConfig: ChromeBridgeConfig } {
  return (
    isRecord(context.bridgeConfig) &&
    typeof context.bridgeConfig.url === 'string' &&
    context.bridgeConfig.url.length > 0
  )
}

async function sendFramedRequest(
  socketPath: string,
  request: { method: string; params: Record<string, unknown> },
): Promise<unknown> {
  const socket = await connectSocket(socketPath)
  try {
    socket.write(encodeFrame(request))
    return await readFrame(socket)
  } finally {
    socket.end()
    socket.destroy()
  }
}

function connectSocket(socketPath: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = connect(socketPath)
    const cleanup = (): void => {
      socket.off('connect', handleConnect)
      socket.off('error', handleError)
    }
    const handleConnect = (): void => {
      cleanup()
      resolve(socket)
    }
    const handleError = (error: Error): void => {
      cleanup()
      socket.destroy()
      reject(error)
    }
    socket.once('connect', handleConnect)
    socket.once('error', handleError)
  })
}

function encodeFrame(message: unknown): Buffer {
  const payload = Buffer.from(JSON.stringify(message), 'utf8')
  if (payload.length === 0 || payload.length > MAX_FRAME_BYTES) {
    throw new Error(
      `Chrome native-host request exceeded ${MAX_FRAME_BYTES} bytes.`,
    )
  }
  const header = Buffer.alloc(4)
  header.writeUInt32LE(payload.length, 0)
  return Buffer.concat([header, payload])
}

function readFrame(socket: Socket): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0)
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error('Timed out waiting for Chrome native-host response.'))
    }, REQUEST_TIMEOUT_MS)

    const cleanup = (): void => {
      clearTimeout(timer)
      socket.off('data', handleData)
      socket.off('error', handleError)
      socket.off('close', handleClose)
    }

    const handleError = (error: Error): void => {
      cleanup()
      reject(error)
    }

    const handleClose = (): void => {
      cleanup()
      reject(new Error('Chrome native-host socket closed before responding.'))
    }

    const handleData = (chunk: Buffer): void => {
      buffer = Buffer.concat([buffer, chunk])
      while (buffer.length >= 4) {
        const length = buffer.readUInt32LE(0)
        if (length === 0 || length > MAX_FRAME_BYTES) {
          cleanup()
          reject(
            new Error(
              `Chrome native-host response had invalid frame length ${length}.`,
            ),
          )
          return
        }
        if (buffer.length < 4 + length) {
          return
        }

        const payload = buffer.subarray(4, 4 + length).toString('utf8')
        cleanup()
        try {
          resolve(JSON.parse(payload) as unknown)
        } catch (error) {
          reject(
            new Error(
              `Chrome native-host response was not valid JSON: ${
                error instanceof Error ? error.message : String(error)
              }`,
            ),
          )
        }
        return
      }
    }

    socket.on('data', handleData)
    socket.once('error', handleError)
    socket.once('close', handleClose)
  })
}

function normalizeToolResult(response: unknown): CallToolResult {
  if (isRecord(response)) {
    if ('error' in response && response.error !== undefined) {
      return {
        content: [{ type: 'text', text: stringifyForMcp(response.error) }],
        isError: true,
      }
    }

    if ('result' in response && response.result !== undefined) {
      return normalizeToolResult(response.result)
    }

    if (Array.isArray(response.content)) {
      return {
        content: normalizeContent(response.content),
        ...(typeof response.isError === 'boolean' && {
          isError: response.isError,
        }),
        ...(isRecord(response._meta) && { _meta: response._meta }),
        ...(isRecord(response.structuredContent) && {
          structuredContent: response.structuredContent,
        }),
      }
    }

    if (typeof response.content === 'string') {
      return {
        content: [{ type: 'text', text: response.content }],
        ...(typeof response.isError === 'boolean' && {
          isError: response.isError,
        }),
        ...(isRecord(response._meta) && { _meta: response._meta }),
        ...(isRecord(response.structuredContent) && {
          structuredContent: response.structuredContent,
        }),
      }
    }

    if ('text' in response && typeof response.text === 'string') {
      return { content: [{ type: 'text', text: response.text }] }
    }
  }

  if (typeof response === 'string') {
    return { content: [{ type: 'text', text: response }] }
  }

  if (response === undefined || response === null) {
    return { content: [] }
  }

  return { content: [{ type: 'text', text: stringifyForMcp(response) }] }
}

function normalizeContent(content: unknown[]): CallToolResult['content'] {
  return content.map(item => {
    if (isRecord(item) && typeof item.type === 'string') {
      return item as CallToolResult['content'][number]
    }
    return { type: 'text', text: stringifyForMcp(item) }
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringifyForMcp(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}
