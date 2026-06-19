import { mkdir, readdir, readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import { getSessionId } from '../bootstrap/state.js'
import { logForDebugging } from './debug.js'
import { getClaudeConfigHomeDir } from './envUtils.js'
import { errorMessage, getErrnoCode } from './errors.js'

export type SessionEnvironmentFormat = 'sh' | 'powershell'

// Cache states:
// undefined = not yet loaded (need to check disk)
// null = checked disk, no files exist (don't check again)
// string = loaded and cached (use cached value)
const sessionEnvScripts: Record<
  SessionEnvironmentFormat,
  string | null | undefined
> = {
  sh: undefined,
  powershell: undefined,
}

export async function getSessionEnvDirPath(): Promise<string> {
  const sessionEnvDir = join(
    getClaudeConfigHomeDir(),
    'session-env',
    getSessionId(),
  )
  await mkdir(sessionEnvDir, { recursive: true })
  return sessionEnvDir
}

export async function getHookEnvFilePath(
  hookEvent: 'Setup' | 'SessionStart' | 'CwdChanged' | 'FileChanged',
  hookIndex: number,
  format: SessionEnvironmentFormat = 'sh',
): Promise<string> {
  const prefix = hookEvent.toLowerCase()
  return join(
    await getSessionEnvDirPath(),
    `${prefix}-hook-${hookIndex}.${HOOK_ENV_EXTENSION[format]}`,
  )
}

export async function clearCwdEnvFiles(): Promise<void> {
  try {
    const dir = await getSessionEnvDirPath()
    const files = await readdir(dir)
    await Promise.all(
      files
        .filter(
          f =>
            (f.startsWith('filechanged-hook-') ||
              f.startsWith('cwdchanged-hook-')) &&
            HOOK_ENV_REGEX.test(f),
        )
        .map(f => writeFile(join(dir, f), '')),
    )
  } catch (e: unknown) {
    const code = getErrnoCode(e)
    if (code !== 'ENOENT') {
      logForDebugging(`Failed to clear cwd env files: ${errorMessage(e)}`)
    }
  }
}

export function invalidateSessionEnvCache(): void {
  logForDebugging('Invalidating session environment cache')
  sessionEnvScripts.sh = undefined
  sessionEnvScripts.powershell = undefined
}

export async function getSessionEnvironmentScript(
  format: SessionEnvironmentFormat = 'sh',
): Promise<string | null> {
  if (sessionEnvScripts[format] !== undefined) {
    return sessionEnvScripts[format]
  }

  const scripts: string[] = []

  // Check for CLAUDE_ENV_FILE passed from parent process (e.g., HFI trajectory runner)
  // This allows venv/conda activation to persist across shell commands
  const envFile = process.env.CLAUDE_ENV_FILE
  if (envFile && shouldLoadExplicitEnvFile(format, envFile)) {
    try {
      const envScript = (await readFile(envFile, 'utf8')).trim()
      if (envScript) {
        scripts.push(envScript)
        logForDebugging(
          `Session environment loaded from CLAUDE_ENV_FILE: ${envFile} (${envScript.length} chars)`,
        )
      }
    } catch (e: unknown) {
      const code = getErrnoCode(e)
      if (code !== 'ENOENT') {
        logForDebugging(`Failed to read CLAUDE_ENV_FILE: ${errorMessage(e)}`)
      }
    }
  }

  // Load hook environment files from session directory
  const sessionEnvDir = await getSessionEnvDirPath()
  try {
    const files = await readdir(sessionEnvDir)
    // We are sorting the hook env files by the order in which they are listed
    // in the settings.json file so that the resulting env is deterministic
    const hookFiles = files
      .filter(f => {
        const match = f.match(HOOK_ENV_REGEX)
        return match?.[3] === HOOK_ENV_EXTENSION[format]
      })
      .sort(sortHookEnvFiles)

    for (const file of hookFiles) {
      const filePath = join(sessionEnvDir, file)
      try {
        const content = (await readFile(filePath, 'utf8')).trim()
        if (content) {
          scripts.push(content)
        }
      } catch (e: unknown) {
        const code = getErrnoCode(e)
        if (code !== 'ENOENT') {
          logForDebugging(
            `Failed to read hook file ${filePath}: ${errorMessage(e)}`,
          )
        }
      }
    }

    if (hookFiles.length > 0) {
      logForDebugging(
        `Session environment loaded from ${hookFiles.length} hook file(s)`,
      )
    }
  } catch (e: unknown) {
    const code = getErrnoCode(e)
    if (code !== 'ENOENT') {
      logForDebugging(
        `Failed to load session environment from hooks: ${errorMessage(e)}`,
      )
    }
  }

  if (scripts.length === 0) {
    logForDebugging('No session environment scripts found')
    sessionEnvScripts[format] = null
    return sessionEnvScripts[format]
  }

  const sessionEnvScript = scripts.join('\n')
  sessionEnvScripts[format] = sessionEnvScript
  logForDebugging(
    `Session environment script ready (${sessionEnvScript.length} chars total)`,
  )
  return sessionEnvScript
}

const HOOK_ENV_PRIORITY: Record<string, number> = {
  setup: 0,
  sessionstart: 1,
  cwdchanged: 2,
  filechanged: 3,
}

const HOOK_ENV_EXTENSION: Record<SessionEnvironmentFormat, 'sh' | 'ps1'> = {
  sh: 'sh',
  powershell: 'ps1',
}

const HOOK_ENV_REGEX =
  /^(setup|sessionstart|cwdchanged|filechanged)-hook-(\d+)\.(sh|ps1)$/

function shouldLoadExplicitEnvFile(
  format: SessionEnvironmentFormat,
  envFile: string,
): boolean {
  return format === 'sh' || envFile.toLowerCase().endsWith('.ps1')
}

function sortHookEnvFiles(a: string, b: string): number {
  const aMatch = a.match(HOOK_ENV_REGEX)
  const bMatch = b.match(HOOK_ENV_REGEX)
  const aType = aMatch?.[1] || ''
  const bType = bMatch?.[1] || ''
  if (aType !== bType) {
    return (HOOK_ENV_PRIORITY[aType] ?? 99) - (HOOK_ENV_PRIORITY[bType] ?? 99)
  }
  const aIndex = parseInt(aMatch?.[2] || '0', 10)
  const bIndex = parseInt(bMatch?.[2] || '0', 10)
  return aIndex - bIndex
}
