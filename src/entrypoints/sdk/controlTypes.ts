// Generated control protocol types are absent from this source dump. Recover
// them from the checked-in Zod schemas for type-checking.
import type { z } from 'zod/v4'
import type { SDKPartialAssistantMessage } from './coreTypes.js'
import type * as Schemas from './controlSchemas.js'

type InferSchema<T extends (...args: any[]) => any> = z.infer<ReturnType<T>>

export type SDKHookCallbackMatcher = InferSchema<typeof Schemas.SDKHookCallbackMatcherSchema>
export type SDKControlInitializeRequest = InferSchema<typeof Schemas.SDKControlInitializeRequestSchema>
export type SDKControlInitializeResponse = InferSchema<typeof Schemas.SDKControlInitializeResponseSchema>
export type SDKControlInterruptRequest = InferSchema<typeof Schemas.SDKControlInterruptRequestSchema>
export type SDKControlPermissionRequest = InferSchema<typeof Schemas.SDKControlPermissionRequestSchema>
export type SDKControlSetPermissionModeRequest = InferSchema<typeof Schemas.SDKControlSetPermissionModeRequestSchema>
export type SDKControlSetModelRequest = InferSchema<typeof Schemas.SDKControlSetModelRequestSchema>
export type SDKControlSetMaxThinkingTokensRequest = InferSchema<typeof Schemas.SDKControlSetMaxThinkingTokensRequestSchema>
export type SDKControlMcpStatusRequest = InferSchema<typeof Schemas.SDKControlMcpStatusRequestSchema>
export type SDKControlMcpStatusResponse = InferSchema<typeof Schemas.SDKControlMcpStatusResponseSchema>
export type SDKControlGetContextUsageRequest = InferSchema<typeof Schemas.SDKControlGetContextUsageRequestSchema>
export type SDKControlGetContextUsageResponse = InferSchema<typeof Schemas.SDKControlGetContextUsageResponseSchema>
export type SDKControlRewindFilesRequest = InferSchema<typeof Schemas.SDKControlRewindFilesRequestSchema>
export type SDKControlRewindFilesResponse = InferSchema<typeof Schemas.SDKControlRewindFilesResponseSchema>
export type SDKControlCancelAsyncMessageRequest = InferSchema<typeof Schemas.SDKControlCancelAsyncMessageRequestSchema>
export type SDKControlCancelAsyncMessageResponse = InferSchema<typeof Schemas.SDKControlCancelAsyncMessageResponseSchema>
export type SDKControlSeedReadStateRequest = InferSchema<typeof Schemas.SDKControlSeedReadStateRequestSchema>
export type SDKHookCallbackRequest = InferSchema<typeof Schemas.SDKHookCallbackRequestSchema>
export type SDKControlMcpMessageRequest = InferSchema<typeof Schemas.SDKControlMcpMessageRequestSchema>
export type SDKControlMcpSetServersRequest = InferSchema<typeof Schemas.SDKControlMcpSetServersRequestSchema>
export type SDKControlMcpSetServersResponse = InferSchema<typeof Schemas.SDKControlMcpSetServersResponseSchema>
export type SDKControlReloadPluginsRequest = InferSchema<typeof Schemas.SDKControlReloadPluginsRequestSchema>
export type SDKControlReloadPluginsResponse = InferSchema<typeof Schemas.SDKControlReloadPluginsResponseSchema>
export type SDKControlMcpReconnectRequest = InferSchema<typeof Schemas.SDKControlMcpReconnectRequestSchema>
export type SDKControlMcpToggleRequest = InferSchema<typeof Schemas.SDKControlMcpToggleRequestSchema>
export type SDKControlStopTaskRequest = InferSchema<typeof Schemas.SDKControlStopTaskRequestSchema>
export type SDKControlApplyFlagSettingsRequest = InferSchema<typeof Schemas.SDKControlApplyFlagSettingsRequestSchema>
export type SDKControlGetSettingsRequest = InferSchema<typeof Schemas.SDKControlGetSettingsRequestSchema>
export type SDKControlGetSettingsResponse = InferSchema<typeof Schemas.SDKControlGetSettingsResponseSchema>
export type SDKControlElicitationRequest = InferSchema<typeof Schemas.SDKControlElicitationRequestSchema>
export type SDKControlElicitationResponse = InferSchema<typeof Schemas.SDKControlElicitationResponseSchema>
export type SDKControlRequestInner = InferSchema<typeof Schemas.SDKControlRequestInnerSchema>
export type SDKControlRequest = InferSchema<typeof Schemas.SDKControlRequestSchema>
export type ControlResponse = InferSchema<typeof Schemas.ControlResponseSchema>
export type ControlErrorResponse = InferSchema<typeof Schemas.ControlErrorResponseSchema>
export type SDKControlResponse = InferSchema<typeof Schemas.SDKControlResponseSchema>
export type SDKControlCancelRequest = InferSchema<typeof Schemas.SDKControlCancelRequestSchema>
export type SDKKeepAliveMessage = InferSchema<typeof Schemas.SDKKeepAliveMessageSchema>
export type SDKUpdateEnvironmentVariablesMessage = InferSchema<typeof Schemas.SDKUpdateEnvironmentVariablesMessageSchema>
export type StdoutMessage = InferSchema<typeof Schemas.StdoutMessageSchema>
export type StdinMessage = InferSchema<typeof Schemas.StdinMessageSchema>
export type { SDKPartialAssistantMessage }
