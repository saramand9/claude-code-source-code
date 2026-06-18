import type { ToolResultBlockParam } from '@anthropic-ai/sdk/resources/index.mjs'
import { z } from 'zod/v4'
import { getProjectRoot } from '../../bootstrap/state.js'
import { getMcpSkillCommands } from '../../commands.js'
import {
  buildTool,
  type ToolDef,
  type ToolResult,
  type ToolUseContext,
} from '../../Tool.js'
import { searchSkillIndex } from '../../services/skillSearch/localSearch.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { DISCOVER_SKILLS_TOOL_NAME } from './constants.js'
import { getPrompt } from './prompt.js'

export const inputSchema = lazySchema(() =>
  z.object({
    query: z
      .string()
      .describe('Task description or keywords to search matching skills for'),
    max_results: z
      .number()
      .int()
      .min(1)
      .max(20)
      .optional()
      .default(5)
      .describe('Maximum number of skills to return'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

export const outputSchema = lazySchema(() =>
  z.object({
    query: z.string(),
    skills: z.array(
      z.object({
        name: z.string(),
        description: z.string(),
      }),
    ),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
export type Output = z.infer<OutputSchema>

function markDiscovered(context: ToolUseContext, names: readonly string[]): void {
  if (!context.discoveredSkillNames) {
    context.discoveredSkillNames = new Set<string>()
  }
  for (const name of names) {
    context.discoveredSkillNames.add(name)
  }
}

function normalizeMaxResults(maxResults: number): number {
  if (!Number.isFinite(maxResults)) return 5
  return Math.max(1, Math.min(20, Math.floor(maxResults)))
}

export const DiscoverSkillsTool = buildTool({
  name: DISCOVER_SKILLS_TOOL_NAME,
  searchHint: 'find matching slash-command skills',
  maxResultSizeChars: 20_000,
  isConcurrencySafe() {
    return true
  },
  isReadOnly() {
    return true
  },
  async description() {
    return getPrompt()
  },
  async prompt() {
    return getPrompt()
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  async call(
    { query, max_results = 5 },
    context,
  ): Promise<ToolResult<Output>> {
    const mcpSkills = getMcpSkillCommands(context.getAppState().mcp.commands)
    const results = await searchSkillIndex(getProjectRoot(), query, {
      extraCommands: mcpSkills,
      excludeNames: context.discoveredSkillNames,
      maxResults: normalizeMaxResults(max_results),
    })
    markDiscovered(
      context,
      results.map(result => result.name),
    )
    return {
      data: {
        query,
        skills: results.map(result => ({
          name: result.name,
          description: result.description,
        })),
      },
    }
  },
  renderToolUseMessage() {
    return null
  },
  mapToolResultToToolResultBlockParam(
    output: Output,
    toolUseID: string,
  ): ToolResultBlockParam {
    if (output.skills.length === 0) {
      return {
        type: 'tool_result',
        tool_use_id: toolUseID,
        content: `No matching skills found for: ${output.query}`,
      }
    }
    return {
      type: 'tool_result',
      tool_use_id: toolUseID,
      content: [
        `Matching skills for: ${output.query}`,
        '',
        ...output.skills.map(skill => `- ${skill.name}: ${skill.description}`),
        '',
        'Invoke a listed skill with the Skill tool to load its full instructions.',
      ].join('\n'),
    }
  },
  userFacingName: () => '',
} satisfies ToolDef<InputSchema, Output>)
