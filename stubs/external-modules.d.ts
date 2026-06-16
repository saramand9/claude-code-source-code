declare module '@anthropic-ai/claude-agent-sdk' {
  export type { PermissionMode } from '../src/entrypoints/agentSdkTypes.js'
}

declare module 'react/compiler-runtime' {
  export function c(size: number): any[]
}

declare module '*.md' {
  const content: string
  export default content
}

declare module 'color-diff-napi' {
  export type SyntaxTheme = Record<string, unknown>
  export const ColorDiff: any
  export const ColorFile: any
  export function getSyntaxTheme(themeName: string): SyntaxTheme | null
}

declare module 'cli-highlight' {
  export function highlight(code: string, options?: any): string
  export function supportsLanguage(language: string): boolean
}

declare module 'plist' {
  export function parse(input: string): any
  export function build(input: any): string
  const plist: { parse: typeof parse; build: typeof build }
  export default plist
}

declare module 'audio-capture-napi' {
  const audioCapture: any
  export = audioCapture
}

declare module 'cacache' {
  const cacache: any
  export = cacache
}

declare module 'vscode-jsonrpc/node.js' {
  export type MessageConnection = any
  export class StreamMessageReader {
    constructor(stream: any)
  }
  export class StreamMessageWriter {
    constructor(stream: any)
  }
  export const Trace: any
  export function createMessageConnection(
    reader: StreamMessageReader,
    writer: StreamMessageWriter,
  ): MessageConnection
}

declare module '@ant/claude-for-chrome-mcp' {
  export type PermissionMode =
    | 'ask'
    | 'skip_all_permission_checks'
    | 'follow_a_plan'
    | string
  export type Logger = {
    silly(message: string, ...args: unknown[]): void
    debug(message: string, ...args: unknown[]): void
    info(message: string, ...args: unknown[]): void
    warn(message: string, ...args: unknown[]): void
    error(message: string, ...args: unknown[]): void
  }
  export type ClaudeForChromeContext = Record<string, any>
  export const BROWSER_TOOLS: readonly string[]
  export function createClaudeForChromeMcpServer(
    context: ClaudeForChromeContext,
  ): any
}

declare module '@ant/computer-use-mcp' {
  export type ComputerExecutor = any
  export type ComputerUseSessionContext = any
  export type CuCallToolResult = any
  export type CuPermissionRequest = any
  export type CuPermissionResponse = any
  export type DisplayGeometry = any
  export type FrontmostApp = any
  export type InstalledApp = any
  export type ResolvePrepareCaptureResult = any
  export type RunningApp = any
  export type ScreenshotDims = any
  export type ScreenshotResult = any
  export const API_RESIZE_PARAMS: any
  export const DEFAULT_GRANT_FLAGS: any
  export function bindSessionContext(...args: any[]): any
  export function buildComputerUseTools(...args: any[]): any
  export function createComputerUseMcpServer(...args: any[]): any
  export function targetImageSize(...args: any[]): [number, number]
}

declare module '@ant/computer-use-mcp/types' {
  export type ComputerUseHostAdapter = any
  export type CoordinateMode = string
  export type CuSubGates = Record<string, boolean>
  export type CuPermissionRequest = any
  export type CuPermissionResponse = any
  export type Logger = {
    silly(message: string, ...args: unknown[]): void
    debug(message: string, ...args: unknown[]): void
    info(message: string, ...args: unknown[]): void
    warn(message: string, ...args: unknown[]): void
    error(message: string, ...args: unknown[]): void
  }
  export const DEFAULT_GRANT_FLAGS: any
}

declare module '@ant/computer-use-mcp/sentinelApps' {
  export function getSentinelCategory(
    bundleId: string,
  ): 'shell' | 'filesystem' | 'system_settings' | null
}

declare module '@ant/computer-use-input' {
  export type ComputerUseInputAPI = any
  export type ComputerUseInput =
    | ({ isSupported: true } & ComputerUseInputAPI)
    | { isSupported: false }
  const computerUseInput: any
  export = computerUseInput
}

declare module '@ant/computer-use-swift' {
  export type ComputerUseAPI = any
  const computerUseSwift: ComputerUseAPI
  export = computerUseSwift
}
