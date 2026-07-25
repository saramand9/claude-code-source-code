# Claude Code core extraction

This branch keeps Claude Code's existing agent architecture and changes its
composition boundary. It does not introduce an `AgentRuntime`, a second tool
registry, or a new message protocol.

## What remains the core

- `src/query.ts` remains the agent state machine and async-generator entry.
- `Tool[]`, `buildTool()`, aliases, permissions, and result mapping keep the
  existing `src/Tool.ts` contract.
- `toolOrchestration.ts` and `StreamingToolExecutor.ts` retain serial/parallel
  scheduling, cancellation, progress, and turn ordering.
- The compact/microcompact decision points, stop-hook result handling, queued
  context injection points, max turns, fallback, and recovery transitions stay
  in `query()`.
- The portable default now includes Claude Code's automatic-compaction policy:
  token estimation, context thresholds, three-failure circuit breaker, media
  stripping, the original compact prompt/summary formatting, API-round
  prompt-too-long recovery, boundary creation, and post-compact ordering.
- The portable session module keeps Claude Code's append-only JSONL message
  shape, UUID parent chain, compact-boundary relinking, legacy progress bridge,
  cycle guard, latest-leaf selection, and parallel tool-result DAG recovery.
- `createCoreSystemPrompt()` provides the small, domain-independent subset of
  Claude Code's persistence, failure-diagnosis, parallelism, verification, and
  action-safety guidance.
- Existing message shapes in `src/types/message.ts` remain the wire protocol.

The portable build substitutes only two product-heavy implementations:

- `utils/messages.ts` becomes a generic headless normalizer that keeps
  user/assistant/tool-use/tool-result semantics without CLI/PDF/IDE rendering
  branches.
- `services/tools/toolExecution.ts` becomes a headless executor that keeps
  lookup, schema validation, permission checks, `tool.call()`, progress,
  context modifiers, new messages, empty-result repair, and paired error
  `tool_result` messages.

## Host capabilities

The existing flat `QueryDeps` seam is now the platform boundary. The only
required capability for `createCoreDeps()` is `callModel`; the same adapter is
used for normal turns and compact-summary turns.

Portable compaction defaults to a 200k model context and can be configured
without replacing the original dependency seam:

```ts
createCoreDeps({
  callModel,
  compaction: {
    contextWindow: model => contextWindowFor(model),
    enabled: true,
  },
})
```

Hosts may still override any of the original compaction dependencies
individually.

`createCoreDeps()` supplies portable no-op defaults for product integrations:
analytics, profiling, hooks, command queues, session persistence, prompt dumps,
and UI policy.

Memory is not removed. Its scheduling points remain in `query()`, while storage
and retrieval remain host adapters:

- `startRelevantMemoryPrefetch`
- `filterDuplicateMemoryAttachments`
- `getAttachmentMessages`
- `createAttachmentMessage`

The default is intentionally no memory provider. A PC, Android, or iOS host can
install its own provider without changing the agent loop.

Session storage uses the same split: protocol and recovery are in core, while
the storage medium stays in the host. `insertMessageChain()` and
`serializeTranscriptEntries()` produce appendable JSONL; after reading that
text from a file, SQLite, cloud sync, or mobile sandbox,
`parseTranscriptJsonl()` plus `buildLatestConversationChain()` reconstruct the
messages passed back to `query()`.

## Public entry

`src/core/index.ts` exports:

- `query`, `QueryParams`, `CoreQueryParams`, `QueryEvent`, `QueryTerminal`
- `createCoreDeps`, `QueryDeps`
- portable compaction, system-prompt, and JSONL resume helpers
- the original Tool helpers and Tool/message types

The portable build has no implicit production fallback. Calling `query()`
without `params.deps` fails immediately instead of loading Claude Code auth,
providers, default tools, CLI, or filesystem services.

## Build and verification

```sh
npm run test:core
```

This command builds the core, audits its dependency boundary, runs a two-turn
tool/compaction smoke test, and verifies JSONL round-trip, compact relinking,
and parallel-result DAG recovery.

| Build | Parsed inputs | Emitted inputs | Raw | Gzip |
|---|---:|---:|---:|---:|
| Naive `query.ts` bundle | 5,187 | not measured | 10.44 MiB | 3.07 MiB |
| Extracted core with compaction and resume | 28 | 26 | 66,816 bytes | 21,060 bytes |

The output is a platform-neutral ESM file at `dist-core/index.js`. It has no
runtime imports and does not emit React, Ink, CLI, commands, concrete default
tools, or the production Claude API adapter.

## Deliberate compatibility boundary

The headless path does not include Claude Code product special cases such as
Bash speculative classification, File/MCP-specific telemetry, transcript
repair for every historical beta format, PDF/IDE attachment formatting,
session JSONL writes, persistent/session/auto memory stores, or React render
methods. Those belong to host adapters or optional compatibility packages;
they are not required for the general agent loop.
