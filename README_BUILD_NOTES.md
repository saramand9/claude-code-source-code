# 本次修改说明

本文记录 `build-safety-isolation` 分支中本次改动的范围、构建方式、已验证内容，以及哪些部分仍然只是 stub 或降级实现。

## 修改目标

这个仓库的 `src/` 来自 `@anthropic-ai/claude-code` 2.1.88 的反解包源码。原始源码依赖 Anthropic 内部 Bun 构建链、编译期宏、feature gate 和若干未发布模块，不能直接用 Node/npm 构建。

本次修改的目标是提供一个可复现的 Node/esbuild 构建路径，让当前源码能生成可启动的 `dist/cli.js`，并明确记录缺失功能的处理边界。

## 标注口径

- **尝试修复/真实适配**：为当前仓库补上可运行构建路径、运行依赖、参数兼容或实际业务逻辑。目标是让现有功能真实工作。
- **mock/stub/降级**：为缺失的内部模块、Bun-only 能力或 native 能力提供占位实现。目标是让构建或非相关路径继续运行，不代表功能完整恢复。
- **混合**：同一块改动里既有真实适配，也有明确降级。

## 修改了什么

1. **尝试修复/真实适配**：构建入口改为 Node/esbuild

   - `package.json` 的 `build` 改为直接执行 `node scripts/build.mjs`。
   - `scripts/build.mjs` 复制 `src/` 到 `build-src/` 后再做转换，避免直接修改原始源码。
   - 构建输出为 `dist/cli.js`。

2. **混合**：处理 Bun 编译期能力

   - **mock/stub/降级**：默认将 `feature('...')` 在构建副本中替换为 `false`，等价于关闭内部 feature gate。
   - **混合**：当前例外保留 `CONTEXT_COLLAPSE`、`HISTORY_SNIP`、`REACTIVE_COMPACT`、`DUMP_SYSTEM_PROMPT`、`MCP_SKILLS` 和 `EXPERIMENTAL_SKILL_SEARCH`；ContextCollapse 是保守外部版，History Snip 已推进为高可用外部版，Reactive Compact 是 prompt-too-long 后置恢复的外部实现，MCP_SKILLS 是 `skill://` 文本资源到 prompt command 的外部实现，EXPERIMENTAL_SKILL_SEARCH 是本地 keyword skill discovery 和 DiscoverSkills 工具外部实现，它们都不等同于官方完整内部实现，`DUMP_SYSTEM_PROMPT` 是显式 CLI 快速路径恢复。
   - **尝试修复/真实适配**：将 `MACRO.VERSION`、`MACRO.PACKAGE_URL`、`MACRO.ISSUES_EXPLAINER_URL` 等宏替换为字符串常量。
   - **尝试修复/真实适配**：移除或替换 `bun:bundle` 相关导入，让 Node/esbuild 可以继续解析源码。

3. **混合**：增加缺失模块的构建期 stub 机制

   - **尝试修复/真实适配**：`scripts/build.mjs` 使用 esbuild JS API，并解析缺失模块/缺失导出。
   - **mock/stub/降级**：对 feature-gated 的相对路径模块生成 fail-fast stub。
   - **mock/stub/降级**：对缺失的命名导出补 fail-fast 导出，保证 bundle 能继续，但运行到对应路径时明确报错。

4. **尝试修复/真实适配**：补充运行依赖和 TypeScript 配置

   - `package.json` / `package-lock.json` 补充 CLI 运行和打包需要的 npm 依赖。
   - `tsconfig.json` 增加 Node/Bun 类型、DOM lib、`src/*` 路径映射和更适合当前源码布局的 `rootDir`。

5. **mock/stub/降级**：增加 `bun:ffi` stub

   - 新增 `stubs/bun-ffi.ts`。
   - 当前实现仅提供空对象和空 `dlopen()` 返回值，用于非 Bun 环境下通过构建。

6. **尝试修复/真实适配**：修复 CLI 启动参数兼容问题

   - 修复 `src/main.tsx` 中 Commander 15 不接受 `-d2e, --debug-to-stderr` 这种短参数写法导致的启动崩溃。
   - 当前隐藏参数改为 `--debug-to-stderr`。

7. **尝试修复/真实适配**：改造 source preparation 脚本

   - `scripts/prepare-src.mjs` 改为输出到 `build-src/prepared`。
   - 不再直接修改 `src/` 或根目录 `stubs/`。
   - 支持 `--out <dir>` 指定输出目录。

8. **尝试修复/真实适配**：新增验证报告模板

   - 新增 `openspec/templates/verification-report.html`。
   - 将数据验证逻辑 `validateRows()` 和数据后置清理 `postProcessRows()` 拆开。
   - 后置处理负责规范化 `id`、`caseName`、`status`、`dimension`、`detail` 等字段。

## 逐项分类

| 文件或功能 | 标注 | 说明 |
| --- | --- | --- |
| `scripts/build.mjs` 构建流程 | 尝试修复/真实适配 | 建立 Node/esbuild 构建路径，复制源码到 `build-src/` 后转换并输出 `dist/cli.js`。 |
| `scripts/build.mjs` 的 `feature(...)` 替换 | 混合 | 默认关闭 gated 代码；当前选择性保留 `CONTEXT_COLLAPSE`、`HISTORY_SNIP`、`REACTIVE_COMPACT`、`DUMP_SYSTEM_PROMPT`、`MCP_SKILLS` 与 `EXPERIMENTAL_SKILL_SEARCH`，其它内部 gate 仍按外部构建关闭。 |
| `scripts/audit-features.mjs` / `npm run audit:features` | 尝试修复/真实适配 | 统计 `src/` 中所有 `feature('...')` 调用、默认保留项、环境保留项和当前 stub manifest，作为后续 feature 修复清单。 |
| `scripts/build.mjs` 的 `MACRO.*` 替换 | 尝试修复/真实适配 | 用确定字符串替代 Bun 编译期 define。 |
| `scripts/build.mjs` 自动生成缺失模块 | mock/stub/降级 | 生成 fail-fast stub，并写入 `build-src/stub-manifest.json`；不恢复内部功能。 |
| `@ant/claude-for-chrome-mcp` alias | 混合 | 指向 `src/stubs/claude-for-chrome-mcp.ts` 外部保守 shim；提供空 browser tools 和可连接的空 MCP server，不恢复真实 Chrome browser tools。 |
| `color-diff-napi` alias 到 `src/native-ts/color-diff` | 尝试修复/真实适配 | 使用已有 TS port 替代 native 包；其中 `BAT_THEME` 支持仍是降级。 |
| `src/native-ts/file-index` | 尝试修复/真实适配 | 使用已有 TS fuzzy index 替代 Rust NAPI 搜索模块。 |
| `src/native-ts/yoga-layout` | 尝试修复/真实适配 | 使用已有 TS flex layout 实现覆盖 Ink 实际使用的布局子集。 |
| `stubs/bun-ffi.ts` | mock/stub/降级 | 空 FFI 占位，不提供真实 `dlopen` 或 native symbol 调用。 |
| `src/main.tsx` Commander 参数修改 | 尝试修复/真实适配 | 修复启动时参数定义不兼容导致的崩溃。 |
| `scripts/prepare-src.mjs` 隔离输出 | 尝试修复/真实适配 | 避免准备阶段直接修改 `src/` 和根目录 `stubs/`。 |
| `openspec/templates/verification-report.html` | 尝试修复/真实适配 | 实现验证与后置清理拆分、字段规范化、筛选和搜索。 |
| `audio-capture-napi` / `image-processor-napi` / `modifiers-napi` / `url-handler-napi` | 混合 | 构建时 external 保留；新增统一可选 native loader，缺失时走 fallback 或返回明确不可用状态。 |
| `scripts/test-build-safety.mjs` | 尝试修复/真实适配 | 新增可重复的深度回归测试，覆盖 stub manifest、fail-fast、native fallback、deep link、CLI smoke 和交互流式渲染。 |
| `src/services/contextCollapse/*` | 混合 | 替换原 `.d.ts` 占位，提供可加载的保守外部运行时；不做真实摘要、投影删除或 ctx-agent 调度。 |
| `src/tools/CtxInspectTool/CtxInspectTool.ts` | 混合 | 补齐工具加载路径和只读检查输出；默认隐藏，仅显式设置 collapse 环境变量时启用。 |
| `src/services/compact/snipCompact.ts` / `snipProjection.ts` | 混合 | 提供高可用 History Snip 运行时、分段裁剪、目标 ID 裁剪、投影删除、工具对保护和运行时阈值；不是官方完整语义 snip。 |
| `src/services/compact/reactiveCompact.ts` | 混合 | 恢复 `REACTIVE_COMPACT` 的 prompt-too-long/media-size 后置压缩重试路径；复用现有 compactConversation，不恢复官方内部实验策略。 |
| `src/tools/SnipTool/SnipTool.ts` / `src/commands/force-snip.ts` | 混合 | Snip 工具与内部 force-snip 命令可加载、可执行；支持自动分段裁剪、目标 ID 和目标 token 参数。 |
| `src/components/messages/SnipBoundaryMessage.tsx` | 尝试修复/真实适配 | UI 可渲染 snip 边界摘要，避免历史裁剪事件不可见。 |
| `src/tools/VerifyPlanExecutionTool/*` | 混合 | `CLAUDE_CODE_VERIFY_PLAN=true` 时可加载、可进入工具池、可记录验证请求；不是官方后台 verifier。 |
| `src/skills/bundled/verify/*` | 尝试修复/真实适配 | 补齐 verify bundled skill 文档和示例，避免继续由空文本 asset stub 代替。 |
| `src/utils/protectedNamespace.ts` | 混合 | 补齐受保护命名空间检查的外部保守实现；未知 k8s/COO 环境默认按 protected 处理。 |
| `src/utils/ultraplan/prompt.txt` | 混合 | 补齐远程规划提示词资源，避免空文本 asset stub；不等于恢复 CCR 远程规划功能。 |
| `src/components/AntModelSwitchCallout.tsx` | 混合 | 补齐 ant-only 模型切换提示弹窗外部保守版；只在显式 env 配置目标模型时显示，不做官方内部模型迁移。 |
| `src/components/UndercoverAutoCallout.tsx` | 混合 | 补齐 ant-only 公开仓库安全提示弹窗；只负责提示和记录已读，不改变 undercover 判定逻辑。 |
| `src/ink/devtools.ts` | 混合 | 补齐 React DevTools 开发态导入路径；当前为 no-op 外部保守实现，不连接真实 devtools。 |
| `src/tools/TungstenTool/*` | 混合 | 补齐 Tungsten 工具和 live monitor 加载路径；工具默认禁用并返回 unavailable，不恢复内部终端会话。 |
| `src/components/FeedbackSurvey/useFrustrationDetection.ts` / `src/hooks/notifs/useAntOrgWarningNotification.ts` | 混合 | 补齐 ant-only REPL 顶层 no-op hook，避免变量路径 require 在外部源码包中运行期缺失。 |
| `src/components/messages/UserGitHubWebhookMessage.tsx` / `UserForkBoilerplateMessage.tsx` / `UserCrossSessionMessage.tsx` | 混合 | 补齐 gated 用户消息渲染组件，并把 `UserTextMessage` 中对应变量路径 require 改为静态路径；组件为外部保守摘要渲染，不恢复内部完整 UI。 |
| `src/screens/ResumeConversation.tsx` ContextCollapse persist require | 尝试修复/真实适配 | 将 resume 入口的 ContextCollapse 持久化恢复从变量路径 require 改为静态字面量 require，避免单文件产物运行期查找不存在的相对文件。 |
| `src/tools/REPLTool/REPLTool.ts` / `src/tools/SuggestBackgroundPRTool/SuggestBackgroundPRTool.ts` / `src/commands/agents-platform/index.ts` | 混合 | 补齐最后 3 个 feature-gated manifest 缺口；均为默认禁用的外部保守实现，不恢复内部 REPL VM、后台 PR 或 agents platform。 |
| `src/skills/mcpSkills.ts` | 混合 | 恢复 `MCP_SKILLS` 的外部可运行路径：读取 MCP `skill://` 文本资源并转换成 prompt command；不恢复非文本资源、resource templates 或内部 skill 分发策略。 |
| `src/services/skillSearch/*` | 混合 | 恢复 `EXPERIMENTAL_SKILL_SEARCH` 的本地索引、预取和 discover attachment 路径；远程 canonical skill 加载仍是明确不可用的外部保守边界。 |
| `src/tools/DiscoverSkillsTool/*` | 混合 | 新增模型可调用的 `DiscoverSkills` 只读工具，支持检索本地/MCP prompt skill；不恢复官方内部 skill marketplace 或语义向量检索。 |

## 尝试修复/真实适配

这些部分是当前分支实际可用的实现或构建适配：

- Node/esbuild 构建流程。
- Bun 宏和 feature gate 的构建期转换。
- CLI 入口 bundle。
- `--version`、`--help`、`auth status`、`-p` 非交互调用。
- 已存在的纯 TypeScript native 替代实现会被构建使用，例如 `src/native-ts/color-diff`、`src/native-ts/file-index`、`src/native-ts/yoga-layout`。
- 验证报告模板的数据校验、过滤、搜索和后置清理逻辑。
- History Snip 的高可用分段裁剪、目标 ID 裁剪、投影删除、工具对保护、SnipTool 和内部 force-snip 命令加载路径。
- Reactive Compact 的后置恢复路径：主请求遇到 prompt-too-long 后可自动 compact 并重试；媒体尺寸错误可以被识别为可恢复错误并进入同一压缩路径。
- VerifyPlanExecution 外部保守工具加载路径、计划退出后的验证提示 gate、pending plan verification 状态记录，以及 verify bundled skill 文档资产。
- `protectedNamespace` 外部保守运行时，避免 `USER_TYPE=ant` 或内部遥测路径触发 fail-fast stub。
- `ultraplan` 的远程规划提示词资源，构建时不再生成空文本 asset stub。
- Ant-only `AntModelSwitchCallout` 和 `UndercoverAutoCallout` 的外部保守 UI 加载路径，避免 `USER_TYPE=ant` 时 REPL 动态加载缺失模块。
- `ink/devtools` 和 `TungstenTool` 的外部保守加载路径，避免开发态 Ink 或 `USER_TYPE=ant` 下相关 import 直接触发 fail-fast stub。
- Ant-only `useFrustrationDetection` 和 `useAntOrgWarningNotification` no-op hook，避免 REPL 顶层变量路径 require 指向缺失文件。
- Resume 入口的 ContextCollapse persist 静态打包路径，以及 `UserTextMessage` 中 GitHub webhook、fork boilerplate、cross-session 三个 gated 用户消息分支的静态打包路径。
- `REPLTool` / `SuggestBackgroundPRTool` / `agents-platform` 的加载路径不再由生成 stub 兜底；`REPLTool` 不可用时不会隐藏 Read/Bash/Edit 等基础工具。
- `@ant/claude-for-chrome-mcp` 不再由构建脚本生成 fail-fast private stub；当前 alias 到源码里的外部保守 shim，至少能完成 MCP 初始化、列出空工具集并给出明确不可用错误。
- `MCP_SKILLS` 默认保留，`skill://` 文本资源会被读取、解析 frontmatter，并作为 `loadedFrom: 'mcp'` 的 prompt command 进入 MCP commands 列表。
- `EXPERIMENTAL_SKILL_SEARCH` 默认保留，支持本地 prompt skill 与 MCP skill 的 keyword 检索、turn-zero 预发现 attachment 和 `DiscoverSkills` 只读工具。

## mock/stub/降级

这些部分不是完整官方实现：

- `feature('...')` 默认替换为 `false`，等价于关闭内部 feature gate；当前只选择性保留 `CONTEXT_COLLAPSE`、`HISTORY_SNIP`、`REACTIVE_COMPACT`、`DUMP_SYSTEM_PROMPT`、`MCP_SKILLS` 和 `EXPERIMENTAL_SKILL_SEARCH`。
- `stubs/bun-ffi.ts` 只是空 stub，不提供真实 FFI。
- 当前 `build-src/stub-manifest.json` 为 0 项；`@ant/claude-for-chrome-mcp` 不再由构建脚本生成 private-package-stub，而是 alias 到源码里的外部保守 shim。该 shim 只提供空 browser tools 和可连接的空 MCP server，不恢复真实 Chrome browser tools。
- 当前 manifest 不再包含 `@ant/claude-for-chrome-mcp` private-package-stub、`snipCompact` / `snipProjection`、`VerifyPlanExecutionTool`、bundled verify skill 文档资产、`utils/protectedNamespace`、`utils/ultraplan/prompt.txt`、`components/AntModelSwitchCallout`、`components/UndercoverAutoCallout`、`ink/devtools`、`tools/TungstenTool`、`tools/REPLTool`、`tools/SuggestBackgroundPRTool` 和 `commands/agents-platform`。
- `ink/devtools` 当前只是 no-op，不会连接 `react-devtools-core`。
- `TungstenTool` 当前默认禁用；只提供明确 unavailable 结果和缓存清理 no-op，不提供真实 tmux/终端会话。
- `REPLTool` 当前默认禁用，不提供内部 REPL VM 或工具包装执行；工具池会保留直接 Read/Bash/Edit 等基础工具。
- `SuggestBackgroundPRTool` 当前默认禁用，不创建后台 PR 或远程任务。
- `agents-platform` 命令当前隐藏且禁用，不连接 Anthropic 内部 agents platform。
- `MCP_SKILLS` 当前只处理 `resources/list` 中 URI 以 `skill://` 开头、且 `resources/read` 返回 text content 的资源；blob-only 资源会跳过，远端 skill 中的 `!` shell 语法会作为普通文本保留，不会执行。
- `EXPERIMENTAL_SKILL_SEARCH` 当前只做本地 keyword scoring 和 MCP prompt command 合并，不做官方内部 AKI/GCS skill 分发、远程 canonical skill 下载、语义 embedding/rerank 或签名校验；`_canonical_` 远程加载路径会明确返回 unavailable。
- `UserGitHubWebhookMessage`、`UserForkBoilerplateMessage` 和 `UserCrossSessionMessage` 是外部保守摘要渲染组件，只保证 gated 分支启用后不因缺失模块崩溃；它们不恢复内部完整 GitHub webhook、fork 子会话或 UDS inbox UI 语义。
- `ULTRAPLAN` feature 仍未恢复：提示词资源是真实文本，但远程 CCR 会话、轮询和执行选择依然依赖内部/线上能力。
- `src/services/contextCollapse/*` 已从纯 `.d.ts` 占位改成可加载运行时，但仍是保守降级实现：
  - 不生成摘要。
  - 不把历史消息投影成 `<collapsed id="...">` 占位。
  - 不启动或调度官方 ctx-agent。
  - 默认不接管 AutoCompact/ReactiveCompact，避免假启用后压制真实可用的压缩路径。
- `REACTIVE_COMPACT` 当前恢复的是外部后置恢复主路径，不包含官方内部 statsig 实验策略、复杂分组剥离策略或 reactive-only manual compact 的完整语义；manual `/compact` 默认仍走传统 compact 路径。
- 下列 native 包仍作为 external 保留；当前通过 `src/utils/nativeOptional.ts` 统一包装缺失错误，触发对应路径时会 fallback、返回不可用状态或记录明确 debug 信息：
  - `audio-capture-napi`
  - `image-processor-napi`
  - `modifiers-napi`
  - `url-handler-napi`
  - `*.node`

## Bun 相关背景

Bun 是一个 JavaScript/TypeScript 运行时和工具链，能力范围大致覆盖 Node.js 运行时、包管理器、打包器和测试器。Claude Code 官方发布流程依赖 Bun 的一些编译期能力，例如：

```ts
feature('KAIROS')
MACRO.VERSION
import { feature } from 'bun:bundle'
```

这些不是普通 Node.js 能直接执行或理解的运行时代码。官方 Bun 构建会在打包阶段判断 feature gate，并做 dead-code elimination。例如内部构建可能保留某个功能，外部发布构建则把它折叠为 `false` 并删除对应分支。

本分支没有恢复 Anthropic 内部 Bun 构建环境，也没有恢复内部 feature 配置。因此当前处理方式是：

```text
feature('...') -> false
feature('CONTEXT_COLLAPSE') -> true
feature('DUMP_SYSTEM_PROMPT') -> true
feature('HISTORY_SNIP') -> true
feature('MCP_SKILLS') -> true
feature('EXPERIMENTAL_SKILL_SEARCH') -> true
feature('REACTIVE_COMPACT') -> true
```

这能让外部主路径继续构建。注意：`CONTEXT_COLLAPSE`、`HISTORY_SNIP`、`REACTIVE_COMPACT`、`DUMP_SYSTEM_PROMPT`、`MCP_SKILLS` 和 `EXPERIMENTAL_SKILL_SEARCH` 只是被保留进 bundle；ContextCollapse 仍由 `CLAUDE_CONTEXT_COLLAPSE` / `CLAUDE_CODE_CONTEXT_COLLAPSE` 和已恢复状态共同控制，History Snip 由 `DISABLE_COMPACT` / `DISABLE_SNIP` / `CLAUDE_CODE_DISABLE_SNIP` 共同控制，Reactive Compact 由 `DISABLE_COMPACT` / `DISABLE_AUTO_COMPACT` / `DISABLE_REACTIVE_COMPACT` / `CLAUDE_CODE_DISABLE_REACTIVE_COMPACT` 控制，`DUMP_SYSTEM_PROMPT` 只在显式传入 `--dump-system-prompt` 时执行，`MCP_SKILLS` 只在已连接 MCP server 暴露 `skill://` text resources 时生效，`EXPERIMENTAL_SKILL_SEARCH` 可被 `CLAUDE_CODE_DISABLE_SKILL_SEARCH` / `DISABLE_SKILL_SEARCH` 关闭，或由 `CLAUDE_CODE_EXPERIMENTAL_SKILL_SEARCH` 显式控制。其它 gated 内部能力默认关闭。

## 实际风险说明

构建成功不代表完整复原官方 Claude Code。本分支的核心风险是：部分代码只是让 import、bundle 或主路径运行成功，真实功能并不存在或不完整。

1. feature gate 替换仍是最大风险

   除当前选择性保留的 `CONTEXT_COLLAPSE`、`HISTORY_SNIP`、`REACTIVE_COMPACT`、`DUMP_SYSTEM_PROMPT`、`MCP_SKILLS` 和 `EXPERIMENTAL_SKILL_SEARCH` 外，这仍会关闭大量内部或实验功能，例如：

   ```text
   KAIROS
   BG_SESSIONS
   CACHED_MICROCOMPACT
   VOICE_MODE
   BASH_CLASSIFIER
   TRANSCRIPT_CLASSIFIER
   WORKFLOW_SCRIPTS
   CHICAGO_MCP
   BRIDGE_MODE
   ```

   可能影响：

   - 后台任务、KAIROS、主动模式、部分远程/桥接能力不可用。
   - cached microcompact 等高级长上下文能力仍缺失。
   - `CONTEXT_COLLAPSE` 虽已可加载，但不是官方完整实现。
   - `HISTORY_SNIP` 虽已可加载并有高可用裁剪实现，但不是官方完整语义裁剪系统。
   - Bash/权限 classifier 自动判断能力关闭，权限体验可能和官方版不同。
   - 有些命令、工具或 UI 分支会直接消失，而不是被真实实现。

2. Stub 不再静默伪装成功，但仍不是功能恢复

   `build-src/` 中生成的 stub 可以让 esbuild 成功，但对应功能没有真实实现。当前已改为 fail-fast，并生成 `build-src/stub-manifest.json` 记录所有生成项。

   这解决了“空函数/undefined 静默通过”的问题，但没有恢复内部能力。常见失败形态变为：

   - 运行到相关路径时报明确的 `Feature-gated module unavailable...`。
   - 缺失命名导出被调用、构造、解引用或数值转换时报明确错误。
   - SDK generated runtime/type 路径对 SDK 消费者不可靠。

3. Native external 依赖有保护，但不是完整重写

   下列 native 包只是保留为 external，并没有被重写：

   ```text
   audio-capture-napi
   image-processor-napi
   modifiers-napi
   url-handler-napi
   *.node
   ```

   当前缓解：

   - `image-processor-napi`：缺失时图片处理走 `sharp` fallback；macOS 剪贴板 native 图片读取失败时回退到脚本路径。
   - `modifiers-napi`：缺失时修饰键状态返回 `false`，避免交互路径崩溃。
   - `audio-capture-napi`：缺失时语音依赖检查返回不可用或走 SoX/arecord fallback，不再让 import 错误冒泡。
   - `url-handler-napi`：缺失时 URL scheme launch 返回 `null` 并记录 debug。

   仍然没有恢复这些 native 包本身的性能和平台能力。

4. TypeScript native 替代实现不是官方 1:1

   `src/native-ts/color-diff`、`src/native-ts/file-index`、`src/native-ts/yoga-layout` 是实际可运行的 TypeScript 替代实现，但与官方 native/Rust/C++ 模块仍可能存在性能和边界行为差异。

## 2026-06-16 续修记录

本轮继续围绕 `npm run check`、`npm run build` 和 `npm run test:build-safety` 收口，目标是让当前源码在 Node/esbuild 路径下可重复检查、构建和做安全回归。

### 本轮尝试修复/真实适配

