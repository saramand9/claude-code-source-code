export type LspServerState = 'stopped' | 'starting' | 'running' | 'stopping' | 'error'

export type LspServerConfig = {
  command: string
  args?: string[]
  env?: Record<string, string>
  workspaceFolder?: string
  initializationOptions?: unknown
  startupTimeout?: number
  shutdownTimeout?: number
  restartOnCrash?: boolean
  maxRestarts?: number
  scope?: string
  [key: string]: any
}

export type ScopedLspServerConfig = LspServerConfig
