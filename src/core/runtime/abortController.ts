export function createAbortController(): AbortController {
  return new AbortController()
}

export function createChildAbortController(
  parent: AbortController,
): AbortController {
  const child = createAbortController()
  if (parent.signal.aborted) {
    child.abort(parent.signal.reason)
    return child
  }

  const propagate = () => child.abort(parent.signal.reason)
  const cleanup = () => parent.signal.removeEventListener('abort', propagate)
  parent.signal.addEventListener('abort', propagate, { once: true })
  child.signal.addEventListener('abort', cleanup, { once: true })
  return child
}