- 修复 TypeScript 静态检查中的长尾类型错误，使 `npm run check` 通过。
- 补齐一批源码侧缺失但运行期只作为常量或类型边界使用的小模块，例如 `WorkflowTool`、`SendUserFileTool`、`SnipTool` 相关常量。
- 增加 `src/utils/toolModuleLoader.ts`，统一处理 feature-gated/lazy tool 的 `require(...).NamedExport` 加载。
- 将 `src/tools.ts` 中的 lazy tool 加载改为 `loadToolExport(...)`，优先读取命名导出；如果生成的 stub 只有 default fail-fast 导出，则回退到 default，避免工具静默变成 `undefined`。
- 修正 `scripts/test-build-safety.mjs`，让测试 helper 的 alias 与构建脚本保持一致，覆盖 `@ant/claude-for-chrome-mcp`、`color-diff-napi` 和 `vscode-jsonrpc/node.js`。
- 将 build-safety 的 stub manifest 断言改为按当前实际 manifest 检查，不再硬编码旧的 `>=25` stub 数量。
- 将 missing named export 的 fail-fast 测试改成“存在时验证”，避免把已经被源码侧修复的缺口当成必须存在的错误。
- 新增 lazy tool loader 的针对性测试，验证 default-only fail-fast stub 不会在工具加载阶段消失。

### 本轮 mock/stub/降级说明

- 新增的若干 `.d.ts` 只解决 TypeScript 编译期缺失声明，不代表对应内部模块已经完整实现。
- 当时 `feature('...') -> false` 的策略没有变化，内部 feature-gated 能力仍默认关闭；后续已对 `CONTEXT_COLLAPSE` 和 `HISTORY_SNIP` 做选择性保留，见后续记录。
- 当时构建仍会生成 fail-fast stub，并记录到 `build-src/stub-manifest.json`；这些 stub 是明确失败边界，不是功能恢复。后续修复已逐步清空当前 manifest。
- 当时 `build-src/stub-manifest.json` 显示：14 个 missing modules、0 个 missing exports、13 个生成 stub；manifest 里还包含私有包 stub 和空文本资源 stub 记录。

### 本轮验证结果

```text
npm run check
npm run build
npm run test:build-safety
```

结果：

- `npm run check` 通过，执行内容为 `tsc --noEmit`，只做 TypeScript 静态检查，不生成产物。
- `npm run build` 通过，重新生成 `build-src/` 和 `dist/cli.js`，产物大小约 27.1MB。
- `npm run test:build-safety` 通过，当时为 14/14 项；ContextCollapse 后续专项补测后为 17/17 项。

## 2026-06-16 ContextCollapse 外部版修复记录

本轮根据两篇关于 Claude Code Context 机制的分析文章，优先修复“上下文压缩功能被构建期整体关闭、运行到相关路径会靠 stub 或缺失模块失败”的问题。参考链接：

- https://blog.csdn.net/xx_nm98/article/details/161715321
- https://blog.csdn.net/wayne_lee_lwc/article/details/160633533

### 本轮技术方案

- 不伪造官方完整 ContextCollapse。
- 构建层选择性保留 `CONTEXT_COLLAPSE`，其它非白名单 feature gate 仍默认关闭。
- 运行时补齐 `src/services/contextCollapse/index.ts`、`operations.ts`、`persist.ts`，替换原来的 `.d.ts` 占位。
- 工具层补齐 `CtxInspectTool`，避免 `tools.ts` 在 `CONTEXT_COLLAPSE` 被保留后加载缺失工具。
- `query.ts` 的 prompt-too-long 恢复分支改为 runtime 真启用时才接管，避免默认路径重复吐出 413 错误或压制 AutoCompact。

### 本轮尝试修复/真实适配

- `scripts/build.mjs` 支持 `DEFAULT_PRESERVED_FEATURES` 和 `CLAUDE_CODE_PRESERVE_FEATURES`，当前默认保留 `CONTEXT_COLLAPSE`。
- `persist.restoreFromEntries()` 可以恢复 transcript 中已有的 collapse commit/snapshot 元数据。
- `getStats()`、`subscribe()`、`resetContextCollapse()`、`initContextCollapse()` 等运行时 API 可加载可调用。
- `CtxInspectTool` 可输出当前运行时状态，用于诊断 collapse 是否被请求、是否有恢复状态。
- `scripts/test-build-safety.mjs` 新增 3 项 ContextCollapse 专项测试。

### 本轮 mock/stub/降级说明

- `ContextCollapse` 当前是 **external-conservative** 实现，不是官方完整实现。
- `projectView()` 保持 no-op，不会删除消息或注入真实 `<collapsed>` 摘要占位。
- `recoverFromOverflow()` 不伪造提交，`committed` 固定为 0。
- 默认 `isContextCollapseEnabled()` 为 `false`，只有显式环境变量加已恢复状态才返回 `true`，避免错误关闭 AutoCompact。
- `CtxInspectTool` 默认隐藏；显式设置 `CLAUDE_CONTEXT_COLLAPSE=1` 或 `CLAUDE_CODE_CONTEXT_COLLAPSE=1` 后才启用。

### 本轮验证结果

```text
npm run check
npm run build
npm run test:build-safety
node dist\cli.js --version
node dist\cli.js --help
$env:CLAUDE_CONTEXT_COLLAPSE='1'; node dist\cli.js --version
node --check dist\cli.js
```

结果：

- `npm run check` 通过。
- `npm run build` 通过，重新生成 `build-src/` 和 `dist/cli.js`，产物大小约 27.1MB。
- `npm run test:build-safety` 通过，当前为 17/17 项。
- 默认启动和显式 `CLAUDE_CONTEXT_COLLAPSE=1` 启动均通过版本烟测。

## 2026-06-16/17 History Snip 高可用外部版优化记录

本轮继续修复长上下文相关缺口，重点是 `HISTORY_SNIP` 之前被构建期关闭，导致 `query.ts`、`QueryEngine.ts`、`tools.ts`、`commands.ts`、消息投影和 UI 边界渲染相关路径无法真实加载。

### 本轮技术方案

- 构建层将 `HISTORY_SNIP` 加入默认保留白名单，避免 SnipTool、force-snip 和运行时 compact 模块继续被折叠掉。
- 新增 `snipCompact`，使用高可用分段裁剪策略：按 user turn 建立安全段，按目标 token 收敛，保护最近消息，避免 assistant 开头续接、tool_result-only 续接和 tool_use/tool_result 半删。
- 新增 `snipProjection`，通过 snip boundary 里的 `removedUuids` 在后续模型视图中投影删除旧消息，同时保留边界消息用于审计。
- 新增 `SnipTool`、内部 `force-snip` 命令和 `SnipBoundaryMessage` UI 组件，补齐工具、命令、渲染三条加载路径，并支持 `targetIds` / `--id` / `--target-tokens`。
- 新增 `replaySnipBoundary()`，SDK/headless 收到 snip boundary 后按 boundary 元数据确定性重放，不再重新计算一套可能不同的裁剪范围。
- Snip 运行时默认可用，但可通过 `DISABLE_COMPACT`、`DISABLE_SNIP` 或 `CLAUDE_CODE_DISABLE_SNIP` 关闭。

### 本轮尝试修复/真实适配

- `snipCompactIfNeeded()` 可在自动阈值、强制模式或目标 ID 模式下返回裁剪后的消息、释放 token 估算、删除消息数、策略名和 snip boundary。
- 自动模式会选择最早的可删安全段，直到接近 `CLAUDE_CODE_SNIP_TARGET_TOKENS` 或默认目标 token。
- 目标 ID 模式支持 UUID 或 `shortMessageIdForSnip()` 生成的短 ID，删除目标所在的完整安全 turn，不会误删其它 turn。
- `projectSnippedView()` 会按所有 snip boundary 的 `removedUuids` 清理历史消息，避免后续模型请求继续携带已裁剪内容。
- `replaySnipBoundary()` 会复用原 boundary 的 `removedUuids`，保证 SDK mutable store、transcript 和后续 API 视图一致。
- `shouldNudgeForSnips()` 和 SnipTool 使用轻量本地 token 估算，避免引入重配置解析链导致独立运行测试失败。
- SnipTool 为只读、并发安全工具；调用成功时只追加 system boundary，不直接改写 UI scrollback。
- force-snip 命令可以手动追加 snip boundary，并支持 `--id` / `--ids` / `--target-tokens` 参数，用于诊断和内部验证。

### 本轮 mock/stub/降级说明

- 当前实现不是官方完整 History Snip。
- 不做语义相关性评分，不做模型辅助摘要。
- 目标 ID 裁剪是按完整安全 turn 删除，不做任意单消息精确点删；这是为了避免破坏 assistant/tool_result 结构。
- token 释放量是本地估算，不是官方 tokenizer 精确计数。
- 裁剪策略会选择安全 turn 分段；找不到安全边界、目标落在受保护尾部或会切开工具对时会拒绝执行。
- UI 只展示 snip 边界摘要，不恢复官方可能存在的完整交互细节。

### 本轮验证结果

```text
npm run check
npm run build
npm run test:build-safety
node --check dist\cli.js
node dist\cli.js --version
node dist\cli.js --help
$env:CLAUDE_CODE_SNIP_TRIGGER_TOKENS='1'; node dist\cli.js --version
$env:CLAUDE_CODE_SNIP_TRIGGER_TOKENS='1'; $env:CLAUDE_CODE_SNIP_TARGET_TOKENS='1'; node dist\cli.js --version
```

结果：

- `npm run check` 通过。
- `npm run build` 通过，重新生成 `build-src/` 和 `dist/cli.js`；当前构建为 14 个 missing modules、0 个 missing exports、13 个生成 stub。
- `npm run test:build-safety` 通过，当时为 20/20 项；resume/transcript 读写侧、恢复入口、session-id/continue、compact+Snip 叠加和 Snip 产物 require 专项补测后为 26/26 项。
- 新增 Snip 专项覆盖：构建保留、投影删除、保留 snip boundary、保护 tool_use/tool_result 对、目标 ID 裁剪、boundary replay 确定性、SnipTool targetIds 加载执行、force-snip `--id` 命令加载执行。
- 产物语法检查、默认启动、帮助输出和显式 Snip 阈值环境变量启动均通过。

## 2026-06-17 Resume/Transcript 一致性优化记录

本轮不新增用户可见功能，重点收敛长任务恢复风险：Snip 后 JSONL transcript 是 append-only，旧消息仍在磁盘上；如果 resume 读侧没有按 snip boundary 重放删除和重连 parentUuid，恢复会把已裁剪历史重新带回模型视图，或在删除区间后断链。

### 本轮尝试修复/真实适配

- `applySnipRemovals()` 的 removed-parent 解析增加 cycle guard，避免损坏 transcript 中 removed parent 链成环时卡死恢复流程。
- `scripts/test-build-safety.mjs` 新增真实 JSONL transcript 回放测试，覆盖多段 Snip 删除、boundary parent 重连、leaf 选择和 `buildConversationChain()` 恢复链。
- 新增 `loadConversationForResume(..., jsonlPath)` 与 `loadTranscriptFromFile()` 入口级测试，模拟 `--resume path.jsonl` 和 transcript 导入路径，确认恢复入口不会把 Snip 删除段重新带回消息链。
- 新增真实项目 session 目录测试，覆盖 `loadConversationForResume(sessionId, undefined)` 和 `loadConversationForResume(undefined, undefined)`，对应 `--resume <session-id>` 与 `--continue` 的恢复选择分支。
- 新增 compact+Snip 叠加恢复测试，覆盖 preserved compact boundary 先剪掉旧前缀、Snip 再删除 compact 后中间 turn 的组合场景，确认两类删除在恢复链中同时生效。
- 修复 `Message.tsx` 与 `QueryEngine.ts` 中 Snip 模块的变量路径 `require(...)`，改为字面量路径，避免 esbuild 无法静态打包导致运行期 `Cannot find module '../services/compact/snipProjection.js'`。
- 新增 `recordTranscript()` 写侧专项测试，覆盖 Snip 后重复持久化不会重复写入 UUID，snip boundary 会接到最后一个保留前缀消息，后续 tail 消息会接到 boundary。
- build-safety snippet bundler 新增 `jsonc-parser` 与 `semver` 的轻量测试 alias，避免导入完整 `sessionStorage` 时被 UI/keybinding 依赖污染测试环境。
- 新增 `scripts/test-cli-resume-e2e.mjs` 与 `npm run test:cli-e2e`，用本地 Anthropic-compatible SSE mock server 启动真实 `dist/cli.js` 子进程，覆盖 `-p`、`--resume <session-id>` 和 `--continue` 三段会话恢复。
- 修复 `QueryEngine` headless/print 路径的 transcript flush 可靠性：assistant/user 等 fire-and-forget 写入现在会被跟踪，最终 result 返回前统一等待并 flush，避免普通 `-p` 或 `--bare` 子进程快速退出时只落下 queue-operation/last-prompt，导致下一次 `--resume` 找不到有效会话。
- 新增 `src/utils/textualToolCallLeak.ts`，检测第三方模型/代理把工具调用以 `Calling: Read` + JSON 文本吐出来、而不是返回结构化 `tool_use` block 的兼容问题。
- `query.ts` 在没有真实结构化 `tool_use` 时，如果检测到文本化工具调用泄漏，会返回明确的 provider/tool-use 兼容错误，并且不会把文本参数自动当工具执行。
- 扩展真实 CLI E2E，覆盖结构化 `tool_use(Read)` 的多段 `input_json_delta`，并模拟第三方代理把 `message_delta.stop_reason` 错报为 `end_turn` 的情况；CLI 仍应以真实 `tool_use` block 为准执行工具和 follow-up。
- 修复流式事件缺失 `content_block_stop` 时的恢复路径：如果 SSE 已收到结构化 content block 内容并正常到达流结束，但代理漏发 stop 事件，`claude.ts` 会在流结束时最终化未关闭 block，避免 assistant/tool_use 被静默丢弃。
- `scripts/test-cli-resume-e2e.mjs` 增加 CLI 子进程 per-run 超时诊断，超时时会打印 args、stdout/stderr 和 mock server 已收到的请求摘要，避免 E2E 静默挂住。
- 扩展真实 CLI E2E，覆盖 streaming 事件乱序：mock 故意先发送 `content_block_delta`、后缺失对应 `content_block_start`，运行时应触发 non-streaming fallback，真实 CLI 最终仍返回正常结果。
- 新增 crash/resume 读侧回归：覆盖 transcript 尾部只有 user、以及尾部 assistant `tool_use` 没有对应 `tool_result` 的两种中断状态，恢复时应识别为 `interrupted_prompt`，并且不会把孤立 `tool_use` 带回 API 消息。
- 扩展真实 CLI E2E，覆盖同一 assistant response 内多个结构化 `tool_use(Read)` block：两个 Read 的 `input_json_delta` 交错到达、stop 顺序反向，follow-up 请求必须包含两个独立且不同 `tool_use_id` 的 `tool_result` block。
- 扩展真实 CLI E2E，覆盖 simple CLI 主路径的混合工具类型：同一 assistant response 内普通文本 + `Read` + `Bash` 三类 block 交错返回，follow-up 请求必须保留 assistant 文本，并包含两个不同工具结果。
- 扩展真实 CLI E2E，覆盖同一 assistant response 内三个结构化工具 block：普通文本 + `Read` + `Bash` + `Read` 交错返回，follow-up 请求必须保留 assistant 文本，并包含三个不同 `tool_use_id` 的 `tool_result` block。
- 扩展真实 CLI E2E，覆盖显式授权下的副作用型 Bash：模型请求 `Bash` 写入 `build-src/test-artifacts` 下的 fixture 文件，CLI 发送 Bash `tool_result` 后，测试确认磁盘文件实际生成。
- 扩展真实 CLI E2E，覆盖 simple CLI 主路径的写入类工具链：模型先请求 `Read`，再基于 Read 结果请求 `Edit`，CLI 在 `acceptEdits` 权限模式下实际改写临时 fixture 文件，并把 Edit `tool_result` 发送回模型。
- 修复 bare/simple 工具池的显式 `Write` opt-in：默认 simple 仍只暴露 Bash/Read/Edit；当用户显式传 `--tools Write` 时，`main.tsx` 会记录 `CLAUDE_CODE_SIMPLE_EXTRA_TOOLS=Write`，`tools.ts` 将 `Write` 加回 simple 工具池。
- 扩展真实 CLI E2E，覆盖 bare/simple 下显式 `--tools Write --allowedTools Write` 的创建文件路径：mock 返回 `Write` tool_use，真实 `dist/cli.js` 执行后会发送 Write `tool_result`，并在 `build-src/test-artifacts` 下创建包含 marker 的 fixture 文件。
- 修复交互 UI 流式显示刷新问题：`visibleStreamingText` 不再只显示最后一个换行前的完整行，避免长 chunk 或无尾随换行内容在 streaming 阶段被隐藏；同时增加 live-scroll backstop，assistant 消息落地或 streaming 文本更新时，如果用户最近没有主动滚动，会恢复到底部 live 区域。
- 扩展 build-safety 到真实 `Messages`/Ink 渲染层：用临时配置目录、`AppStateProvider` 和模拟 TTY 渲染无尾随换行的 `streamingText`，确认未完成行在组件输出中实际可见，而不只依赖源码字符串断言。

### 本轮验证结果

```text
npm run check
npm run build
npm run test:build-safety
npm run test:cli-e2e
node --check dist\cli.js
```

结果：

- `npm run check` 通过。
- `npm run build` 通过，重新生成 `build-src/` 和 `dist/cli.js`。
- `npm run test:build-safety` 通过，当前为 31/31 项。
- 新增 resume/transcript 专项确认：被 `snipMetadata.removedUuids` 标记的消息不会在 resume 后回到 `messages` Map；删除区间后的 survivor 与 snip boundary 会被重连到最近未删除祖先；最终 conversation chain 与预期一致；`loadConversationForResume(..., jsonlPath)`、`loadTranscriptFromFile()`、`loadConversationForResume(sessionId, undefined)` 和 `loadConversationForResume(undefined, undefined)` 入口层不会带回已删除历史；compact preservedSegment 与 Snip 删除叠加时恢复链符合预期；写侧重复调用 `recordTranscript()` 不会重复写 UUID，boundary/tail 接链符合预期。
- 新增产物级确认：`dist/cli.js` 不再包含 Snip 相关变量路径 `__require(snip...ModulePath)`，避免 UI 渲染 snip boundary 时按磁盘相对路径找未发布的 `.js` 文件。
- 新增真实 CLI 子进程 E2E 确认：第一段 `-p` 会生成可恢复 transcript；第二段 `--resume <session-id>` 的模型请求体包含第一段 user/assistant 历史和第二段 prompt；第三段 `--continue` 的模型请求体包含前两段历史和第三段 prompt；最终 JSONL transcript 同时包含三段 prompt 与三段 assistant response，且 user/assistant 消息 UUID 不重复。
- 新增第三方代理 tool-use 兼容性确认：本地 mock 返回纯文本 `Calling: Read` + JSON 时，真实 `dist/cli.js` 会输出 `is_error: true` 的 JSON 结果，说明模型/代理没有返回结构化 `tool_use`；不会自动执行这个文本化工具调用。
- 新增结构化工具调用正向 E2E：本地 mock 返回标准 `tool_use(Read)` stream，真实 `dist/cli.js` 会执行 Read 工具，并在后续模型请求中发送包含文件内容的 `tool_result`。
- 新增结构化工具调用异常流式 E2E：本地 mock 将 Read 参数拆成多段 `input_json_delta`，并把 stop reason 错报为 `end_turn`；真实 `dist/cli.js` 仍会执行 Read 并发送 `tool_result`。
- 新增缺失 stop 事件 E2E：本地 mock 返回结构化 Read 的 `content_block_start` 与 `input_json_delta`，但省略 `content_block_stop`；真实 `dist/cli.js` 会在流结束时最终化该 tool_use，执行 Read 并发送 `tool_result`。
- 新增 streaming 乱序 fallback E2E：本地 mock 返回 `content_block_delta` 早于 `content_block_start` 的非法 SSE，真实 `dist/cli.js` 会触发 non-streaming fallback，并通过第二次非流式 `/messages` 请求拿到最终回答。
- 新增中断恢复专项：尾部只有 user 的 transcript 会恢复为 `interrupted_prompt` 并插入一个 synthetic assistant sentinel；尾部孤立 assistant `tool_use` 会被过滤，恢复仍指向原始 user prompt，不会把未配对 tool_use 发送回模型。
- 新增多工具交错 E2E：本地 mock 在同一 assistant message 内返回两个 Read `tool_use` block，参数 delta 交错、block stop 顺序反向；真实 `dist/cli.js` 会执行两个 Read，并在 follow-up request 中发送两个独立 `tool_result` block。
- 新增混合工具类型 E2E：在 `CLAUDE_CODE_SIMPLE=1` / `--bare --print` 真实可用工具池内，本地 mock 返回 assistant 文本 + Read + Bash；真实 `dist/cli.js` 会保留 assistant 文本，执行两个工具，并在 follow-up request 中发送两个不同 `tool_use_id` 的结果。这里没有使用 Glob/TodoWrite，因为 simple 主路径默认只暴露 Bash、Read、Edit；`Write` 只有在显式 `--tools Write` 时加入。
- 新增三工具交错 E2E：本地 mock 在同一 assistant message 内返回 assistant 文本 + Read + Bash + Read，三个工具的 `input_json_delta` 交错到达、stop 顺序打乱；真实 `dist/cli.js` 会执行三个工具，并在 follow-up request 中发送三个互不重复的 `tool_result`。
- 新增副作用型 Bash E2E：本地 mock 返回写文件 Bash 命令，测试使用 `--allowedTools=Bash` 显式授权；真实 `dist/cli.js` 会执行 Bash、发送 Bash `tool_result`，并在 `build-src/test-artifacts` 下生成包含 marker 的 fixture 文件。
- 新增写入工具链 E2E：在 `acceptEdits` 权限模式下，本地 mock 先返回 Read，再返回 Edit；真实 `dist/cli.js` 会在第三次模型请求前发送 Edit `tool_result`，并且 `build-src/test-artifacts` 下的 fixture 文件会从 before 标记实际改成 after 标记。
- 新增 Write 创建文件 E2E：bare/simple 模式下显式 `--tools Write --allowedTools Write` 会把 `Write` 加回工具池；本地 mock 返回 Write `tool_use` 后，真实 `dist/cli.js` 会创建 fixture 文件并在 follow-up request 中发送 Write `tool_result`。
- 新增交互 UI 回归：build-safety 检查构建副本中的 `visibleStreamingText` 保留完整 streaming tail，不再通过 `lastIndexOf('\n')` 截断未完成行；同时确认保留 `maybeRepinLiveScroll`，覆盖 streaming 文本更新和 assistant 消息落地时的 live-scroll 兜底。另新增真实 `Messages`/Ink 组件渲染测试，确认无尾随换行的 streaming tail 会进入终端输出。

## 2026-06-17 NotebookEdit 工具链补强记录

本轮继续推进整体可靠性，不再重复修同一个 Snip/Resume 问题。优先补齐之前仍缺真实 CLI 覆盖的写入类工具 `NotebookEdit`，因为它和普通 `Edit` 不同：需要先通过 `Read` 建立 notebook 的读取状态，再按 cell id 修改 `.ipynb`，并且模型侧收到的是嵌套 `tool_result.content` 文本块。

### 本轮尝试修复/真实适配

- bare/simple 模式默认工具池仍保持 Bash/Read/Edit；当用户显式传 `--tools NotebookEdit` 时，`main.tsx` 会把 `NotebookEdit` 写入 `CLAUDE_CODE_SIMPLE_EXTRA_TOOLS`。
- `tools.ts` 在 simple 工具池中读取 `CLAUDE_CODE_SIMPLE_EXTRA_TOOLS`，显式 opt-in 时把 `NotebookEditTool` 加回可用工具列表。
- 扩展真实 CLI E2E：本地 mock 先返回结构化 `Read`，确认模型 follow-up 能看到 notebook cell 内容；再返回结构化 `NotebookEdit`，真实 `dist/cli.js` 在 `acceptEdits` 权限模式下修改 `.ipynb` fixture；最后确认 follow-up 请求中包含 `NotebookEdit` 的 `tool_result`。
- E2E 断言实际落盘结果：目标 cell 的 `source` 从 before marker 改为 after marker，code cell `outputs` 被清空。
- 修复 E2E 诊断工具：`textFromContent()` 递归提取嵌套 `tool_result.content` 中的 text block，避免把 notebook read result 误判为空；`runCli()` 非零退出时也打印 mock server 请求摘要，后续定位流式/工具链问题更直接。

### 本轮 mock/stub/降级说明

- 这轮不是 mock。`NotebookEdit` E2E 使用真实构建产物 `dist/cli.js`、真实 `Read` 工具、真实 `NotebookEdit` 工具和真实 `.ipynb` 文件落盘。
- 本轮只覆盖 `edit_mode=replace`、按 cell id 替换 code cell 的主路径。
- 当时未覆盖 `insert`、`delete`、按 `cell-N` 索引定位、markdown/raw cell、损坏 notebook JSON、超大 notebook、并发编辑和权限拒绝路径；后续章节已补齐 insert/delete、`cell-N` markdown replace、缺失 cell、损坏 JSON、超大 notebook 拒绝、读后写保护和 deny-list 禁用。

### 本轮验证结果

```text
npm run build
npm run test:cli-e2e
npm run check
npm run test:build-safety
node --check dist\cli.js
git diff --check
```

结果：

- `npm run build` 通过，重新生成 `build-src/` 和 `dist/cli.js`。
- `npm run test:cli-e2e` 通过，新增输出 `ok - Read then NotebookEdit updates an artifact notebook`。
- `npm run check` 通过。
- `npm run test:build-safety` 通过，当前为 31/31 项。
- `node --check dist\cli.js` 通过。
- `git diff --check` 通过，仅提示 Windows 下 LF/CRLF 工作区换行转换警告。

## 2026-06-17 Write 覆盖已有文件链路补强记录

