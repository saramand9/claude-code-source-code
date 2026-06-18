import type { TextBlockParam } from '@anthropic-ai/sdk/resources/index.mjs'
import * as React from 'react'
import { Box, Text } from '../../ink.js'
import { truncateToWidth } from '../../utils/format.js'
import { extractTag } from '../../utils/messages.js'

type Props = {
  addMargin: boolean
  param: TextBlockParam
}

const GITHUB_WEBHOOK_TAG = 'github-webhook-activity'
const TRUNCATE_AT = 100

function normalizeActivity(text: string): string {
  const tagged = extractTag(text, GITHUB_WEBHOOK_TAG)
  const body = tagged ?? text.replace(/<\/?github-webhook-activity>/g, '')
  return truncateToWidth(body.trim().replace(/\s+/g, ' '), TRUNCATE_AT)
}

export function UserGitHubWebhookMessage({
  addMargin,
  param: { text },
}: Props): React.ReactNode {
  const activity = normalizeActivity(text)
  return (
    <Box marginTop={addMargin ? 1 : 0}>
      <Text>
        <Text color="suggestion">GitHub activity</Text>
        {activity ? ` ${activity}` : ' received'}
      </Text>
    </Box>
  )
}
