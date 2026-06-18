import { isEnvTruthy } from '../../utils/envUtils.js'

export function isSkillSearchEnabled(): boolean {
  if (isEnvTruthy(process.env.CLAUDE_CODE_DISABLE_SKILL_SEARCH)) {
    return false
  }
  if (isEnvTruthy(process.env.DISABLE_SKILL_SEARCH)) {
    return false
  }
  const explicit = process.env.CLAUDE_CODE_EXPERIMENTAL_SKILL_SEARCH
  if (explicit !== undefined) {
    return isEnvTruthy(explicit)
  }
  return true
}