本轮继续收口写入安全风险。前一轮已覆盖 bare/simple 下显式 `Write` 创建新文件，但覆盖已有文件会触发更严格的读后写保护：文件必须先被 `Read` 读过，且写入前不能被外部修改。

### 本轮尝试修复/真实适配

- 扩展真实 CLI E2E：本地 mock 先返回结构化 `Read`，CLI 读取已有 fixture 文件并把原始内容放入 follow-up request。
- mock 再返回结构化 `Write`，真实 `dist/cli.js` 在 `acceptEdits` 权限模式下覆盖同一个文件。
- 测试断言第三轮模型请求包含 `Write` 的 `tool_result`，且提示文件已更新成功。
- 测试断言磁盘文件从 before marker 实际变成 after marker，证明不是只模拟请求体。

### 本轮 mock/stub/降级说明

- 这轮不是 mock。mock server 只模拟模型 API；工具执行、读后写状态、权限模式和文件落盘都由真实 `dist/cli.js` 完成。
- 本轮覆盖的是正常 `Read -> Write(existing file) -> final` 主路径。
- 当时未覆盖未读直接 Write、Read 后外部修改、CRLF/编码边界、二进制文件误写、权限拒绝和进程中断后的部分副作用恢复；后续章节已补齐未读拒绝、stale-write 拒绝、deny-list 禁用、CRLF 创建文件和二进制 Read/Write 阻断，编码/权限弹窗/强杀恢复仍留作当前风险。

### 本轮验证结果

```text
node --check scripts\test-cli-resume-e2e.mjs
npm run build
npm run test:cli-e2e
npm run check
npm run test:build-safety
node --check dist\cli.js
git diff --check
```

结果：

- `node --check scripts\test-cli-resume-e2e.mjs` 通过。
- `npm run build` 通过，重新生成 `build-src/` 和 `dist/cli.js`。
- `npm run test:cli-e2e` 通过，新增输出 `ok - Read then Write updates an existing artifact file`。
- `npm run check` 通过。
- `npm run test:build-safety` 通过，当前为 31/31 项。
- `node --check dist\cli.js` 通过。
- `git diff --check` 通过，仅提示 Windows 下 LF/CRLF 工作区换行转换警告。

## 2026-06-17 Write 拒绝路径补强记录

本轮继续围绕写入安全做负向验证，目标是确认 `Write` 不会在关键保护条件失败时静默写盘。

### 本轮尝试修复/真实适配

- 扩展真实 CLI E2E：模型直接请求 `Write` 覆盖一个已存在但未被 `Read` 的文件时，CLI 返回 `is_error: true` 的 tool_result，内容包含“File has not been read yet”，磁盘文件保持原内容。
- 扩展真实 CLI E2E：模型先请求 `Read`，mock server 在第二轮请求到达后模拟外部进程修改同一个文件并把 mtime 推到未来，随后模型请求 `Write`；CLI 返回 `is_error: true` 的 tool_result，内容包含“modified since read”，磁盘保留外部修改内容，而不是写入模型尝试的新内容。
- 这两个用例覆盖了 `FileWriteTool.validateInput()` 的读后写保护和 stale-write 保护，避免只测 happy path。

### 本轮 mock/stub/降级说明

- 这轮不是 mock。mock server 只模拟模型 API；实际的文件读取、写入拒绝、mtime 检查和 tool_result 生成都来自真实 `dist/cli.js`。
- 当时未覆盖权限显式拒绝、hook 拒绝、编码/CRLF 差异、二进制文件误写、文件系统权限错误，以及工具执行中途进程被强杀后的恢复；后续章节已补齐 deny-list 禁用、CRLF 创建文件、UTF-16LE BOM、UTF-8 BOM 和二进制 Read/Write 阻断，hook/managed policy、混合换行、文件系统权限错误和强杀恢复仍留作当前风险。

### 本轮验证结果

```text
node --check scripts\test-cli-resume-e2e.mjs
npm run test:cli-e2e
npm run check
npm run test:build-safety
node --check dist\cli.js
git diff --check
```

结果：

- `node --check scripts\test-cli-resume-e2e.mjs` 通过。
- `npm run test:cli-e2e` 通过，新增输出：
  - `ok - Write rejects updating a file that was not read first`
  - `ok - Write rejects stale updates after external modification`
- `npm run check` 通过。
- `npm run test:build-safety` 通过，当前为 31/31 项。
- `node --check dist\cli.js` 通过。
- `git diff --check` 通过，仅提示 Windows 下 LF/CRLF 工作区换行转换警告。

## 2026-06-17 NotebookEdit 变体与拒绝路径补强记录

本轮继续收口 `NotebookEdit` 风险。前一轮只覆盖了 `replace` 主路径；本轮补充真实 CLI E2E，验证 `insert`、`delete` 和缺失 cell 的错误回传。

### 本轮尝试修复/真实适配

- 将 E2E mock server 的 `NotebookEdit` SSE 生成函数参数化，支持不同 `tool_use_id` 前缀、notebook 路径、cell id、cell type、edit mode 和 source。
- 新增真实 CLI E2E：`Read -> NotebookEdit(insert markdown cell) -> NotebookEdit(delete cell-1) -> final`。
- 测试断言 insert 后 follow-up request 包含 `Inserted cell ...` tool_result，delete 后 follow-up request 包含 `Deleted cell cell-1` tool_result。
- 测试断言最终 `.ipynb` 文件只剩原始 base cell，证明 insert 和 delete 都实际落盘并被后续删除回收。
- 新增真实 CLI E2E：`Read -> NotebookEdit(missing cell) -> final`，验证缺失 cell 会返回 `is_error: true` 的 tool_result，且 notebook 文件保持不变。

### 本轮 mock/stub/降级说明

- 这轮不是 mock。mock server 只模拟模型 API；实际的 notebook 读取、insert/delete、错误校验、tool_result 生成和文件落盘都来自真实 `dist/cli.js`。
- 本轮已覆盖 `replace`、`insert`、`delete` 和缺失 cell 拒绝路径。
- 当时未覆盖损坏 notebook JSON、超大 notebook、markdown replace、按 `cell-N` 直接 replace、权限显式拒绝、hook 拒绝、读后外部修改拒绝和并发编辑；后续章节已补齐损坏 JSON、超大 notebook 拒绝、markdown `cell-N` replace、读后外部修改拒绝和 deny-list 禁用。

### 本轮验证结果

```text
node --check scripts\test-cli-resume-e2e.mjs
npm run build
npm run test:cli-e2e
npm run check
npm run test:build-safety
node --check dist\cli.js
git diff --check
```

结果：

- `node --check scripts\test-cli-resume-e2e.mjs` 通过。
- `npm run build` 通过，重新生成 `build-src/` 和 `dist/cli.js`。
- `npm run test:cli-e2e` 通过，新增输出：
  - `ok - NotebookEdit inserts and deletes an artifact notebook cell`
  - `ok - NotebookEdit rejects editing a missing notebook cell`
- `npm run check` 通过。
- `npm run test:build-safety` 通过，当前为 31/31 项。
- `node --check dist\cli.js` 通过。
- `git diff --check` 通过，仅提示 Windows 下 LF/CRLF 工作区换行转换警告。

## 2026-06-17 NotebookEdit 读后写保护补强记录

本轮继续补齐 `NotebookEdit` 的负向保护，验证 notebook 写入和普通 `Write` 一样不会绕过读后写约束。

### 本轮尝试修复/真实适配

- 新增真实 CLI E2E：模型直接请求 `NotebookEdit` 修改一个已存在但未被 `Read` 的 `.ipynb`，CLI 返回 `is_error: true` 的 tool_result，内容包含“File has not been read yet”，notebook 保持原内容。
- 新增真实 CLI E2E：模型先请求 `Read`，mock server 在第二轮请求到达后模拟外部进程修改同一个 `.ipynb` 并把 mtime 推到未来，随后模型请求 `NotebookEdit`；CLI 返回 `is_error: true` 的 tool_result，内容包含“modified since read”，notebook 保留外部修改内容。
- 这两个用例覆盖了 `NotebookEditTool.validateInput()` 的读后写保护和 stale-write 保护，避免 notebook 工具只验证 happy path。

### 本轮 mock/stub/降级说明

- 这轮不是 mock。mock server 只模拟模型 API；实际 notebook 读取、mtime 检查、错误 tool_result 生成和文件保护都来自真实 `dist/cli.js`。
- 当时未覆盖损坏 notebook JSON、超大 notebook、markdown replace、按 `cell-N` 直接 replace、权限显式拒绝、hook 拒绝和复杂并发编辑；后续章节已补齐损坏 JSON、超大 notebook 拒绝、markdown `cell-N` replace 和 deny-list 禁用。

### 本轮验证结果

```text
node --check scripts\test-cli-resume-e2e.mjs
npm run test:cli-e2e
npm run check
npm run test:build-safety
node --check dist\cli.js
git diff --check
```

结果：

- `node --check scripts\test-cli-resume-e2e.mjs` 通过。
- `npm run test:cli-e2e` 通过，新增输出：
  - `ok - NotebookEdit rejects editing a notebook that was not read first`
  - `ok - NotebookEdit rejects stale notebook edits after external modification`
- `npm run check` 通过。
- `npm run test:build-safety` 通过，当前为 31/31 项。
- `node --check dist\cli.js` 通过。
- `git diff --check` 通过，仅提示 Windows 下 LF/CRLF 工作区换行转换警告。

## 2026-06-17 disallowedTools 写入工具禁用验证记录

本轮补齐 CLI 策略禁用路径。这里验证的是 `--disallowedTools` deny-list 行为：工具会从可用工具集中移除，模型即使返回对应 `tool_use`，真实 CLI 也只会回传错误 tool_result，不会执行工具。

### 本轮尝试修复/真实适配

- 新增真实 CLI E2E：`--tools Write --disallowedTools Write` 下，mock 返回 `Write` tool_use，CLI 回传 `is_error: true` 的 tool_result，内容包含 `No such tool available: Write`，目标文件没有被创建。
- 新增真实 CLI E2E：`--tools Read,NotebookEdit --disallowedTools NotebookEdit` 下，CLI 仍可先执行 `Read`，但随后对 `NotebookEdit` tool_use 回传 `is_error: true` 的 tool_result，内容包含 `No such tool available: NotebookEdit`，notebook 文件保持原样。
- 这轮确认 deny-list 的真实表现不是权限弹窗拒绝文案，而是工具不可用错误；这和 `--disallowedTools` 在工具选择层生效的实现一致。

### 本轮 mock/stub/降级说明

- 这轮不是 mock。mock server 只模拟模型 API；工具过滤、错误 tool_result 生成和文件未写入都来自真实 `dist/cli.js`。
- 本轮覆盖的是 CLI 参数 deny-list。仍未覆盖交互权限弹窗里用户手动拒绝、hook 拒绝、配置文件 deny 规则、managed policy deny 规则。

### 本轮验证结果

```text
node --check scripts\test-cli-resume-e2e.mjs
npm run test:cli-e2e
npm run check
npm run test:build-safety
node --check dist\cli.js
git diff --check
```

结果：

- `node --check scripts\test-cli-resume-e2e.mjs` 通过。
- `npm run test:cli-e2e` 通过，新增输出：
  - `ok - Write respects explicit disallowedTools denial`
  - `ok - NotebookEdit respects explicit disallowedTools denial`
- `npm run check` 通过。
- `npm run test:build-safety` 通过，当前为 31/31 项。
- `node --check dist\cli.js` 通过。
- `git diff --check` 通过，仅提示 Windows 下 LF/CRLF 工作区换行转换警告。

## 2026-06-17 NotebookEdit cell-N 与 markdown replace 验证记录

本轮继续补齐 `NotebookEdit` 的定位和 cell 类型边界。此前已覆盖按真实 cell id replace、insert/delete、缺失 cell、未读/stale 保护；本轮补充按 `cell-N` 索引定位并替换 markdown cell。

### 本轮尝试修复/真实适配

- 新增真实 CLI E2E：构造一个包含 code cell 和 markdown cell 的 `.ipynb`，mock 先触发 `Read`，再触发 `NotebookEdit`，参数为 `cell_id: "cell-1"`、`cell_type: "markdown"`、`edit_mode: "replace"`。
- 测试断言 follow-up request 中包含原始 markdown 内容，证明模型视图确实拿到了 notebook 内容。
- 测试断言 `NotebookEdit` tool_result 包含 `Updated cell cell-1` 和新的 markdown 内容。
- 测试断言落盘后的 notebook 保留第一个 code cell，第二个 markdown cell 的 `source` 被替换且 `cell_type` 仍为 `markdown`。

### 本轮 mock/stub/降级说明

- 这轮不是 mock。mock server 只模拟模型 API；实际 notebook 读取、`cell-N` 解析、markdown replace 和文件落盘都来自真实 `dist/cli.js`。
- 当时未覆盖损坏 notebook JSON、超大 notebook、配置/managed policy deny、hook 拒绝和复杂并发编辑；后续章节已补齐损坏 JSON 和超大 notebook 拒绝路径。

### 本轮验证结果

```text
node --check scripts\test-cli-resume-e2e.mjs
npm run test:cli-e2e
npm run check
npm run test:build-safety
node --check dist\cli.js
git diff --check
```

结果：

- `node --check scripts\test-cli-resume-e2e.mjs` 通过。
- `npm run test:cli-e2e` 通过，新增输出 `ok - NotebookEdit replaces a markdown cell by cell index`。
- `npm run check` 通过。
- `npm run test:build-safety` 通过，当前为 31/31 项。
- `node --check dist\cli.js` 通过。
- `git diff --check` 通过，仅提示 Windows 下 LF/CRLF 工作区换行转换警告。

## 2026-06-17 Edit 负向保护补强记录

本轮补齐普通 `Edit` 的负向路径。此前已覆盖 `Read -> Edit -> final` happy path，但未验证 `Edit` 是否和 `Write` / `NotebookEdit` 一样遵守读后写保护和 deny-list 禁用。

### 本轮尝试修复/真实适配

- 将 E2E mock server 的 `Edit` SSE 生成函数参数化，支持不同文件路径、old/new string 和 `tool_use_id` 前缀。
- 新增真实 CLI E2E：模型直接请求 `Edit` 修改一个已存在但未被 `Read` 的文件，CLI 返回 `is_error: true` 的 tool_result，内容包含“File has not been read yet”，文件保持原内容。
- 新增真实 CLI E2E：模型先请求 `Read`，mock server 在第二轮请求到达后模拟外部进程修改同一个文件并把 mtime 推到未来，随后模型请求 `Edit`；CLI 返回 `is_error: true` 的 tool_result，内容包含“modified since read”，文件保留外部修改内容。
- 新增真实 CLI E2E：`--tools Read,Edit --disallowedTools Edit` 下，CLI 仍可先执行 `Read`，但随后对 `Edit` tool_use 回传 `is_error: true` 的 tool_result，内容包含 `No such tool available: Edit`，文件保持原样。

### 本轮 mock/stub/降级说明

- 这轮不是 mock。mock server 只模拟模型 API；实际文件读取、mtime 检查、Edit 校验、deny-list 工具过滤、错误 tool_result 生成和文件保护都来自真实 `dist/cli.js`。
- 当时未覆盖交互权限弹窗拒绝、hook 拒绝、配置/managed policy deny、CRLF/编码边界、replace_all 多匹配和 Edit 创建新文件路径；后续章节已补齐 `replace_all`、多匹配拒绝、`old_string: ""` 新建文件、CRLF 保留、混合换行保留、UTF-16LE BOM 和 UTF-8 BOM，交互权限与 hook/managed policy 仍留作当前风险。

### 本轮验证结果

```text
node --check scripts\test-cli-resume-e2e.mjs
npm run test:cli-e2e
npm run check
npm run test:build-safety
node --check dist\cli.js
git diff --check
```

结果：

- `node --check scripts\test-cli-resume-e2e.mjs` 通过。
- `npm run test:cli-e2e` 通过，新增输出：
  - `ok - Edit rejects updating a file that was not read first`
  - `ok - Edit rejects stale updates after external modification`
  - `ok - Edit respects explicit disallowedTools denial`
- `npm run check` 通过。
- `npm run test:build-safety` 通过，当前为 31/31 项。
- `node --check dist\cli.js` 通过。
- `git diff --check` 通过，仅提示 Windows 下 LF/CRLF 工作区换行转换警告。

## 2026-06-18 Feature gate 首批恢复记录

本轮开始推进“各种 feature”修复，但不采用一次性全开的方式。原因是当前审计显示 `src/` 里仍有大量内部 gate，一次性保留会把私有包、内部服务、native 依赖和未补齐模块一起拉入构建，容易把 fail-fast 边界重新变成运行期崩溃。

### 本轮尝试修复/真实适配

- 新增 `scripts/audit-features.mjs` 和 `npm run audit:features`，可重复统计所有 `feature('...')` 调用、默认保留项、环境保留项和当前 `build-src/stub-manifest.json`。
- `scripts/build.mjs` 默认保留 `DUMP_SYSTEM_PROMPT`，恢复 `node dist\cli.js --dump-system-prompt --model <model>` 快速路径。
- `scripts/test-build-safety.mjs` 增加两类针对性验证：
  - 构建副本中 `DUMP_SYSTEM_PROMPT` 没有被折叠成 `false`。
  - 真实 `dist/cli.js --dump-system-prompt --model sonnet` 可以直接输出系统提示词，且不会触发 API/model 请求。

### 本轮 mock/stub/降级说明

- `npm run audit:features` 是审计工具，不代表清单里的 feature 已恢复。
- `DUMP_SYSTEM_PROMPT` 只是显式 CLI 快速路径恢复，不影响普通 `-p`、REPL 或工具调用主路径。
- 其它 feature gate 仍默认关闭；审计结果显示当前共有 90 个 feature、974 次 `feature(...)` 调用，后续需要逐项按“是否有源码、是否依赖私有服务、是否可测试”推进。

### 本轮验证结果

```text
node --check scripts\audit-features.mjs
npm run check
npm run audit:features
npm run build
npm run test:build-safety
node dist\cli.js --dump-system-prompt --model sonnet
node --check scripts\test-build-safety.mjs
node --check dist\cli.js
npm run test:cli-e2e
git diff --check
```

结果：

- `npm run audit:features` 会列出 `CONTEXT_COLLAPSE`、`DUMP_SYSTEM_PROMPT`、`HISTORY_SNIP`、`MCP_SKILLS` 为 `preserved-default`。
- `npm run test:build-safety` 当时通过全部 32 项，覆盖 `DUMP_SYSTEM_PROMPT` 的构建保留和真实 CLI 快速路径；后续新增测试后的当前统计见下方“已验证”部分。
- `node dist\cli.js --dump-system-prompt --model sonnet` 不需要真实 API key，也不连接当前代理或模型服务；smoke 检查命中了 `Claude Code` 文本。
- `npm run check`、`node --check scripts\test-build-safety.mjs`、`node --check dist\cli.js`、`npm run test:cli-e2e` 和 `git diff --check` 均通过；`git diff --check` 仅提示 Windows 下 LF/CRLF 工作区换行转换警告。

## 构建和启动

```powershell
npm install
npm run build
npm run test:build-safety
npm start -- --version
```

构建成功后入口在：

```text
dist/cli.js
```

直接启动：

```powershell
node .\dist\cli.js
```

非交互任务：

```powershell
node .\dist\cli.js -p "hello" --max-turns 1
```

## 已验证

本次修改后已经验证：

```text
npm run check
npm run audit:features
npm run build
npm start -- --version
node dist\cli.js --help
node dist\cli.js doctor --help
node dist\cli.js --dump-system-prompt --model sonnet
node dist\cli.js -p "<prompt>" --max-turns 1 --model <model>
npm run test:build-safety
npm run test:cli-e2e
$env:CLAUDE_CONTEXT_COLLAPSE='1'; node dist\cli.js --version
$env:CLAUDE_CODE_SNIP_TRIGGER_TOKENS='1'; node dist\cli.js --version
$env:CLAUDE_CODE_SNIP_TRIGGER_TOKENS='1'; $env:CLAUDE_CODE_SNIP_TARGET_TOKENS='1'; node dist\cli.js --version
node --check dist\cli.js
build-src/stub-manifest.json 生成
fail-fast stub 默认导出和命名导出行为
fail-fast stub 调用、构造、取属性和数值转换行为
ContextCollapse 默认关闭、显式 opt-in、恢复状态和 CtxInspectTool 加载
History Snip 构建保留、分段裁剪、目标 ID 裁剪、boundary replay、投影删除、工具对保护、SnipTool 和 force-snip 加载
DUMP_SYSTEM_PROMPT 构建保留、真实 dist 快速路径输出、且不触发模型/API 请求
CC Switch 设置路径启动探针：读取到 settings env 中的 ANTHROPIC_AUTH_TOKEN/ANTHROPIC_BASE_URL，`setup()` 可完成，不再卡在首屏前 ContextCollapse 初始化
Windows Node 产物 ripgrep fallback：缺少 `dist/vendor/ripgrep/.../rg.exe` 时自动回退系统 `rg`，并通过 `rg --version`
Snip 后 transcript resume 过滤、parentUuid 重连、conversation chain 恢复、resume 入口恢复、session-id/continue 恢复、compact+Snip 叠加恢复，以及 recordTranscript 写侧去重接链
真实 dist/cli.js 子进程 E2E：-p、--resume <session-id>、--continue 三段模型请求和 transcript 落盘恢复
第三方代理文本化工具调用泄漏检测：`Calling: Read` + JSON 被识别为 tool_use 协议兼容错误，不自动执行工具
结构化 `tool_use(Read)` 正向 E2E：真实 CLI 执行 Read 工具并把 `tool_result` 发回模型
结构化 `tool_use(Read)` 分片 E2E：多段 `input_json_delta` 且 stop_reason 非 `tool_use` 时仍执行工具并 follow-up
结构化 `tool_use(Read)` 缺失 stop 事件 E2E：漏发 `content_block_stop` 时仍最终化 tool_use、执行工具并 follow-up
Streaming 乱序 fallback E2E：`content_block_delta` 早于 `content_block_start` 时触发 non-streaming fallback 并正常返回
中断恢复读侧测试：尾部只有 user、尾部孤立 `tool_use` 都恢复为可自动续跑的 interrupted prompt
多工具交错 E2E：同一 assistant response 的两个 Read `tool_use` 均执行，follow-up 中有两个不同 `tool_use_id` 的 `tool_result`
混合工具类型 E2E：simple 主路径下 assistant 文本 + Read + Bash 均被保留或执行，follow-up 中包含两个不同工具结果
三工具交错 E2E：simple 主路径下 assistant 文本 + Read + Bash + Read 均被保留或执行，follow-up 中包含三个不同工具结果
副作用型 Bash E2E：显式 `--allowedTools=Bash` 授权下，Bash 写文件命令会执行并生成 artifact fixture
写入工具链 E2E：simple 主路径下 `Read -> Edit -> final` 三轮执行通过，Edit 在 `acceptEdits` 下实际更新 fixture 文件
Edit 负向保护 E2E：未读直接 Edit 会返回 `is_error` tool_result 且文件不变；Read 后外部修改同一文件会返回 stale-write `is_error` tool_result；`--disallowedTools Edit` 会返回 `No such tool available: Edit`
Edit replace_all / 多匹配 / 新建文件 E2E：`replace_all: true` 会替换全部匹配；默认多匹配会拒绝并提示设置 `replace_all`；`old_string: ""` 可创建不存在的文件
Edit CRLF 保留 E2E：`Read -> Edit -> final` 修改 CRLF 文件中的单行时，真实落盘仍保留 CRLF 换行
Edit 混合换行保留 E2E：`Read -> Edit -> final` 修改同时包含 CRLF/LF 的文件时，真实落盘仍保留原有逐行换行分布
Edit UTF-16LE BOM 保留 E2E：`Read -> Edit -> final` 修改带 `FF FE` BOM 的 UTF-16LE 文件时，真实落盘仍保留 BOM 和 UTF-16LE 编码
Edit UTF-8 BOM 保留 E2E：`Read -> Edit -> final` 修改带 UTF-8 BOM 的文件时，真实落盘仍保留 `EF BB BF`
Write 创建文件 E2E：bare/simple 模式显式 `--tools Write --allowedTools Write` 时，Write 会加入工具池、执行并创建 fixture 文件
Write CRLF 创建文件 E2E：bare/simple 模式显式 `--tools Write --allowedTools Write` 时，Write 创建含 `\r\n` 的 fixture 后会保持 CRLF 内容不变
Write 混合换行创建文件 E2E：bare/simple 模式显式 `--tools Write --allowedTools Write` 时，Write 创建同时包含 CRLF/LF 的 fixture 后会保持原始 content 不变
Write 覆盖已有文件 E2E：bare/simple 模式显式 `--tools Read,Write` 且 `acceptEdits` 时，真实 CLI 会先读取已有文件，再覆盖文件并发送更新成功的 `Write` tool_result
Write UTF-16LE BOM 覆盖 E2E：`Read -> Write(existing UTF-16LE BOM file) -> final` 覆盖已有文件时会保留旧文件 BOM 和 UTF-16LE 编码
Write UTF-8 BOM 覆盖 E2E：`Read -> Write(existing UTF-8 BOM file) -> final` 覆盖已有文件时会保留旧文件 `EF BB BF`
Write 拒绝路径 E2E：未读直接覆盖已有文件会返回 `is_error` tool_result 且文件不变；Read 后外部修改同一文件会返回 stale-write `is_error` tool_result 且保留外部修改
Read 二进制内容拒绝 E2E：无扩展二进制文件会被 `Read` 内容 sniff 拒绝，随后同路径 `Write` 仍因未成功 Read 而拒绝，原始字节不变
NotebookEdit 写入链路 E2E：bare/simple 模式显式 `--tools Read,NotebookEdit` 且 `acceptEdits` 时，真实 CLI 会先读取 notebook cell，再替换目标 cell source、清空 outputs，并发送 `NotebookEdit` 的 `tool_result`
NotebookEdit 变体与拒绝路径 E2E：真实 CLI 会执行 `insert` markdown cell、随后按 `cell-1` 删除该 cell；缺失 cell 会返回 `is_error` tool_result 且 notebook 不变
NotebookEdit 损坏 JSON 拒绝 E2E：Read 成功后 notebook 被破坏但 mtime 调回读取时刻，NotebookEdit 会返回 `Notebook is not valid JSON.` 错误并保持损坏内容不变
NotebookEdit 超大文件拒绝 E2E：Read 成功后 notebook 被替换成超过默认读取大小上限的合法 JSON 且 mtime 保持不变，NotebookEdit 会在解析前返回 too-large 错误并保持文件不变
NotebookEdit 读后写保护 E2E：未读直接编辑 notebook 会返回 `is_error` tool_result 且文件不变；Read 后外部修改同一 notebook 会返回 stale-write `is_error` tool_result 且保留外部修改
disallowedTools 写入工具禁用 E2E：`--disallowedTools Write` 和 `--disallowedTools NotebookEdit` 会让对应工具返回 `No such tool available` 错误 tool_result，且不写入文件
NotebookEdit cell-N/markdown E2E：真实 CLI 会用 `cell_id: "cell-1"` 定位第二个 cell，替换 markdown source，并保持第一个 code cell 不变
交互 UI 流式显示回归：构建副本中 streaming 文本不再按最后一个换行截断，assistant/streaming 更新保留 live-scroll 兜底，并通过真实 `Messages`/Ink 渲染确认未完成行可见
modifiers-napi 缺失 fallback
image-processor-napi 缺失时 sharp fallback
audio-capture-napi 缺失时语音依赖检查 fallback
url-handler-napi 缺失由 nativeOptional 包装
VerifyPlanExecutionTool 默认关闭、显式 opt-in、工具池加载、保守状态记录和非官方 verifier 警告
verify bundled skill 文档资产不再是空文本 stub
ResumeConversation 的 ContextCollapse persist 静态打包路径，以及 UserTextMessage 的 GitHub webhook / fork boilerplate / cross-session gated 分支静态打包和真实 Ink 渲染
REPLTool / SuggestBackgroundPRTool / agents-platform 外部保守加载路径，`USER_TYPE=ant` 下不再生成 feature-gated module stub，且 REPLTool 不可用时仍保留 Read/Bash/Edit
```

