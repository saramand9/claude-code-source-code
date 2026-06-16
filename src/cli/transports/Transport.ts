import type { StdoutMessage } from 'src/entrypoints/sdk/controlTypes.js'
import type { StreamClientEvent } from './SSETransport.js'

export interface Transport {
  connect(): Promise<void>
  write(message: StdoutMessage): Promise<void>
  close(): void
  isConnectedStatus(): boolean
  isClosedStatus(): boolean
  setOnData(callback: (data: string) => void): void
  setOnClose(callback: (closeCode?: number) => void): void
  setOnConnect?(callback: () => void): void
  setOnEvent?(callback: (event: StreamClientEvent) => void): void
  getStateLabel?(): string
}
