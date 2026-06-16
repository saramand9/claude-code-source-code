import { logForDebugging } from './debug.js'
import {
  getOptionalNativeModuleMessage,
  requireOptionalNativeModule,
} from './nativeOptional.js'

export type ModifierKey = 'shift' | 'command' | 'control' | 'option'

let prewarmed = false

/**
 * Pre-warm the native module by loading it in advance.
 * Call this early to avoid delay on first use.
 */
export function prewarmModifiers(): void {
  if (prewarmed || process.platform !== 'darwin') {
    return
  }
  prewarmed = true
  // Load module in background
  try {
    const { prewarm } = requireOptionalNativeModule<{ prewarm: () => void }>(
      'modifiers-napi',
      'modifier-key prewarm',
    )
    prewarm()
  } catch (error) {
    logForDebugging(`[native] ${getOptionalNativeModuleMessage(error)}`)
  }
}

/**
 * Check if a specific modifier key is currently pressed (synchronous).
 */
export function isModifierPressed(modifier: ModifierKey): boolean {
  if (process.platform !== 'darwin') {
    return false
  }
  // Dynamic import to avoid loading native module at top level
  try {
    const { isModifierPressed: nativeIsModifierPressed } =
      requireOptionalNativeModule<{ isModifierPressed: (m: string) => boolean }>(
        'modifiers-napi',
        'modifier-key state detection',
      )
    return nativeIsModifierPressed(modifier)
  } catch (error) {
    logForDebugging(`[native] ${getOptionalNativeModuleMessage(error)}`)
    return false
  }
}
