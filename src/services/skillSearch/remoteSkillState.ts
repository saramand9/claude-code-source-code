type RemoteSkillMeta = {
  url: string
}

const CANONICAL_PREFIX = '_canonical_'
const discoveredRemoteSkills = new Map<string, RemoteSkillMeta>()

export function stripCanonicalPrefix(commandName: string): string | null {
  if (!commandName.startsWith(CANONICAL_PREFIX)) return null
  const slug = commandName.slice(CANONICAL_PREFIX.length).trim()
  return slug.length > 0 ? slug : null
}

export function getDiscoveredRemoteSkill(
  slug: string,
): RemoteSkillMeta | undefined {
  return discoveredRemoteSkills.get(slug)
}

export function rememberDiscoveredRemoteSkill(
  slug: string,
  meta: RemoteSkillMeta,
): void {
  discoveredRemoteSkills.set(slug, meta)
}

export function clearDiscoveredRemoteSkills(): void {
  discoveredRemoteSkills.clear()
}
