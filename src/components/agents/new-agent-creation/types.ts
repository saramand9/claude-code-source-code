import type { AgentColorName } from '../../../tools/AgentTool/agentColorManager.js'
import type { AgentMemoryScope } from '../../../tools/AgentTool/agentMemory.js'
import type { CustomAgentDefinition } from '../../../tools/AgentTool/loadAgentsDir.js'
import type { SettingSource } from '../../../utils/settings/constants.js'

export type AgentWizardData = {
  location?: SettingSource
  method?: 'generate' | 'manual'
  generationPrompt?: string
  isGenerating?: boolean
  wasGenerated?: boolean
  generatedAgent?: unknown
  agentType?: string
  systemPrompt?: string
  whenToUse?: string
  selectedTools?: string[]
  selectedModel?: string
  selectedColor?: AgentColorName | string
  selectedMemory?: AgentMemoryScope
  finalAgent?: CustomAgentDefinition
}
