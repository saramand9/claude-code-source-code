export type DevtoolsStatus = {
  status: 'unavailable'
  implementation: 'external-conservative'
  reason: string
}

const status: DevtoolsStatus = {
  status: 'unavailable',
  implementation: 'external-conservative',
  reason:
    'React DevTools integration is not bundled in this source build. Rendering continues without devtools.',
}

export async function connectToDevTools(): Promise<DevtoolsStatus> {
  return status
}

export function getDevtoolsStatus(): DevtoolsStatus {
  return status
}
