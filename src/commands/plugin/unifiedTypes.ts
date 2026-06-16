export type UnifiedInstalledItem = {
  type?: 'plugin' | 'marketplace' | string
  name: string
  source?: string
  version?: string
  enabled?: boolean
  [key: string]: any
}
