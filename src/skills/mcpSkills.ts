import {
  ListResourcesResultSchema,
  ReadResourceResultSchema,
  type ReadResourceResult,
  type Resource,
} from '@modelcontextprotocol/sdk/types.js'
import type { MCPServerConnection } from '../services/mcp/types.js'
import type { Command } from '../types/command.js'
import { normalizeNameForMCP } from '../services/mcp/normalization.js'
import { logForDebugging } from '../utils/debug.js'
import { errorMessage } from '../utils/errors.js'
import { parseFrontmatter } from '../utils/frontmatterParser.js'
import { memoizeWithLRU } from '../utils/memoize.js'
import { getMCPSkillBuilders } from './mcpSkillBuilders.js'

const MCP_SKILL_CACHE_SIZE = 20
const SKILL_SCHEME = 'skill://'

function isSkillResource(resource: Resource): boolean {
  return resource.uri.startsWith(SKILL_SCHEME)
}

function getSkillNameFromResource(resource: Resource): string {
  const explicitName =
    typeof resource.name === 'string' && resource.name.trim()
      ? resource.name.trim()
      : undefined

  if (explicitName) {
    return explicitName
  }

  try {
    const url = new URL(resource.uri)
    const pathParts = url.pathname.split('/').filter(Boolean)
    const candidate = pathParts.at(-1) ?? url.hostname
    return candidate.replace(/\.md$/i, '').replace(/^skill$/i, '') || 'skill'
  } catch {
    return (
      resource.uri.slice(SKILL_SCHEME.length).replace(/\.md$/i, '') || 'skill'
    )
  }
}

function textFromReadResourceResult(result: ReadResourceResult): string | null {
  const textParts = result.contents.flatMap(content =>
    'text' in content && typeof content.text === 'string'
      ? [content.text]
      : [],
  )
  return textParts.length > 0 ? textParts.join('\n\n') : null
}

async function readSkillMarkdown(
  client: MCPServerConnection,
  resource: Resource,
): Promise<string | null> {
  if (client.type !== 'connected') {
    return null
  }

  try {
    const result = await client.client.request(
      { method: 'resources/read', params: { uri: resource.uri } },
      ReadResourceResultSchema,
    )
    return textFromReadResourceResult(result)
  } catch (error) {
    logForDebugging(
      `[mcp-skills] failed to read ${resource.uri} from ${client.name}: ${errorMessage(error)}`,
      { level: 'warn' },
    )
    return null
  }
}

async function fetchMcpSkillsForConnectedClient(
  client: MCPServerConnection,
): Promise<Command[]> {
  if (client.type !== 'connected' || !client.capabilities?.resources) {
    return []
  }

  let resources: Resource[] = []
  try {
    const result = await client.client.request(
      { method: 'resources/list' },
      ListResourcesResultSchema,
    )
    resources = result.resources.filter(isSkillResource)
  } catch (error) {
    logForDebugging(
      `[mcp-skills] failed to list resources from ${client.name}: ${errorMessage(error)}`,
      { level: 'warn' },
    )
    return []
  }

  if (resources.length === 0) {
    return []
  }

  const { createSkillCommand, parseSkillFrontmatterFields } =
    getMCPSkillBuilders()
  const serverPrefix = normalizeNameForMCP(client.name)
  const commands: Command[] = []

  for (const resource of resources) {
    const markdown = await readSkillMarkdown(client, resource)
    if (!markdown) {
      continue
    }

    try {
      const rawSkillName = getSkillNameFromResource(resource)
      const skillName = `${serverPrefix}:${normalizeNameForMCP(rawSkillName)}`
      const { frontmatter, content } = parseFrontmatter(
        markdown,
        resource.uri,
      )
      const parsed = parseSkillFrontmatterFields(
        frontmatter,
        content,
        skillName,
      )
      const description =
        parsed.hasUserSpecifiedDescription || !resource.description
          ? parsed.description
          : resource.description

      commands.push(
        createSkillCommand({
          ...parsed,
          description,
          hasUserSpecifiedDescription:
            parsed.hasUserSpecifiedDescription || !!resource.description,
          displayName: parsed.displayName ?? resource.name,
          skillName,
          markdownContent: content,
          source: 'mcp',
          baseDir: undefined,
          loadedFrom: 'mcp',
          paths: undefined,
        }),
      )
    } catch (error) {
      logForDebugging(
        `[mcp-skills] failed to parse ${resource.uri} from ${client.name}: ${errorMessage(error)}`,
        { level: 'warn' },
      )
    }
  }

  return commands
}

export type FetchMcpSkillsForClient = typeof fetchMcpSkillsForClient

export const fetchMcpSkillsForClient = memoizeWithLRU(
  fetchMcpSkillsForConnectedClient,
  (client: MCPServerConnection) => client.name,
  MCP_SKILL_CACHE_SIZE,
)
