import type { TextBlockParam } from '@anthropic-ai/sdk/resources/index.mjs'
import * as React from 'react'
import { INJECTED_ARROW } from '../../constants/figures.js'
import { Box, Text } from '../../ink.js'
import { truncateToWidth } from '../../utils/format.js'

type Props = {
  addMargin: boolean
  param: TextBlockParam
}

const CROSS_SESSION_RE =
  /<cross-session-message\b([^>]*)>\n?([\s\S]*?)\n?<\/cross-session-message>/
const SOURCE_ATTR_RE = /\b(?:source|sender|from|agent)="([^"]+)"/
const TRUNCATE_AT = 100

function parseCrossSessionMessage(text: string): {
  source: string | null
  body: string
} {
  const match = CROSS_SESSION_RE.exec(text)
  const attrs = match?.[1] ?? ''
  const body = match?.[2] ?? text
  return {
    source: SOURCE_ATTR_RE.exec(attrs)?.[1] ?? null,
    body: truncateToWidth(
      body
        .replace(/<[^>]+>/g, ' ')
        .trim()
        .replace(/\s+/g, ' '),
      TRUNCATE_AT,
    ),
  }
}

export function UserCrossSessionMessage({
  addMargin,
  param: { text },
}: Props): React.ReactNode {
  const { source, body } = parseCrossSessionMessage(text)
  return (
    <Box marginTop={addMargin ? 1 : 0}>
      <Text>
        <Text color="suggestion">{INJECTED_ARROW}</Text>{' '}
        <Text dimColor>Cross-session{source ? ` ${source}` : ''}:</Text>{' '}
        {body}
      </Text>
    </Box>
  )
}
