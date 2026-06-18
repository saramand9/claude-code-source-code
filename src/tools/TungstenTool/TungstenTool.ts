import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { jsonStringify } from '../../utils/slowOperations.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    command: z
      .string()
      .optional()
      .describe('Command or shell session request intended for Tungsten.'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    status: z.literal('unavailable'),
    implementation: z.literal('external-conservative'),
    message: z.string(),
    command: z.string().optional(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

export type Output = z.infer<OutputSchema>

let initializationResetCount = 0
let usageClearCount = 0

export function clearSessionsWithTungstenUsage(): void {
  usageClearCount++
}

export function resetInitializationState(): void {
  initializationResetCount++
}

export function getTungstenFallbackState(): {
  usageClearCount: number
  initializationResetCount: number
} {
  return {
    usageClearCount,
    initializationResetCount,
  }
}

export const TungstenTool = buildTool({
  name: 'Tungsten',
  searchHint: 'terminal session unavailable',
  maxResultSizeChars: 100_000,
  async description() {
    return 'Tungsten terminal sessions are unavailable in this source build.'
  },
  async prompt() {
    return `Tungsten is unavailable in this source build.

Use Bash, Read, Edit, Write, or NotebookEdit for supported local work instead.`
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  isEnabled() {
    return false
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
  async call({ command }): Promise<{ data: Output }> {
    return {
      data: {
        status: 'unavailable',
        implementation: 'external-conservative',
        message:
          'Tungsten terminal sessions are unavailable in this source build. Use Bash or file tools instead.',
        ...(command ? { command } : {}),
      },
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
