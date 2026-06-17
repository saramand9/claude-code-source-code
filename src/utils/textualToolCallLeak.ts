type ToolLike = {
  name: string
  aliases?: readonly string[]
}

export type TextualToolCallLeak = {
  toolName: string
  callCount: number
}

const CALLING_LINE =
  /^\s*(?:[-*]\s*)?(?:Calling|Call|Using tool|Tool call)\s*:\s*([A-Za-z][A-Za-z0-9_.:-]{0,120})(?:\s+(\{.*))?\s*$/i

function toolMatches(tool: ToolLike, name: string): boolean {
  return tool.name === name || (tool.aliases?.includes(name) ?? false)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function parseObjectPrefix(lines: string[], startIndex: number): unknown {
  let text = ''
  let depth = 0
  let started = false
  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i]!.trim()
    if (!started && line === '') continue
    text += (text ? '\n' : '') + line
    for (const ch of line) {
      if (ch === '{') {
        depth++
        started = true
      } else if (ch === '}') {
        depth--
      }
    }
    if (started && depth <= 0) {
      try {
        return JSON.parse(text)
      } catch {
        return null
      }
    }
    if (text.length > 8000) return null
  }
  return null
}

export function detectTextualToolCallLeak(
  text: string,
  tools: readonly ToolLike[],
): TextualToolCallLeak | null {
  if (!text || tools.length === 0) return null

  const lines = text.split(/\r?\n/)
  const matches = new Map<string, number>()

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i]!.match(CALLING_LINE)
    if (!match) continue

    const toolName = match[1]!
    const tool = tools.find(candidate => toolMatches(candidate, toolName))
    if (!tool) continue

    const sameLineJson = match[2]
    const parsed = sameLineJson
      ? (() => {
          try {
            return JSON.parse(sameLineJson)
          } catch {
            return null
          }
        })()
      : parseObjectPrefix(lines, i + 1)

    if (!isPlainObject(parsed)) continue

    matches.set(tool.name, (matches.get(tool.name) ?? 0) + 1)
  }

  const [toolName, callCount] = [...matches.entries()][0] ?? []
  if (!toolName || !callCount) return null
  return { toolName, callCount }
}

export function detectTextualToolCallLeakInAssistantMessages(
  messages: readonly {
    message?: { content?: readonly unknown[] }
  }[],
  tools: readonly ToolLike[],
): TextualToolCallLeak | null {
  for (const message of messages) {
    const content = message.message?.content
    if (!Array.isArray(content)) continue
    for (const block of content) {
      if (
        block &&
        typeof block === 'object' &&
        (block as { type?: unknown }).type === 'text' &&
        typeof (block as { text?: unknown }).text === 'string'
      ) {
        const leak = detectTextualToolCallLeak(
          (block as { text: string }).text,
          tools,
        )
        if (leak) return leak
      }
    }
  }
  return null
}
