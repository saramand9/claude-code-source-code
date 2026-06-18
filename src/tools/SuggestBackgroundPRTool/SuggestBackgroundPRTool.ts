import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { jsonStringify } from '../../utils/slowOperations.js'

const inputSchema = lazySchema(() =>
  z.object({}).passthrough().describe('Background pull request suggestion'),
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

export const SuggestBackgroundPRTool = buildTool({
  name: 'SuggestBackgroundPR',
  searchHint: 'background pull request unavailable',
  maxResultSizeChars: 100_000,
  async description() {
    return 'Background pull request suggestions are unavailable in this source build.'
  },
  async prompt() {
    return `SuggestBackgroundPR is unavailable in this source build.

If you need to propose a pull request, summarize the suggested change in the
conversation instead of invoking this internal background PR workflow.`
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
  async call(): Promise<{ data: Output }> {
    return {
      data: {
        status: 'unavailable',
        implementation: 'external-conservative',
        message:
          'SuggestBackgroundPRTool is not implemented in this source build.',
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

export default SuggestBackgroundPRTool
