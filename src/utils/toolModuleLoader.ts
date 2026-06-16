import type { Tool } from '../Tool.js'

export type ToolModule<T extends Tool = Tool> = Record<
  string,
  T | undefined
> & {
  default?: T
}

export function loadToolExport<T extends Tool = Tool>(
  module: ToolModule<T>,
  exportName: string,
  specifier: string,
): T {
  const tool = module[exportName] ?? module.default
  if (!tool) {
    throw new Error(
      `Tool module ${specifier} does not export ${exportName} or default`,
    )
  }
  return tool
}
