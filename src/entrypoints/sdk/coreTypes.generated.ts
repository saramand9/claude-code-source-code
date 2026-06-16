// Generated types are absent from this source dump. Recover them from the
// checked-in Zod schemas so tsc can type-check SDK consumers.
import type { z } from 'zod/v4'
import type * as Schemas from './coreSchemas.js'

type InferSchema<T extends (...args: any[]) => any> = z.infer<ReturnType<T>>
type SDKOpenRecord = Record<string, any>

export type ModelUsage = InferSchema<typeof Schemas.ModelUsageSchema>
export type OutputFormatType = InferSchema<typeof Schemas.OutputFormatTypeSchema>
export type BaseOutputFormat = InferSchema<typeof Schemas.BaseOutputFormatSchema>
export type JsonSchemaOutputFormat = InferSchema<typeof Schemas.JsonSchemaOutputFormatSchema>
export type OutputFormat = InferSchema<typeof Schemas.OutputFormatSchema>
export type ApiKeySource = InferSchema<typeof Schemas.ApiKeySourceSchema>
export type ConfigScope = InferSchema<typeof Schemas.ConfigScopeSchema>
export type SdkBeta = InferSchema<typeof Schemas.SdkBetaSchema>
export type ThinkingAdaptive = InferSchema<typeof Schemas.ThinkingAdaptiveSchema>
export type ThinkingEnabled = InferSchema<typeof Schemas.ThinkingEnabledSchema>
export type ThinkingDisabled = InferSchema<typeof Schemas.ThinkingDisabledSchema>
export type ThinkingConfig = InferSchema<typeof Schemas.ThinkingConfigSchema>
export type McpStdioServerConfig = InferSchema<typeof Schemas.McpStdioServerConfigSchema>
export type McpSSEServerConfig = InferSchema<typeof Schemas.McpSSEServerConfigSchema>
export type McpHttpServerConfig = InferSchema<typeof Schemas.McpHttpServerConfigSchema>
export type McpSdkServerConfig = InferSchema<typeof Schemas.McpSdkServerConfigSchema>
export type McpServerConfigForProcessTransport = InferSchema<typeof Schemas.McpServerConfigForProcessTransportSchema>
export type McpClaudeAIProxyServerConfig = InferSchema<typeof Schemas.McpClaudeAIProxyServerConfigSchema>
export type McpServerStatusConfig = InferSchema<typeof Schemas.McpServerStatusConfigSchema>
export type McpServerStatus = InferSchema<typeof Schemas.McpServerStatusSchema>
export type McpSetServersResult = InferSchema<typeof Schemas.McpSetServersResultSchema>
export type PermissionUpdateDestination = InferSchema<typeof Schemas.PermissionUpdateDestinationSchema>
export type PermissionBehavior = InferSchema<typeof Schemas.PermissionBehaviorSchema>
export type PermissionRuleValue = InferSchema<typeof Schemas.PermissionRuleValueSchema>
export type PermissionUpdate = InferSchema<typeof Schemas.PermissionUpdateSchema>
export type PermissionDecisionClassification = InferSchema<typeof Schemas.PermissionDecisionClassificationSchema>
export type PermissionResult = InferSchema<typeof Schemas.PermissionResultSchema>
export type PermissionMode = InferSchema<typeof Schemas.PermissionModeSchema>
export type HookEvent = InferSchema<typeof Schemas.HookEventSchema>
export type BaseHookInput = InferSchema<typeof Schemas.BaseHookInputSchema>
export type PreToolUseHookInput = InferSchema<typeof Schemas.PreToolUseHookInputSchema>
export type PermissionRequestHookInput = InferSchema<typeof Schemas.PermissionRequestHookInputSchema>
export type PostToolUseHookInput = InferSchema<typeof Schemas.PostToolUseHookInputSchema>
export type PostToolUseFailureHookInput = InferSchema<typeof Schemas.PostToolUseFailureHookInputSchema>
export type PermissionDeniedHookInput = InferSchema<typeof Schemas.PermissionDeniedHookInputSchema>
export type NotificationHookInput = InferSchema<typeof Schemas.NotificationHookInputSchema>
export type UserPromptSubmitHookInput = InferSchema<typeof Schemas.UserPromptSubmitHookInputSchema>
export type SessionStartHookInput = InferSchema<typeof Schemas.SessionStartHookInputSchema>
export type SetupHookInput = InferSchema<typeof Schemas.SetupHookInputSchema>
export type StopHookInput = InferSchema<typeof Schemas.StopHookInputSchema>
export type StopFailureHookInput = InferSchema<typeof Schemas.StopFailureHookInputSchema>
export type SubagentStartHookInput = InferSchema<typeof Schemas.SubagentStartHookInputSchema>
export type SubagentStopHookInput = InferSchema<typeof Schemas.SubagentStopHookInputSchema>
export type PreCompactHookInput = InferSchema<typeof Schemas.PreCompactHookInputSchema>
export type PostCompactHookInput = InferSchema<typeof Schemas.PostCompactHookInputSchema>
export type TeammateIdleHookInput = InferSchema<typeof Schemas.TeammateIdleHookInputSchema>
export type TaskCreatedHookInput = InferSchema<typeof Schemas.TaskCreatedHookInputSchema>
export type TaskCompletedHookInput = InferSchema<typeof Schemas.TaskCompletedHookInputSchema>
export type ElicitationHookInput = InferSchema<typeof Schemas.ElicitationHookInputSchema>
export type ElicitationResultHookInput = InferSchema<typeof Schemas.ElicitationResultHookInputSchema>
export type ConfigChangeHookInput = InferSchema<typeof Schemas.ConfigChangeHookInputSchema>
export type InstructionsLoadedHookInput = InferSchema<typeof Schemas.InstructionsLoadedHookInputSchema>
export type WorktreeCreateHookInput = InferSchema<typeof Schemas.WorktreeCreateHookInputSchema>
export type WorktreeRemoveHookInput = InferSchema<typeof Schemas.WorktreeRemoveHookInputSchema>
export type CwdChangedHookInput = InferSchema<typeof Schemas.CwdChangedHookInputSchema>
export type FileChangedHookInput = InferSchema<typeof Schemas.FileChangedHookInputSchema>
export type ExitReason = InferSchema<typeof Schemas.ExitReasonSchema>
export type SessionEndHookInput = InferSchema<typeof Schemas.SessionEndHookInputSchema>
export type HookInput = InferSchema<typeof Schemas.HookInputSchema>
export type AsyncHookJSONOutput = InferSchema<typeof Schemas.AsyncHookJSONOutputSchema>
export type PreToolUseHookSpecificOutput = InferSchema<typeof Schemas.PreToolUseHookSpecificOutputSchema>
export type UserPromptSubmitHookSpecificOutput = InferSchema<typeof Schemas.UserPromptSubmitHookSpecificOutputSchema>
export type SessionStartHookSpecificOutput = InferSchema<typeof Schemas.SessionStartHookSpecificOutputSchema>
export type SetupHookSpecificOutput = InferSchema<typeof Schemas.SetupHookSpecificOutputSchema>
export type SubagentStartHookSpecificOutput = InferSchema<typeof Schemas.SubagentStartHookSpecificOutputSchema>
export type PostToolUseHookSpecificOutput = InferSchema<typeof Schemas.PostToolUseHookSpecificOutputSchema>
export type PostToolUseFailureHookSpecificOutput = InferSchema<typeof Schemas.PostToolUseFailureHookSpecificOutputSchema>
export type PermissionDeniedHookSpecificOutput = InferSchema<typeof Schemas.PermissionDeniedHookSpecificOutputSchema>
export type NotificationHookSpecificOutput = InferSchema<typeof Schemas.NotificationHookSpecificOutputSchema>
export type PermissionRequestHookSpecificOutput = InferSchema<typeof Schemas.PermissionRequestHookSpecificOutputSchema>
export type CwdChangedHookSpecificOutput = InferSchema<typeof Schemas.CwdChangedHookSpecificOutputSchema>
export type FileChangedHookSpecificOutput = InferSchema<typeof Schemas.FileChangedHookSpecificOutputSchema>
export type SyncHookJSONOutput = InferSchema<typeof Schemas.SyncHookJSONOutputSchema>
export type ElicitationHookSpecificOutput = InferSchema<typeof Schemas.ElicitationHookSpecificOutputSchema>
export type ElicitationResultHookSpecificOutput = InferSchema<typeof Schemas.ElicitationResultHookSpecificOutputSchema>
export type WorktreeCreateHookSpecificOutput = InferSchema<typeof Schemas.WorktreeCreateHookSpecificOutputSchema>
export type HookJSONOutput = InferSchema<typeof Schemas.HookJSONOutputSchema>
export type PromptRequestOption = InferSchema<typeof Schemas.PromptRequestOptionSchema>
export type PromptRequest = InferSchema<typeof Schemas.PromptRequestSchema>
export type PromptResponse = InferSchema<typeof Schemas.PromptResponseSchema>
export type SlashCommand = InferSchema<typeof Schemas.SlashCommandSchema>
export type AgentInfo = InferSchema<typeof Schemas.AgentInfoSchema>
export type ModelInfo = InferSchema<typeof Schemas.ModelInfoSchema>
export type AccountInfo = InferSchema<typeof Schemas.AccountInfoSchema>
export type AgentMcpServerSpec = InferSchema<typeof Schemas.AgentMcpServerSpecSchema>
export type AgentDefinition = InferSchema<typeof Schemas.AgentDefinitionSchema>
export type SettingSource = InferSchema<typeof Schemas.SettingSourceSchema>
export type SdkPluginConfig = InferSchema<typeof Schemas.SdkPluginConfigSchema>
export type RewindFilesResult = InferSchema<typeof Schemas.RewindFilesResultSchema>
export type SDKAssistantMessageError = InferSchema<typeof Schemas.SDKAssistantMessageErrorSchema>
export type SDKStatus = InferSchema<typeof Schemas.SDKStatusSchema>
export type SDKUserMessage = SDKOpenRecord & {
  type: 'user'
  message: SDKOpenRecord
  uuid?: string
  session_id?: string
  parent_tool_use_id?: string | null
}
export type SDKUserMessageReplay = SDKOpenRecord & {
  type: 'user'
  message: SDKOpenRecord
  uuid: string
  session_id: string
  isReplay: true
  parent_tool_use_id?: string | null
}
export type SDKRateLimitInfo = InferSchema<typeof Schemas.SDKRateLimitInfoSchema>
export type SDKAssistantMessage = SDKOpenRecord & {
  type: 'assistant'
  message: SDKOpenRecord
  uuid: string
  session_id: string
  parent_tool_use_id?: string | null
}
export type SDKRateLimitEvent = InferSchema<typeof Schemas.SDKRateLimitEventSchema>
export type SDKStreamlinedTextMessage = InferSchema<typeof Schemas.SDKStreamlinedTextMessageSchema>
export type SDKStreamlinedToolUseSummaryMessage = InferSchema<typeof Schemas.SDKStreamlinedToolUseSummaryMessageSchema>
export type SDKPermissionDenial = InferSchema<typeof Schemas.SDKPermissionDenialSchema>
export type SDKResultSuccess = InferSchema<typeof Schemas.SDKResultSuccessSchema>
export type SDKResultError = InferSchema<typeof Schemas.SDKResultErrorSchema>
export type SDKResultMessage = InferSchema<typeof Schemas.SDKResultMessageSchema>
export type SDKSystemMessage = InferSchema<typeof Schemas.SDKSystemMessageSchema>
export type SDKPartialAssistantMessage = SDKOpenRecord & {
  type: 'stream_event'
  event: SDKOpenRecord
  uuid: string
  session_id: string
  parent_tool_use_id?: string | null
}
export type SDKCompactBoundaryMessage = InferSchema<typeof Schemas.SDKCompactBoundaryMessageSchema>
export type SDKStatusMessage = InferSchema<typeof Schemas.SDKStatusMessageSchema>
export type SDKPostTurnSummaryMessage = InferSchema<typeof Schemas.SDKPostTurnSummaryMessageSchema>
export type SDKAPIRetryMessage = InferSchema<typeof Schemas.SDKAPIRetryMessageSchema>
export type SDKLocalCommandOutputMessage = InferSchema<typeof Schemas.SDKLocalCommandOutputMessageSchema>
export type SDKHookStartedMessage = InferSchema<typeof Schemas.SDKHookStartedMessageSchema>
export type SDKHookProgressMessage = InferSchema<typeof Schemas.SDKHookProgressMessageSchema>
export type SDKHookResponseMessage = InferSchema<typeof Schemas.SDKHookResponseMessageSchema>
export type SDKToolProgressMessage = InferSchema<typeof Schemas.SDKToolProgressMessageSchema>
export type SDKAuthStatusMessage = InferSchema<typeof Schemas.SDKAuthStatusMessageSchema>
export type SDKFilesPersistedEvent = InferSchema<typeof Schemas.SDKFilesPersistedEventSchema>
export type SDKTaskNotificationMessage = InferSchema<typeof Schemas.SDKTaskNotificationMessageSchema>
export type SDKTaskStartedMessage = InferSchema<typeof Schemas.SDKTaskStartedMessageSchema>
export type SDKSessionStateChangedMessage = InferSchema<typeof Schemas.SDKSessionStateChangedMessageSchema>
export type SDKTaskProgressMessage = InferSchema<typeof Schemas.SDKTaskProgressMessageSchema>
export type SDKToolUseSummaryMessage = InferSchema<typeof Schemas.SDKToolUseSummaryMessageSchema>
export type SDKElicitationCompleteMessage = InferSchema<typeof Schemas.SDKElicitationCompleteMessageSchema>
export type SDKPromptSuggestionMessage = InferSchema<typeof Schemas.SDKPromptSuggestionMessageSchema>
export type SDKSessionInfo = InferSchema<typeof Schemas.SDKSessionInfoSchema>
export type SDKMessage =
  | SDKAssistantMessage
  | SDKUserMessage
  | SDKUserMessageReplay
  | SDKResultMessage
  | SDKSystemMessage
  | SDKPartialAssistantMessage
  | SDKCompactBoundaryMessage
  | SDKStatusMessage
  | SDKAPIRetryMessage
  | SDKLocalCommandOutputMessage
  | SDKHookStartedMessage
  | SDKHookProgressMessage
  | SDKHookResponseMessage
  | SDKToolProgressMessage
  | SDKAuthStatusMessage
  | SDKTaskNotificationMessage
  | SDKTaskStartedMessage
  | SDKTaskProgressMessage
  | SDKSessionStateChangedMessage
  | SDKFilesPersistedEvent
  | SDKToolUseSummaryMessage
  | SDKRateLimitEvent
  | SDKElicitationCompleteMessage
  | SDKPromptSuggestionMessage
export type FastModeState = InferSchema<typeof Schemas.FastModeStateSchema>
