import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  type CallToolResult,
  ListToolsRequestSchema,
  type ListToolsResult,
  type Tool as McpTool,
} from '@modelcontextprotocol/sdk/types.js'
import { randomUUID } from 'crypto'
import uniqBy from 'lodash-es/uniqBy.js'
import { getDefaultAppState } from 'src/state/AppStateStore.js'
import review from '../commands/review.js'
import type { Command } from '../commands.js'
import {
  findToolByName,
  getEmptyToolPermissionContext,
  type Tool as ClaudeTool,
  type Tools,
  type ToolUseContext,
} from '../Tool.js'
import {
  getMcpToolsCommandsAndResources,
} from '../services/mcp/client.js'
import type {
  MCPServerConnection,
  ServerResource,
} from '../services/mcp/types.js'
import { assembleToolPool } from '../tools.js'
import { createAbortController } from '../utils/abortController.js'
import { createFileStateCacheWithSizeLimit } from '../utils/fileStateCache.js'
import { logError } from '../utils/log.js'
import { createAssistantMessage } from '../utils/messages.js'
import { getMainLoopModel } from '../utils/model/model.js'
import type { PermissionDecision } from '../utils/permissions/PermissionResult.js'
import { hasPermissionsToUseTool } from '../utils/permissions/permissions.js'
import { setCwd } from '../utils/Shell.js'
import { jsonStringify } from '../utils/slowOperations.js'
import { formatZodValidationError, getErrorParts } from '../utils/toolErrors.js'
import { zodToJsonSchema } from '../utils/zodToJsonSchema.js'

type ToolInput = McpTool['inputSchema']
type ToolOutput = McpTool['outputSchema']

const MCP_COMMANDS: Command[] = [review]

type McpServeToolState = {
  clients: MCPServerConnection[]
  tools: Tools
  commands: Command[]
  resources: Record<string, ServerResource[]>
}

type McpConnectionToolUpdate = {
  client: MCPServerConnection
  tools: ClaudeTool[]
  commands: Command[]
  resources?: ServerResource[]
}

type McpServeConnectionLoader = (
  onConnectionAttempt: (params: McpConnectionToolUpdate) => void,
) => Promise<void>

type McpSchemaTool = Pick<
  ClaudeTool,
  'inputJSONSchema' | 'inputSchema' | 'name'
>
type McpCallableTool = Pick<ClaudeTool, 'inputSchema' | 'name'>

export function getMcpToolInputSchema(tool: McpSchemaTool): ToolInput {
  return (
    tool.inputJSONSchema ?? zodToJsonSchema(tool.inputSchema)
  ) as ToolInput
}

export function parseMcpToolInput(
  tool: McpCallableTool,
  args: unknown,
): { ok: true; input: Record<string, unknown> } | { ok: false; message: string } {
  const rawInput = args === undefined ? {} : args
  const parsedInput = tool.inputSchema.safeParse(rawInput)
  if (!parsedInput.success) {
    return {
      ok: false,
      message: formatZodValidationError(tool.name, parsedInput.error),
    }
  }
  return { ok: true, input: parsedInput.data }
}

export function applyMcpPermissionDecision(
  toolName: string,
  input: Record<string, unknown>,
  decision: PermissionDecision<Record<string, unknown>>,
): { ok: true; input: Record<string, unknown> } | { ok: false; message: string } {
  if (decision.behavior === 'allow') {
    return { ok: true, input: decision.updatedInput ?? input }
  }
  return {
    ok: false,
    message: decision.message || `Permission to use ${toolName} was not granted.`,
  }
}

export async function loadMcpServeToolState(
  loadConnections: McpServeConnectionLoader = onConnectionAttempt =>
    getMcpToolsCommandsAndResources(onConnectionAttempt),
): Promise<McpServeToolState> {
  const clients: MCPServerConnection[] = []
  const tools: ClaudeTool[] = []
  const commands: Command[] = []
  const resources: Record<string, ServerResource[]> = {}

  await loadConnections(({ client, tools: newTools, commands: newCommands, resources: newResources }) => {
    clients.push(client)
    tools.push(...newTools)
    commands.push(...newCommands)
    if (newResources && newResources.length > 0) {
      resources[client.name] = newResources
    }
  })

  return {
    clients,
    tools: uniqBy(tools, 'name'),
    commands: uniqBy(commands, 'name'),
    resources,
  }
}

