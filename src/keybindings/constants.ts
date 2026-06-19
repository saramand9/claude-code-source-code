/**
 * Shared keybinding context and action constants.
 *
 * Kept separate from schema.ts so runtime validation can reuse the source of
 * truth without importing Zod schema construction.
 */

/**
 * Valid context names where keybindings can be applied.
 */
export const KEYBINDING_CONTEXTS = [
  'Global',
  'Chat',
  'Autocomplete',
  'Confirmation',
  'Help',
  'Transcript',
  'HistorySearch',
  'Task',
  'ThemePicker',
  'Settings',
  'Tabs',
  'Scroll',
  // New contexts for keybindings migration
  'Attachments',
  'Footer',
  'MessageSelector',
  'MessageActions',
  'DiffDialog',
  'ModelPicker',
  'Select',
  'Plugin',
] as const

/**
 * Human-readable descriptions for each keybinding context.
 */
export const KEYBINDING_CONTEXT_DESCRIPTIONS: Record<
  (typeof KEYBINDING_CONTEXTS)[number],
  string
> = {
  Global: 'Active everywhere, regardless of focus',
  Chat: 'When the chat input is focused',
  Autocomplete: 'When autocomplete menu is visible',
  Confirmation: 'When a confirmation/permission dialog is shown',
  Help: 'When the help overlay is open',
  Transcript: 'When viewing the transcript',
  HistorySearch: 'When searching command history (ctrl+r)',
  Task: 'When a task/agent is running in the foreground',
  ThemePicker: 'When the theme picker is open',
  Settings: 'When the settings menu is open',
  Tabs: 'When tab navigation is active',
  Scroll: 'When scrollback or scrollable content is focused',
  Attachments: 'When navigating image attachments in a select dialog',
  Footer: 'When footer indicators are focused',
  MessageSelector: 'When the message selector (rewind) is open',
  MessageActions: 'When message action navigation is active',
  DiffDialog: 'When the diff dialog is open',
  ModelPicker: 'When the model picker is open',
  Select: 'When a select/list component is focused',
  Plugin: 'When the plugin dialog is open',
}

/**
 * All valid keybinding action identifiers.
 */
export const KEYBINDING_ACTIONS = [
  // App-level actions (Global context)
  'app:interrupt',
  'app:exit',
  'app:toggleTodos',
  'app:toggleTranscript',
  'app:toggleBrief',
  'app:toggleTeammatePreview',
  'app:toggleTerminal',
  'app:redraw',
  'app:globalSearch',
  'app:quickOpen',
  // History navigation
  'history:search',
  'history:previous',
  'history:next',
  // Chat input actions
  'chat:cancel',
  'chat:killAgents',
  'chat:cycleMode',
  'chat:modelPicker',
  'chat:fastMode',
  'chat:thinkingToggle',
  'chat:submit',
  'chat:newline',
  'chat:undo',
  'chat:externalEditor',
  'chat:stash',
  'chat:imagePaste',
  'chat:messageActions',
  // Autocomplete menu actions
  'autocomplete:accept',
  'autocomplete:dismiss',
  'autocomplete:previous',
  'autocomplete:next',
  // Confirmation dialog actions
  'confirm:yes',
  'confirm:no',
  'confirm:previous',
  'confirm:next',
  'confirm:nextField',
  'confirm:previousField',
  'confirm:cycleMode',
  'confirm:toggle',
  'confirm:toggleExplanation',
  // Tabs navigation actions
  'tabs:next',
  'tabs:previous',
  // Scrollback and selection actions
  'scroll:pageUp',
  'scroll:pageDown',
  'scroll:lineUp',
  'scroll:lineDown',
  'scroll:top',
  'scroll:bottom',
  'scroll:halfPageUp',
  'scroll:halfPageDown',
  'scroll:fullPageUp',
  'scroll:fullPageDown',
  'selection:copy',
  // Transcript viewer actions
  'transcript:toggleShowAll',
  'transcript:exit',
  // History search actions
  'historySearch:next',
  'historySearch:accept',
  'historySearch:cancel',
  'historySearch:execute',
  // Task/agent actions
  'task:background',
  // Theme picker actions
  'theme:toggleSyntaxHighlighting',
  // Help menu actions
  'help:dismiss',
  // Attachment navigation (select dialog image attachments)
  'attachments:next',
  'attachments:previous',
  'attachments:remove',
  'attachments:exit',
  // Footer indicator actions
  'footer:up',
  'footer:down',
  'footer:next',
  'footer:previous',
  'footer:openSelected',
  'footer:clearSelection',
  'footer:close',
  // Message selector (rewind) actions
  'messageSelector:up',
  'messageSelector:down',
  'messageSelector:top',
  'messageSelector:bottom',
  'messageSelector:select',
  // Message action navigation and commands
  'messageActions:prev',
  'messageActions:next',
  'messageActions:prevUser',
  'messageActions:nextUser',
  'messageActions:top',
  'messageActions:bottom',
  'messageActions:escape',
  'messageActions:ctrlc',
  'messageActions:enter',
  'messageActions:c',
  'messageActions:p',
  // Diff dialog actions
  'diff:dismiss',
  'diff:previousSource',
  'diff:nextSource',
  'diff:back',
  'diff:viewDetails',
  'diff:previousFile',
  'diff:nextFile',
  // Model picker actions (ant-only)
  'modelPicker:decreaseEffort',
  'modelPicker:increaseEffort',
  // Select component actions (distinct from confirm: to avoid collisions)
  'select:next',
  'select:previous',
  'select:accept',
  'select:cancel',
  // Plugin dialog actions
  'plugin:toggle',
  'plugin:install',
  // Permission dialog actions
  'permission:toggleDebug',
  // Settings config panel actions
  'settings:search',
  'settings:retry',
  'settings:close',
  // Voice actions
  'voice:pushToTalk',
] as const
