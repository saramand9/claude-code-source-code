import type { Dispatch, ReactNode, SetStateAction } from 'react'

export type WizardStepComponent = () => ReactNode

export type WizardContextValue<T = any> = {
  currentStepIndex: number
  totalSteps: number
  wizardData: T
  setWizardData: Dispatch<SetStateAction<T>>
  updateWizardData: (updates: Partial<T>) => void
  goNext: () => void
  goBack: () => void
  goToStep: (index: number) => void
  cancel: () => void
  title?: string
  showStepCounter: boolean
}

export type WizardProviderProps<T = any> = {
  steps: WizardStepComponent[]
  initialData?: T
  onComplete: (data: T) => void
  onCancel?: () => void
  children?: ReactNode
  title?: string
  showStepCounter?: boolean
}
