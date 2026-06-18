import uniqBy from 'lodash-es/uniqBy.js'
import {
  getCommandName,
  getSkillToolCommands,
  type Command,
} from '../../commands.js'
import { memoizeWithLRU } from '../../utils/memoize.js'

export type SkillSearchResult = {
  name: string
  description: string
  score: number
  command: Command
}

export type SkillIndex = {
  cwd: string
  commands: Command[]
}

type SearchOptions = {
  extraCommands?: readonly Command[]
  excludeNames?: ReadonlySet<string>
  maxResults?: number
}

const DEFAULT_MAX_RESULTS = 5
const MAX_RESULTS_LIMIT = 20
const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'for',
  'how',
  'in',
  'into',
  'need',
  'of',
  'on',
  'or',
  'please',
  'run',
  'task',
  'the',
  'to',
  'use',
  'using',
  'with',
])

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/[_:/.-]+/g, ' ')
}

function tokenize(query: string): string[] {
  return normalizeText(query)
    .split(/\s+/)
    .map(term => term.trim())
    .filter(term => term.length > 1 && !STOP_WORDS.has(term))
}

function normalizeMaxResults(maxResults: number | undefined): number {
  if (!Number.isFinite(maxResults ?? DEFAULT_MAX_RESULTS)) {
    return DEFAULT_MAX_RESULTS
  }
  return Math.max(
    1,
    Math.min(MAX_RESULTS_LIMIT, Math.floor(maxResults ?? DEFAULT_MAX_RESULTS)),
  )
}

function commandSearchText(command: Command): string {
  const aliases = command.aliases?.join(' ') ?? ''
  const paths =
    command.type === 'prompt' && command.paths ? command.paths.join(' ') : ''
  return [
    command.name,
    getCommandName(command),
    aliases,
    command.description,
    command.whenToUse ?? '',
    command.type === 'prompt' ? command.source : '',
    command.loadedFrom ?? '',
    paths,
  ].join(' ')
}

function commandDescription(command: Command): string {
  return command.whenToUse
    ? `${command.description} - ${command.whenToUse}`
    : command.description
}

function scoreCommand(command: Command, terms: string[], rawQuery: string): number {
  const name = normalizeText(command.name)
  const displayName = normalizeText(getCommandName(command))
  const aliases = command.aliases?.map(normalizeText) ?? []
  const description = normalizeText(command.description)
  const whenToUse = normalizeText(command.whenToUse ?? '')
  const allText = normalizeText(commandSearchText(command))
  const normalizedQuery = normalizeText(rawQuery).trim()

  let score = 0
  if (normalizedQuery.length > 0) {
    if (name === normalizedQuery || displayName === normalizedQuery) {
      score += 120
    } else if (
      name.startsWith(normalizedQuery) ||
      displayName.startsWith(normalizedQuery)
    ) {
      score += 80
    } else if (name.includes(normalizedQuery) || displayName.includes(normalizedQuery)) {
      score += 45
    }
  }

  for (const term of terms) {
    let matched = false
    if (name.split(/\s+/).includes(term) || displayName.split(/\s+/).includes(term)) {
      score += 35
      matched = true
    } else if (name.includes(term) || displayName.includes(term)) {
      score += 22
      matched = true
    }
    if (aliases.some(alias => alias === term || alias.includes(term))) {
      score += 28
      matched = true
    }
    if (description.includes(term)) {
      score += 12
      matched = true
    }
    if (whenToUse.includes(term)) {
      score += 18
      matched = true
    }
    if (!matched && allText.includes(term)) {
      score += 4
      matched = true
    }
    if (!matched) {
      return 0
    }
  }

  if (command.loadedFrom === 'bundled') score += 5
  if (command.loadedFrom === 'mcp') score += 4
  if (command.type === 'prompt' && command.source === 'plugin') score += 2
  return score
}

async function buildSkillIndex(cwd: string): Promise<SkillIndex> {
  return {
    cwd,
    commands: await getSkillToolCommands(cwd),
  }
}

export const getSkillIndex = memoizeWithLRU(
  buildSkillIndex,
  cwd => cwd,
  20,
)

export function clearSkillIndexCache(): void {
  getSkillIndex.cache.clear()
}

export async function searchSkillIndex(
  cwd: string,
  query: string,
  options: SearchOptions = {},
): Promise<SkillSearchResult[]> {
  const rawQuery = String(query ?? '')
  const terms = tokenize(rawQuery)
  if (terms.length === 0 && rawQuery.trim().length === 0) {
    return []
  }

  const index = await getSkillIndex(cwd)
  const allCommands = uniqBy(
    [...index.commands, ...(options.extraCommands ?? [])],
    command => command.name,
  )
  const scored = allCommands
    .filter(command => command.type === 'prompt')
    .filter(command => !command.disableModelInvocation)
    .filter(command => !options.excludeNames?.has(command.name))
    .map(command => ({
      command,
      score: scoreCommand(command, terms, rawQuery),
    }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || a.command.name.localeCompare(b.command.name))
    .slice(0, normalizeMaxResults(options.maxResults))

  return scored.map(({ command, score }) => ({
    name: command.name,
    description: commandDescription(command),
    score,
    command,
  }))
}