export async function startMCPServer(
  cwd: string,
  debug: boolean,
  verbose: boolean,
): Promise<void> {
  // Use size-limited LRU cache for readFileState to prevent unbounded memory growth
  // 100 files and 25MB limit should be sufficient for MCP server operations
  const READ_FILE_STATE_CACHE_SIZE = 100
  const readFileStateCache = createFileStateCacheWithSizeLimit(
    READ_FILE_STATE_CACHE_SIZE,
  )
  setCwd(cwd)
  const toolPermissionContext = getEmptyToolPermissionContext()
  const mcpServeState = await loadMcpServeToolState()
  let appState = {
    ...getDefaultAppState(),
    mcp: {
      ...getDefaultAppState().mcp,
      clients: mcpServeState.clients,
      tools: [...mcpServeState.tools],
      commands: mcpServeState.commands,
      resources: mcpServeState.resources,
    },
    toolPermissionContext,
  }
  const getCurrentTools = () =>
    assembleToolPool(toolPermissionContext, appState.mcp.tools)

  const server = new Server(
    {
      name: 'claude/tengu',
      version: MACRO.VERSION,
    },
    {
      capabilities: {
        tools: {},
      },
    },
  )

  server.setRequestHandler(
    ListToolsRequestSchema,
    async (): Promise<ListToolsResult> => {
      const tools = getCurrentTools()
      return {
        tools: await Promise.all(
          tools.map(async tool => {
            let outputSchema: ToolOutput | undefined
            if (tool.outputSchema) {
              const convertedSchema = zodToJsonSchema(tool.outputSchema)
              // MCP SDK requires outputSchema to have type: "object" at root level
              // Skip schemas with anyOf/oneOf at root (from z.union, z.discriminatedUnion, etc.)
              // See: https://github.com/anthropics/claude-code/issues/8014
              if (
                typeof convertedSchema === 'object' &&
                convertedSchema !== null &&
                'type' in convertedSchema &&
                convertedSchema.type === 'object'
              ) {
                outputSchema = convertedSchema as ToolOutput
              }
            }
            return {
              ...tool,
              description: await tool.prompt({
                getToolPermissionContext: async () => toolPermissionContext,
                tools,
                agents: [],
              }),
              inputSchema: getMcpToolInputSchema(tool),
              outputSchema,
            }
          }),
        ),
      }
    },
  )

  server.setRequestHandler(
    CallToolRequestSchema,
    async ({ params: { name, arguments: args } }): Promise<CallToolResult> => {
      const tools = getCurrentTools()
      const tool = findToolByName(tools, name)
      if (!tool) {
        throw new Error(`Tool ${name} not found`)
      }

      // Assume MCP servers do not read messages separately from the tool
      // call arguments.
      const toolUseContext: ToolUseContext = {
        abortController: createAbortController(),
        options: {
          commands: [...MCP_COMMANDS, ...appState.mcp.commands],
          tools,
          mainLoopModel: getMainLoopModel(),
          thinkingConfig: { type: 'disabled' },
          mcpClients: appState.mcp.clients,
          mcpResources: appState.mcp.resources,
          isNonInteractiveSession: true,
          debug,
          verbose,
          agentDefinitions: { activeAgents: [], allAgents: [] },
        },
        getAppState: () => appState,
        setAppState: update => {
          appState = update(appState)
        },
        messages: [],
        readFileState: readFileStateCache,
        setInProgressToolUseIDs: () => {},
        setResponseLength: () => {},
        updateFileHistoryState: () => {},
        updateAttributionState: () => {},
      }

      try {
        if (!tool.isEnabled()) {
          throw new Error(`Tool ${name} is not enabled`)
        }
        const parsedInput = parseMcpToolInput(tool, args)
        if (parsedInput.ok === false) {
          throw new Error(parsedInput.message)
        }
        const input = parsedInput.input as never
        const validationResult = await tool.validateInput?.(
          input,
          toolUseContext,
        )
        if (validationResult && validationResult.result === false) {
          throw new Error(
            `Tool ${name} input is invalid: ${validationResult.message}`,
          )
        }
        const assistantMessage = createAssistantMessage({
          content: [],
        })
        const permissionDecision = await hasPermissionsToUseTool(
          tool,
          input,
          toolUseContext,
          assistantMessage,
          `mcp-${randomUUID()}`,
        )
        const permissionResult = applyMcpPermissionDecision(
          tool.name,
          input,
          permissionDecision,
        )
        if (permissionResult.ok === false) {
          throw new Error(permissionResult.message)
        }
        const permittedInput = permissionResult.input as never
        const finalResult = await tool.call(
          permittedInput,
          toolUseContext,
          hasPermissionsToUseTool,
          assistantMessage,
        )

        return {
          content: [
            {
              type: 'text' as const,
              text:
                typeof finalResult === 'string'
                  ? finalResult
                  : jsonStringify(finalResult.data),
            },
          ],
        }
      } catch (error) {
        logError(error)

        const parts =
          error instanceof Error ? getErrorParts(error) : [String(error)]
        const errorText = parts.filter(Boolean).join('\n').trim() || 'Error'

        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: errorText,
            },
          ],
        }
      }
    },
  )

  async function runServer() {
    const transport = new StdioServerTransport()
    await server.connect(transport)
  }

  return await runServer()
}