版本输出：

```text
2.1.88 (Claude Code)
```

`npm run test:build-safety` 当前覆盖 41 项深度检查：

- 构建输出、`build-src/stub-manifest.json` 和当前实际 stub 类型记录。
- 存在 feature-generated stub 时的默认导出 fail-fast 行为，以及存在时的缺失命名导出 fail-fast 行为，包括调用、构造、解引用和 primitive coercion。
- lazy tool export loader 优先取命名导出，缺失时回退 default。
- `DUMP_SYSTEM_PROMPT` 在构建副本中被保留，真实 `dist/cli.js --dump-system-prompt --model sonnet` 能输出系统提示词，且不会触发 API/model 请求。
- `CONTEXT_COLLAPSE` 在构建副本中被保留，但 prompt-too-long 兜底仍受 runtime gate 控制。
- ContextCollapse 外部运行时默认关闭、projection no-op、恢复元数据、显式 opt-in 和 prompt-too-long withholding 行为。
- `CtxInspectTool` 加载、默认隐藏、显式启用和工具结果序列化。
- `VerifyPlanExecutionTool` 默认关闭、`CLAUDE_CODE_VERIFY_PLAN=true` 后进入工具池、调用后只记录请求并返回 `external-conservative` / `recorded_unavailable`，不会伪造官方后台验证结果。
- verify bundled skill 的 `SKILL.md`、CLI 示例和 server 示例都是真实文本资产，不再由空字符串 asset stub 代替。
- `ultraplan` prompt 是真实文本资源，包含规划和 `ExitPlanMode` 指引，且不包含会自触发关键词检测的裸 `ultraplan`。
- `protectedNamespace` 不再由 fail-fast stub 代替；测试覆盖本地无信号、homespace、开放命名空间、未知命名空间、production 命名空间、ASL3 override 和只有 cluster 信号的保守路径。
- Ant-only callout 不再由 fail-fast stub 代替；测试覆盖默认关闭、显式 env opt-in 可见，以及 `AntModelSwitchCallout` / `UndercoverAutoCallout` 真实 Ink 渲染输出。
- `ink/devtools` 和 `TungstenTool` 不再由 fail-fast stub 代替；测试覆盖 devtools no-op 状态、Tungsten 默认禁用、unavailable 结果、缓存清理 no-op 状态、live monitor 组件加载、ant-only no-op hook，以及 REPL 构建副本不再保留相关变量路径 require。
- `REPLTool`、`SuggestBackgroundPRTool` 和 `agents-platform` 不再由 fail-fast stub 代替；测试覆盖 manifest 中 feature-gated-module-stub 为 0、两个工具默认禁用且返回 unavailable、agents-platform 隐藏禁用，以及 `USER_TYPE=ant` + CLI 下 REPLTool 不可用时 Read/Bash/Edit 仍留在工具池。
- Resume/UserTextMessage 变量路径 require 收敛：构建副本和 `dist/cli.js` 不再保留 `contextCollapsePersistModulePath` 或 `user*ModulePath`；三个 gated 用户消息组件会通过真实 Ink 渲染输出 GitHub activity、Fork context 和 Cross-session 摘要。
- ContextCollapse 相关 `setup`、`TokenWarning`、`REPL`、`analyzeContext` 不再保留变量路径 require；`setup()` 不再在首屏前同步初始化 ContextCollapse。
- `HISTORY_SNIP` 在构建副本中被保留，SnipTool 和 force-snip 命令不会继续被 feature gate 折叠。
- History Snip 高可用外部运行时的分段裁剪、目标 ID 裁剪、boundary replay 确定性、投影删除、snip boundary 保留、保护尾部消息和 tool_use/tool_result 不被切开。
- Snip 后 resume/transcript 的 JSONL 回放、removedUuids 过滤、parentUuid 重连、leaf 选择、conversation chain 恢复、`loadConversationForResume(..., jsonlPath)` / `loadTranscriptFromFile()` 恢复入口、`loadConversationForResume(sessionId, undefined)` / `loadConversationForResume(undefined, undefined)` session 恢复入口、compact preservedSegment 与 Snip 删除叠加恢复，以及 `recordTranscript()` 写侧去重和 boundary/tail 接链。
- Prompt/tool 中断恢复：尾部只有 user 时会识别为 `interrupted_prompt`，尾部孤立 assistant `tool_use` 会被过滤并恢复到原始 user prompt，避免 resume 后向 API 发送未配对工具调用。
- Snip UI/SDK 相关构建产物不再保留变量路径 require，避免 `snipProjection.js` / `snipCompact.js` / `SnipBoundaryMessage.js` 在单文件 bundle 运行期缺失。
- 真实 `dist/cli.js` 子进程 `-p` / `--resume <session-id>` / `--continue` E2E 由 `npm run test:cli-e2e` 单独覆盖；该测试使用本地 Anthropic-compatible mock server，不依赖外部 API key。
- 文本化工具调用泄漏检测会保守识别已知工具名和合法 JSON 参数块，例如 `Calling: Read` 后接 `{"file_path":"..."}`；未知工具、非 JSON、普通讨论文本不会触发。
- 同一 CLI E2E 还覆盖标准结构化 `tool_use(Read)` 正向路径：mock 返回 `content_block_start(tool_use)` + `input_json_delta`，CLI 执行 Read 后的 follow-up request 必须包含真实文件内容。
- 同一 CLI E2E 还覆盖分片结构化 `tool_use(Read)` 路径：mock 将 `input_json_delta` 拆成多段，并将 `message_delta.stop_reason` 错报为 `end_turn`；CLI 仍以 block 内容判断需要 follow-up，而不依赖 stop reason。
- 同一 CLI E2E 还覆盖缺失 `content_block_stop` 的结构化 `tool_use(Read)` 路径：mock 省略 stop 事件但正常结束 stream，运行时会最终化未关闭 block，CLI 仍执行 Read 并发送 `tool_result`。
- 同一 CLI E2E 还覆盖 streaming 事件乱序 fallback：mock 将 `content_block_delta` 放在 `content_block_start` 之前，运行时会把该 streaming attempt 视为损坏并切到 non-streaming fallback；最终结果来自第二次非流式请求。
- 同一 CLI E2E 还覆盖多工具交错路径：mock 在一个 assistant response 内发两个 `tool_use(Read)` block，两个 block 的 `input_json_delta` 交错到达，`content_block_stop` 反向到达；follow-up request 必须包含两个 `tool_result` block，且 `tool_use_id` 互不重复。
- 同一 CLI E2E 还覆盖三工具交错路径：mock 在一个 assistant response 内发 assistant 文本 + `Read` + `Bash` + `Read`，三个工具的 `input_json_delta` 交错到达、`content_block_stop` 打乱到达；follow-up request 必须保留文本并包含三个互不重复的 `tool_result` block。
- 同一 CLI E2E 还覆盖副作用型 Bash：mock 返回写文件 Bash 命令，CLI 通过 `--allowedTools=Bash` 显式授权后执行命令；测试同时验证 follow-up request 中存在 Bash `tool_result`，以及 artifact 文件确实写入。
- 同一 CLI E2E 还覆盖 Edit 负向保护：未读直接 Edit 会返回 `is_error` tool_result 且文件不变；Read 后 mock 模拟外部修改同一文件会返回 stale-write `is_error` tool_result，磁盘保留外部修改内容；`--disallowedTools Edit` 下 Edit tool_use 会返回 `No such tool available: Edit`。
- 同一 CLI E2E 还覆盖 Edit replace_all / 多匹配 / 新建文件：`Read -> Edit(replace_all: true) -> final` 会替换文件中全部匹配；默认 `replace_all` 为 false 时遇到重复 `old_string` 会返回 `is_error` tool_result 且文件不变；`old_string: ""` 对不存在路径会创建新文件。
- 同一 CLI E2E 还覆盖 Edit CRLF 保留：mock 先触发 Read，再触发 Edit 修改 CRLF fixture 的单行；真实 CLI 写回后，测试确认文件仍保持 CRLF 换行。
- 同一 CLI E2E 还覆盖 Edit UTF-16LE BOM 保留：fixture 以 `FF FE` BOM 和 UTF-16LE 编码写入，mock 先触发 Read 建立读后写状态，再触发 Edit；测试按 Buffer 检查 BOM 字节，并用 `utf16le` 解码确认内容已更新。
- 同一 CLI E2E 还覆盖 Edit UTF-8 BOM 保留：fixture 以 `EF BB BF` BOM 写入，mock 先触发 Read，再触发 Edit；测试按 Buffer 检查 BOM 字节，并用 UTF-8 解码确认内容已更新。
- 同一 CLI E2E 还覆盖 bare/simple 下显式 `Write` opt-in：默认 simple 工具池不变，但 `--tools Write --allowedTools Write` 会让 Write 工具可用；mock 返回 Write `tool_use` 后，CLI 会创建 fixture 文件并发送 Write `tool_result`。
- 同一 CLI E2E 还覆盖 Write CRLF 创建文件：mock 返回 `content` 中包含 `\r\n` 的 Write tool_use，真实 CLI 创建 fixture 后，测试确认落盘内容仍是 CRLF。
- 同一 CLI E2E 还覆盖 `Read -> Write(existing file) -> final`：mock 先触发 Read 建立读后写状态，再触发 Write 覆盖已有 fixture，CLI 会发送更新成功的 Write `tool_result`，并且磁盘内容实际变更。
- 同一 CLI E2E 还覆盖 Write UTF-16LE BOM 覆盖：已有文件以 `FF FE` BOM 和 UTF-16LE 编码写入，mock 先触发 Read，再触发 Write 覆盖；真实 CLI 会保留 BOM 和 UTF-16LE 编码。
- 同一 CLI E2E 还覆盖 Write UTF-8 BOM 覆盖：已有文件以 `EF BB BF` BOM 写入，mock 先触发 Read，再触发 Write 覆盖；真实 CLI 会保留 UTF-8 BOM。
- 同一 CLI E2E 还覆盖 Write 负向保护：未读直接覆盖已有文件会返回 `is_error` tool_result 且文件不变；Read 后 mock 模拟外部修改同一文件会返回 stale-write `is_error` tool_result，磁盘保留外部修改内容。
- 同一 CLI E2E 还覆盖 bare/simple 下显式 `NotebookEdit` opt-in：默认 simple 工具池不变，但 `--tools Read,NotebookEdit --permission-mode acceptEdits` 会让 NotebookEdit 工具可用；mock 先触发 Read，再触发 NotebookEdit，CLI 会修改 `.ipynb` fixture、清空 code cell outputs，并发送 NotebookEdit `tool_result`。
- 同一 CLI E2E 还覆盖 NotebookEdit 变体和拒绝路径：mock 触发 insert markdown cell 后再触发 delete `cell-1`，最终 notebook 只保留原始 base cell；缺失 cell 的 replace 请求会返回 `is_error` tool_result，notebook 文件不变。
- 同一 CLI E2E 还覆盖 NotebookEdit 损坏 JSON 拒绝路径：mock 先触发 Read 建立读后写状态，再把 notebook 文件破坏成非法 JSON 并把 mtime 调回读取时刻；NotebookEdit 会返回 `Notebook is not valid JSON.` 错误 tool_result，文件保持损坏内容不变。
- 同一 CLI E2E 还覆盖 NotebookEdit 读后写保护：未读直接编辑 notebook 会返回 `is_error` tool_result 且文件不变；Read 后 mock 模拟外部修改同一 notebook 会返回 stale-write `is_error` tool_result，磁盘保留外部修改内容。
- 同一 CLI E2E 还覆盖 CLI deny-list：`--disallowedTools Write` 下 Write tool_use 会返回 `No such tool available: Write`，目标文件不创建；`--disallowedTools NotebookEdit` 下 Read 仍可执行，但 NotebookEdit tool_use 会返回 `No such tool available: NotebookEdit`，notebook 不变。
- 同一 CLI E2E 还覆盖 NotebookEdit `cell-N` 索引定位和 markdown replace：`cell_id: "cell-1"` 会定位第二个 cell，替换 markdown source，并保持第一个 code cell 不变。
- 交互 UI 流式显示回归：`visibleStreamingText` 不再按最后一个换行截断，避免无尾随换行内容必须等最终 message 或键盘 repaint 才出现；`maybeRepinLiveScroll` 会在 streaming 文本更新和 assistant 消息落地时保持 live 区域可见，除非用户最近主动滚动离开；真实 `Messages`/Ink 渲染测试会把无尾随换行的 `streamingText` 渲染到模拟 TTY，并确认输出中包含完整 tail。
- 构建副本中不再存在 `export const X = undefined` 静默导出。
- `@ant/claude-for-chrome-mcp` 外部保守 shim 的空工具列表、真实 MCP client/server in-process 连接、`tools/list=[]` 和未知 browser tool 的明确不可用错误。
- `MCP_SKILLS` 被保留进构建副本，`dist/cli.js` 不再保留 `mcpSkillsModulePath` 变量路径 require；真实 MCP client/server in-process 测试会暴露 `skill://` text resource，并验证 frontmatter 解析、命令命名、`loadedFrom: 'mcp'` 标记、参数替换、blob resource 跳过、缓存命中和 cache delete 后刷新。
- `nativeOptional` 对缺失 native 包的统一错误包装。
- `modifiers-napi`、`image-processor-napi`、`audio-capture-napi`、`url-handler-napi` 相关 fallback 或保护路径。
- Node 产物缺少 vendored ripgrep 二进制时，`ripgrepCommand()` 会回退到系统 `rg`，并通过真实 `rg --version` 验证。
- deep link 合法输入、非法 repo、控制字符和超长输入。
- `dist/cli.js --version`、`--help`、`doctor --help` 和 `node --check`。

还通过配置好的 Anthropic-compatible 代理完成过真实 `-p` 任务和一组纯推理 smoke test。该代理配置没有写入仓库。

## 2026-06-18 CC Switch 启动卡住专项修复

用户复现路径：两个终端启动同一个构建产物，一个显式设置模型/代理环境变量时正常；另一个不设置环境变量、依赖 CC Switch 写入的 Claude settings 环境变量时，在 `Welcome back` 之前卡住。官方 Claude Code 走同一 CC Switch 配置可正常启动。

### 根因判断

- 这不是 CC Switch 协议本身的问题，也不是 Playwright MCP 是否启用导致。
- debug 文件显示当前产物能读取 settings env：`ANTHROPIC_AUTH_TOKEN` 和 `ANTHROPIC_BASE_URL=http://127.0.0.1:15721`。
- 卡点在 `setup()` 的 ContextCollapse 启动期动态加载：`const contextCollapseModulePath = './services/contextCollapse/index.js'; require(contextCollapseModulePath)`。
- 官方产物的打包/运行时形态能处理这类路径；当前 Node 单文件 esbuild 产物会把变量路径 require 留到运行期，等价于去 `dist/services/contextCollapse/index.js` 找真实文件。该文件不存在，容易在首屏前阻塞或报缺失模块。
- 同轮启动探针还暴露 `dist/vendor/ripgrep/x64-win32/rg.exe ENOENT`。仓库没有 vendored ripgrep 二进制，Node 产物不应该默认指向不存在的 vendor 路径。

### 本轮真实修复

- 移除 `setup.ts` 中首屏前的 ContextCollapse 初始化。当前 `initContextCollapse()` 只做订阅通知，运行时状态仍由模块自身和 resume/persist 路径维护，不需要阻塞首次渲染。
- 将 `TokenWarning`、`REPL`、`analyzeContext` 中的 `contextCollapseModulePath` 变量 require 改为静态字面量 require，让构建器能把模块并入单文件产物。
- 给 Logo v2 的 release notes / recent activity 预取增加 750ms 上限。它属于非关键首屏数据，超时后后台继续暖缓存，不阻塞欢迎界面。
- `ripgrepCommand()` 在 Node 产物缺少 vendored `rg` 时自动回退系统 `rg`，避免启动或搜索路径直接报 `rg.exe ENOENT`。
- `scripts/test-build-safety.mjs` 新增断言：ContextCollapse 相关路径不再使用变量 require，`setup()` 不再同步初始化 ContextCollapse，ripgrep fallback 必须指向可执行命令并通过 `rg --version`。

### 本轮 mock/stub/风险说明

- 本修复没有把 ContextCollapse 变成官方完整实现。它仍是 external-conservative：默认关闭、projection no-op、不伪造摘要提交。
- CC Switch 本身没有写入仓库配置；产物只是读取用户本机 settings/env。
- 非 TTY 启动探针会因为没有 stdin/prompt 而退出，这是测试环境特性，不代表交互终端退出。
- 当前仍会看到扫描不存在的全局 commands/agents 目录时产生的 `rg error` debug 日志；它已不是 `rg.exe ENOENT`，不阻塞启动，但后续可继续做目录存在性优化。

### 本轮验证结果

```text
npm run check
npm run build
npm run test:build-safety
npm run test:cli-e2e
node --check dist\cli.js
CC Switch settings env 启动探针：setup() completed，读取到 ANTHROPIC_BASE_URL=http://127.0.0.1:15721
ripgrep 启动探针：Ripgrep first use test PASSED (mode=system, path=rg)，不再出现 dist/vendor/.../rg.exe ENOENT
```

## 2026-06-18 VerifyPlanExecution 外部保守版修复

本轮继续推进未完成 feature，优先选择 `CLAUDE_CODE_VERIFY_PLAN`。它比 Tungsten 或 Chrome MCP 更适合作为下一项，因为源码中已有计划退出、提醒和状态字段，只缺工具实现与文档资产；同时它不依赖私有包或真实浏览器桥接服务。

### 本轮真实修复

- 新增 `src/tools/VerifyPlanExecutionTool/constants.ts` 和 `VerifyPlanExecutionTool.ts`。
- `CLAUDE_CODE_VERIFY_PLAN=true` 时，工具可以进入 `getAllBaseTools()`，不会再加载 fail-fast stub。
- 工具调用会读取 `pendingPlanVerification`，把 `verificationStarted` 置为 `true`，但保持 `verificationCompleted=false`。
- `ExitPlanModePermissionRequest` 的验证提示从固定 `undefined === 'true'` 恢复为读取 `process.env.CLAUDE_CODE_VERIFY_PLAN`。
- `REPL.tsx` 的 pending plan verification 状态保存从 `isEnvTruthy(undefined)` 恢复为读取 `process.env.CLAUDE_CODE_VERIFY_PLAN`。
- `classifierDecision.ts` 的 allowlist 改为跟随 `CLAUDE_CODE_VERIFY_PLAN=true`，和工具池启用条件一致。
- 补齐 `src/skills/bundled/verify/SKILL.md`、`examples/cli.md`、`examples/server.md`，构建后不再生成 bundled verify skill 空文本 asset stub。
- `scripts/test-build-safety.mjs` 增加 `.md` text loader，并新增 VerifyPlanExecution 与 verify skill 资产专项测试。

### 本轮 mock/stub/风险说明

- `VerifyPlanExecutionTool` 是 **external-conservative** 实现，不是 Anthropic 内部后台 verifier。
- 它不会启动后台 agent、不会自动证明计划已完成，也不会把 `verificationCompleted` 置为 `true`。
- 它的作用是让 opt-in 路径可加载、可调用、可诊断，并明确提醒模型/用户仍需报告真实测试证据。
- 默认不启用；只有显式设置 `CLAUDE_CODE_VERIFY_PLAN=true` 才会进入工具池并向模型注入调用提示。

### 本轮验证结果

```text
npm run check
npm run build
npm run test:build-safety
node --check scripts\test-build-safety.mjs
node --check dist\cli.js
```

结果：

- `npm run check` 通过。
- `npm run build` 通过，stub manifest 从 14 项降到 10 项，`VerifyPlanExecutionTool` 和 bundled verify skill 文档资产不再在 manifest 中。
- `npm run test:build-safety` 通过，当前为 35/35 项。
- VerifyPlanExecution 专项测试覆盖默认关闭、显式 env opt-in、工具池加载、调用后的 app state 更新、工具结果序列化和“非官方 verifier”警告。

## 2026-06-18 protectedNamespace 外部保守版修复

本轮继续推进未完成 feature，选择 `utils/protectedNamespace`。它原本只有 `.d.ts` 类型占位，`envUtils.isInProtectedNamespace()` 在 `USER_TYPE=ant` 分支会动态加载 `./protectedNamespace.js`，当前构建只能生成 fail-fast stub。虽然外部用户默认不会触发这个分支，但内部遥测、权限事件和 bridge 事件会读取该值；一旦用户误设或继承 `USER_TYPE=ant`，这里会从“返回一个保守布尔值”变成运行期异常。

### 本轮真实修复

- 删除 `src/utils/protectedNamespace.d.ts` 类型占位，新增 `src/utils/protectedNamespace.ts` 真实实现。
- 实现 `checkProtectedNamespace()`：
  - 没有 k8s/COO 信号时按本地环境处理，返回 `false`。
  - `COO_RUNNING_ON_HOMESPACE=1` 或 `CLAUDE_CODE_HOMESPACE=1` 返回 `false`。
  - `default`、`ts`、`dev`、`test`、`sandbox` 等开放命名空间返回 `false`。
  - `production`、`stage`、`protected`、`secure`、`sensitive`、`asl3+`、`boron` 等命名空间返回 `true`。
  - 只有 cluster 信号但没有 namespace，或 namespace 未知时返回 `true`。
  - 支持 `CLAUDE_CODE_OPEN_NAMESPACES` 追加外部可控开放命名空间，便于本地/测试环境显式放行。
- `scripts/test-build-safety.mjs` 新增 protectedNamespace 专项，确认 manifest 不再包含该 stub，并覆盖上述判断路径。

### 本轮 mock/stub/风险说明

- 这是外部保守实现，不是 Anthropic 内部真实 allowlist。
- 风险取向是宁可把未知 k8s/COO 环境判为 protected，也不把敏感环境误判为 unprotected。
- 如果某个真实内部开放 namespace 不在默认列表里，需要通过 `CLAUDE_CODE_OPEN_NAMESPACES` 显式追加，或者后续补充更准确的公开规则。

### 本轮验证结果

```text
npm run check
npm run build
npm run test:build-safety
npm run test:cli-e2e
node --check scripts\test-build-safety.mjs
node --check dist\cli.js
npm run audit:features
```

结果：

- `npm run build` 通过，stub manifest 从 10 项降到 9 项，`utils/protectedNamespace` 不再在 manifest 中。
- `npm run test:build-safety` 通过，当前为 36/36 项。
- `npm run test:cli-e2e` 通过，真实 `dist/cli.js` 子进程主路径、resume、streaming fallback 和工具链回归未受影响。

## 2026-06-18 ultraplan prompt 资源修复

本轮继续收口 manifest 中最后一个 `empty-asset-stub`：`src/utils/ultraplan/prompt.txt`。该资源被 `commands/ultraplan.tsx` 读取，用于远程规划会话的系统提示；之前源码包缺失该文件，构建只能生成空文本 stub。空 prompt 虽然不直接启用 `ULTRAPLAN`，但一旦内部路径被打开，会让远程规划缺少核心行为约束。

### 本轮真实修复

