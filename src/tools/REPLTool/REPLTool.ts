import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { jsonStringify } from '../../utils/slowOperations.js'
import { REPL_TOOL_NAME } from './constants.js'

const inputSchema = lazySchema(() =>
  z.object({}).passthrough().describe('REPL execution request'),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    status: z.literal('unavailable'),
    implementation: z.literal('external-conservative'),
    message: z.string(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

export type Output = z.infer<OutputSchema>

export const REPLTool = buildTool({
  name: REPL_TOOL_NAME,
  searchHint: 'repl execution unavailable',
  maxResultSizeChars: 100_000,
  async description() {
    return 'REPL execution is unavailable in this source build.'
  },
  async prompt() {
    return `The REPL wrapper tool is unavailable in this source build.

Use Bash, Read, Edit, Write, NotebookEdit, Glob, Grep, or Agent directly
instead of routing those operations through REPL.`
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
  isTransparentWrapper() {
    return true
  },
  renderToolUseMessage() {
    return null
  },
  async call(): Promise<{ data: Output }> {
    return {
      data: {
        status: 'unavailable',
        implementation: 'external-conservative',
        message:
          'REPLTool is not implemented in this source build. Use direct tools instead.',
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

export default REPLTool
