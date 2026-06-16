import type { BetaUsage } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'

export type NonNullableUsage = Omit<
  BetaUsage,
  | 'cache_creation'
  | 'cache_creation_input_tokens'
  | 'cache_read_input_tokens'
  | 'inference_geo'
  | 'iterations'
  | 'output_tokens_details'
  | 'server_tool_use'
  | 'service_tier'
  | 'speed'
> & {
  input_tokens: number
  output_tokens: number
  output_tokens_details: NonNullable<BetaUsage['output_tokens_details']>
  cache_creation_input_tokens: number
  cache_read_input_tokens: number
  server_tool_use: NonNullable<BetaUsage['server_tool_use']>
  service_tier: NonNullable<BetaUsage['service_tier']>
  cache_creation: NonNullable<BetaUsage['cache_creation']>
  inference_geo: NonNullable<BetaUsage['inference_geo']>
  iterations: NonNullable<BetaUsage['iterations']>
  speed: NonNullable<BetaUsage['speed']>
  [key: string]: any
}
