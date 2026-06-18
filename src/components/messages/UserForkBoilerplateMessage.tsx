import type { TextBlockParam } from '@anthropic-ai/sdk/resources/index.mjs'
import * as React from 'react'
import { FORK_GLYPH } from '../../constants/figures.js'
import { Box, Text } from '../../ink.js'
import { truncateToWidth } from '../../utils/format.js'
import { extractTag } from '../../utils/messages.js'

type Props = {
  addMargin: boolean
  param: TextBlockParam
}

const FORK_BOILERPLATE_TAG = 'fork-boilerplate'
const TRUNCATE_AT = 90

function normalizeDirective(text: string): string {
  const tagged = extractTag(text, FORK_BOILERPLATE_TAG)
  const body = tagged ?? text.replace(/<\/?fork-boilerplate>/g, '')
  return truncateToWidth(body.trim().replace(/\s+/g, ' '), TRUNCATE_AT)
}

export function UserForkBoilerplateMessage({
  addMargin,
  param: { text },
}: Props): React.ReactNode {
  const directive = normalizeDirective(text)
  return (
    <Box marginTop={addMargin ? 1 : 0}>
      <Text>
        <Text color="suggestion">{FORK_GLYPH}</Text>{' '}
        <Text dimColor>Fork context</Text>
        {directive ? ` ${directive}` : ' initialized'}
      </Text>
    </Box>
  )
}
