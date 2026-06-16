export type NotebookCellType = 'code' | 'markdown' | 'raw' | string

export type NotebookCell = {
  cell_type: NotebookCellType
  source: string | string[]
  metadata?: Record<string, any>
  outputs?: any[]
  execution_count?: number | null
  [key: string]: any
}

export type NotebookCellOutput = {
  output_type: 'stream' | 'execute_result' | 'display_data' | 'error' | string
  text?: string | string[]
  data?: Record<string, any>
  [key: string]: any
}

export type NotebookCellSource = {
  cell_type?: NotebookCellType
  cellType?: NotebookCellType
  source: string | string[]
  outputs?: NotebookCellOutput[]
  [key: string]: any
}

export type NotebookCellSourceOutput = {
  type?: string
  text?: string | string[]
  data?: Record<string, any>
  [key: string]: any
}

export type NotebookOutputImage = {
  type?: string
  image_data?: string
  media_type?: string
  data?: string
  mimeType?: string
  [key: string]: any
}

export type NotebookContent = {
  cells: NotebookCell[]
  metadata?: Record<string, any>
  nbformat?: number
  nbformat_minor?: number
  [key: string]: any
}
