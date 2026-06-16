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
   - **混合**：当前例外保留 `CONTEXT_COLLAPSE`，但运行时实现为保守外部版，不等同于官方完整 ContextCollapse。
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
| `scripts/build.mjs` 的 `feature(...)` 替换 | 混合 | 默认关闭 gated 代码；当前选择性保留 `CONTEXT_COLLAPSE`，其它内部 gate 仍按外部构建关闭。 |
| `scripts/build.mjs` 的 `MACRO.*` 替换 | 尝试修复/真实适配 | 用确定字符串替代 Bun 编译期 define。 |
| `scripts/build.mjs` 自动生成缺失模块 | mock/stub/降级 | 生成 fail-fast stub，并写入 `build-src/stub-manifest.json`；不恢复内部功能。 |
| `@ant/claude-for-chrome-mcp` alias | mock/stub/降级 | 空 browser tools；server 创建时 fail-fast。 |
| `color-diff-napi` alias 到 `src/native-ts/color-diff` | 尝试修复/真实适配 | 使用已有 TS port 替代 native 包；其中 `BAT_THEME` 支持仍是降级。 |
| `src/native-ts/file-index` | 尝试修复/真实适配 | 使用已有 TS fuzzy index 替代 Rust NAPI 搜索模块。 |
| `src/native-ts/yoga-layout` | 尝试修复/真实适配 | 使用已有 TS flex layout 实现覆盖 Ink 实际使用的布局子集。 |
| `stubs/bun-ffi.ts` | mock/stub/降级 | 空 FFI 占位，不提供真实 `dlopen` 或 native symbol 调用。 |
| `src/main.tsx` Commander 参数修改 | 尝试修复/真实适配 | 修复启动时参数定义不兼容导致的崩溃。 |
| `scripts/prepare-src.mjs` 隔离输出 | 尝试修复/真实适配 | 避免准备阶段直接修改 `src/` 和根目录 `stubs/`。 |
| `openspec/templates/verification-report.html` | 尝试修复/真实适配 | 实现验证与后置清理拆分、字段规范化、筛选和搜索。 |
| `audio-capture-napi` / `image-processor-napi` / `modifiers-napi` / `url-handler-napi` | 混合 | 构建时 external 保留；新增统一可选 native loader，缺失时走 fallback 或返回明确不可用状态。 |
| `scripts/test-build-safety.mjs` | 尝试修复/真实适配 | 新增可重复的深度回归测试，覆盖 stub manifest、fail-fast、native fallback、deep link 和 CLI smoke。 |
| `src/services/contextCollapse/*` | 混合 | 替换原 `.d.ts` 占位，提供可加载的保守外部运行时；不做真实摘要、投影删除或 ctx-agent 调度。 |
| `src/tools/CtxInspectTool/CtxInspectTool.ts` | 混合 | 补齐工具加载路径和只读检查输出；默认隐藏，仅显式设置 collapse 环境变量时启用。 |

## 尝试修复/真实适配

这些部分是当前分支实际可用的实现或构建适配：

- Node/esbuild 构建流程。
- Bun 宏和 feature gate 的构建期转换。
- CLI 入口 bundle。
- `--version`、`--help`、`auth status`、`-p` 非交互调用。
- 已存在的纯 TypeScript native 替代实现会被构建使用，例如 `src/native-ts/color-diff`、`src/native-ts/file-index`、`src/native-ts/yoga-layout`。
- 验证报告模板的数据校验、过滤、搜索和后置清理逻辑。

## mock/stub/降级

这些部分不是完整官方实现：

- `feature('...')` 默认替换为 `false`，等价于关闭内部 feature gate；当前只选择性保留 `CONTEXT_COLLAPSE`。
- `stubs/bun-ffi.ts` 只是空 stub，不提供真实 FFI。
- `@ant/claude-for-chrome-mcp` 在构建副本中生成为空 browser tools；server 创建时会 fail-fast。
- 一批 feature-gated 内部模块会在 `build-src/` 中生成 fail-fast stub，并记录到 `build-src/stub-manifest.json`，例如：
  - `assistant/AssistantSessionChooser`
  - `commands/agents-platform`
  - `entrypoints/sdk/*Types`
  - `ink/devtools`
  - `tools/WorkflowTool`
  - `tools/VerifyPlanExecutionTool`
  - `tools/TungstenTool`
  - `tools/REPLTool`
  - `tools/SuggestBackgroundPRTool`
  - `services/compact/*`
