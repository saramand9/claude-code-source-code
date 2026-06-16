export type SecureStorageData = Record<string, any> | null

export type SecureStorage = {
  name: string
  read(): SecureStorageData
  readAsync(): Promise<SecureStorageData>
  update(data: NonNullable<SecureStorageData>): { success: boolean; warning?: string }
  delete(): boolean
}
