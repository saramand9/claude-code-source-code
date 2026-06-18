export { DISCOVER_SKILLS_TOOL_NAME } from './constants.js'

export function getPrompt(): string {
  return `Searches available local, bundled, plugin, and MCP skills by task description.

Use this when the automatically surfaced skills do not cover the current task or the task has pivoted. Pass a concise description of what you are trying to do.`
}