- `src/services/contextCollapse/*` 已从纯 `.d.ts` 占位改成可加载运行时，但仍是保守降级实现：
  - 不生成摘要。
  - 不把历史消息投影成 `<collapsed id="...">` 占位。
  - 不启动或调度官方 ctx-agent。
  - 默认不接管 AutoCompact/ReactiveCompact，避免假启用后压制真实可用的压缩路径。
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
```

这能让外部主路径继续构建。注意：`CONTEXT_COLLAPSE` 只是被保留进 bundle，运行时仍由 `CLAUDE_CONTEXT_COLLAPSE` / `CLAUDE_CODE_CONTEXT_COLLAPSE` 和已恢复状态共同控制；其它 gated 内部能力默认关闭。

## 实际风险说明

构建成功不代表完整复原官方 Claude Code。本分支的核心风险是：部分代码只是让 import、bundle 或主路径运行成功，真实功能并不存在或不完整。

1. feature gate 替换仍是最大风险

   除当前选择性保留的 `CONTEXT_COLLAPSE` 外，这仍会关闭大量内部或实验功能，例如：

   ```text
   KAIROS
   BG_SESSIONS
   CACHED_MICROCOMPACT
   HISTORY_SNIP
   VOICE_MODE
   BASH_CLASSIFIER
   TRANSCRIPT_CLASSIFIER
   WORKFLOW_SCRIPTS
   CHICAGO_MCP
   BRIDGE_MODE
   ```

   可能影响：

   - 后台任务、KAIROS、主动模式、部分远程/桥接能力不可用。
   - 历史裁剪、cached microcompact 等高级长上下文能力仍缺失。
   - `CONTEXT_COLLAPSE` 虽已可加载，但不是官方完整实现。
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
- 当时 `feature('...') -> false` 的策略没有变化，内部 feature-gated 能力仍默认关闭；后续已对 `CONTEXT_COLLAPSE` 做选择性保留，见下一节。
- 当前构建仍会生成 fail-fast stub，并记录到 `build-src/stub-manifest.json`；这些 stub 是明确失败边界，不是功能恢复。
- `build-src/stub-manifest.json` 当前显示：15 个 missing modules、0 个 missing exports、14 个生成 stub。

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
- 构建层选择性保留 `CONTEXT_COLLAPSE`，其它 feature gate 仍默认关闭。
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
npm run build
npm start -- --version
node dist\cli.js --help
node dist\cli.js doctor --help
node dist\cli.js -p "<prompt>" --max-turns 1 --model <model>
npm run test:build-safety
$env:CLAUDE_CONTEXT_COLLAPSE='1'; node dist\cli.js --version
node --check dist\cli.js
build-src/stub-manifest.json 生成
fail-fast stub 默认导出和命名导出行为
fail-fast stub 调用、构造、取属性和数值转换行为
ContextCollapse 默认关闭、显式 opt-in、恢复状态和 CtxInspectTool 加载
modifiers-napi 缺失 fallback
image-processor-napi 缺失时 sharp fallback
audio-capture-napi 缺失时语音依赖检查 fallback
url-handler-napi 缺失由 nativeOptional 包装
```

版本输出：

```text
2.1.88 (Claude Code)
```

`npm run test:build-safety` 当前覆盖 17 项深度检查：

- 构建输出、`build-src/stub-manifest.json` 和当前实际 stub 类型记录。
- 默认导出和存在时的缺失命名导出 fail-fast 行为，包括调用、构造、解引用和 primitive coercion。
- lazy tool export loader 对 default-only fail-fast stub 的回退行为。
- `CONTEXT_COLLAPSE` 在构建副本中被保留，但 prompt-too-long 兜底仍受 runtime gate 控制。
- ContextCollapse 外部运行时默认关闭、projection no-op、恢复元数据、显式 opt-in 和 prompt-too-long withholding 行为。
- `CtxInspectTool` 加载、默认隐藏、显式启用和工具结果序列化。
- 构建副本中不再存在 `export const X = undefined` 静默导出。
- `@ant/claude-for-chrome-mcp` 私有包 stub 的空工具列表和 server 创建时报错。
- `nativeOptional` 对缺失 native 包的统一错误包装。
- `modifiers-napi`、`image-processor-napi`、`audio-capture-napi`、`url-handler-napi` 相关 fallback 或保护路径。
- deep link 合法输入、非法 repo、控制字符和超长输入。
- `dist/cli.js --version`、`--help`、`doctor --help` 和 `node --check`。

还通过配置好的 Anthropic-compatible 代理完成过真实 `-p` 任务和一组纯推理 smoke test。该代理配置没有写入仓库。

## 当前风险边界

当前产物适合验证 CLI 主路径、模型调用、基础项目读取和非交互任务。

不要把它理解为完整恢复的官方 Bun 编译产物。内部实验功能、Chrome MCP、Tungsten、Workflow、VerifyPlanExecution、部分 SDK generated 类型、语音、图片 native 处理、deep link 等路径仍然可能不可用或只提供 stub。

ContextCollapse 的当前风险要单独看待：它已不再是纯缺失模块，但仍不是官方完整长上下文压缩系统。它现在的价值是让相关代码路径可构建、可加载、可诊断，并且不会默认破坏 AutoCompact；它还不能替代 Snip、真实 ctx-agent、摘要提交或官方投影恢复逻辑。
