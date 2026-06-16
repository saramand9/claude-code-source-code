export class OptionalNativeModuleUnavailableError extends Error {
  readonly moduleName: string
  readonly featureName: string

  constructor(moduleName: string, featureName: string, cause: unknown) {
    super(
      `Optional native module "${moduleName}" is unavailable for ${featureName}. ` +
        'This source build can continue only if a fallback path exists.',
    )
    this.name = 'OptionalNativeModuleUnavailableError'
    this.moduleName = moduleName
    this.featureName = featureName
    this.cause = cause
  }
}

export function isOptionalNativeModuleUnavailableError(
  error: unknown,
): error is OptionalNativeModuleUnavailableError {
  return error instanceof OptionalNativeModuleUnavailableError
}

export function getOptionalNativeModuleMessage(error: unknown): string {
  if (isOptionalNativeModuleUnavailableError(error)) {
    const cause =
      error.cause instanceof Error ? ` Cause: ${error.cause.message}` : ''
    return `${error.message}${cause}`
  }
  return error instanceof Error ? error.message : String(error)
}

export async function importOptionalNativeModule<T>(
  moduleName: string,
  featureName: string,
): Promise<T> {
  try {
    return (await import(moduleName)) as T
  } catch (error) {
    throw new OptionalNativeModuleUnavailableError(
      moduleName,
      featureName,
      error,
    )
  }
}

export function requireOptionalNativeModule<T>(
  moduleName: string,
  featureName: string,
): T {
  try {
    return require(moduleName) as T
  } catch (error) {
    throw new OptionalNativeModuleUnavailableError(
      moduleName,
      featureName,
      error,
    )
  }
}
