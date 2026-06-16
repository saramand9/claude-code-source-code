import '@anthropic-ai/mcpb'

declare module '@anthropic-ai/mcpb' {
  export type McpbUserConfigurationOption = {
    type: 'string' | 'number' | 'boolean' | 'file' | 'directory' | string
    title?: string
    description?: string
    required?: boolean
    sensitive?: boolean
    multiple?: boolean
    min?: number
    max?: number
    default?: unknown
    enum?: readonly unknown[]
    [key: string]: unknown
  }
}
