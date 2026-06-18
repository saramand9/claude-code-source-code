import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js'

export type PermissionMode = 'ask' | 'skip_all_permission_checks' | 'follow_a_plan'

export type Logger = {
  silly?(message: string, ...args: unknown[]): void
  debug?(message: string, ...args: unknown[]): void
  info?(message: string, ...args: unknown[]): void
  warn?(message: string, ...args: unknown[]): void
  error?(message: string, ...args: unknown[]): void
}

export type ClaudeForChromeContext = {
  serverName?: string
  logger?: Logger
  socketPath?: string
  getSocketPaths?: () => string[]
  clientTypeId?: string
  initialPermissionMode?: PermissionMode
  onAuthenticationError?: () => void
  onToolCallDisconnected?: () => string
  onExtensionPaired?: (deviceId: string, name: string) => void
  getPersistedDeviceId?: () => string | undefined
  trackEvent?: (eventName: string, metadata?: Record<string, unknown>) => void
  [key: string]: unknown
}

export const BROWSER_TOOLS: ReadonlyArray<{ name: string }> = []

export function createClaudeForChromeMcpServer(
  context: ClaudeForChromeContext = {},
): Server {
  context.logger?.warn?.(
    'Claude in Chrome MCP private package is unavailable in this source build; starting an empty MCP server with no browser tools.',
  )
  context.trackEvent?.('tengu_chrome_mcp_external_shim_started', {
    tool_count: BROWSER_TOOLS.length,
  })
  const server = new Server(
    {
      name: context.serverName ?? 'Claude in Chrome unavailable',
      version: '0.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    },
  )
  server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: [] }))
  server.setRequestHandler(CallToolRequestSchema, request => {
    throw new McpError(
      ErrorCode.InvalidParams,
      `Claude in Chrome tool "${request.params.name}" is unavailable in this source build.`,
    )
  })
  return server
}
