# 本次修改说明

本文记录 `build-safety-isolation` 分支中本次改动的范围、构建方式、已验证内容，以及哪些部分仍然只是 stub 或降级实现。

## 修改目标

这个仓库的 `src/` 来自 `@anthropic-ai/claude-code` 2.1.88 的反解包源码。原始源码依赖 Anthropic 内部 Bun 构建链、编译期宏、feature gate 和若干未发布模块，不能直接用 Node/npm 构建。

本次修改的目标是提供一个可复现的 Node/esbuild 构建路径，让当前源码能生成可启动的 `dist/cli.js`，并明确记录缺失功能的处理边界。

## 修改了什么

1. 构建入口改为 Node/esbuild

   - `package.json` 的 `build` 改为直接执行 `node scripts/build.mjs`。
   - `scripts/build.mjs` 复制 `src/` 到 `build-src/` 后再做转换，避免直接修改原始源码。
   - 构建输出为 `dist/cli.js`。

2. 处理 Bun 编译期能力

   - 将 `feature('...')` 在构建副本中替换为 `false`。
   - 将 `MACRO.VERSION`、`MACRO.PACKAGE_URL`、`MACRO.ISSUES_EXPLAINER_URL` 等宏替换为字符串常量。
   - 移除或替换 `bun:bundle` 相关导入。

3. 增加缺失模块的构建期 stub 机制

   - `scripts/build.mjs` 使用 esbuild JS API。
   - 构建失败时解析缺失模块和缺失导出。
   - 对 feature-gated 的相对路径模块生成空 stub。
   - 对缺失的命名导出补 `undefined` 导出，保证 bundle 能继续。

4. 补充运行依赖和 TypeScript 配置

   - `package.json` / `package-lock.json` 补充 CLI 运行和打包需要的 npm 依赖。
   - `tsconfig.json` 增加 Node/Bun 类型、DOM lib、`src/*` 路径映射和更适合当前源码布局的 `rootDir`。

5. 增加 `bun:ffi` stub

   - 新增 `stubs/bun-ffi.ts`。
   - 当前实现仅提供空对象和空 `dlopen()` 返回值，用于非 Bun 环境下通过构建。

6. 修复 CLI 启动参数兼容问题

   - 修复 `src/main.tsx` 中 Commander 15 不接受 `-d2e, --debug-to-stderr` 这种短参数写法导致的启动崩溃。
   - 当前隐藏参数改为 `--debug-to-stderr`。

7. 改造 source preparation 脚本

   - `scripts/prepare-src.mjs` 改为输出到 `build-src/prepared`。
   - 不再直接修改 `src/` 或根目录 `stubs/`。
   - 支持 `--out <dir>` 指定输出目录。

8. 新增验证报告模板

   - 新增 `openspec/templates/verification-report.html`。
   - 将数据验证逻辑 `validateRows()` 和数据后置清理 `postProcessRows()` 拆开。
   - 后置处理负责规范化 `id`、`caseName`、`status`、`dimension`、`detail` 等字段。

## 哪些是真实现

这些部分是当前分支实际可用的实现或构建适配：

- Node/esbuild 构建流程。
- Bun 宏和 feature gate 的构建期转换。
- CLI 入口 bundle。
- `--version`、`--help`、`auth status`、`-p` 非交互调用。
- 已存在的纯 TypeScript native 替代实现会被构建使用，例如 `src/native-ts/color-diff`、`src/native-ts/file-index`、`src/native-ts/yoga-layout`。
- 验证报告模板的数据校验、过滤、搜索和后置清理逻辑。

## 哪些是 stub 或降级

这些部分不是完整官方实现：

- `feature('...')` 统一替换为 `false`，等价于关闭内部 feature gate。
- `stubs/bun-ffi.ts` 只是空 stub，不提供真实 FFI。
- `@ant/claude-for-chrome-mcp` 在构建副本中生成为空 browser tools 和 no-op server。
- 一批 feature-gated 内部模块会在 `build-src/` 中生成空 stub，例如：
  - `assistant/AssistantSessionChooser`
  - `commands/agents-platform`
  - `entrypoints/sdk/*Types`
  - `ink/devtools`
  - `tools/WorkflowTool`
  - `tools/VerifyPlanExecutionTool`
  - `tools/TungstenTool`
  - `tools/REPLTool`
  - `tools/SuggestBackgroundPRTool`
  - `services/contextCollapse`
  - `services/compact/*`
- 下列 native 包仅作为 external 保留，触发对应路径时仍可能需要真实 native 依赖：
  - `audio-capture-napi`
  - `image-processor-napi`
  - `modifiers-napi`
  - `url-handler-napi`
  - `*.node`

## 构建和启动

```powershell
npm install
npm run build
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
npm run build
npm start -- --version
node dist\cli.js --help
node dist\cli.js doctor --help
node dist\cli.js -p "<prompt>" --max-turns 1 --model <model>
```

版本输出：

```text
2.1.88 (Claude Code)
```

还通过配置好的 Anthropic-compatible 代理完成过真实 `-p` 任务和一组纯推理 smoke test。该代理配置没有写入仓库。

## 当前风险边界

当前产物适合验证 CLI 主路径、模型调用、基础项目读取和非交互任务。

不要把它理解为完整恢复的官方 Bun 编译产物。内部实验功能、Chrome MCP、Tungsten、Workflow、VerifyPlanExecution、部分 SDK generated 类型、语音、图片 native 处理、deep link 等路径仍然可能不可用或只提供 stub。
