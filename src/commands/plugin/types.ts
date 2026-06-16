export type ViewState = {
  view?: string
  selectedIndex?: number
  marketplace?: string
  pluginName?: string
  [key: string]: any
}

export type PluginSettingsProps = {
  viewState?: ViewState
  setViewState?: (state: ViewState | ((previous: ViewState) => ViewState)) => void
  onDone?: () => void
  [key: string]: any
}
