export type StatusLineCommandInput = {
  cwd?: string
  model?: string | { id: string; display_name: string }
  transcriptPath?: string
  [key: string]: any
}
