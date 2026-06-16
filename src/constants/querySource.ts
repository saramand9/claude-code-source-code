/**
 * Identifies the high-level caller for an API query. The original source uses
 * this for analytics, cache tracking, and feature gates; values are intentionally
 * extensible because many call sites compose prefixes such as
 * `agent:${agentType}` and `repl_main_thread:${mode}`.
 */
export type QuerySource = string