- 新增 `src/utils/ultraplan/prompt.txt`，提供真实规划提示词资源。
- prompt 要求远程规划会话只产出实现计划，不直接改代码，并在计划完成时调用 `ExitPlanMode`。
- prompt 明确要求计划包含行为变化、涉及文件/子系统、验证步骤和剩余风险。
- prompt 避免包含裸 `ultraplan` 关键词，防止被原始输入关键词检测误触发。
- `scripts/test-build-safety.mjs` 增加 `.txt` loader，并新增 prompt 资产测试，确认该文件非空、包含 `ExitPlanMode` 指引、不自触发关键词检测，且 manifest 不再包含该 asset stub。
- stub manifest 断言收紧：当前构建不应再出现 `empty-asset-stub`。

### 本轮 mock/stub/风险说明

- 这不是完整恢复 `ULTRAPLAN` feature。`ULTRAPLAN` 仍然 off-by-default，远程 CCR session、审批轮询、执行目标选择等能力仍依赖内部/线上服务。
- 本轮只恢复缺失文本资产，避免空 prompt 这种静默坏状态。

### 本轮验证结果

```text
npm run check
npm run build
npm run test:build-safety
npm run test:cli-e2e
node --check scripts\test-build-safety.mjs
node --check dist\cli.js
npm run audit:features
```

结果：

- `npm run build` 通过，stub manifest 从 9 项降到 8 项；`empty-asset-stub` 已为 0。
- `npm run test:build-safety` 通过，当前为 37/37 项。
- `npm run audit:features` 通过，当时 stub kinds 只剩 `feature-gated-module-stub: 7` 和 `private-package-stub: 1`。
- `npm run test:cli-e2e` 顺序重跑通过。曾经并行跑 `test:build-safety` 与 `test:cli-e2e` 会互相清理 `build-src/test-artifacts`，导致一次假失败；后续验证已按顺序执行。

## 2026-06-18 ant-only 提示弹窗外部保守版修复

本轮继续推进未完成 feature，选择 `components/AntModelSwitchCallout` 和 `components/UndercoverAutoCallout`。这两个组件在 `screens/REPL.tsx` 中只会在 `USER_TYPE=ant` 时动态加载；之前源码包缺失实际实现，构建只能生成 fail-fast stub。一旦用户继承或手动设置 `USER_TYPE=ant`，REPL 打开相关弹窗路径会直接遇到缺失模块。

### 本轮真实修复

- 新增 `src/components/AntModelSwitchCallout.tsx`。
- `shouldShowModelSwitchCallout()` 只在以下条件同时满足时返回 true：
  - `USER_TYPE=ant`
  - `CLAUDE_CODE_ENABLE_MODEL_SWITCH_CALLOUT` 为 truthy
  - 显式配置了 `CLAUDE_CODE_MODEL_SWITCH_TARGET` 或内部 `antModels` switchCallout
  - 用户没有永久 dismiss，且没有在 24 小时内展示过同版本 callout
- 弹窗可以选择切换到显式目标模型、暂不处理或不再显示；选择切换时只把目标模型交还给 REPL 的既有 `setModel(...)` 回调。
- 新增 `src/components/UndercoverAutoCallout.tsx`。
- Undercover 弹窗只展示公开仓库安全提示，并把 `hasSeenUndercoverAutoNotice` 写入全局配置；真正是否 undercover 仍由 `src/utils/undercover.ts` 判断。
- `scripts/test-build-safety.mjs` 新增专项测试，确认 manifest 不再包含两个 callout stub，且默认关闭、显式 opt-in、真实 Ink 渲染路径都可执行。

### 本轮 mock/stub/风险说明

- 这两个组件都是 **external-conservative** 实现，不是 Anthropic 内部原版 UI 或完整策略。
- `AntModelSwitchCallout` 不会自动判断应该迁移到哪个官方模型；必须显式配置目标模型，避免假装知道内部模型迁移策略。
- `UndercoverAutoCallout` 不改变 undercover 模式，不新增仓库隐私判断，只负责提示和记录已读。
- 这轮修复把运行期缺失模块风险收敛成可加载 UI，但没有恢复任何内部 ant-only 后台策略。

### 本轮验证结果

```text
npm run check
npm run build
node --check dist\cli.js
npm run audit:features
npm run test:build-safety
npm run test:cli-e2e
```

结果：

- `npm run build` 通过，stub manifest 从 8 项降到 6 项；`AntModelSwitchCallout` 和 `UndercoverAutoCallout` 不再在 manifest 中。
- `npm run test:build-safety` 通过，当前为 38/38 项。
- `npm run test:cli-e2e` 通过，真实 `dist/cli.js` 子进程主路径、resume、streaming fallback、多工具调用和写入工具链回归未受影响。
- `npm run audit:features` 通过，当时 stub kinds 只剩 `feature-gated-module-stub: 5` 和 `private-package-stub: 1`。

## 2026-06-18 devtools / Tungsten 外部保守版修复

本轮继续推进剩余 manifest 缺口，选择 `ink/devtools` 和 `tools/TungstenTool`。这两项触发面较局部：`ink/devtools` 只在开发态 Ink reconciler 动态导入；`TungstenTool` 是 ant-only 终端会话工具，同时 `/clear` 缓存清理会动态导入它的清理函数。之前两者都是构建期 fail-fast stub。同轮还顺手补齐两个 REPL 顶层 ant-only 变量路径 require 指向的缺失 hook，避免它们绕过 manifest 后在运行期失败。

### 本轮真实修复

- 删除 `src/ink/devtools.d.ts`，新增 `src/ink/devtools.ts`。
- `connectToDevTools()` / `getDevtoolsStatus()` 返回明确的 `external-conservative` / `unavailable` 状态，开发态导入不再触发缺失模块。
- 删除 `src/tools/TungstenTool/TungstenTool.d.ts`，新增 `src/tools/TungstenTool/TungstenTool.ts`。
- `TungstenTool` 使用真实 `buildTool()` 定义，默认 `isEnabled=false`，调用时返回 `unavailable`，不执行任何终端命令。
- 补齐 `clearSessionsWithTungstenUsage()`、`resetInitializationState()` 和可测试的 fallback state，保证 `/clear` 的动态清理路径不会因缺失模块失败。
- 新增 `src/tools/TungstenTool/TungstenLiveMonitor.tsx`，REPL 中 ant-only monitor 渲染为 no-op。
- `src/screens/REPL.tsx` 将 Tungsten live monitor 的变量路径 require 改成静态字面量 require，让 esbuild 可以把该 no-op 组件打进单文件产物。
- 新增 `src/components/FeedbackSurvey/useFrustrationDetection.ts` 和 `src/hooks/notifs/useAntOrgWarningNotification.ts` no-op hook。
- `src/screens/REPL.tsx` 将 frustration detection、ant org warning 和 Tungsten live monitor 的变量路径 require 改成静态字面量 require。
- `scripts/test-build-safety.mjs` 新增 devtools/Tungsten/ant-only hook 专项，并将 lazy tool fail-fast 回退测试改用仍缺失的 `REPLTool`。

### 本轮 mock/stub/风险说明

- `ink/devtools` 只是 no-op，不连接 `react-devtools-core`，不提供真实 React DevTools 调试能力。
- `TungstenTool` 不是官方内部终端会话能力。它默认禁用，不会创建 tmux session，不会执行命令，不会注入 live terminal。
- `TungstenLiveMonitor` 只保证 REPL ant-only UI 路径可加载，不展示真实 live monitor。
- `useFrustrationDetection` 不做真实挫败感检测，`useAntOrgWarningNotification` 不展示内部组织提示。
- 本轮把“导入即 fail-fast/运行期缺失”的风险改成“可加载但明确不可用或 no-op”，没有恢复内部 ant-only Tungsten、frustration detection 或 org warning 后台能力。

### 本轮验证结果

```text
npm run check
npm run build
node --check dist\cli.js
npm run audit:features
npm run test:build-safety
npm run test:cli-e2e
```

结果：

- `npm run build` 通过，stub manifest 从 6 项降到 4 项；`ink/devtools` 和 `tools/TungstenTool` 不再在 manifest 中。
- `npm run test:build-safety` 通过，当时为 39/39 项；后续 Resume/UserTextMessage 变量路径专项补测后为 40/40 项。
- `npm run test:cli-e2e` 通过，真实 `dist/cli.js` 子进程主路径、resume、streaming fallback、多工具调用和写入工具链回归未受影响。
- `npm run audit:features` 通过，当时 stub kinds 只剩 `feature-gated-module-stub: 3` 和 `private-package-stub: 1`。

## 2026-06-18 Resume/UserTextMessage 变量路径修复

本轮继续处理“源码能构建，但单文件产物运行到 gated 分支时仍按磁盘相对路径找 `.js` 文件”的风险。上一轮已经修了 `setup`、`TokenWarning`、`REPL`、`analyzeContext` 和 Snip 相关路径；本轮收口 `ResumeConversation` 与 `UserTextMessage` 中剩余的变量路径 require。

### 本轮真实修复

- `src/screens/ResumeConversation.tsx` 的 ContextCollapse persist 恢复路径从 `require(contextCollapsePersistModulePath)` 改为 `require('../services/contextCollapse/persist.js')` 字面量路径。
- `src/components/messages/UserTextMessage.tsx` 中 `KAIROS_GITHUB_WEBHOOKS`、`FORK_SUBAGENT`、`UDS_INBOX` 三个 gated 分支从 `require(user*ModulePath)` 改为静态字面量 require。
- 新增 `src/components/messages/UserGitHubWebhookMessage.tsx`，用于保守展示 `<github-webhook-activity>` 内容摘要。
- 新增 `src/components/messages/UserForkBoilerplateMessage.tsx`，用于保守折叠并展示 fork 子会话 boilerplate 摘要。
- 新增 `src/components/messages/UserCrossSessionMessage.tsx`，用于保守展示 `<cross-session-message>` 来源和正文摘要。
- `scripts/test-build-safety.mjs` 新增专项测试，检查构建副本和 `dist/cli.js` 不再保留上述变量路径，并通过真实 Ink 渲染三个新增消息组件。

### 本轮 mock/stub/风险说明

- 三个新增用户消息组件是 **external-conservative** 渲染器，不是 Anthropic 内部原版 UI。
- GitHub webhook 只展示活动文本摘要，不恢复内部订阅、PR 事件结构化展示或通知策略。
- Fork boilerplate 只折叠展示指令摘要，不恢复完整 fork 子会话 UX。
- Cross-session message 只解析常见 `source` / `sender` / `from` / `agent` 属性和正文，不恢复 UDS inbox 的完整消息编排。
- 这轮的核心收益是消除运行期 `Cannot find module ...User*Message.js` / ContextCollapse persist 变量路径缺失风险；不代表这些 feature gate 已默认启用。

### 本轮验证结果

```text
npm run check
npm run build
node --check dist\cli.js
npm run audit:features
npm run test:build-safety
npm run test:cli-e2e
```

结果：

- `npm run build` 通过，当时 stub manifest 仍为 4 项：`feature-gated-module-stub: 3`、`private-package-stub: 1`；后续 ant-only 工具/命令修复后只剩 `private-package-stub: 1`。
- `npm run test:build-safety` 通过，当时为 40/40 项；后续 ant-only 工具/命令专项补测后为 41/41 项。
- 新增专项确认构建副本和 `dist/cli.js` 不再包含 `contextCollapsePersistModulePath`、`userGitHubWebhookModulePath`、`userForkBoilerplateModulePath`、`userCrossSessionModulePath`。
- 新增专项真实渲染 `UserGitHubWebhookMessage`、`UserForkBoilerplateMessage` 和 `UserCrossSessionMessage`，确认终端输出包含预期摘要。
- `npm run test:cli-e2e` 通过，真实 `dist/cli.js` 子进程主路径、resume、streaming fallback、多工具调用和写入工具链回归未受影响。

## 2026-06-18 ant-only 工具和 agents-platform 外部保守版修复

本轮继续清理 `build-src/stub-manifest.json` 中最后 3 个 `feature-gated-module-stub`：`tools/REPLTool/REPLTool`、`tools/SuggestBackgroundPRTool/SuggestBackgroundPRTool` 和 `commands/agents-platform/index`。这些路径都由 `USER_TYPE=ant` 顶层条件触发；如果用户继承或手动设置 `USER_TYPE=ant`，它们比普通关闭 feature 更容易在工具/命令加载阶段触发 fail-fast。

### 本轮真实修复

- 新增 `src/tools/REPLTool/REPLTool.ts`，使用真实 `buildTool()` 定义，默认 `isEnabled=false`，调用时返回 `unavailable`。
- 新增 `src/tools/SuggestBackgroundPRTool/SuggestBackgroundPRTool.ts`，默认禁用，调用时返回 `unavailable`。
- 新增 `src/commands/agents-platform/index.ts`，命令隐藏且禁用，调用时返回明确不可用提示。
- 修改 `src/tools.ts`：只有 `REPLTool?.isEnabled()` 为 true 时，simple/non-simple 工具池才把基础工具隐藏到 REPL 后面；当前外部保守 REPLTool 禁用时，Read/Bash/Edit 等基础工具仍直接可用。
- `scripts/test-build-safety.mjs` 新增专项测试，确认 manifest 中 `feature-gated-module-stub` 已为 0，并模拟 `USER_TYPE=ant` + CLI 工具池，验证 REPLTool 禁用时基础工具不丢失。

### 本轮 mock/stub/风险说明

- `REPLTool` 不是官方内部 REPL VM。它不执行代码、不包装 primitive tools、不提供透明工具代理；当前只是防止 ant-only 路径加载失败，并避免禁用状态误隐藏基础工具。
- `SuggestBackgroundPRTool` 不创建后台 PR、不调度远程任务、不恢复内部 PR 建议流。
- `agents-platform` 不连接 Anthropic 内部 agents platform，只是隐藏禁用的占位命令。
- 本轮把 3 个生成 stub 改成可加载、明确不可用的模块；不代表 `USER_TYPE=ant` 的所有内部体验都已恢复。

### 本轮验证结果

```text
npm run check
npm run build
node --check dist\cli.js
npm run audit:features
npm run test:build-safety
npm run test:cli-e2e
```

结果：

- `npm run build` 通过，stub manifest 从 4 项降到 1 项，只剩 `private-package-stub: 1`。
- `npm run audit:features` 通过，Stub kinds 只剩 `private-package-stub: 1`。
- `npm run test:build-safety` 通过，当时为 41/41 项；后续 MCP_SKILLS 专项补测后为 43/43 项。
- 新增专项确认 `REPLTool`、`SuggestBackgroundPRTool`、`agents-platform` 不再在 manifest 中；`USER_TYPE=ant` + CLI 下工具池包含 Read/Bash/Edit，且不暴露 disabled 的 REPL/SuggestBackgroundPR。
- `npm run test:cli-e2e` 通过，真实 `dist/cli.js` 子进程主路径、resume、streaming fallback、多工具调用和写入工具链回归未受影响。

## 2026-06-18 Chrome MCP 外部保守 shim 修复

本轮继续推进最后一个构建期 private-package-stub：`@ant/claude-for-chrome-mcp`。之前构建脚本会生成 `build-src/stubs/claude-for-chrome-mcp.js`，只导出空 `BROWSER_TOOLS`，但 `createClaudeForChromeMcpServer()` 会 fail-fast。一旦用户启用 Claude in Chrome MCP 或 in-process MCP 路径，运行时会直接报私有包不可用。

### 本轮真实修复

- 新增 `src/stubs/claude-for-chrome-mcp.ts`，作为 source-controlled 外部保守 shim。
- `scripts/build.mjs` 不再生成 `build-src/stubs/claude-for-chrome-mcp.js`，也不再记录 `private-package-stub`。
- esbuild alias 改为把 `@ant/claude-for-chrome-mcp` 指向 `build-src/src/stubs/claude-for-chrome-mcp.ts`。
- shim 导出空 `BROWSER_TOOLS`，因此 `setupClaudeInChrome()` 和 bundled Claude-in-Chrome skill 会得到空 allowed tools，不会伪造 browser tools。
- shim 使用 MCP SDK 低层 `Server` 创建可连接的空 MCP server：
  - `tools/list` 返回 `[]`。
  - `tools/call` 对任意 browser tool 返回明确不可用错误。
  - 创建时写入 warning，并通过 `trackEvent` 记录 `tengu_chrome_mcp_external_shim_started`。
- `scripts/test-build-safety.mjs` 更新 manifest 断言：当前不应再出现 `private-package-stub`。
- 新增 Chrome MCP 专项深度测试：通过项目已有 `createLinkedTransportPair()` 连接真实 MCP `Client` 和 shim server，验证初始化、`listTools()` 空列表、未知 `browser_snapshot` tool 的明确错误，以及 warning 输出。

### 本轮 mock/stub/风险说明

- 这不是官方 `@ant/claude-for-chrome-mcp` 实现，不提供真实 Chrome 连接、页面读取、点击、截图、browser task 或 lightning_turn。
- 这轮收益是把“启用即 fail-fast”降级为“可初始化但明确无工具”，便于 CLI 和 MCP 管理路径继续运行。
- Playwright MCP 是独立项目级 MCP server，和这个 Claude-in-Chrome 私有包不是同一个能力；Playwright MCP 可用不代表 Chrome MCP 已恢复。
- 如果后续要恢复真实浏览器能力，应优先接入公开、可安装、可测试的 MCP server，而不是伪造 `BROWSER_TOOLS`。

### 本轮验证结果

```text
npm run check
npm run build
node --check dist\cli.js
npm run audit:features
npm run test:build-safety
npm run test:cli-e2e
```

结果：

- `npm run build` 通过，`build-src/stub-manifest.json` 当前为 `entries: []`。
- `npm run audit:features` 通过，Stub kinds 为空。
- `npm run test:build-safety` 通过，当时为 41/41 项；Chrome MCP 新专项覆盖真实 MCP client/server in-process 连接。后续 MCP_SKILLS 专项补测后为 43/43 项。
- `npm run test:cli-e2e` 串行复跑通过，真实 `dist/cli.js` 子进程主路径、resume、streaming fallback、多工具调用和写入工具链回归未受影响。
- 曾经并行跑 `test:build-safety` 与 `test:cli-e2e` 时出现过一次 CLI e2e 假失败；串行复跑已通过，后续仍建议这两个测试顺序执行。

## 2026-06-18 MCP_SKILLS 外部可运行路径修复

本轮继续推进 feature gate 层面的真实可用能力，选择 `MCP_SKILLS`。它影响 MCP server 通过 resources 暴露模型可调用 skill 的路径。之前源码里只有 `src/skills/mcpSkills.d.ts` 类型占位，没有实现文件；如果直接保留 `feature('MCP_SKILLS')`，构建会重新生成 fail-fast stub，或者单文件产物在变量路径 require 上出问题。

### 本轮真实修复

- 删除 `src/skills/mcpSkills.d.ts`，新增 `src/skills/mcpSkills.ts`。
- `scripts/build.mjs` 默认保留 `MCP_SKILLS`，`npm run audit:features` 现在会把它列为 `preserved-default`。
- `src/services/mcp/client.ts` 和 `src/services/mcp/useManageMCPConnections.ts` 的 MCP skill require 改为静态字面量路径，避免单文件产物运行时查找 `mcpSkillsModulePath`。
- `fetchMcpSkillsForClient()` 现在会：
  - 对 connected 且支持 resources 的 MCP server 调用 `resources/list`。
  - 只处理 URI 以 `skill://` 开头的资源。
  - 对每个 skill resource 调用 `resources/read`。
  - 只接受 text content，blob-only resource 会跳过。
  - 复用 `loadSkillsDir.ts` 注册的 parser/builder，解析 frontmatter、`allowed-tools`、`arguments`、`user-invocable` 等字段。
  - 生成 `loadedFrom: 'mcp'`、`source: 'mcp'` 的 prompt command，命名规则为 `normalizedServer:normalizedSkill`，和现有 MCP command cleanup/filter 逻辑兼容。
  - 使用 LRU cache，并暴露 `.cache.delete(serverName)` 给 reconnect/list_changed 路径刷新。
- `scripts/test-build-safety.mjs` 的 snippet runner 默认加入和真实 `dist` 一致的 `createRequire` banner，避免临时 ESM snippet 在 `require('yaml')`、`require('perf_hooks')` 这类 Node fallback 上产生假失败。

### 本轮 mock/stub/风险说明

- 这不是完整恢复所有 MCP skill/resource 能力。当前只支持静态 `resources/list` 返回的 `skill://` text resources，不支持 resource templates、blob skill、远端资源目录递归、签名校验或内部分发策略。
- MCP skill 来自远端 server，按不可信内容处理；skill markdown 里的 `!` shell 语法不会执行，只作为普通文本交给模型。
- `MCP_SKILLS` 虽然被默认保留，但只有在用户配置的 MCP server 成功连接并暴露 skill resources 时才生效。
- 如果 MCP server 返回坏 YAML、不可读 resource 或 blob-only 内容，当前策略是跳过该资源并记录 debug，不让整个 MCP server 连接失败。

### 本轮验证结果

```text
npm run check
npm run build
node --check scripts\test-build-safety.mjs
node --check dist\cli.js
npm run audit:features
npm run test:build-safety
npm run test:cli-e2e
```

结果：

- `npm run audit:features` 通过，默认保留项为 `CONTEXT_COLLAPSE`、`DUMP_SYSTEM_PROMPT`、`HISTORY_SNIP`、`MCP_SKILLS`。
- `build-src/stub-manifest.json` 仍为 `entries: []`。
- `npm run test:build-safety` 通过，当前为 43/43 项；新增 MCP skill 专项覆盖真实 MCP client/server in-process 连接、resource list/read、frontmatter、参数替换、缓存和坏资源跳过。
- `npm run test:cli-e2e` 通过，真实 `dist\cli.js` 子进程主路径、resume、streaming fallback、多工具调用和写入工具链回归未受影响。

## 2026-06-18 EXPERIMENTAL_SKILL_SEARCH 本地发现路径修复

本轮继续推进 feature gate 层面的真实可用能力，选择 `EXPERIMENTAL_SKILL_SEARCH`。它影响模型在对话早期发现可用 skill，以及后续通过工具主动查询 skill 的路径。之前源码里只有 `src/services/skillSearch/localSearch.d.ts` 类型占位；如果直接保留 feature，构建会重新生成缺失模块 stub，或在需要 skill discovery 时运行期失败。

### 本轮真实修复

- 删除 `src/services/skillSearch/localSearch.d.ts`，新增 `src/services/skillSearch/localSearch.ts`、`featureCheck.ts`、`prefetch.ts`。
- `scripts/build.mjs` 默认保留 `EXPERIMENTAL_SKILL_SEARCH`，`npm run audit:features` 会把它列为 `preserved-default`。
- 本地 skill search 会读取当前项目可用 prompt skill，并合并 MCP 暴露的 prompt skill；支持 LRU 缓存、重复发现去重、最大结果数控制和明确的 env disable。
- 新增 `src/tools/DiscoverSkillsTool/*`，把 `DiscoverSkills` 作为只读工具接入工具池；模型可以用 `{ query, max_results }` 查询匹配 skill。
- 新增 turn-zero skill discovery prefetch：对用户最新输入做本地检索，命中时生成 `skill_discovery` attachment，并记录到 `context.discoveredSkillNames`，避免重复提示同一 skill。
- 检索输入做了空值和自然语言噪声词防护，避免 `content: null` 或普通句式中的弱词导致崩溃/误判。
- `max_results` 做 1-20 范围钳制，避免模型或调用方传入负数/过大值时出现 `slice(0, -1)` 这类不直观结果。
- `review` 不再被当作停用词，避免误伤 code review、PR review 等实际技能类目。
- 新增 `remoteSkillLoader.ts`、`remoteSkillState.ts` 和 `telemetry.ts`，把 `_canonical_` 远程 skill 路径收口为明确的 external-unavailable 边界，而不是缺失模块或隐式 stub。
- `scripts/test-build-safety.mjs` 增加技能发现专项，覆盖默认保留、env 禁用、工具池接入、MCP skill 检索、turn-zero attachment、重复发现去重、`DiscoverSkills` 工具调用、`max_results` 边界钳制和 `content: null` 防崩溃。

### 本轮 mock/stub/风险说明

- 这不是完整恢复官方内部 skill marketplace。当前没有 AKI/GCS 远程分发、canonical skill 下载、签名校验、版本治理或组织级策略。
- `_canonical_` 远程 skill 加载会明确返回 unavailable；这是保守边界，不是功能恢复。
- 当前排序是本地 keyword scoring，不是 embedding、模型 rerank 或官方语义检索；长查询、同义词和跨语言命中质量仍有限。
- `DiscoverSkills` 只暴露 prompt skill 的名称和描述，不会执行 skill，也不会绕过既有工具权限。
- MCP skill 仍继承上一轮 `MCP_SKILLS` 的边界：只支持 `skill://` text resources 到 prompt command 的外部路径。
- `context.discoveredSkillNames` 是单上下文内的去重状态，不是持久化全局偏好，也不会同步到远程账号。

### 本轮验证结果

```text
npm run check
npm run build
node --check scripts\test-build-safety.mjs
node --check dist\cli.js
npm run audit:features
npm run test:build-safety
npm run test:cli-e2e
```

结果：

- `npm run audit:features` 通过，默认保留项为 `CONTEXT_COLLAPSE`、`DUMP_SYSTEM_PROMPT`、`EXPERIMENTAL_SKILL_SEARCH`、`HISTORY_SNIP`、`MCP_SKILLS`。
- `build-src/stub-manifest.json` 仍为 `entries: []`。
- `npm run test:build-safety` 通过，当前为 45/45 项；新增技能发现专项覆盖本地/MCP skill 检索、DiscoverSkills 工具接入和坏输入防护。
- `npm run test:cli-e2e` 通过，真实 `dist\cli.js` 子进程主路径、resume、streaming fallback、多工具调用和写入工具链回归未受影响。

