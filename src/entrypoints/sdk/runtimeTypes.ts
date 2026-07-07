import type { CallToolResult, ToolAnnotations } from '@modelcontextprotocol/sdk/types.js'
import type { z } from 'zod/v4'
import type {
  SDKMessage,
  SDKResultMessage,
  SDKSessionInfo,
  SDKUserMessage,
} from './coreTypes.js'

export type EffortLevel = 'low' | 'medium' | 'high' | 'max' | 'xhigh'
export type AnyZodRawShape = z.ZodRawShape
export type InferShape<Schema extends AnyZodRawShape> = z.infer<z.ZodObject<Schema>>

export type SdkMcpToolDefinition<
  Schema extends AnyZodRawShape = AnyZodRawShape,
> = {
  name: string
  description: string
  inputSchema: Schema
  handler?: (
    args: InferShape<Schema>,
    extra: unknown,
  ) => Promise<CallToolResult> | CallToolResult
  annotations?: ToolAnnotations
  searchHint?: string
  alwaysLoad?: boolean
}

export type McpSdkServerConfigWithInstance = {
  type?: 'sdk'
  name?: string
  version?: string
  tools?: Array<SdkMcpToolDefinition<any>>
  instance?: unknown
}

export type Options = Record<string, unknown>
export type InternalOptions = Options

export interface Query extends AsyncIterable<SDKMessage> {
  abort?: () => void
  [key: string]: unknown
}

export interface InternalQuery extends Query {}

export type SDKSessionOptions = Record<string, unknown>

export interface SDKSession extends AsyncIterable<SDKMessage> {
  id?: string
  prompt?: (message: string | SDKUserMessage) => Promise<SDKResultMessage>
  send?: (message: string | SDKUserMessage) => void
  abort?: () => void
  close?: () => void
  [key: string]: unknown
}

export type SessionMessage = SDKMessage

export type ListSessionsOptions = {
  dir?: string
  limit?: number
  offset?: number
  includeWorktrees?: boolean
}

export type GetSessionInfoOptions = {
  dir?: string
}

export type GetSessionMessagesOptions = {
  dir?: string
  limit?: number
  offset?: number
  includeSystemMessages?: boolean
}

export type SessionMutationOptions = {
  dir?: string
}

export type ForkSessionOptions = {
  dir?: string
  upToMessageId?: string
  title?: string
}

export type ForkSessionResult = {
  sessionId: string
}

export type { SDKSessionInfo, SDKUserMessage }
