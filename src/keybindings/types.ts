export type KeybindingContextName =
  | 'Global'
  | 'Chat'
  | 'Autocomplete'
  | 'Confirmation'
  | 'Help'
  | 'Transcript'
  | 'HistorySearch'
  | 'Task'
  | 'ThemePicker'
  | 'Settings'
  | 'Tabs'
  | 'Attachments'
  | 'Footer'
  | 'MessageSelector'
  | 'DiffDialog'
  | 'ModelPicker'
  | 'Select'
  | 'Plugin'
  | string

export type ParsedKeystroke = {
  key: string
  ctrl?: boolean
  alt?: boolean
  shift?: boolean
  meta?: boolean
  super?: boolean
  [key: string]: any
}

export type Chord = ParsedKeystroke[]

export type ParsedBinding = {
  chord: Chord
  action: string | null
  context: KeybindingContextName
  [key: string]: any
}

export type KeybindingBlock = {
  context: KeybindingContextName
  bindings: Record<string, string | null>
  [key: string]: any
}

export type KeybindingAction = string