## 2026-06-18 REACTIVE_COMPACT 后置恢复路径修复

本轮继续推进上下文可靠性，但不是继续修 ContextCollapse 本身，而是恢复 `REACTIVE_COMPACT`。它影响“已经发起模型请求后，API 返回 prompt-too-long 或媒体过大错误”的恢复路径。之前源码里只有 `src/services/compact/reactiveCompact.d.ts` 类型占位，构建默认把 feature 裁掉；遇到真实 413/400 prompt-too-long 时只能提前阻断或直接报错，无法走 query 里已经写好的压缩后重试分支。

### 本轮真实修复

- 删除 `src/services/compact/reactiveCompact.d.ts`，新增 `src/services/compact/reactiveCompact.ts`。
- `scripts/build.mjs` 默认保留 `REACTIVE_COMPACT`，`npm run audit:features` 会把它列为 `preserved-default`。
- 实现 `isReactiveCompactEnabled()`，支持 `DISABLE_COMPACT`、`DISABLE_AUTO_COMPACT`、`DISABLE_REACTIVE_COMPACT`、`CLAUDE_CODE_DISABLE_REACTIVE_COMPACT` 和 `CLAUDE_CODE_REACTIVE_COMPACT`。
- 实现 prompt-too-long 与 media-size error 的 withheld 判断，避免 query loop 在可恢复错误上过早把错误吐给用户。
- 实现 `tryReactiveCompact()`：仅在未尝试过、未 abort、非 compact/session_memory 递归 querySource、且 auto compact 允许时触发。
- 复用现有 `compactConversation()` 生成摘要，不另写一套总结逻辑；成功后清理 compact 后缓存，并让 query loop 用 `buildPostCompactMessages()` 进入下一轮模型重试。
- 保留旧导出 `isReactiveOnlyMode()` 和 `reactiveCompactOnPromptTooLong()`，兼容 `/compact` 中已有引用；manual reactive-only 默认不启用。
- `scripts/test-build-safety.mjs` 新增模块级专项，覆盖默认启用、env 禁用、reactive-only 默认关闭/显式开启、prompt-too-long/media-size withheld、普通错误不 withheld、hasAttempted/递归/abort 熔断。
- `scripts/test-cli-resume-e2e.mjs` 新增真实 CLI 子进程 E2E：本地 mock provider 第一次返回 HTTP 400 `prompt is too long`，CLI 触发 compact summary 请求，随后用 compact summary 重试并返回最终结果。

### 本轮 mock/stub/风险说明

- 这不是完整恢复官方内部 reactive compact 实验。当前没有 statsig 分桶策略、内部指标策略、复杂 token-gap 分组剥离策略或官方 reactive-only manual compact 语义。
- 当前恢复重点是后置恢复主路径：API 已经返回 prompt-too-long/media-size 后，尽量 compact 并重试。普通 proactive autocompact 和 History Snip 仍各自按既有路径工作。
- 如果 compact 请求本身也连续 prompt-too-long，仍会交给 `compactConversation()` 内已有的 PTL retry；耗尽后会返回原错误，不会无限重试。
- `ImageSizeError` / `ImageResizeError` 这类本地预校验抛错目前仍走现有直接错误路径；本轮 media-size recovery 主要覆盖 API 返回的媒体尺寸错误消息。
- manual `/compact` 默认仍走传统 compact；只有显式 `CLAUDE_CODE_REACTIVE_COMPACT_ONLY` 时才进入兼容 reactive-only 分支。

### 本轮验证结果

```text
npm run check
npm run build
node --check scripts\test-build-safety.mjs
node --check scripts\test-cli-resume-e2e.mjs
node --check dist\cli.js
npm run audit:features
npm run test:build-safety
npm run test:cli-e2e
```

结果：

- `npm run audit:features` 通过，默认保留项为 `CONTEXT_COLLAPSE`、`DUMP_SYSTEM_PROMPT`、`EXPERIMENTAL_SKILL_SEARCH`、`HISTORY_SNIP`、`MCP_SKILLS`、`REACTIVE_COMPACT`。
- `build-src/stub-manifest.json` 仍为 `entries: []`。
- `npm run test:build-safety` 通过，当前为 46/46 项；新增 reactive compact 专项覆盖运行时 gate 和熔断边界。
- `npm run test:cli-e2e` 通过，新增真实 `dist\cli.js` 子进程 prompt-too-long -> compact summary -> retry -> final 的恢复路径。

## 2026-06-18 feature gate 环境变量风险收紧

本轮不恢复新的内部功能，目标是降低误操作风险：之前 `CLAUDE_CODE_PRESERVE_FEATURES` 可以在构建时直接额外保留任意源码里存在的 feature gate。对于这个仓库来说，非默认 gate 往往意味着 Anthropic 内部模块、private package、native 能力或未审计路径，静默打开会把“构建成功”误导成“功能可用”。

### 本轮真实修复

- 新增 `scripts/feature-gate-policy.mjs`，集中维护默认保留 gate 列表、环境变量解析和策略校验。
- `scripts/build.mjs` 构建前会先扫描 `src/` 中实际存在的 `feature('...')`，再校验 `CLAUDE_CODE_PRESERVE_FEATURES`。
- 未知 feature gate 会直接阻断构建，避免拼写错误或过期 gate 被静默忽略。
- 非默认 feature gate 默认也会阻断构建；只有显式设置 `CLAUDE_CODE_ALLOW_UNAUDITED_FEATURES=1` 后才允许继续，并打印 unaudited gate 警告。
- `scripts/audit-features.mjs` 改为复用同一策略模块，输出 `env preservation policy`，让审计结果和构建行为一致。
- `scripts/test-build-safety.mjs` 增加策略级测试，覆盖重复解析、非默认 gate 默认阻断、显式 override 放行和未知 gate 永远阻断。

### 本轮 mock/stub/风险说明

- 这不是功能恢复。它只是把高风险 feature gate 从“静默保留”改成“默认拒绝 + 显式确认”。
- 如果确实要恢复新的内部 feature gate，仍需要补实现、补风险说明、补 `audit:features` / `test:build-safety` / `test:cli-e2e` 验证，而不是只设置 override。
- `CLAUDE_CODE_ALLOW_UNAUDITED_FEATURES=1` 只是开发期逃生口，不应作为常规构建配置进入发布脚本。

## 2026-06-18 MCP skill 资源输入边界收紧

本轮继续收紧 `MCP_SKILLS` 外部可运行路径的安全边界。MCP server 暴露的 `skill://` resource 属于远端输入，虽然当前只处理 text resource 并把 shell 语法作为普通文本保留，但仍需要限制 URI 和 markdown 大小，避免恶意或异常 server 把超大 skill 文本塞进 prompt command，或暴露异常 URI 干扰解析。

### 本轮真实修复

- `src/skills/mcpSkills.ts` 新增 skill resource URI 校验：跳过缺失 URI、控制字符 URI、超长 URI、不可解析 URI 和没有 skill 标识的 URI。
- 每个 MCP server 最多加载 50 个 skill resource，超过部分跳过并记录 debug warning。
- 单个 MCP skill markdown 超过 100000 字符时跳过，不做截断加载，避免半截指令被误认为完整 skill。
- MCP skill 缓存键改为 server 名称 + 配置 hash，避免同名但配置不同的 MCP 连接复用彼此的 skill 列表；相关重连/资源变更清理点同步改用稳定 key。
- MCP skill frontmatter 只保留描述性字段；`allowed-tools`、`hooks`、`context: fork`、`agent`、`model`、`effort` 和 `shell` 会在解析前剥离并记录 debug warning，避免远端 skill 扩大本地权限或改变执行形态。
- `scripts/test-build-safety.mjs` 扩展 MCP skill 专项测试，覆盖合法 URI、空 URI、控制字符 URI、超长 URI、超大 text resource 被跳过、同名不同配置 server 不共享缓存，以及远端 frontmatter 不能授予工具权限或切换 model/fork/effort/hooks。

### 本轮 mock/stub/风险说明

- 这不是完整恢复官方 MCP skill 分发。当前仍只支持 `skill://` text resources 到 prompt command 的外部路径。
- 超大 skill 当前直接跳过，不做摘要或分段加载；这是保守边界，避免引入半截 skill 语义。
- 资源数量限制是防御性上限。真正需要大量 skill 的 server 应先在 server 侧做分类或按需暴露。
- MCP tools/resources/prompts 的原有缓存策略本轮未改；这里仅收紧新接入的 MCP skill resource 路径。
- MCP skill 不再能通过 frontmatter 自带 `allowed-tools` 授权；如果 skill 内容需要使用工具，仍走普通工具权限和用户/策略授权路径。

## 2026-06-18 DiscoverSkills 查询归一化

本轮继续收紧 `EXPERIMENTAL_SKILL_SEARCH` / `DiscoverSkills` 的模型可调用输入边界。之前 skill 查询会被本地 keyword scorer 使用，并在 tool_result 里回显；如果模型或上游代理传入超长文本、换行或控制字符，会放大日志/结果噪声，也可能干扰后续模型阅读工具结果。

### 本轮真实修复

- `src/services/skillSearch/localSearch.ts` 新增 `normalizeSkillSearchQuery()`：控制字符转空格、连续空白折叠、首尾裁剪、最大 1000 字符。
- `searchSkillIndex()`、turn-zero/prefetch skill discovery 和 `DiscoverSkillsTool.call()` 共用同一归一化逻辑。
- `DiscoverSkills` 的输出 `query` 和 tool_result 标题只回显归一化后的查询。
- `DiscoverSkills` 返回的 skill 名称/描述、tool_result 文本，以及 turn-zero/prefetch skill discovery attachment 都会清理控制字符、折叠空白并限制输出长度。
- `scripts/test-build-safety.mjs` 扩展 skill search 专项测试，覆盖查询/输出控制字符清理、长度上限和 tool_result 不泄漏控制字符。

### 本轮 mock/stub/风险说明

- 这不是语义检索增强；当前仍是 keyword scoring，不是 embedding/rerank。
- 超长查询和超长 skill 描述会被截断，可能牺牲少量召回或描述完整性，但避免异常输入污染工具结果和上下文。

## 2026-06-18 markdown 配置目录扫描噪声收敛

本轮继续收敛启动期噪声。之前全局或托管的 `commands` / `agents` / `skills` / `output-styles` 目录不存在时，`loadMarkdownFiles()` 仍会直接调用 ripgrep；虽然调用结果会被当作空列表处理，不阻塞启动，但 debug 日志里会留下无意义的 `rg error`。

### 本轮真实修复

- `src/utils/markdownConfigLoader.ts` 在调用 ripgrep 或 native markdown walker 前先检查目标路径是否是可访问目录。
- 缺失、不可访问、路径组件不是目录或 symlink 循环等预期文件系统状态直接返回空列表，不再启动 ripgrep。
- 目录存在时仍使用原有 ripgrep/native 搜索；目录在预检后消失的 TOCTOU 情况继续由原 catch 处理。
- `src/utils/ripgrep.ts` 的系统 ripgrep fallback 增加直接 `rg --version` 探测；当 `where.exe rg` 找不到但 Node spawn 能正常执行 `rg` 时，不再误回退到缺失的临时 vendor 路径。
- `scripts/test-build-safety.mjs` 的 skill-search 工具池 snippet 改为先 `enableConfigs()` 再动态导入工具池，避免测试环境在允许读取配置前触发默认模型配置读取。
- `scripts/test-build-safety.mjs` 增加源码级防退化断言，避免以后删掉目录预检后重新引入启动期 `rg error` 噪声。

### 本轮 mock/stub/风险说明

- 这不是命令、agent、skill 或 output style 功能恢复，只是避免对明确不存在的目录做无意义搜索。
- 对存在目录的搜索语义不变，仍受当前 ripgrep/native walker 的性能和平台行为影响。

### 本轮验证结果

```text
npm run check
npm run build
npm run test:build-safety
npm run test:cli-e2e
node scripts/audit-features.mjs
git diff --check
```

结果：

- `npm run check` 通过。
- `npm run build` 通过，`build-src/stub-manifest.json` 当前为 `entries: []`。
- `npm run test:build-safety` 通过，当前为 48/48 项；覆盖 feature gate 策略、MCP skill 输入边界、DiscoverSkills 归一化、ripgrep fallback 和 markdown 目录预检。
- `npm run test:cli-e2e` 通过，真实 `dist\cli.js` 子进程主路径、resume、streaming fallback、reactive compact、结构化工具调用和写入工具链回归未受影响。
- `node scripts/audit-features.mjs` 通过，env preservation policy 为 `ok`。
- `git diff --check` 仅报告 Windows 换行提示，没有 whitespace error。

## 2026-06-18 npm dependency audit 收敛

本轮继续处理依赖层风险。`npm audit` 初始结果为 8 项：`esbuild` 低危、`@anthropic-ai/mcpb -> @inquirer/editor -> external-editor -> tmp` 链路中的 `tmp` 高危/低危、以及 `@anthropic-ai/vertex-sdk -> google-auth-library@9 -> gaxios@6 -> uuid@9` 链路中的 moderate。

### 本轮真实修复

- 将 dev dependency `esbuild` 从 `^0.27.4` 升级到 `^0.28.1`，避开 Windows dev server 任意文件读取 advisory 范围。
- 新增 npm `overrides.tmp = ^0.2.6`，把 `external-editor` 间接依赖的旧 `tmp@0.0.33` 提升到当前 0.2.x 修复线；实际解析为 `tmp@0.2.7`。
- 新增 npm `overrides.google-auth-library = $google-auth-library`，让 `@anthropic-ai/vertex-sdk` 复用根项目的 `google-auth-library@10.7.0`，移除旧 `google-auth-library@9` / `gaxios@6` / `uuid@9` 嵌套链。
- 将项目 Node engine 从 `>=18.0.0` 调整为 `>=18.17.0`，并把直接依赖 `undici` 从 `^8.5.0` 收回到 `^6.27.0`，避免本机 Node `22.17.0` 下的 `undici@8` engine warning。
- `scripts/test-build-safety.mjs` 新增锁文件级断言，防止 `esbuild`、`tmp`、`google-auth-library`、`uuid` 或 `undici` 回退到高风险范围；同时新增 `undici` 代理/mTLS API 和 Vertex SDK + GoogleAuth override 构造烟测。

### 本轮 mock/stub/风险说明

- 这不是业务功能恢复。它只收敛 npm 依赖审计风险。
- `@anthropic-ai/mcpb` 和 `@anthropic-ai/vertex-sdk` 上游当前没有可直接升级的新版本；本轮使用 npm override 收敛 transitive 风险，因此需要回归测试确认构建和 CLI 主路径不受影响。
- `undici` 当前使用 6.x 最新修复线并要求 Node `>=18.17`，所以项目 engine 也同步提高到 `>=18.17.0`；这会放弃 Node 18.0-18.16 的声明支持。
- `undici.EnvHttpProxyAgent` 上游仍标记为 experimental；本轮测试锁定当前导出和构造行为，但不能保证未来 `undici` API 不发生变更。

### 本轮验证结果

```text
npm --cache .npm-cache install
npm --cache .npm-cache audit --json
node --check scripts\test-build-safety.mjs
npm ls esbuild tmp external-editor @anthropic-ai/vertex-sdk google-auth-library gaxios uuid undici
npm run check
npm run build
npm run test:build-safety
npm run test:cli-e2e
```

结果：

- `npm audit` 当前为 0 vulnerabilities。
- `npm install` 不再提示 `undici@8` 的 Node engine warning。
- `npm ls` 依赖树无 invalid；`external-editor` 使用 `tmp@0.2.7 overridden`，`@anthropic-ai/vertex-sdk` 复用 `google-auth-library@10.7.0`，`undici` 为 `6.27.0`。
- `esbuild` 当前为 `0.28.1`，项目 Node engine 当前为 `>=18.17.0`。
- `node --check scripts\test-build-safety.mjs` 通过。
- `npm run check`、`npm run build`、`npm run test:build-safety` 和 `npm run test:cli-e2e` 均通过；`test:build-safety` 当前为 51/51 项。

## 2026-06-18 stream-json partial 输出刷新回归

本轮继续处理交互/输出刷新类剩余风险。之前已经在源码和 Ink 组件层确认 streaming preview 不再隐藏未完成行，但真实 CLI E2E 主要覆盖 `--output-format json` 的最终结果，不足以证明 SDK/管道消费者能在 provider 慢速分段输出时及时收到 partial 事件。

### 本轮真实修复

- `scripts/test-cli-resume-e2e.mjs` 新增 delayed SSE fixture：mock server 在同一个文本 block 内分三段发送 `content_block_delta`，并在第一段后延迟继续输出。
- 新增 `runCliStreaming()`，对子进程 stdout 做实时 NDJSON 行解析并记录每条消息的观察时间。
- 新增真实 `dist\cli.js` 子进程场景：`--bare --print --verbose --output-format stream-json --include-partial-messages`。
- 测试断言第一条 partial `content_block_delta` 在最终 `result` 前到达，并且距离进程关闭至少 150ms，避免只在进程退出时一次性 flush。

### 本轮 mock/stub/风险说明

- 这不是完整 REPL 伪终端 E2E。它覆盖的是 headless/SDK `stream-json` 输出刷新路径。
- mock provider 只模拟标准 Anthropic SSE 文本 delta；更复杂的第三方代理事件字段差异仍由现有 out-of-order/fallback 场景和后续专项覆盖。
- 完整交互终端滚动行为仍需要 PTY 级测试；当前仓库没有 `node-pty` 类依赖，本轮未引入新的重型测试依赖。

### 本轮验证结果

```text
node --check scripts\test-cli-resume-e2e.mjs
npm run test:cli-e2e
```

结果：

- `node --check scripts\test-cli-resume-e2e.mjs` 通过。
- `npm run test:cli-e2e` 通过，新增输出 `ok - stream-json partial events flush before final result`。

## 2026-06-18 Edit replace_all / 多匹配 / 新建文件 E2E

本轮继续收口写入工具边界。之前 `Edit` 已覆盖 `Read -> Edit -> final` 主路径、未读拒绝、读后外部修改拒绝和 `disallowedTools` 禁用，但还没有真实 CLI 子进程覆盖 `replace_all`、重复匹配拒绝和 `old_string: ""` 新建文件。

### 本轮真实修复

- `scripts/test-cli-resume-e2e.mjs` 将 mock 的 `Edit` SSE 生成函数扩展为可传入 `replace_all`。
- 新增真实 CLI E2E：`Read -> Edit(replace_all: true) -> final`，确认文件中三个相同 marker 都被替换。
- 新增真实 CLI E2E：`Read -> Edit(default replace_all false) -> final`，当 `old_string` 在文件中重复出现时，CLI 返回 `is_error: true` 的 tool_result，内容提示 `replace_all is false`，文件保持原样。
- 新增真实 CLI E2E：`Edit(old_string: "") -> final`，在 `--tools Edit --permission-mode acceptEdits` 下对不存在路径创建新文件，并发送成功的 `Edit` tool_result。

### 本轮 mock/stub/风险说明

- 这不是 mock 写文件。测试使用真实 `dist\cli.js` 子进程和真实 `Edit` 工具，mock server 只负责模拟 provider 的标准结构化 tool_use SSE。
- 当前已覆盖 UTF-8 文本的 LF 与 CRLF fixture；非 UTF-8、BOM、混合换行和超大文件仍需要后续专项覆盖。

### 本轮验证结果

```text
node --check scripts\test-cli-resume-e2e.mjs
npm run test:cli-e2e
```

结果：

- `node --check scripts\test-cli-resume-e2e.mjs` 通过。
- `npm run test:cli-e2e` 通过，新增输出 `ok - Edit replace_all updates every matching occurrence`、`ok - Edit rejects ambiguous multi-match updates` 和 `ok - Edit creates a new file when old_string is empty`。

## 2026-06-18 Edit CRLF 保留 E2E

本轮继续收口 `Edit` 的文本写回边界。`Edit` 和 `Write` 不同，它会基于原文件内容做局部替换，因此需要确认读取时记录的换行风格会在写回时保留。

### 本轮真实修复

- `scripts/test-cli-resume-e2e.mjs` 新增真实 CLI E2E：`Read(CRLF file) -> Edit(single line) -> final`。
- 测试断言 Read follow-up 能看到原始 marker，Edit follow-up 包含成功 tool_result。
- 测试直接读取 fixture 文件，确认修改后的内容仍与 `editCrlfUpdatedContent` 完全一致，也就是保留 `\r\n`。

### 本轮 mock/stub/风险说明

- 这不是 mock 编辑文件。测试使用真实 `dist\cli.js` 子进程和真实 `Edit` 工具，mock server 只模拟 provider 响应。
- 当前覆盖的是 UTF-8 CRLF 文本、UTF-16LE BOM 文件和 UTF-8 BOM 文件；混合换行保留见后续章节。

### 本轮验证结果

```text
node --check scripts\test-cli-resume-e2e.mjs
npm run test:cli-e2e
```

结果：

- `node --check scripts\test-cli-resume-e2e.mjs` 通过。
- `npm run test:cli-e2e` 通过，新增输出 `ok - Edit preserves CRLF line endings`。

## 2026-06-18 Edit UTF-16LE BOM 保留 E2E

本轮继续收口 `Edit` 的编码边界。源码中 `readFileSyncWithMetadata()` 会识别 `FF FE` 为 `utf16le`，`Edit` 写回时会复用原编码；之前缺少真实 CLI 子进程验证。

### 本轮真实修复

- `scripts/test-cli-resume-e2e.mjs` 新增真实 CLI E2E：`Read(UTF-16LE BOM file) -> Edit(single line) -> final`。
- fixture 使用 `Buffer.from(text, 'utf16le')` 写入，文本开头包含 `\uFEFF`，因此磁盘以 `FF FE` BOM 开头。
- mock server 第二轮判断只依赖 `Read` tool_result 的存在，不依赖 Read 输出里的 marker；这是因为普通 Read 文本路径按 UTF-8 展示 UTF-16LE 文件，不适合作字符串 marker。
- 测试在 Edit 后按 Buffer 检查 `0xff 0xfe` BOM 字节，并用 `toString('utf16le')` 确认内容从 before marker 改成 after marker。

### 本轮 mock/stub/风险说明

- 这不是 mock 编辑文件。测试使用真实 `dist\cli.js` 子进程和真实 `Edit` 工具，mock server 只模拟 provider 的 tool_use。
- 当前覆盖 `Edit` 的 UTF-16LE BOM 保留，后续章节也已覆盖 `Write` 覆盖已有 UTF-16LE BOM 文件、UTF-8 BOM 和混合换行。

### 本轮验证结果

```text
node --check scripts\test-cli-resume-e2e.mjs
npm run test:cli-e2e
```

结果：

- `node --check scripts\test-cli-resume-e2e.mjs` 通过。
- `npm run test:cli-e2e` 通过，新增输出 `ok - Edit preserves UTF-16LE BOM encoding`。

## 2026-06-18 Write CRLF 创建文件 E2E

本轮继续收口写入内容边界。之前 `Write` 已覆盖创建文件、读后覆盖已有文件、未读覆盖拒绝、读后外部修改拒绝和 deny-list 禁用，但还没有确认模型传入 Windows 换行时真实落盘内容是否会被归一化。

### 本轮真实修复

- `scripts/test-cli-resume-e2e.mjs` 新增真实 CLI E2E：`Write(content with \r\n) -> final`。
- 测试使用 `--tools Write --allowedTools Write` 显式启用 Write，mock server 只返回标准结构化 Write tool_use。
- 测试断言 follow-up request 包含成功的 `Write` tool_result，并直接读取 fixture 文件，确认内容与 `writeCrlfContent` 完全一致。

### 本轮 mock/stub/风险说明

- 这不是 mock 写文件。测试使用真实 `dist\cli.js` 子进程和真实 `Write` 工具，mock server 只模拟 provider 响应。
- 本节覆盖的是 UTF-8 字符串中的 CRLF；UTF-16LE BOM、UTF-8 BOM 和混合换行覆盖见后续章节。

### 本轮验证结果

```text
node --check scripts\test-cli-resume-e2e.mjs
npm run test:cli-e2e
```

结果：

- `node --check scripts\test-cli-resume-e2e.mjs` 通过。
- `npm run test:cli-e2e` 通过，新增输出 `ok - Write tool preserves CRLF content when creating a file`。

## 2026-06-18 Write UTF-16LE BOM 覆盖修复

本轮继续收口 `Write` 覆盖已有文件的编码边界。问题是：`FileWriteTool` 会复用旧文件 encoding，但如果旧文件以 BOM 开头、模型传入的新 `content` 不带 BOM，旧实现会把文件写成同编码但无 BOM。对于 UTF-16LE 文件，这会导致后续编码探测无法再识别 `FF FE`。

### 本轮真实修复

- `src/tools/FileWriteTool/FileWriteTool.ts` 新增写回内容规范化：当旧文件内容以 `\uFEFF` 开头，而模型新 content 没有 BOM 时，写盘前补回 `\uFEFF`。
- 写盘、LSP `changeFile`、VSCode diff 通知、`readFileState` 缓存、patch 展示和 tool result data 都统一使用补 BOM 后的实际文件内容，避免状态和磁盘不一致。
- `scripts/test-cli-resume-e2e.mjs` 新增真实 CLI E2E：`Read(UTF-16LE BOM file) -> Write(existing file) -> final`。
- 测试断言覆盖后文件仍以 `0xff 0xfe` 开头，并用 `utf16le` 解码确认内容已更新。

