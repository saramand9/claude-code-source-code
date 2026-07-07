import {
  copyFile,
  readdir,
  readlink,
  realpath,
  rename,
  rm,
  symlink,
} from 'fs/promises'
import { createHash } from 'crypto'
import { dirname, join, relative, sep } from 'path'
import { execFileNoThrow } from '../execFileNoThrow.js'
import { pathExists } from '../file.js'
import { getFsImplementation } from '../fsOperations.js'
import { logForDebugging } from '../debug.js'
import { getPluginsDirectory } from './pluginDirectories.js'

async function copyDir(src: string, dest: string): Promise<void> {
  await getFsImplementation().mkdir(dest)

  const entries = await readdir(src, { withFileTypes: true })
  for (const entry of entries) {
    const srcPath = join(src, entry.name)
    const destPath = join(dest, entry.name)

    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath)
    } else if (entry.isFile()) {
      await copyFile(srcPath, destPath)
    } else if (entry.isSymbolicLink()) {
      const linkTarget = await readlink(srcPath)

      let resolvedTarget: string
      try {
        resolvedTarget = await realpath(srcPath)
      } catch {
        await symlink(linkTarget, destPath)
        continue
      }

      let resolvedSrc: string
      try {
        resolvedSrc = await realpath(src)
      } catch {
        resolvedSrc = src
      }

      const srcPrefix = resolvedSrc.endsWith(sep)
        ? resolvedSrc
        : resolvedSrc + sep
      if (
        resolvedTarget.startsWith(srcPrefix) ||
        resolvedTarget === resolvedSrc
      ) {
        const targetRelativeToSrc = relative(resolvedSrc, resolvedTarget)
        const destTargetPath = join(dest, targetRelativeToSrc)
        const relativeLinkPath = relative(dirname(destPath), destTargetPath)
        await symlink(relativeLinkPath, destPath)
      } else {
        await symlink(resolvedTarget, destPath)
      }
    }
  }
}

function pythonExecutable(): string {
  return (
    process.env.CLAUDE_CODE_PYTHON ??
    process.env.PYTHON ??
    (process.platform === 'win32' ? 'python' : 'python3')
  )
}

function formatPipPackageSpec(packageName: string, version?: string): string {
  const trimmedVersion = version?.trim()
  if (!trimmedVersion) {
    return packageName
  }
  if (/^[<>=!~=]/.test(trimmedVersion)) {
    return `${packageName}${trimmedVersion}`
  }
  return `${packageName}==${trimmedVersion}`
}

function getPipPackageCacheKey(
  packageName: string,
  options: { registry?: string; version?: string } = {},
): string {
  const sanitized = packageName.replace(/[^a-zA-Z0-9_.-]/g, '-')
  const hash = createHash('sha256')
    .update(JSON.stringify({ packageName, ...options }))
    .digest('hex')
    .slice(0, 16)
  return `${sanitized}-${hash}`
}

export function getPipPackageCachePath(
  packageName: string,
  options: { registry?: string; version?: string } = {},
): string {
  return join(
    getPluginsDirectory(),
    'pip-cache',
    getPipPackageCacheKey(packageName, options),
  )
}

/**
 * Install a Python package into Claude's plugin pip cache and copy it to a target path.
 */
export async function installFromPip(
  packageName: string,
  targetPath: string,
  options: { registry?: string; version?: string; force?: boolean } = {},
): Promise<void> {
  const pipCachePath = join(getPluginsDirectory(), 'pip-cache')
  const packagePath = getPipPackageCachePath(packageName, {
    registry: options.registry,
    version: options.version,
  })

  await getFsImplementation().mkdir(pipCachePath)

  if (options.force || !(await pathExists(packagePath))) {
    const tempPath = `${packagePath}.tmp-${process.pid}-${Date.now()}`
    await rm(tempPath, { recursive: true, force: true })

    const packageSpec = formatPipPackageSpec(packageName, options.version)
    const args = [
      '-m',
      'pip',
      'install',
      packageSpec,
      '--target',
      tempPath,
      '--upgrade',
      '--no-warn-script-location',
    ]
    if (options.registry) {
      args.push('--index-url', options.registry)
    }

    logForDebugging(`Installing pip package ${packageSpec} to cache`)
    const result = await execFileNoThrow(pythonExecutable(), args, {
      useCwd: false,
      timeout: 10 * 60 * 1000,
    })

    if (result.code !== 0) {
      await rm(tempPath, { recursive: true, force: true }).catch(() => {})
      throw new Error(
        `Failed to install Python package: ${result.stderr || result.error || result.stdout}`,
      )
    }

    await rm(packagePath, { recursive: true, force: true })
    await rename(tempPath, packagePath)
  }

  await rm(targetPath, { recursive: true, force: true })
  await copyDir(packagePath, targetPath)
  logForDebugging(
    `Copied pip package ${packageName} from cache to ${targetPath}`,
  )
}
