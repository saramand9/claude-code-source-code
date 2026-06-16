export type ConnectorTextBlock = {
  type: 'connector_text'
  text?: string
  content?: string
  [key: string]: any
}

export type ConnectorTextDelta = {
  text?: string
  content?: string
  [key: string]: any
}

export function isConnectorTextBlock(value: unknown): value is ConnectorTextBlock {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { type?: unknown }).type === 'connector_text'
  )
}