### 本轮 mock/stub/风险说明

- 这不是 mock 写文件。测试使用真实 `dist\cli.js` 子进程和真实 `Write` 工具，mock server 只模拟 provider 的 tool_use。
- 当前覆盖 `Write` 覆盖已有 UTF-16LE BOM 文件；后续章节也已覆盖 UTF-8 BOM 和混合换行。

### 本轮验证结果

```text
npm run check
npm run build
node --check scripts\test-cli-resume-e2e.mjs
npm run test:cli-e2e
```

结果：

- `npm run check` 通过。
- `npm run build` 通过，重新生成 `dist\cli.js`。
- `node --check scripts\test-cli-resume-e2e.mjs` 通过。
- `npm run test:cli-e2e` 通过，新增输出 `ok - Write preserves UTF-16LE BOM encoding`。

## 2026-06-18 UTF-8 BOM 写入保留 E2E

本轮继续收口 BOM 边界。前面已覆盖 UTF-16LE BOM，本轮补齐 UTF-8 BOM，确认 `Edit` 局部修改和 `Write` 覆盖已有文件都不会丢掉 `EF BB BF`。

### 本轮真实修复

- `scripts/test-cli-resume-e2e.mjs` 新增 `Edit` 真实 CLI E2E：`Read(UTF-8 BOM file) -> Edit(single line) -> final`。
- `scripts/test-cli-resume-e2e.mjs` 新增 `Write` 真实 CLI E2E：`Read(UTF-8 BOM file) -> Write(existing file) -> final`。
- 两个用例都按 Buffer 检查文件开头仍是 `0xef 0xbb 0xbf`，并用 UTF-8 解码确认内容已更新。
- `Write` 用例复用本轮 `FileWriteTool` 的通用 BOM 保留逻辑：旧内容以 `\uFEFF` 开头而模型新 content 没带 BOM 时，写盘前补回 BOM。

### 本轮 mock/stub/风险说明

- 这不是 mock 写文件。测试使用真实 `dist\cli.js` 子进程和真实 `Edit` / `Write` 工具，mock server 只模拟 provider 的 tool_use。
- 混合换行和二进制误写边界见后续章节；文件系统权限错误和强杀恢复仍未覆盖。

### 本轮验证结果

```text
node --check scripts\test-cli-resume-e2e.mjs
npm run test:cli-e2e
```

结果：

- `node --check scripts\test-cli-resume-e2e.mjs` 通过。
- `npm run test:cli-e2e` 通过，新增输出 `ok - Edit preserves UTF-8 BOM` 和 `ok - Write preserves UTF-8 BOM`。

## 2026-06-19 混合换行写回保留修复

本轮继续收口文本写回边界。旧实现只记录“CRLF 或 LF”的总体换行风格，`Edit` 写回时会按多数风格重写整文件；如果文件本身同时包含 CRLF 和 LF，局部替换也会把未修改行的换行符统一掉。

### 本轮真实修复

- `src/utils/fileRead.ts` 在读取元数据时保留原始文本，并记录完整文件内是否存在混合换行；既有 `lineEndings` 仍保持 `CRLF | LF`，避免影响其它工具的既有写回判断。
- `src/tools/FileEditTool/FileEditTool.ts` 在混合换行文件上仍用标准化 LF 内容做匹配、diff、stale 检查和 LSP 通知，但写盘前按原文件逐行分隔符重建实际内容，避免局部 Edit 破坏未改行的 CRLF/LF 分布。
- `scripts/test-cli-resume-e2e.mjs` 新增 `Edit` 真实 CLI E2E：`Read(mixed CRLF/LF file) -> Edit(single line) -> final`，断言写回后 CRLF 行和 LF 行仍保持原位置。
- `scripts/test-cli-resume-e2e.mjs` 新增 `Write` 真实 CLI E2E：`Write(content with mixed CRLF/LF) -> final`，确认全量写入会按模型传入 content 原样落盘。

### 本轮 mock/stub/风险说明

- 这不是 mock 写文件。测试使用真实 `dist\cli.js` 子进程和真实 `Edit` / `Write` 工具，mock server 只模拟 provider 的 tool_use。
- `Edit` 的混合换行恢复是逐行分隔符映射：单行替换和不改变行结构的局部替换能保持原分布；如果一次 Edit 大量插入/删除行，新插入行仍会使用 LF 作为默认分隔符。
- 二进制误写边界见后续章节；当前剩余写入风险主要是文件系统权限错误、hook 拒绝、Read/NotebookEdit/PowerShell 等其它 content-specific 规则，以及工具执行中途强杀后的副作用恢复。

### 本轮验证结果

```text
npm run check
npm run build
node --check dist\cli.js
node --check scripts\test-cli-resume-e2e.mjs
npm run test:cli-e2e
npm run test:build-safety
git diff --check
```

结果：

- `npm run check` 通过。
- `npm run build` 通过，重新生成 `dist\cli.js`。
- `node --check dist\cli.js` 通过。
- `node --check scripts\test-cli-resume-e2e.mjs` 通过。
- `npm run test:cli-e2e` 通过，新增输出 `ok - Edit preserves mixed CRLF/LF line endings` 和 `ok - Write tool preserves mixed CRLF/LF content`。
- `npm run test:build-safety` 通过，51/51。
- `git diff --check` 通过，仅提示 Windows 下 LF/CRLF 工作区换行转换警告。

## 2026-06-19 二进制内容 Read 拒绝与 Write 阻断

本轮继续收口二进制误写风险。旧逻辑只按扩展名拒绝明显二进制文件；无扩展或伪装成文本扩展的二进制内容会进入普通文本读取路径，进而可能建立 `readFileState`，让后续 `Write` 覆盖同一路径。

### 本轮真实修复

- `src/tools/FileReadTool/FileReadTool.ts` 在普通文本读取分支前 sniff 文件前 8KB，并复用已有 `isBinaryContent()` 判断内容是否为二进制。
- 图片、PDF、notebook 仍走各自专用路径；带 `FF FE` BOM 的 UTF-16LE 文本不按二进制拒绝，避免破坏现有读后写编码保留路径。
- `scripts/test-cli-resume-e2e.mjs` 新增真实 CLI E2E：`Read(binary file without extension) -> Write(same file) -> final`。
- 测试断言 `Read` 返回 `cannot read binary files` 错误 tool_result；随后模型继续尝试 `Write` 时，因为 `Read` 没有成功写入 `readFileState`，`Write` 返回 `File has not been read yet`；最后按 Buffer 确认原始二进制字节未变化。

### 本轮 mock/stub/风险说明

- 这不是 mock 写文件。测试使用真实 `dist\cli.js` 子进程和真实 `Read` / `Write` 工具，mock server 只模拟 provider 的 tool_use。
- 当前保护覆盖“未知扩展但内容明显为二进制”的普通文本 Read 路径；图片/PDF/notebook 仍由专用读取逻辑处理。
- 带 UTF-16LE BOM 的文本文件为了兼容现有编码保留流程仍允许通过；其它无 BOM UTF-16 文本可能被判为二进制，需要后续如果要完整支持再做专门编码读取。

### 本轮验证结果

```text
npm run check
npm run build
node --check dist\cli.js
node --check scripts\test-cli-resume-e2e.mjs
npm run test:cli-e2e
npm run test:build-safety
git diff --check
```

结果：

- `npm run check` 通过。
- `npm run build` 通过，重新生成 `dist\cli.js`。
- `node --check dist\cli.js` 通过。
- `node --check scripts\test-cli-resume-e2e.mjs` 通过。
- `npm run test:cli-e2e` 通过，新增输出 `ok - Read rejects binary content and Write stays blocked`。
- `npm run test:build-safety` 通过，51/51。
- `git diff --check` 通过，仅提示 Windows 下 LF/CRLF 工作区换行转换警告。

## 2026-06-19 NotebookEdit 超大 notebook 拒绝

本轮继续收口 `NotebookEdit` 的大文件风险。`Read` 默认会限制 notebook 内容大小，但 `NotebookEdit` 自己在 validate/call 中还会重新整本读取并解析 `.ipynb`；如果 Read 后文件被替换成超大合法 JSON 且 mtime 被伪装，旧逻辑仍可能进入整本解析和 file history 路径。

### 本轮真实修复

- `src/tools/NotebookEditTool/NotebookEditTool.ts` 新增 stat 级 notebook size guard，默认复用 `Read` 的 `maxSizeBytes`；validate 阶段在 JSON parse 前返回明确 too-large 错误。
- `NotebookEdit.call()` 也在 `fileHistoryTrackEdit()` 之前做同样的 size guard，避免直接调用绕过 validate 时备份或解析超大 notebook。
- 错误提示包含实际大小、上限大小，并建议只在读取较小 notebook 后编辑，或用 Bash/jq 提取目标 cells。
- `scripts/test-cli-resume-e2e.mjs` 新增真实 CLI E2E：`Read(small notebook) -> replace same path with oversized valid notebook preserving mtime -> NotebookEdit -> final`。
- 测试断言 NotebookEdit 返回 `too large to edit` 错误 tool_result，文件仍保留 oversized marker，并且没有写入模型尝试的新 source。

### 本轮 mock/stub/风险说明

- 这不是 mock 编辑 notebook。测试使用真实 `dist\cli.js` 子进程和真实 `Read` / `NotebookEdit` 工具；mock server 只负责模拟 provider 的 tool_use 和测试用外部文件替换。
- 当前上限跟随 `Read` 的 fileReadingLimits/default maxSizeBytes；如果调用方显式提高 Read 限制，NotebookEdit 的允许大小也会同步提高。
- 这轮覆盖的是“超大 notebook 在 NotebookEdit 解析前被拒绝”；复杂并发编辑、hook 拒绝、Read/NotebookEdit/PowerShell 等其它 content-specific 规则，以及强杀恢复仍是剩余风险。

### 本轮验证结果

```text
npm run check
npm run build
node --check dist\cli.js
node --check scripts\test-cli-resume-e2e.mjs
npm run test:cli-e2e
npm run test:build-safety
git diff --check
```

结果：

- `npm run check` 通过。
- `npm run build` 通过，重新生成 `dist\cli.js`。
- `node --check dist\cli.js` 通过。
- `node --check scripts\test-cli-resume-e2e.mjs` 通过。
- `npm run test:cli-e2e` 通过，新增输出 `ok - NotebookEdit rejects oversized notebooks before parsing`。
- `npm run test:build-safety` 通过，51/51。
- `git diff --check` 通过，仅提示 Windows 下 LF/CRLF 工作区换行转换警告。

## 2026-06-19 managed-only 权限规则启动同步修复

本轮继续收口配置/managed policy 权限风险。旧实现里 `allowManagedPermissionRulesOnly` 的清理逻辑主要存在于 settings 热更新同步路径；启动初始化时会先把 `--allowedTools` / `--disallowedTools` 写入 `cliArg`，再追加磁盘规则，导致 managed-only 策略有机会在启动阶段保留 CLI allow。另一个同类问题是热更新同步只清理 user/project/local 规则，旧的 `policySettings` / `flagSettings` 规则在被删除后可能继续留在内存上下文。

### 本轮真实修复

- `src/utils/permissions/permissionSetup.ts` 的启动初始化改为复用 `syncPermissionRulesFromDisk()`，让启动路径和 settings 热更新路径使用同一套规则替换/清理语义。
- `src/utils/permissions/permissions.ts` 扩展 `syncPermissionRulesFromDisk()`：普通同步会清理所有 settings 来源的旧规则（user/project/local/flag/policy）后再应用新规则；managed-only 模式还会清理所有非 policy 来源（cliArg/command/session/flag/user/project/local）。
- `scripts/test-cli-resume-e2e.mjs` 新增真实 CLI E2E：临时写入 managed settings，启用 `allowManagedPermissionRulesOnly`，同时传入 `--tools Write --allowedTools Write`；mock provider 仍尝试 `Write`，真实 `dist\cli.js` 返回写权限未授予的 `is_error` tool_result，目标文件未创建。
- `scripts/test-build-safety.mjs` 新增模块级回归：直接构造旧权限上下文，验证 `syncPermissionRulesFromDisk()` 会替换 policy/flag 规则并清掉 stale settings-source 规则，同时在普通同步下保留 cliArg/command/session 规则。

### 本轮 mock/stub/风险说明

- 这不是 mock 权限执行。E2E 使用真实 `dist\cli.js` 子进程和真实 `Write` 工具权限链路；mock server 只模拟 provider 的 `tool_use`。
- 当前覆盖的是 managed-only 权限规则对 CLI allow 的启动期压制，以及 settings-source stale rule 清理。user/project settings 工具级 deny、Bash content-specific deny/ask、Write path-specific Edit 规则和直接 Edit path-specific 规则见后续章节；Read/NotebookEdit/PowerShell 等其它 content-specific 规则、交互权限弹窗拒绝、hook 拒绝和强杀恢复仍需要后续覆盖。

### 本轮验证结果

```text
npm run check
npm run build
node --check scripts\test-cli-resume-e2e.mjs
npm run test:cli-e2e
node --check scripts\test-build-safety.mjs
npm run test:build-safety
```

结果：

- `npm run check` 通过。
- `npm run build` 通过，重新生成 `dist\cli.js`。
- `node --check scripts\test-cli-resume-e2e.mjs` 通过。
- `npm run test:cli-e2e` 通过，新增输出 `ok - managed-only permissions ignore CLI Write allow`。
- `node --check scripts\test-build-safety.mjs` 通过。
- `npm run test:build-safety` 通过，52/52。

## 2026-06-19 user settings deny 规则 E2E 覆盖

本轮继续收口配置文件 deny 风险。此前已覆盖 `--disallowedTools` 参数 deny-list 和 managed-only 对 CLI allow 的压制，但还缺普通用户配置文件中的 `permissions.deny` 是否真的进入工具池过滤和运行时错误回传。

### 本轮真实修复

- `scripts/test-cli-resume-e2e.mjs` 新增真实 CLI E2E：为单个子进程创建独立 `CLAUDE_CONFIG_DIR/settings.json`，写入 `{ "permissions": { "deny": ["Write"] } }`。
- 测试仍传入 `--tools Write`，mock provider 仍返回 `Write` tool_use；真实 `dist\cli.js` 会根据 user settings deny 规则把 `Write` 从工具池移除，并对 provider 的 tool_use 回传 `No such tool available: Write`。
- 测试断言目标文件没有被创建，证明配置文件 deny 不只是提示文案，而是真实阻断了写入路径。

### 本轮 mock/stub/风险说明

- 这不是 mock 权限执行。E2E 使用真实 `dist\cli.js` 子进程、真实 settings 加载、真实工具池过滤和真实 tool_result 回传；mock server 只模拟 provider 的 `tool_use`。
- 当前覆盖的是 user settings 的工具级 deny。项目级 `.claude/settings.json`、Bash content-specific deny/ask、Write path-specific Edit 规则和直接 Edit path-specific 规则见后续章节；Read/NotebookEdit/PowerShell 等其它 content-specific 规则和交互权限弹窗拒绝仍需要后续覆盖。

### 本轮验证结果

```text
node --check scripts\test-cli-resume-e2e.mjs
npm run test:cli-e2e
```

结果：

- `node --check scripts\test-cli-resume-e2e.mjs` 通过。
- `npm run test:cli-e2e` 通过，新增输出 `ok - user settings deny removes Write from the tool pool`。

## 2026-06-19 project settings deny 规则 E2E 覆盖

本轮继续补齐配置文件 deny 规则。上一轮覆盖了全局 user settings；本轮验证项目目录里的 `.claude/settings.json` 也会参与真实 CLI 启动时的权限规则加载，并在工具池层移除被 deny 的工具。

### 本轮真实修复

- `scripts/test-cli-resume-e2e.mjs` 的 `runCli()` / `runCliStreaming()` helper 增加可选 `cwd`，默认仍是仓库根目录；只有项目 settings deny 用例切到临时项目目录。
- 新增真实 CLI E2E：创建临时 cwd，写入 `.claude/settings.json`，内容为 `{ "permissions": { "deny": ["Write"] } }`。
- 测试仍传入 `--tools Write`，mock provider 仍返回 `Write` tool_use；真实 `dist\cli.js` 会根据项目 settings deny 规则把 `Write` 从工具池移除，并对 provider 的 tool_use 回传 `No such tool available: Write`。
- 测试断言目标文件没有被创建，证明项目配置 deny 和 user settings deny 一样会真实阻断写入路径。

### 本轮 mock/stub/风险说明

- 这不是 mock 权限执行。E2E 使用真实 `dist\cli.js` 子进程、真实临时 cwd、真实 `.claude/settings.json` 加载、真实工具池过滤和真实 tool_result 回传；mock server 只模拟 provider 的 `tool_use`。
- 当前覆盖的是项目 settings 的工具级 deny。Bash content-specific deny/ask、Write path-specific Edit 规则和直接 Edit path-specific 规则见后续章节；Read/NotebookEdit/PowerShell 等其它 content-specific 规则、交互权限弹窗拒绝和 hook 拒绝仍需要后续覆盖。

### 本轮验证结果

```text
node --check scripts\test-cli-resume-e2e.mjs
npm run test:cli-e2e
```

结果：

- `node --check scripts\test-cli-resume-e2e.mjs` 通过。
- `npm run test:cli-e2e` 通过，新增输出 `ok - project settings deny removes Write from the tool pool`。

## 2026-06-19 Bash content-specific deny/ask 规则 E2E 覆盖

本轮继续补齐权限规则边界。之前已经覆盖 `--disallowedTools`、user settings 工具级 deny、project settings 工具级 deny 和 managed-only 对 CLI allow 的压制；本轮验证“工具仍在工具池里，但具体 Bash 命令命中 `Bash(echo:*)` deny/ask”时，真实 CLI 会在执行前拒绝或要求授权，并把错误作为 `tool_result` 回传给 provider。

### 本轮真实修复

- `scripts/test-cli-resume-e2e.mjs`
  - 新增 `cli bash content-specific deny prompt` 路径，mock provider 返回真实 `Bash` `tool_use`：`echo <marker> > build-src/test-artifacts/cli-bash-content-deny-tool.txt`。
  - 新增临时 `CLAUDE_CONFIG_DIR/settings.json`，配置 `permissions.deny: ["Bash(echo:*)"]`，同时 CLI 参数仍显式 `--allowedTools=Bash`，确保验证的是 content-specific deny 覆盖工具级 allow，而不是工具池移除。
  - 断言 follow-up request 包含 `tool_result`、`is_error: true`、`tool_use_id` 前缀为 `toolu_cli_bash_content_deny_`，内容包含 `Permission to use Bash ... has been denied`，并断言目标文件没有被创建。
  - 新增 `cli bash content-specific ask prompt` 路径，配置 `permissions.ask: ["Bash(echo:*)"]` 且仍传 `--allowedTools=Bash`，断言真实 CLI 在非交互模式下返回 `Claude requested permissions to use Bash, but you haven't granted it yet.`，并且不会创建目标文件。
  - 新增 `cli project bash content-specific deny prompt` 路径，在临时 cwd 的 `.claude/settings.json` 中配置 `permissions.deny: ["Bash(echo:*)"]`，验证项目级 content-specific deny 同样会覆盖 CLI `--allowedTools=Bash`，并且不会在项目 cwd 下写入文件。
  - 将 Bash tool-use SSE 写入函数参数化，复用同一条流式 `input_json_delta` 路径覆盖正向副作用和 deny 场景。

### 本轮 mock/stub/风险说明

- mock server 只模拟 provider 发起 Bash 工具调用；权限加载、`Bash(echo:*)` 匹配、deny 优先级、工具执行前拦截、`tool_result` 回传和磁盘副作用检查都走真实 `dist\cli.js` 子进程。
- 当前覆盖的是 user settings 中的 Bash content-specific deny/ask 覆盖 CLI `--allowedTools=Bash`，以及 project settings 中的 Bash content-specific deny/ask 覆盖 CLI `--allowedTools=Bash`。Write path-specific Edit 规则和直接 Edit path-specific 规则见后续章节；Read/NotebookEdit/PowerShell 等其它 content-specific 规则、交互权限弹窗拒绝和 hook 拒绝仍需要后续覆盖。

### 本轮验证结果

```text
node --check scripts\test-cli-resume-e2e.mjs
npm run test:cli-e2e
```

结果：

- `node --check scripts\test-cli-resume-e2e.mjs` 通过。
- `npm run test:cli-e2e` 通过，新增输出 `ok - Bash content-specific deny blocks a matching command`、`ok - Bash content-specific ask requires approval`、`ok - project Bash content-specific deny blocks a matching command` 和 `ok - project Bash content-specific ask requires approval`。

## 2026-06-19 Write path-specific Edit 规则 E2E 覆盖

本轮继续收窄 content-specific 权限风险。`Write` 工具自身执行写文件，但路径权限复用 `Edit(path)` 规则；如果只覆盖工具级 `Write` deny，无法证明 `Write` 在 CLI allow 后仍会尊重路径级 `Edit(...)` deny/ask。

### 本轮真实修复

- `scripts/test-cli-resume-e2e.mjs`
  - 新增 `cli write content-specific deny prompt`，在临时 user settings 中配置 `permissions.deny: ["Edit(build-src/test-artifacts/cli-write-content-deny-tool.txt)"]`。
  - 新增 `cli write content-specific ask prompt`，在临时 user settings 中配置 `permissions.ask: ["Edit(build-src/test-artifacts/cli-write-content-ask-tool.txt)"]`。
  - 两个用例都显式传 `--tools Write --allowedTools Write`，验证路径级 `Edit(...)` 规则能覆盖 CLI 对 `Write` 的工具级 allow。
  - deny 路径断言真实 CLI 返回 `File is in a directory that is denied by your permission settings`，ask 路径断言返回 `Claude requested permissions to write to ... haven't granted it yet`，并且两个目标文件都不会被创建。

### 本轮 mock/stub/风险说明

- mock server 只模拟 provider 返回标准 `Write` `tool_use`；settings 加载、`Edit(path)` 匹配、`Write` 权限/输入校验、tool_result 回传和磁盘副作用检查都走真实 `dist\cli.js`。
- 当前覆盖的是 `Write` 复用 `Edit(path)` deny/ask 的路径级规则。直接 `Edit(path)`、`Read(path)`、NotebookEdit 复用路径规则、PowerShell 路径抽取规则、交互权限弹窗拒绝和 hook 拒绝仍需后续覆盖。

### 本轮验证结果

```text
node --check scripts\test-cli-resume-e2e.mjs
npm run test:cli-e2e
```

结果：

- `node --check scripts\test-cli-resume-e2e.mjs` 通过。
- `npm run test:cli-e2e` 通过，新增输出 `ok - Write respects Edit path-specific deny rules` 和 `ok - Write respects Edit path-specific ask rules`。

## 2026-06-19 Edit path-specific 规则 E2E 覆盖

本轮继续收窄 content-specific 权限风险。上一轮确认 `Write` 会复用 `Edit(path)` 规则；本轮直接覆盖 `Edit` 工具自身的路径级 deny/ask，确保 CLI 显式 opt-in 或 `acceptEdits` 模式不会绕过路径规则。

### 本轮真实修复

- `scripts/test-cli-resume-e2e.mjs`
  - 新增 `cli edit content-specific deny prompt`，在临时 user settings 中配置 `permissions.deny: ["Edit(build-src/test-artifacts/cli-edit-content-deny-tool.txt)"]`。
  - 新增 `cli edit content-specific ask prompt`，在临时 user settings 中配置 `permissions.ask: ["Edit(build-src/test-artifacts/cli-edit-content-ask-tool.txt)"]`。
  - deny 用例验证已有文件不会被修改；ask 用例使用 `old_string: ""` 的新建文件路径，并在 `acceptEdits` 下运行，确保如果 ask 未命中就会创建文件，从而让断言有真实副作用差异。
  - 断言 deny 路径返回权限设置拒绝错误，ask 路径返回 `Claude requested permissions to write to ... haven't granted it yet`，两个目标路径都保持未写入/未修改。

### 本轮 mock/stub/风险说明

- mock server 只模拟 provider 返回标准 `Edit` `tool_use`；settings 加载、`Edit(path)` 规则匹配、权限/输入校验、tool_result 回传和磁盘副作用检查都走真实 `dist\cli.js`。
- 当前覆盖的是 user settings 中的直接 `Edit(path)` deny/ask。`Read(path)` 见后续章节；NotebookEdit 复用路径规则、PowerShell 路径抽取规则、交互权限弹窗拒绝和 hook 拒绝仍需后续覆盖。

### 本轮验证结果

```text
node --check scripts\test-cli-resume-e2e.mjs
npm run test:cli-e2e
```

结果：

- `node --check scripts\test-cli-resume-e2e.mjs` 通过。
- `npm run test:cli-e2e` 通过，新增输出 `ok - Edit respects path-specific deny rules` 和 `ok - Edit respects path-specific ask rules`。

## 2026-06-19 Read path-specific 规则 E2E 覆盖

本轮继续收窄 content-specific 权限风险。前面已经覆盖 Bash、Write 复用 `Edit(path)`、以及直接 `Edit(path)` 的 deny/ask；本轮补上 `Read(path)`，确保工作区默认可读和 CLI `--allowedTools Read` 都不会绕过显式路径规则。

### 本轮真实修复

