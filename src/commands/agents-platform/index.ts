import type { Command } from '../../commands.js'
import type { LocalCommandCall } from '../../types/command.js'

const call: LocalCommandCall = async () => ({
  type: 'text',
  value:
    'Agents Platform is unavailable in this source build. Use local agents and tasks instead.',
})

const agentsPlatform = {
  type: 'local',
  name: 'agents-platform',
  description: 'Anthropic internal agents platform command unavailable',
  isEnabled: () => false,
  isHidden: true,
  supportsNonInteractive: true,
  load: () => Promise.resolve({ call }),
} satisfies Command

export default agentsPlatform
