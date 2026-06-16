import type { Message } from '../../types/message.js'

/**
 * Conservative external-build projection. The closed-source implementation
 * rewrites committed spans into summary placeholders. This source build keeps
 * the API surface loadable but preserves messages unchanged.
 */
export function projectView<T extends Message[]>(messages: T): T {
  return messages
}

export function clearProjectedViewCache(): void {
  // No projection cache is maintained in this external implementation.
}
