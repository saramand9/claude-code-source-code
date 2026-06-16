import { z } from 'zod/v4'
import {
  getStats,
  isContextCollapseEnabled,
  isContextCollapseRuntimeRequested,
} from '../../services/contextCollapse/index.js'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { jsonStringify } from '../../utils/slowOperations.js'

const inputSchema = lazySchema(() => z.strictObject({}))
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    enabled: z.boolean(),
    runtimeRequested: z.boolean(),
    implementation: z.literal('external-conservative'),
    stats: z.unknown(),
    warning: z.string(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

export type Output = z.infer<OutputSchema>

export const CtxInspectTool = buildTool({
  name: 'CtxInspect',
  searchHint: 'inspect context collapse state',
  maxResultSizeChars: 100_000,
  async description() {
    return 'Inspect the context collapse runtime state.'
  },
  async prompt() {
    return `Inspect context collapse state for this session.

This source build exposes a conservative external implementation: it can load
and restore recorded collapse metadata, but it does not summarize or remove
messages by itself.`
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  shouldDefer: true,
  isEnabled() {
    return isContextCollapseRuntimeRequested()
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
    const stats = getStats()
    return {
      data: {
        enabled: isContextCollapseEnabled(),
        runtimeRequested: isContextCollapseRuntimeRequested(),
        implementation: stats.implementation,
        stats,
        warning:
          'ContextCollapse is loadable in this source build, but projection and summarization are conservative no-ops.',
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
