import { readFileSync } from 'fs'

const DEFAULT_NAMESPACE_PATH =
  '/var/run/secrets/kubernetes.io/serviceaccount/namespace'

const DEFAULT_OPEN_NAMESPACES = new Set([
  'default',
  'dev',
  'development',
  'homespace',
  'local',
  'sandbox',
  'test',
  'testing',
  'ts',
])

const NAMESPACE_ENV_KEYS = [
  'COO_NAMESPACE',
  'POD_NAMESPACE',
  'KUBERNETES_NAMESPACE',
  'NAMESPACE',
  'CLAUDE_CODE_NAMESPACE',
]

const CLUSTER_SIGNAL_ENV_KEYS = [
  'COO_CLUSTER',
  'COO_CLUSTER_NAME',
  'CLUSTER',
  'KUBERNETES_SERVICE_HOST',
]

const SECURITY_LEVEL_ENV_KEYS = [
  'COO_ASL',
  'COO_SECURITY_LEVEL',
  'COO_NAMESPACE_SECURITY_LEVEL',
  'ASL',
  'ASL_LEVEL',
  'SECURITY_LEVEL',
]

function isTruthy(value: string | undefined): boolean {
  return ['1', 'true', 'yes', 'on'].includes(String(value ?? '').toLowerCase())
}

function normalized(value: string | undefined): string | undefined {
  const trimmed = value?.trim().toLowerCase()
  return trimmed || undefined
}

function splitEnvList(value: string | undefined): string[] {
  return String(value ?? '')
    .split(/[,\s]+/)
    .map(item => item.trim().toLowerCase())
    .filter(Boolean)
}

function getConfiguredOpenNamespaces(): Set<string> {
  return new Set([
    ...DEFAULT_OPEN_NAMESPACES,
    ...splitEnvList(process.env.CLAUDE_CODE_OPEN_NAMESPACES),
  ])
}

function namespaceFromEnv(): string | undefined {
  for (const key of NAMESPACE_ENV_KEYS) {
    const value = normalized(process.env[key])
    if (value) return value
  }
  return undefined
}

function namespaceFromServiceAccount(): string | undefined {
  const namespacePath =
    process.env.CLAUDE_CODE_K8S_NAMESPACE_PATH || DEFAULT_NAMESPACE_PATH
  try {
    return normalized(readFileSync(namespacePath, 'utf8'))
  } catch {
    return undefined
  }
}

function currentNamespace(): string | undefined {
  return namespaceFromEnv() || namespaceFromServiceAccount()
}

function hasClusterSignal(namespace: string | undefined): boolean {
  if (namespace) return true
  return CLUSTER_SIGNAL_ENV_KEYS.some(key => Boolean(normalized(process.env[key])))
}

function hasProtectedSecurityLevel(): boolean {
  for (const key of SECURITY_LEVEL_ENV_KEYS) {
    const value = normalized(process.env[key])
    if (!value) continue

    const numeric = value.match(/\d+/)?.[0]
    if (numeric) return Number(numeric) >= 3

    if (/(protected|privileged|sensitive|high|prod)/.test(value)) return true
  }
  return false
}

function namespaceLooksProtected(namespace: string): boolean {
  return /(^|[-_])(prod|production|stage|staging|priv|protected|secure|sensitive|asl[3-9]|boron)([-_]|$)/.test(
    namespace,
  )
}

/**
 * Conservative runtime replacement for the internal protected namespace guard.
 *
 * No k8s/COO signal means local or laptop usage, so this returns false. When
 * cluster signals are present, unknown namespaces are treated as protected.
 */
export function checkProtectedNamespace(): boolean {
  if (
    isTruthy(process.env.COO_RUNNING_ON_HOMESPACE) ||
    isTruthy(process.env.CLAUDE_CODE_HOMESPACE)
  ) {
    return false
  }

  const namespace = currentNamespace()
  if (!hasClusterSignal(namespace)) return false
  if (hasProtectedSecurityLevel()) return true
  if (!namespace) return true
  if (namespaceLooksProtected(namespace)) return true

  return !getConfiguredOpenNamespaces().has(namespace)
}
