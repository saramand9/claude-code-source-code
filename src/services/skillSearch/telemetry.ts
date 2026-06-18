import { logForDebugging } from '../../utils/debug.js'

export function logRemoteSkillLoaded(event: Record<string, unknown>): void {
  logForDebugging(`Remote skill load event: ${JSON.stringify(event)}`)
}
