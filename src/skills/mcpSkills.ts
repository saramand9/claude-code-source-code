import {
  ListResourcesResultSchema,
  ReadResourceResultSchema,
  type ReadResourceResult,
  type Resource,
} from '@modelcontextprotocol/sdk/types.js'
import { createHash } from 'node:crypto'
import type { MCPServerConnection } from '../services/mcp/types.js'
import type { Command } from '../types/command.js'
import { normalizeNameForMCP } from '../services/mcp/normalization.js'
import { logForDebugging } from '../utils/debug.js'
import { errorMessage } from '../utils/errors.js'
import {
  parseFrontmatter,
  type FrontmatterData,
} from '../utils/frontmatterParser.js'
import { memoizeWithLRU } from '../utils/memoize.js'
import { getMCPSkillBuilders } from './mcpSkillBuilders.js'

const MCP_SKILL_CACHE_SIZE = 20
const SKILL_SCHEME = 'skill://'
const MAX_MCP_SKILL_RESOURCES_PER_SERVER = 50
const MAX_MCP_SKILL_URI_CHARS = 2048
const MAX_MCP_SKILL_MARKDOWN_CHARS = 100_000
const MAX_MCP_SKILL_NAME_CHARS = 200
const MAX_MCP_SKILL_DESCRIPTION_CHARS = 1000
const CONTROL_CHARS_RE = /[\u0000-\u001F\u007F]/
const CONTROL_CHARS_GLOBAL_RE = /[\u0000-\u001F\u007F]+/g
const MCP_SKILL_IGNORED_FRONTMATTER_KEYS = [
  'allowed-tools',
  'hooks',
  'context',
  'agent',
  'model',
  'effort',
  'shell',
] as const

function stableStringifyForCache(
  value: unknown,
  seen = new WeakSet<object>(),
): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null'
  }
  if (seen.has(value)) {
    return '"[Circular]"'
  }
  seen.add(value)
  if (Array.isArray(value)) {
    return `[${value.map(item => stableStringifyForCache(item, seen)).join(',')}]`
  }
  const obj = value as Record<string, unknown>
  const entries = Object.keys(obj)
    .filter(key => {
      const item = obj[key]
      return item !== undefined && typeof item !== 'function'
    })
    .sort()
    .map(
      key =>
        `${JSON.stringify(key)}:${stableStringifyForCache(obj[key], seen)}`,
    )
  return `{${entries.join(',')}}`
}

function hashMcpSkillConfig(config: unknown): string {
  return createHash('sha256')
    .update(stableStringifyForCache(config ?? {}))
    .digest('hex')
    .slice(0, 16)
}

export function getMcpSkillCacheKeyForServer(
  name: string,
  config: unknown,
): string {
  return `${name}:${hashMcpSkillConfig(config)}`
}

export function getMcpSkillCacheKey(client: MCPServerConnection): string {
  return getMcpSkillCacheKeyForServer(String(client.name ?? ''), client.config)
}

function normalizeMcpSkillText(
  value: unknown,
  maxChars: number,
): string | undefined {
  if (
    value !== undefined &&
    value !== null &&
    typeof value !== 'string' &&
    typeof value !== 'number' &&
    typeof value !== 'boolean'
  ) {
    return undefined
  }
  const normalized = String(value ?? '')
    .replace(CONTROL_CHARS_GLOBAL_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, Math.max(0, maxChars))
  return normalized || undefined
}

function hasMeaningfulFrontmatterValue(value: unknown): boolean {
  if (value === undefined || value === null || value === false) return false
  if (typeof value === 'string') return value.trim().length > 0
  if (Array.isArray(value)) return value.length > 0
  if (typeof value === 'object') return Object.keys(value).length > 0
  return true
}

function getIgnoredMcpSkillFrontmatterKeys(
  frontmatter: FrontmatterData,
): string[] {
  return MCP_SKILL_IGNORED_FRONTMATTER_KEYS.filter(key =>
    hasMeaningfulFrontmatterValue(frontmatter[key]),
  )
}

function stripUntrustedMcpSkillFrontmatter(
  frontmatter: FrontmatterData,
): FrontmatterData {
  const stripped = { ...frontmatter }
  for (const key of MCP_SKILL_IGNORED_FRONTMATTER_KEYS) {
    delete stripped[key]
  }
  return stripped
}

