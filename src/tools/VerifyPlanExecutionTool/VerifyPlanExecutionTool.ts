import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { jsonStringify } from '../../utils/slowOperations.js'
import { VERIFY_PLAN_EXECUTION_TOOL_NAME } from './constants.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    notes: z
      .string()
      .optional()
      .describe('Optional notes about what was implemented or tested.'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    status: z.literal('recorded_unavailable'),
    implementation: z.literal('external-conservative'),
    planAvailable: z.boolean(),
    verificationStarted: z.boolean(),
    verificationCompleted: z.boolean(),
    message: z.string(),
    warning: z.string(),
    notes: z.string().optional(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

export type Output = z.infer<OutputSchema>

export const VerifyPlanExecutionTool = buildTool({
  name: VERIFY_PLAN_EXECUTION_TOOL_NAME,
  searchHint: 'record plan verification request',
  maxResultSizeChars: 100_000,
  async description() {
    return 'Record that plan execution verification was requested.'
  },
  async prompt() {
    return `Records that implementation of the accepted plan is ready for verification.

This source build provides an external-conservative implementation. It records
the verification request and updates local plan-verification state, but it does
not run Anthropic's internal background verifier. You must still report any
manual tests or checks you performed.`
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  shouldDefer: true,
  isEnabled() {
    return process.env.CLAUDE_CODE_VERIFY_PLAN === 'true'
  },
  isConcurrencySafe() {
    return true
  },
  isReadOnly() {
    return false
  },
  isDestructive() {
    return false
  },
  renderToolUseMessage() {
    return null
  },
  async call({ notes }, { getAppState, setAppState }): Promise<{ data: Output }> {
    const pending = getAppState().pendingPlanVerification

    if (pending) {
      setAppState(prev => ({
        ...prev,
        pendingPlanVerification: prev.pendingPlanVerification
          ? {
              ...prev.pendingPlanVerification,
              verificationStarted: true,
              verificationCompleted: false,
            }
          : prev.pendingPlanVerification,
      }))
    }

    return {
      data: {
        status: 'recorded_unavailable',
        implementation: 'external-conservative',
        planAvailable: !!pending?.plan,
        verificationStarted: !!pending,
        verificationCompleted: false,
        message: pending
          ? 'Plan verification request recorded. Internal background verification is unavailable in this source build.'
          : 'No pending plan verification state was found. Internal background verification is unavailable in this source build.',
        warning:
          'This tool does not prove that the plan was implemented correctly. Run targeted tests and report their results explicitly.',
        ...(notes ? { notes } : {}),
      },
    }
  },
  mapToolResultToToolResultBlockParam(content, toolUseID) {
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: jsonStringify(content, null, 2),
    }
  },
} satisfies ToolDef<InputSchema, Output>)
