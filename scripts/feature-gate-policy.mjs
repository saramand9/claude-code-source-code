export const PRESERVE_FEATURES_ENV = 'CLAUDE_CODE_PRESERVE_FEATURES'
export const ALLOW_UNAUDITED_FEATURES_ENV =
  'CLAUDE_CODE_ALLOW_UNAUDITED_FEATURES'

export const DEFAULT_PRESERVED_FEATURES = Object.freeze([
  'CONTEXT_COLLAPSE',
  'DUMP_SYSTEM_PROMPT',
  'EXPERIMENTAL_SKILL_SEARCH',
  'HISTORY_PICKER',
  'HISTORY_SNIP',
  'MCP_SKILLS',
  'QUICK_SEARCH',
  'REACTIVE_COMPACT',
])

export function parseFeatureList(value) {
  return [
    ...new Set(
      String(value ?? '')
        .split(/[,\s]+/)
        .map(name => name.trim())
        .filter(Boolean),
    ),
  ]
}

export function getEnvPreservedFeatures(env = process.env) {
  return parseFeatureList(env[PRESERVE_FEATURES_ENV])
}

export function isTruthyFlag(value) {
  return /^(1|true|yes|on)$/i.test(String(value ?? '').trim())
}

export function validateFeatureGatePolicy({
  sourceFeatures,
  defaultPreservedFeatures = DEFAULT_PRESERVED_FEATURES,
  envPreservedFeatures = [],
  allowUnaudited = false,
}) {
  const sourceSet = new Set(sourceFeatures)
  const defaultSet = new Set(defaultPreservedFeatures)
  const unknownFeatures = envPreservedFeatures.filter(
    feature => !sourceSet.has(feature),
  )
  const unauditedFeatures = envPreservedFeatures.filter(
    feature => sourceSet.has(feature) && !defaultSet.has(feature),
  )
  const errors = []

  if (unknownFeatures.length > 0) {
    errors.push(
      `${PRESERVE_FEATURES_ENV} contains unknown feature gate(s): ${unknownFeatures.join(
        ', ',
      )}`,
    )
  }

  if (unauditedFeatures.length > 0 && !allowUnaudited) {
    errors.push(
      `${PRESERVE_FEATURES_ENV} contains non-default feature gate(s): ${unauditedFeatures.join(
        ', ',
      )}. Set ${ALLOW_UNAUDITED_FEATURES_ENV}=1 only after documenting the source-build risk boundary.`,
    )
  }

  return {
    ok: errors.length === 0,
    unknownFeatures,
    unauditedFeatures,
    allowUnaudited,
    errors,
  }
}
