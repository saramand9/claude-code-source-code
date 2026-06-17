import { z } from 'zod/v4'
import {
  isSnipRuntimeEnabled,
  snipCompactIfNeeded,
} from '../../services/compact/snipCompact.js'
import { buildTool, type ToolDef } from '../../Tool.js'
import type { SystemMessage } from '../../types/message.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { jsonStringify } from '../../utils/slowOperations.js'
import { SNIP_TOOL_NAME } from './prompt.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    reason: z
      .string()
      .optional()
      .describe('Short reason for snipping old context.'),
    targetIds: z
      .array(z.string())
      .optional()
      .describe('Optional message ids or UUIDs to remove as whole safe turns.'),
    targetTokens: z
      .number()
      .int()
      .positive()
      .optional()
      .describe('Optional target token budget after snipping.'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    executed: z.boolean(),
    removedMessages: z.number(),
    tokensFreed: z.number(),
    strategy: z.string().optional(),
    preTokens: z.number().optional(),
    postTokens: z.number().optional(),
    reason: z.string().optional(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

export type Output = z.infer<OutputSchema>

export const SnipTool = buildTool({
  name: SNIP_TOOL_NAME,
  searchHint: 'remove stale conversation history',
  maxResultSizeChars: 100_000,
  async description() {
    return 'Snip stale conversation history from the active model context.'
  },
  async prompt() {
    return `Use this when old conversation history is no longer relevant and preserving recent context is more valuable.

The tool appends a snip boundary to the transcript. The UI can keep scrollback,
while future model calls project out the removed messages.`
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  shouldDefer: true,
  isEnabled() {
    return isSnipRuntimeEnabled()
  },
  isConcurrencySafe() {
    return true
  },
  isReadOnly() {
    return true
  },
  renderToolUseMessage() {
    return null
  },
  async call(
    { reason, targetIds, targetTokens },
    context,
  ): Promise<{ data: Output; newMessages?: SystemMessage[] }> {
    const result = snipCompactIfNeeded(context.messages, {
      force: true,
      trigger: 'tool',
      reason,
      targetMessageIds: targetIds,
      targetTokens,
    })
    return {
      data: {
        executed: result.executed,
        removedMessages: result.removedMessages,
        tokensFreed: result.tokensFreed,
        strategy: result.strategy,
        preTokens: result.preTokens,
        postTokens: result.postTokens,
        reason,
      },
      newMessages: result.boundaryMessage ? [result.boundaryMessage] : [],
    }
  },
  mapToolResultToToolResultBlockParam(content, toolUseID) {
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: jsonStringify(content, null, 2),
    }
  },
} satisfies ToolDef<InputSchema, Output>)
