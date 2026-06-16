import type {
  ConfigScope,
  MCPServerConnection,
  ScopedMcpServerConfig,
} from '../../services/mcp/types.js'

export type ServerInfo = {
  name: string
  scope: ConfigScope
  client: MCPServerConnection
  config?: ScopedMcpServerConfig
  [key: string]: any
}

export type AgentMcpServerInfo = {
  name: string
  sourceAgents: string[]
  needsAuth?: boolean
  config?: ScopedMcpServerConfig
  [key: string]: any
}

export type MCPViewState = {
  view?: string
  selectedServer?: ServerInfo
  selectedAgentServer?: AgentMcpServerInfo
  [key: string]: any
}

export type StdioServerInfo = ServerInfo
export type SSEServerInfo = ServerInfo
export type HTTPServerInfo = ServerInfo
export type ClaudeAIServerInfo = ServerInfo
