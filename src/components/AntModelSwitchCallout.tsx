import React, { useCallback, useEffect, useRef } from 'react'
import { Box, Text } from '../ink.js'
import { getGlobalConfig, saveGlobalConfig } from '../utils/config.js'
import { isEnvTruthy } from '../utils/envUtils.js'
import { getAntModelOverrideConfig } from '../utils/model/antModels.js'
import type { OptionWithDescription } from './CustomSelect/select.js'
import { Select } from './CustomSelect/select.js'
import { PermissionDialog } from './permissions/PermissionDialog.js'

type ModelSwitchSelection = 'switch' | 'dismiss' | 'never'

type Props = {
  onDone: (selection: string, modelAlias?: string) => void
}

const CALLOUT_VERSION = 'external-conservative-v1'
const DAY_MS = 24 * 60 * 60 * 1000

function markShown(): void {
  saveGlobalConfig(current => ({
    ...current,
    modelSwitchCalloutLastShown: Date.now(),
    modelSwitchCalloutVersion: CALLOUT_VERSION,
  }))
}

function markDismissed(): void {
  saveGlobalConfig(current => ({
    ...current,
    modelSwitchCalloutDismissed: true,
    modelSwitchCalloutVersion: CALLOUT_VERSION,
  }))
}

function getSwitchConfig():
  | { modelAlias: string; description: string; version: string }
  | undefined {
  const configured = getAntModelOverrideConfig()?.switchCallout
  if (configured?.modelAlias) return configured as {
    modelAlias: string
    description: string
    version: string
  }

  const envModel = process.env.CLAUDE_CODE_MODEL_SWITCH_TARGET
  if (!envModel) return undefined
  return {
    modelAlias: envModel,
    description:
      process.env.CLAUDE_CODE_MODEL_SWITCH_DESCRIPTION ??
      `Switch this session to ${envModel}.`,
    version: process.env.CLAUDE_CODE_MODEL_SWITCH_VERSION ?? CALLOUT_VERSION,
  }
}

export function shouldShowModelSwitchCallout(): boolean {
  if (process.env.USER_TYPE !== 'ant') return false
  if (!isEnvTruthy(process.env.CLAUDE_CODE_ENABLE_MODEL_SWITCH_CALLOUT)) {
    return false
  }

  const config = getGlobalConfig()
  if (config.modelSwitchCalloutDismissed) return false

  const switchConfig = getSwitchConfig()
  if (!switchConfig?.modelAlias) return false
  if (config.modelSwitchCalloutVersion === switchConfig.version) return false

  const lastShown = config.modelSwitchCalloutLastShown
  if (lastShown && Date.now() - lastShown < DAY_MS) return false

  return true
}

export function AntModelSwitchCallout({ onDone }: Props): React.ReactNode {
  const onDoneRef = useRef(onDone)
  onDoneRef.current = onDone
  const switchConfig = getSwitchConfig()
  const modelAlias = switchConfig?.modelAlias

  useEffect(() => {
    markShown()
  }, [])

  const handleCancel = useCallback((): void => {
    onDoneRef.current('dismiss')
  }, [])

  const handleSelect = useCallback(
    (value: ModelSwitchSelection): void => {
      if (value === 'never') {
        markDismissed()
        onDoneRef.current('dismiss')
        return
      }
      if (value === 'switch' && modelAlias) {
        markDismissed()
        onDoneRef.current('switch', modelAlias)
        return
      }
      onDoneRef.current('dismiss')
    },
    [modelAlias],
  )

  const options: OptionWithDescription<ModelSwitchSelection>[] = [
    {
      label: modelAlias ? `Switch to ${modelAlias}` : 'Keep current model',
      description:
        switchConfig?.description ??
        'The internal model switch configuration is unavailable.',
      value: modelAlias ? 'switch' : 'dismiss',
      disabled: !modelAlias,
    },
    {
      label: 'Not now',
      description: 'Dismiss this notice for now.',
      value: 'dismiss',
    },
    {
      label: "Don't show again",
      description: 'Persistently dismiss this callout.',
      value: 'never',
    },
  ]

  return (
    <PermissionDialog title="Model Update">
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <Box marginBottom={1} flexDirection="column">
          <Text>
            A model update is available for this internal session. This source
            build only applies an explicitly configured target model.
          </Text>
        </Box>
        <Select options={options} onChange={handleSelect} onCancel={handleCancel} />
      </Box>
    </PermissionDialog>
  )
}
