import type { Message } from '../../types/message.js'
import type { SystemPrompt } from '../../utils/systemPromptType.js'
import { createUserMessage } from './messages.js'

export function appendSystemContext(
  systemPrompt: SystemPrompt,
  context: Record<string, string>,
): string[] {
  return [
    ...systemPrompt,
    Object.entries(context)
      .map(([key, value]) => `${key}: ${value}`)
      .join('\n'),
  ].filter(Boolean)
}

export function prependUserContext(
  messages: Message[],
  context: Record<string, string>,
): Message[] {
  const isNodeTest =
    typeof process !== 'undefined' && process.env?.NODE_ENV === 'test'
  if (isNodeTest || Object.keys(context).length === 0) {
    return messages
  }

  return [
    createUserMessage({
      content: `<system-reminder>\nAs you answer the user's questions, you can use the following context:\n${Object.entries(
        context,
      )
        .map(([key, value]) => `# ${key}\n${value}`)
        .join('\n')}

      IMPORTANT: this context may or may not be relevant to your tasks. You should not respond to this context unless it is highly relevant to your task.\n</system-reminder>\n`,
      isMeta: true,
    }),
    ...messages,
  ]
}
