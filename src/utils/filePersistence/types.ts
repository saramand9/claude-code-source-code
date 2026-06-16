export const OUTPUTS_SUBDIR = 'outputs'
export const FILE_COUNT_LIMIT = 100
export const DEFAULT_UPLOAD_CONCURRENCY = 5

export type TurnStartTime = number

export type PersistedFile = {
  filename: string
  file_id: string
  [key: string]: any
}

export type FailedPersistence = {
  filename: string
  error: string
  [key: string]: any
}

export type FilesPersistedEventData = {
  files: PersistedFile[]
  failed: FailedPersistence[]
  [key: string]: any
}
