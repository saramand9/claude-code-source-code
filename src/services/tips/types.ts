export type TipContext = {
  theme?: any
  bashTools?: Set<string>
  readFileState?: any
  [key: string]: any
}

export type Tip = {
  id: string
  content: (context: TipContext) => string | Promise<string>
  cooldownSessions: number
  isRelevant: (context?: TipContext) => boolean | Promise<boolean>
  [key: string]: any
}