export function getSkillResourceSkipReason(resource: Resource): string | null {
  if (typeof resource.uri !== 'string') {
    return 'missing uri'
  }
  if (!resource.uri.startsWith(SKILL_SCHEME)) {
    return 'not skill resource'
  }
  if (resource.uri.length > MAX_MCP_SKILL_URI_CHARS) {
    return `uri exceeds ${MAX_MCP_SKILL_URI_CHARS} characters`
  }
  if (CONTROL_CHARS_RE.test(resource.uri)) {
    return 'uri contains control characters'
  }
  try {
    const url = new URL(resource.uri)
    if (url.protocol !== 'skill:') {
      return 'uri is not a skill URL'
    }
    if (!url.hostname && !url.pathname.replace(/^\/+/, '')) {
      return 'uri has no skill identifier'
    }
  } catch {
    return 'uri is not parseable'
  }
  return null
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
    const markdown = textFromReadResourceResult(result)
    if (markdown && markdown.length > MAX_MCP_SKILL_MARKDOWN_CHARS) {
      logForDebugging(
        `[mcp-skills] skipped ${resource.uri} from ${client.name}: markdown exceeds ${MAX_MCP_SKILL_MARKDOWN_CHARS} characters`,
        { level: 'warn' },
      )
      return null
    }
    return markdown
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
    const skillResources: Resource[] = []
    for (const resource of result.resources) {
      const skipReason = getSkillResourceSkipReason(resource)
      if (skipReason === null) {
        skillResources.push(resource)
      } else if (skipReason !== 'not skill resource') {
        logForDebugging(
          `[mcp-skills] skipped resource from ${client.name}: ${skipReason}`,
          { level: 'warn' },
        )
      }
    }
    if (skillResources.length > MAX_MCP_SKILL_RESOURCES_PER_SERVER) {
      logForDebugging(
        `[mcp-skills] limiting ${client.name} skill resources from ${skillResources.length} to ${MAX_MCP_SKILL_RESOURCES_PER_SERVER}`,
        { level: 'warn' },
      )
    }
    resources = skillResources.slice(0, MAX_MCP_SKILL_RESOURCES_PER_SERVER)
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
      const rawSkillName =
        normalizeMcpSkillText(
          getSkillNameFromResource(resource),
          MAX_MCP_SKILL_NAME_CHARS,
        ) ?? 'skill'
      const skillName = `${serverPrefix}:${normalizeNameForMCP(rawSkillName)}`
      const { frontmatter, content } = parseFrontmatter(
        markdown,
        resource.uri,
      )
      const ignoredFrontmatterKeys =
        getIgnoredMcpSkillFrontmatterKeys(frontmatter)
      if (ignoredFrontmatterKeys.length > 0) {
        logForDebugging(
          `[mcp-skills] ignored untrusted frontmatter from ${resource.uri} on ${client.name}: ${ignoredFrontmatterKeys.join(', ')}`,
          { level: 'warn' },
        )
      }
      const parsed = parseSkillFrontmatterFields(
        stripUntrustedMcpSkillFrontmatter(frontmatter),
        content,
        skillName,
      )
      const rawDescription =
        parsed.hasUserSpecifiedDescription || !resource.description
          ? parsed.description
          : resource.description
      const description =
        normalizeMcpSkillText(
          rawDescription,
          MAX_MCP_SKILL_DESCRIPTION_CHARS,
        ) ?? 'MCP skill'
      const displayName = normalizeMcpSkillText(
        parsed.displayName ?? resource.name,
        MAX_MCP_SKILL_NAME_CHARS,
      )
      const argumentHint = normalizeMcpSkillText(
        parsed.argumentHint,
        MAX_MCP_SKILL_DESCRIPTION_CHARS,
      )
      const whenToUse = normalizeMcpSkillText(
        parsed.whenToUse,
        MAX_MCP_SKILL_DESCRIPTION_CHARS,
      )
      const version = normalizeMcpSkillText(parsed.version, 100)

      commands.push(
        createSkillCommand({
          ...parsed,
          description,
          hasUserSpecifiedDescription:
            parsed.hasUserSpecifiedDescription || !!resource.description,
          displayName,
          allowedTools: [],
          argumentHint,
          whenToUse,
          version,
          model: undefined,
          hooks: undefined,
          executionContext: undefined,
          agent: undefined,
          effort: undefined,
          shell: undefined,
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
  getMcpSkillCacheKey,
  MCP_SKILL_CACHE_SIZE,
)
