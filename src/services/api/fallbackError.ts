/**
 * Control-flow signal emitted by the model retry layer when a configured
 * fallback model should take over.
 *
 * Kept separate from withRetry.ts so the agent loop can recognize the signal
 * without importing the production authentication, provider, and retry stack.
 */
export class FallbackTriggeredError extends Error {
  constructor(
    public readonly originalModel: string,
    public readonly fallbackModel: string,
  ) {
    super(`Model fallback triggered: ${originalModel} -> ${fallbackModel}`)
    this.name = 'FallbackTriggeredError'
  }
}
