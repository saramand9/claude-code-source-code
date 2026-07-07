import {
  copyFile,
  readFile,
  readdir,
  readlink,
  realpath,
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

type NpmInstallOptions = {
  registry?: string
  version?: string
  force?: boolean
}

const SIMPLE_NPM_PACKAGE_NAME =
  /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/i

function isSimpleNpmPackageName(packageName: string): boolean {
  return SIMPLE_NPM_PACKAGE_NAME.test(packageName)
}

function formatNpmPackageSpec(
  packageName: string,
  options: NpmInstallOptions,
): string {
  if (options.version && !isSimpleNpmPackageName(packageName)) {
    throw new Error(
      'NPM source version can only be used with registry package names. ' +
        'For npm aliases, tarballs, URLs, or file: specs, encode the desired version in the package spec itself.',
    )
  }
  return options.version && isSimpleNpmPackageName(packageName)
    ? `${packageName}@${options.version}`
    : packageName
}

function getSpecCacheKey(
  packageName: string,
  options: Pick<NpmInstallOptions, 'registry' | 'version'> = {},
): string {
  const sanitized = packageName.replace(/[^a-zA-Z0-9_.-]/g, '-').slice(0, 48)
  const hash = createHash('sha256')
    .update(JSON.stringify({ packageName, ...options }))
    .digest('hex')
    .slice(0, 16)
  return `${sanitized || 'npm-spec'}-${hash}`
}

export function getNpmPackageSpecCachePath(
  packageName: string,
  options: Pick<NpmInstallOptions, 'registry' | 'version'> = {},
): string {
  return join(getPluginsDirectory(), 'npm-cache', 'spec-cache', getSpecCacheKey(packageName, options))
}

function normalizeExactNpmVersion(version: string | undefined): string | null {
  const trimmed = version?.trim()
  if (!trimmed) {
    return null
  }
  const exact = trimmed.match(/^v?(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z-.+]+)?)$/)
  return exact?.[1] ?? null
}

async function readCachedPackageVersion(
  packagePath: string,
): Promise<string | null> {
  try {
    const manifest = JSON.parse(
      await readFile(join(packagePath, 'package.json'), 'utf-8'),
    ) as { version?: unknown }
    return typeof manifest.version === 'string' ? manifest.version : null
  } catch {
    return null
  }
}

async function shouldInstallNpmPackage(
  packagePath: string,
  options: NpmInstallOptions,
): Promise<boolean> {
  if (options.force || !(await pathExists(packagePath))) {
    return true
  }
  if (options.registry) {
    return true
  }
  if (!options.version) {
    return false
  }

  const exactVersion = normalizeExactNpmVersion(options.version)
  if (!exactVersion) {
    return true
  }

  return (await readCachedPackageVersion(packagePath)) !== exactVersion
}

async function getInstalledPackagePathFromPrefix(
  prefixPath: string,
): Promise<string | null> {
  const directNames = await readNpmRootDependencyNames(prefixPath)
  for (const name of directNames) {
    const packagePath = join(prefixPath, 'node_modules', name)
    if (await pathExists(join(packagePath, 'package.json'))) {
      return packagePath
    }
  }

  const packagePaths = await listInstalledTopLevelPackages(
    join(prefixPath, 'node_modules'),
  )
  return packagePaths.length === 1 ? packagePaths[0]! : null
}

async function readNpmRootDependencyNames(prefixPath: string): Promise<string[]> {
  try {
    const manifest = JSON.parse(
      await readFile(join(prefixPath, 'package.json'), 'utf-8'),
    ) as {
      dependencies?: Record<string, unknown>
      optionalDependencies?: Record<string, unknown>
      devDependencies?: Record<string, unknown>
    }
    return [
      ...new Set([
        ...Object.keys(manifest.dependencies ?? {}),
        ...Object.keys(manifest.optionalDependencies ?? {}),
        ...Object.keys(manifest.devDependencies ?? {}),
      ]),
    ]
  } catch {
    return []
  }
}

async function listInstalledTopLevelPackages(
  nodeModulesPath: string,
): Promise<string[]> {
  try {
    const entries = await readdir(nodeModulesPath, { withFileTypes: true })
    const packagePaths: string[] = []
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === '.bin') {
        continue
      }
      if (entry.name.startsWith('@')) {
        const scopePath = join(nodeModulesPath, entry.name)
        for (const scopedEntry of await readdir(scopePath, {
          withFileTypes: true,
        })) {
          if (!scopedEntry.isDirectory()) {
            continue
          }
          const packagePath = join(scopePath, scopedEntry.name)
          if (await pathExists(join(packagePath, 'package.json'))) {
            packagePaths.push(packagePath)
          }
        }
      } else {
        const packagePath = join(nodeModulesPath, entry.name)
        if (await pathExists(join(packagePath, 'package.json'))) {
          packagePaths.push(packagePath)
        }
      }
    }
    return packagePaths
  } catch {
    return []
  }
}

async function runNpmInstall(
  packageSpec: string,
  prefixPath: string,
  options: NpmInstallOptions,
): Promise<void> {
  logForDebugging(`Installing npm package ${packageSpec} to cache`)
  const args = ['install', packageSpec, '--prefix', prefixPath]
  if (options.registry) {
    args.push('--registry', options.registry)
  }
  const result = await execFileNoThrow('npm', args, { useCwd: false })

  if (result.code !== 0) {
    throw new Error(`Failed to install npm package: ${result.stderr}`)
  }
}

/**
 * Install an npm package into Claude's plugin npm cache and copy it to a target path.
 */
export async function installFromNpm(
  packageName: string,
  targetPath: string,
  options: NpmInstallOptions = {},
): Promise<void> {
  const npmCachePath = join(getPluginsDirectory(), 'npm-cache')

  await getFsImplementation().mkdir(npmCachePath)

  const packageSpec = formatNpmPackageSpec(packageName, options)
  let packagePath: string | null

  if (isSimpleNpmPackageName(packageName)) {
    packagePath = join(npmCachePath, 'node_modules', packageName)
    if (await shouldInstallNpmPackage(packagePath, options)) {
      await runNpmInstall(packageSpec, npmCachePath, options)
    }
  } else {
    const specCachePath = getNpmPackageSpecCachePath(packageName, {
      registry: options.registry,
      version: options.version,
    })
    packagePath = options.force
      ? null
      : await getInstalledPackagePathFromPrefix(specCachePath)

    if (!packagePath) {
      await rm(specCachePath, { recursive: true, force: true })
      await runNpmInstall(packageSpec, specCachePath, options)
      packagePath = await getInstalledPackagePathFromPrefix(specCachePath)
      if (!packagePath) {
        throw new Error(
          `Failed to locate installed npm package for spec: ${packageSpec}`,
        )
      }
    }
  }

  await rm(targetPath, { recursive: true, force: true })
  await copyDir(packagePath, targetPath)
  logForDebugging(
    `Copied npm package ${packageName} from cache to ${targetPath}`,
  )
}