- `scripts/test-cli-resume-e2e.mjs`
  - `Read` streaming tool_use helper 支持自定义 `tool_use_id` 前缀，和 `Edit` / `Write` / `NotebookEdit` 的测试 helper 保持一致。
  - 新增 `cli read content-specific deny prompt`，在临时 user settings 中配置 `permissions.deny: ["Read(build-src/test-artifacts/cli-read-content-deny-tool.txt)"]`。
  - 新增 `cli read content-specific ask prompt`，在临时 user settings 中配置 `permissions.ask: ["Read(build-src/test-artifacts/cli-read-content-ask-tool.txt)"]`。
  - 两个用例都显式传 `--tools Read --allowedTools Read`，验证 `Read(path)` deny/ask 会覆盖 CLI 工具级 allow 和工作区默认读权限。
  - deny 路径断言返回 `File is in a directory that is denied by your permission settings`；ask 路径断言返回 `Claude requested permissions to read from ... haven't granted it yet`。两条路径都断言 denied/unapproved 文件内容没有进入 follow-up 请求。

### 本轮 mock/stub/风险说明

- mock server 只模拟 provider 返回标准 `Read` `tool_use`；settings 加载、`Read(path)` 规则匹配、输入校验/权限校验、`tool_result` 回传和文件内容不泄漏断言都走真实 `dist\cli.js`。
- 当前覆盖的是 user settings 中的直接 `Read(path)` deny/ask。NotebookEdit 复用路径规则见后续章节；PowerShell 路径抽取规则、交互权限弹窗拒绝和 hook 拒绝仍需后续覆盖。

### 本轮验证结果

```text
node --check scripts\test-cli-resume-e2e.mjs
npm run test:cli-e2e
```

结果：

- `node --check scripts\test-cli-resume-e2e.mjs` 通过。
- `npm run test:cli-e2e` 通过，新增输出 `ok - Read respects path-specific deny rules` 和 `ok - Read respects path-specific ask rules`。

## 2026-06-19 NotebookEdit path-specific 规则 E2E 覆盖

本轮继续收窄 notebook 写入权限风险。`NotebookEdit` 不是普通文本 `Edit`，但它的写权限链路复用 `Edit(path)` 规则；如果只覆盖 `NotebookEdit` 的 disallowedTools 和未读/stale 保护，仍无法证明路径级 deny/ask 会覆盖 `acceptEdits`。

### 本轮真实修复

- `scripts/test-cli-resume-e2e.mjs`
  - 新增 `cli notebook edit content-specific deny prompt`：mock 先触发真实 `Read` 读取 `.ipynb`，再触发真实 `NotebookEdit`；临时 user settings 配置 `permissions.deny: ["Edit(build-src/test-artifacts/cli-notebook-content-deny-tool.ipynb)"]`。
  - 新增 `cli notebook edit content-specific ask prompt`：同样先 `Read` 再 `NotebookEdit`，临时 user settings 配置 `permissions.ask: ["Edit(build-src/test-artifacts/cli-notebook-content-ask-tool.ipynb)"]`。
  - 两个用例都显式传 `--tools Read,NotebookEdit --allowedTools Read,NotebookEdit --permission-mode acceptEdits`，验证路径规则会覆盖工具级 allow 和 acceptEdits 工作区写入。
  - deny 路径断言返回 `Permission to edit ... has been denied`，ask 路径断言返回 `Claude requested permissions to write to ... haven't granted it yet`；两条路径都断言 notebook cell source 保持原内容。

### 本轮 mock/stub/风险说明

- mock server 只模拟 provider 的 `Read` / `NotebookEdit` `tool_use`；settings 加载、`Edit(path)` 匹配、read-before-write 状态、NotebookEdit 权限拦截、tool_result 回传和磁盘不变断言都走真实 `dist\cli.js`。
- 当前覆盖的是 user settings 中 `NotebookEdit` 复用 `Edit(path)` deny/ask 的路径级规则。PowerShell 路径抽取规则见后续章节；交互权限弹窗拒绝和 hook 拒绝仍需后续覆盖。

### 本轮验证结果

```text
node --check scripts\test-cli-resume-e2e.mjs
npm run test:cli-e2e
```

结果：

- `node --check scripts\test-cli-resume-e2e.mjs` 通过。
- `npm run test:cli-e2e` 通过，新增输出 `ok - NotebookEdit respects Edit path-specific deny rules` 和 `ok - NotebookEdit respects Edit path-specific ask rules`。

## 2026-06-19 PowerShell path-specific ask 规则修复

本轮继续收窄 PowerShell 路径权限风险。`pathValidation.ts` 已能从 `Get-Content` / `Set-Content` 等 cmdlet 抽取文件路径并检查 `Read(...)` / `Edit(...)` deny，但 ask 规则没有在隐式工作区允许和 `acceptEdits` 之前参与判断，导致路径级 ask 可能被绕过。

### 本轮真实修复

- `src/tools/PowerShellTool/pathValidation.ts`
  - `isPathAllowed()` 新增路径级 ask 规则检查，位置在默认工作区读权限、sandbox allow、`acceptEdits` 和 allow 规则之前。
  - 路径检查结果新增 `ruleBehavior`，让上层区分 ask/deny：deny 仍直接返回 `deny`，ask 则进入原有 `firstAsk` 聚合，不再被误当成 deny，也不会落到 passthrough。
  - `validatePath()` 对普通路径、glob traversal 路径、provider/backtick deny 猜测路径透传 `ruleBehavior`，避免 rule 命中在上层丢失行为语义。
- `scripts/test-build-safety.mjs`
  - 新增 build-safety 回归，解析真实 PowerShell AST 后调用 `checkPathConstraints()`。
  - 覆盖 `Get-Content <path>` 命中 `Read(path)` deny/ask，以及 `Set-Content -Path <path>` 命中 `Edit(path)` deny/ask。

### 本轮 mock/stub/风险说明

- 这不是 mock parser。测试使用真实 PowerShell parser 输出的 AST，再走真实 `checkPathConstraints()`；不执行 PowerShell 命令，因此没有文件写入副作用。
- 当前覆盖的是 PowerShell 静态路径抽取后的 `Read(path)` / `Edit(path)` deny/ask 优先级。交互权限弹窗拒绝、hook 拒绝、复杂 provider/runtime 动态路径仍需后续覆盖。

### 本轮验证结果

```text
npm run check
npm run build
node --check scripts\test-build-safety.mjs
npm run test:build-safety
```

结果：

- `npm run check` 通过。
- `npm run build` 通过，重新生成 `build-src` / `dist\cli.js` 用于 build-safety 验证。
- `node --check scripts\test-build-safety.mjs` 通过。
- `npm run test:build-safety` 通过，新增输出 `ok - PowerShell path constraints respect path-specific ask rules`。

## 2026-06-18 NotebookEdit 损坏 JSON 拒绝 E2E

本轮继续收口 notebook 写入边界。之前 `NotebookEdit` 已覆盖 replace、insert/delete、缺失 cell、未读拒绝、读后外部修改拒绝、deny-list 禁用和 `cell-N` markdown replace，但还没有覆盖 notebook 内容损坏时的解析错误。

### 本轮真实修复

- `scripts/test-cli-resume-e2e.mjs` 新增真实 CLI E2E：`Read(valid notebook) -> NotebookEdit(after notebook is corrupted) -> final`。
- mock server 在 Read follow-up 到达后，把同一个 `.ipynb` fixture 改成非法 JSON，并把 mtime 调回 Read 时刻，确保测试触发 NotebookEdit 的 JSON 校验，而不是 stale-write 保护。
- 测试断言 follow-up request 包含 `is_error: true` 的 `NotebookEdit` tool_result，内容包含 `Notebook is not valid JSON.`。
- 测试断言磁盘文件保持损坏 JSON 内容不变，证明拒绝路径没有继续写盘。

### 本轮 mock/stub/风险说明

- 这不是 mock 编辑 notebook。测试使用真实 `dist\cli.js` 子进程和真实 `NotebookEdit` 工具，mock server 只负责模拟 provider 的 tool_use。
- 当前覆盖的是小型非法 JSON 文件；超大 notebook 拒绝见后续章节，复杂并发编辑、hook 拒绝和 Read/NotebookEdit/PowerShell 等其它 content-specific 规则仍未覆盖。

### 本轮验证结果

```text
node --check scripts\test-cli-resume-e2e.mjs
npm run test:cli-e2e
```

结果：

- `node --check scripts\test-cli-resume-e2e.mjs` 通过。
- `npm run test:cli-e2e` 通过，新增输出 `ok - NotebookEdit rejects corrupted notebook JSON`。

## 当前风险边界

当前产物适合验证 CLI 主路径、模型调用、基础项目读取、非交互任务、显式 `--dump-system-prompt` 快速路径、高可用 History Snip 路径，以及 Snip 后 resume/transcript 读写侧、恢复入口和 compact+Snip 叠加恢复一致性。

不要把它理解为完整恢复的官方 Bun 编译产物。内部实验功能、Chrome MCP、Tungsten、Workflow、部分 SDK generated 类型、语音、图片 native 处理、deep link 等路径仍然可能不可用或只提供 stub / external-conservative 实现。当前 `build-src/stub-manifest.json` 已为 0 项，但这只代表不再由构建脚本生成缺失模块 stub，不代表内部能力都已恢复。Chrome MCP 已不再是 private-package-stub，但仍只是空工具外部保守 shim。`MCP_SKILLS` 已不再是缺失实现，但当前只支持 `skill://` text resources 到 prompt command 的外部路径，不代表恢复完整内部 MCP skill 分发。`EXPERIMENTAL_SKILL_SEARCH` 已不再是缺失实现，但当前只是本地/MCP prompt skill 的 keyword discovery 和 `DiscoverSkills` 工具，不代表恢复官方 AKI/GCS remote skill marketplace、canonical skill 下载或语义向量检索。`REACTIVE_COMPACT` 已不再是缺失实现，但当前只是基于现有 `compactConversation()` 的 prompt-too-long/media-size 后置恢复路径，不代表恢复官方内部 reactive compact 实验或所有上下文压缩策略。VerifyPlanExecution 已不再是缺失模块，但仍只是外部保守版，不是官方后台 verifier。`protectedNamespace` 也已不再是缺失模块，但它是保守外部实现，不包含 Anthropic 内部完整 namespace allowlist。`AntModelSwitchCallout` 和 `UndercoverAutoCallout` 已不再是缺失模块，但只是 ant-only UI 的外部保守实现，不代表恢复内部模型迁移或仓库隐私策略。`ink/devtools`、`TungstenTool`、`useFrustrationDetection` 和 `useAntOrgWarningNotification` 也已不再是缺失模块或变量路径运行期缺口，但它们只是 no-op / unavailable 外部保守实现。`REPLTool`、`SuggestBackgroundPRTool` 和 `agents-platform` 已不再是生成 stub，但仍只是默认禁用的 external-conservative 实现。`UserGitHubWebhookMessage`、`UserForkBoilerplateMessage` 和 `UserCrossSessionMessage` 也只是外部保守摘要渲染，不代表恢复 GitHub webhook、fork 子会话或 UDS inbox 的完整内部体验。

ContextCollapse 的当前风险要单独看待：它已不再是纯缺失模块，但仍不是官方完整长上下文压缩系统。它现在的价值是让相关代码路径可构建、可加载、可诊断，并且不会默认破坏 AutoCompact；它还不能替代真实 ctx-agent、摘要提交或官方投影恢复逻辑。

Reactive Compact 的当前风险也要单独看待：它已不再是纯 `.d.ts` 占位或被构建期关闭，可以在真实 CLI 子进程里处理 prompt-too-long 后的 compact-and-retry；但它仍复用传统 `compactConversation()`，没有恢复官方内部 reactive compact 的实验分桶、语义裁剪策略或复杂 token-gap 选择。它是后置恢复兜底，不是替代 AutoCompact、History Snip 或 ContextCollapse 的统一上下文管理器。

History Snip 的当前风险也要单独看待：它已不再是完全关闭、stub 或简单保守前缀裁剪，而是高可用外部版。它可以按安全 turn 分段删除、按目标 token 收敛、按目标 ID 删除完整安全 turn，并在后续模型视图中投影清理旧消息；但它仍不做官方语义评分、模型摘要、任意单消息精确点删或复杂跨轮调度。

Resume/transcript 的当前风险：本轮已覆盖 Snip 多段删除后的 JSONL 读侧恢复、`loadConversationForResume(..., jsonlPath)` / `loadTranscriptFromFile()` 恢复入口、`loadConversationForResume(sessionId, undefined)` / `loadConversationForResume(undefined, undefined)` session 恢复入口、compact preservedSegment 与 Snip 删除叠加恢复、`recordTranscript()` 写侧重复持久化、boundary 接链和 tail 接链，以及真实 `dist/cli.js` 子进程在本地 Anthropic-compatible mock server 下的 `-p` / `--resume <session-id>` / `--continue` 三段恢复。第三方代理把工具调用泄漏成普通文本的场景已能识别并返回明确错误，但仍不会自动转换为真实工具调用。结构化工具调用已覆盖标准 `tool_use(Read)`、多段 `input_json_delta`、stop reason 错报为 `end_turn`、缺失 `content_block_stop` 但 stream 正常结束、同一 assistant response 内两个 Read `tool_use` 交错 delta/反向 stop、simple 主路径中的 assistant 文本 + Read + Bash 混合工具 block、同一 assistant response 内三个工具 block 交错、显式授权下的副作用型 Bash、Bash content-specific deny/ask、project Bash content-specific deny/ask、simple 主路径中的 `Read -> Edit -> final` 写入工具链、Edit 未读直接拒绝、Edit 读后外部修改拒绝、Edit deny-list 禁用、Edit path-specific deny/ask、Edit `replace_all: true` 全量替换、Edit 多匹配默认拒绝、Edit `old_string: ""` 创建新文件、Edit CRLF 保留、Edit 混合 CRLF/LF 保留、Edit UTF-16LE BOM 保留、Edit UTF-8 BOM 保留、bare/simple 显式 `Write` 创建文件路径、Write CRLF 创建文件路径、Write 混合 CRLF/LF 创建文件路径、bare/simple 显式 `Read -> Write(existing file) -> final` 覆盖已有文件路径、Write UTF-16LE BOM 覆盖、Write UTF-8 BOM 覆盖、Write 未读直接覆盖拒绝、Write 读后外部修改拒绝、Write deny-list 禁用、Write path-specific Edit deny/ask、user settings Write deny、project settings Write deny、managed-only 权限规则忽略 CLI Write allow、bare/simple 显式 `Read -> NotebookEdit(replace) -> final` notebook 替换 cell 路径、NotebookEdit `insert -> delete` 路径、NotebookEdit 缺失 cell 拒绝路径、NotebookEdit 损坏 JSON 拒绝路径、NotebookEdit 超大文件拒绝路径、NotebookEdit 未读直接编辑拒绝、NotebookEdit 读后外部修改拒绝、NotebookEdit deny-list 禁用，以及 NotebookEdit `cell-N` markdown replace。Streaming 损坏恢复已覆盖 `content_block_delta` 早于 `content_block_start` 时切换到 non-streaming fallback 的路径。进程中断读侧恢复已覆盖尾部只有 user、尾部孤立 `tool_use` 两种场景。仍未覆盖的风险是：真实外部 provider 网络、更复杂的第三方代理 streaming 事件字段差异、更大规模多工具并发、交互权限弹窗拒绝、hook 拒绝、Read/NotebookEdit/PowerShell 等其它 content-specific 规则、非 simple 全量工具池的复杂混合、工具执行过程中产生部分副作用后被强杀的幂等性，以及跨 provider streaming 中断恢复。

补充：`Read(path)` user settings deny/ask、`NotebookEdit` 复用 `Edit(path)` deny/ask、以及 PowerShell 静态路径抽取后的 `Read(path)` / `Edit(path)` deny/ask 优先级已在后续 2026-06-19 章节覆盖；当前剩余的 content-specific 权限风险主要收敛为交互权限弹窗拒绝、hook 拒绝和复杂 provider/runtime 动态路径。

NotebookEdit 大文件保护的当前风险：`NotebookEdit` 现在会在解析 JSON 和 file history 之前按 `Read` 的 size limit 做 stat 级拒绝；真实 CLI E2E 已覆盖 Read 成功后 notebook 被替换成 oversized 合法 JSON 且 mtime 保持不变时，NotebookEdit 返回 too-large 错误并保持文件不变。复杂并发编辑、hook 拒绝、复杂 provider/runtime 动态路径、强杀恢复仍需后续覆盖。

二进制写入保护的当前风险：普通文本 `Read` 现在会对未知扩展文件做内容 sniff，明显二进制内容会被拒绝，并且不会建立后续 `Write` 覆盖资格；真实 CLI E2E 已覆盖无扩展二进制文件的 `Read` 拒绝、同路径 `Write` 继续被读后写保护拒绝，以及原始字节不变。带 UTF-16LE BOM 的文本为兼容现有编码保留流程仍允许通过；其它无 BOM 多字节文本如果被误判为二进制，需要后续专门编码读取支持。

交互 UI 的当前风险：真实用户长任务里观察到过“内容已经产生但终端没有立即刷新，按 Enter 后才显示后续总结”的现象。本轮已修复两个高概率触发点：streaming preview 不再隐藏未完成行，assistant/streaming 更新会在用户未主动滚动时保持 live 区域可见。当前验证已包含源码/构建级回归、真实 `Messages`/Ink 组件渲染回归，以及真实 `dist\cli.js` 子进程的 `stream-json --include-partial-messages` delayed SSE partial flush 回归；完整 REPL 伪终端 E2E 和真实终端滚动行为仍需要后续单独补。

## 2026-06-19 PreToolUse hook denial E2E coverage

This round closes one remaining permission-path risk: user configured
`PreToolUse` hooks must be able to reject a tool call even when the CLI
arguments allow that tool.

### Real coverage added

- `scripts/test-cli-resume-e2e.mjs`
  - Adds `cli write pretooluse hook deny prompt`.
  - Adds a mock HTTP hook endpoint at `/hook/pretooluse-block-write`.
  - Creates a temporary `settings.json` with `hooks.PreToolUse` matching
    `Write` and returning `{"decision":"block","reason":...}`.
  - Runs real non-bare `dist/cli.js` with `--tools Write --allowedTools Write`.
  - Deletes `CLAUDE_CODE_SIMPLE` for this scenario because simple mode and
    `--bare` intentionally skip hooks.
  - Asserts the hook endpoint is called once, the follow-up `tool_result` is
    `is_error: true` and includes the hook reason, and the blocked file is not
    created.
  - Adds a second HTTP hook scenario returning `{"decision":"approve"}` while
    user settings ask `Edit(path)` for the same Write target.
  - Asserts the approving hook is called, but the settings ask rule still wins
    and the target file is not created.

### Verification

```text
node --check scripts\test-cli-resume-e2e.mjs
npm run test:cli-e2e
```

Expected new output:

```text
ok - Write respects PreToolUse hook denial
ok - Write hook approval does not bypass ask rules
```

## 2026-06-19 PreToolUse allow deny override build-safety coverage

CLI E2E cannot express every deny override after a PreToolUse approval because
some denies happen before hooks run, for example Write `validateInput` rejects
path-level `Edit(path)` deny rules before PreToolUse. This round adds a direct
build-safety regression for the shared resolver.

- `scripts/test-build-safety.mjs`
  - Imports real `resolveHookPermissionDecision` from `src/services/tools`.
  - Asserts hook `behavior: "allow"` is still overridden by a tool-wide deny
    rule.
  - Asserts hook `behavior: "allow"` is still overridden by a tool-specific
    deny returned from `checkPermissions`.
  - Asserts the denial path does not call `canUseTool`.

Verification:

```text
node --check scripts\test-build-safety.mjs
npm run test:build-safety
```

Expected new output:

```text
ok - PreToolUse hook allow does not bypass deny rules
```

## 2026-06-19 PermissionRequest headless hook build-safety coverage

This round narrows the remaining hook-permission risk. `PreToolUse` hook
denial and approval/ask ordering are covered by real CLI E2E, and the shared
PreToolUse allow resolver is covered at build-safety level. The new coverage
adds the adjacent headless prompt path used by async/background agents that
cannot show an interactive permission dialog.

- `scripts/test-build-safety.mjs`
  - Imports real `hasPermissionsToUseTool` and registered hook plumbing.
  - Runs with `toolPermissionContext.shouldAvoidPermissionPrompts = true`.
  - Asserts the no-hook path still auto-denies with an `asyncAgent` decision.
  - Registers a real `PermissionRequest` callback hook for `Write`.
  - Asserts hook deny wins over the headless auto-deny fallback and preserves
    the hook message.
  - Asserts hook allow wins over the headless auto-deny fallback and preserves
    `updatedInput`.

Risk boundary update: the broad "hook refusal" gap is now reduced to uncovered
interactive PermissionRequest UI flows, command-hook exit-code behavior, other
tool families beyond `Write`, and larger mixed-tool/concurrency combinations.

Verification:

```text
node --check scripts\test-build-safety.mjs
npm run test:build-safety
```

Expected new output:

```text
ok - PermissionRequest hooks decide headless permission prompts
```

## 2026-06-19 PreToolUse command hook exit-2 E2E coverage

This round covers the command-hook branch of the remaining hook-denial risk.
The earlier E2E used an HTTP hook returning a structured block decision; this
new scenario validates the legacy hook protocol where a command exits with
status code 2 and writes the denial reason to stderr.

- `scripts/test-cli-resume-e2e.mjs`
  - Adds `cli write pretooluse command hook exit two prompt`.
  - Creates a temporary `settings.json` with `hooks.PreToolUse` matching
    `Write` and a `type: "command"` hook using `shell: "powershell"`.
  - The hook writes a marker to stderr and exits with code 2.
  - Runs real non-bare `dist/cli.js` with `--tools Write --allowedTools Write`.
  - Asserts the follow-up `tool_result` is `is_error: true`, includes the
    `PreToolUse:Write hook error` wrapper and command-hook marker, and the
    blocked file is not created.

Risk boundary update: PreToolUse denial is now covered for both structured
HTTP hook output and command exit-code-2 output. Remaining hook gaps are mainly
interactive PermissionRequest UI, non-Write tool families, and larger
mixed-tool/concurrency cases.

Verification:

```text
node --check scripts\test-cli-resume-e2e.mjs
npm run test:cli-e2e
```

Expected new output:

```text
ok - Write respects PreToolUse command hook exit 2 denial
```

## 2026-06-19 Bash PreToolUse command hook denial E2E coverage

This round extends command-hook denial coverage beyond file-write tools. The
new E2E validates that a `PreToolUse:Bash` command hook exiting with status 2
blocks a side-effecting Bash tool call before it can write to disk.

- `scripts/test-cli-resume-e2e.mjs`
  - Adds `cli bash pretooluse command hook exit two prompt`.
  - Uses a real non-bare `dist/cli.js` subprocess with `--tools Bash` and
    `--allowedTools Bash`.
  - Creates a temporary `settings.json` with `hooks.PreToolUse` matching
    `Bash` and a `type: "command"` PowerShell hook.
  - The hook writes a marker to stderr and exits with code 2.
  - Asserts the follow-up `tool_result` is `is_error: true`, includes the
    `PreToolUse:Bash hook error` wrapper and command-hook marker, and the
    Bash target file is not created.

Risk boundary update: command exit-code-2 hook denial is now covered for both
`Write` and `Bash`. Remaining hook gaps are mainly interactive
PermissionRequest UI, other tool families, and larger mixed-tool/concurrency
cases.

Verification:

```text
node --check scripts\test-cli-resume-e2e.mjs
npm run test:cli-e2e
```

Expected new output:

```text
ok - Bash respects PreToolUse command hook exit 2 denial
```

## 2026-06-19 PostToolUseFailure hook context build-safety coverage

This round covers a different hook lifecycle: hooks that run after a tool call
fails. The new build-safety test validates that the real registered hook
plumbing receives the failed tool metadata and that service-layer wrapping
preserves hook-provided additional context for the next model turn.

- `scripts/test-build-safety.mjs`
  - Imports real `runPostToolUseFailureHooks`.
  - Registers a callback hook for `PostToolUseFailure` matching `Read`.
  - Asserts the hook input includes the event name, tool name, tool use id,
    original tool input, failure message, and interrupt flag.
  - Asserts `additionalContext` from the hook is emitted as a
    `hook_additional_context` attachment with `PostToolUseFailure:Read`.

Risk boundary update: post-failure hook context propagation now has direct
build-safety coverage. Remaining hook gaps are mainly full CLI E2E for
PostToolUse/PostToolUseFailure side effects, interactive PermissionRequest UI,
and larger mixed-tool/concurrency cases.

Verification:

```text
node --check scripts\test-build-safety.mjs
npm run test:build-safety
```

Expected new output:

```text
ok - PostToolUseFailure hooks attach additional context
```

## 2026-06-19 PostToolUse MCP output hook build-safety coverage

This round covers the successful post-tool hook path. The new build-safety test
validates that `PostToolUse` hooks receive the original tool response, can add
context for the next model turn, and can rewrite MCP tool output when the tool
is MCP-backed.

- `scripts/test-build-safety.mjs`
  - Imports real `runPostToolUseHooks`.
  - Registers a callback hook for `PostToolUse` matching an MCP-style tool.
  - Asserts the hook input includes event name, tool name, tool use id,
    original tool input, and original tool response.
  - Asserts hook `additionalContext` is emitted as a `PostToolUse` attachment.
  - Asserts hook `updatedMCPToolOutput` is yielded for the MCP tool and
    preserves both text content and structured content.

Risk boundary update: both successful and failed post-tool hook context paths
now have direct build-safety coverage. Remaining hook gaps are mainly full CLI
E2E for post-tool hook side effects, interactive PermissionRequest UI, and
larger mixed-tool/concurrency cases.

Verification:

```text
node --check scripts\test-build-safety.mjs
npm run test:build-safety
```

Expected new output:

```text
ok - PostToolUse hooks can update MCP output
```
