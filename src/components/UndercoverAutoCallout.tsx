import React, { useCallback, useEffect, useRef } from 'react'
import { Box, Text } from '../ink.js'
import { saveGlobalConfig } from '../utils/config.js'
import type { OptionWithDescription } from './CustomSelect/select.js'
import { Select } from './CustomSelect/select.js'
import { PermissionDialog } from './permissions/PermissionDialog.js'

type UndercoverSelection = 'dismiss'

type Props = {
  onDone: () => void
}

function markSeen(): void {
  saveGlobalConfig(current => {
    if (current.hasSeenUndercoverAutoNotice) return current
    return {
      ...current,
      hasSeenUndercoverAutoNotice: true,
    }
  })
}

export function UndercoverAutoCallout({ onDone }: Props): React.ReactNode {
  const onDoneRef = useRef(onDone)
  onDoneRef.current = onDone

  useEffect(() => {
    markSeen()
  }, [])

  const handleDone = useCallback((): void => {
    onDoneRef.current()
  }, [])

  const options: OptionWithDescription<UndercoverSelection>[] = [
    {
      label: 'Got it',
      description: 'Continue this session.',
      value: 'dismiss',
    },
  ]

  return (
    <PermissionDialog title="Public Repository Safety">
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <Box marginBottom={1} flexDirection="column">
          <Text>
            This repository is being treated as public or external. Commit and
            pull request text will avoid internal model names, private project
            names, and AI attribution.
          </Text>
        </Box>
        <Select options={options} onChange={handleDone} onCancel={handleDone} />
      </Box>
    </PermissionDialog>
  )
}
