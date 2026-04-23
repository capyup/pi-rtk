# pi-rtk

pi integration for [rtk](https://github.com/rtk-ai/rtk) (Rust Token Killer):
transparently rewrites `bash` tool calls to their token-optimized `rtk`
equivalents, mirroring the behavior of rtk's own hooks for Claude Code,
Cursor, Codex, OpenCode, and others.

Typical savings: 60-90% on git, cargo, pytest, jest, vitest, tsc, eslint,
ruff, docker, kubectl, aws, pnpm, pip, ls, find, grep, and similar commands.

## Requirements

- pi (`@mariozechner/pi-coding-agent`)
- `rtk` >= 0.23.0 on `PATH` — install via `brew install rtk`,
  `cargo install --git https://github.com/rtk-ai/rtk`, or the prebuilt
  binaries on the [rtk releases page](https://github.com/rtk-ai/rtk/releases).

## Installation

```bash
pi install git:github.com/lulucatdev/pi-rtk
```

Or, for project-local install:

```bash
pi install -l git:github.com/lulucatdev/pi-rtk
```

To try without installing:

```bash
pi -e git:github.com/lulucatdev/pi-rtk
```

To uninstall:

```bash
pi remove git:github.com/lulucatdev/pi-rtk
```

## What the extension does

- **Hook on `tool_call`**: when the LLM calls the built-in `bash` tool, the
  extension invokes `rtk rewrite <command>` and rewrites
  `event.input.command` in place when rtk returns a token-optimized
  equivalent. Equivalent in pattern to rtk's official OpenCode plugin.
- **System-prompt addition**: appends a short awareness block to every turn's
  system prompt so the model knows about the bash-only scope and about
  meta commands (`rtk gain`, `rtk discover`, …) that are not auto-rewritten.
- **`/rtk` slash command**: `/rtk`, `/rtk gain --history`, `/rtk discover`,
  `/rtk on`, `/rtk off`, `/rtk clear`, `/rtk status`. Output is shown in a
  transient widget so it never enters LLM context.
- **Footer status**: shows `rtk <version>` (or `rtk off` after `/rtk off`).
- **Skill**: a SKILL.md describing rtk usage that the model can pull in.

## Scope

The auto-rewrite only fires for the `bash` tool. The built-in `read`, `grep`,
`glob`, and `list` tools bypass the hook. When token efficiency matters for
file inspection or code search, prefer invoking `rtk read`, `rtk grep`, or
`rtk find` through bash.

## Configuration

All configuration is via environment variables; no settings file is read.

| Variable                  | Default | Effect                                                  |
|---------------------------|---------|---------------------------------------------------------|
| `PI_RTK_DISABLED`         | unset   | If `1`, disable the extension entirely                  |
| `PI_RTK_ASK_MODE`         | `auto`  | `auto` silently applies rtk "ask" rewrites; `confirm` prompts |
| `PI_RTK_AWARENESS`        | `1`     | Set `0` to skip the system-prompt addition              |
| `PI_RTK_TIMEOUT_MS`       | `2000`  | Per-call timeout for `rtk rewrite` (ms)                 |
| `PI_RTK_QUIET`            | unset   | If `1`, suppress startup notifications                  |

`rtk`'s own per-command opt-out also works: prefix a command with
`RTK_DISABLED=1` (for example `RTK_DISABLED=1 git status`) to bypass the
rewrite for that one invocation.

## Failure model

If `rtk` is missing, below the minimum version, or fails for any reason, the
extension passes the original command through unchanged. It never blocks
execution of the LLM's bash calls.

A startup notification appears once per session if rtk is missing or too old
(suppressible with `PI_RTK_QUIET=1`).

## Relationship to upstream rtk

This package is independent of rtk and does not require any change to the
rtk binary. All rewrite decisions are delegated to `rtk rewrite`, which is
the single source of truth defined in `src/discover/registry.rs` of the rtk
repository. To add or change rewrite rules, file a PR against rtk itself.

## Development

Clone the repo and install dev dependencies:

```bash
git clone https://github.com/lulucatdev/pi-rtk.git
cd pi-rtk
npm install
```

### Correctness tests

```bash
npm test                  # all suites (94 tests)
npm run test:unit         # unit tests only (51)
npm run test:e2e          # e2e tests only (36)
npm run test:integration  # requires rtk on PATH (7; auto-skipped otherwise)
```

The test layout:

- `test/unit/` — pure-function tests against the `config`, `version`,
  `rewrite`, and `awareness` modules, using a programmable `pi.exec`
  stub so no real `rtk` binary is required.
- `test/e2e/` — drives the extension factory with a fake
  `ExtensionAPI` + `ExtensionContext`, fires synthetic `session_start`,
  `before_agent_start`, `tool_call` events, and invokes the `/rtk`
  command to verify registered handlers end-to-end.
- `test/integration/` — exercises the real `rtk` binary to protect
  against drift in the `rtk rewrite` exit-code contract. Skipped
  automatically when `rtk` is not installed.

TypeScript source modules are loaded via `jiti` (matching how pi itself
loads extensions), so no build step is needed.

CI runs the full suite on `{ubuntu-latest, macos-latest} × Node {22, 24}`.

### Effectiveness benchmark

Measures how many tokens pi-rtk actually saves. Runs every task 5 times
per arm (baseline vs. rtk), serial and interleaved, and writes a
statistical report.

```bash
npm run bench
```

See [`benchmark/README.md`](benchmark/README.md) for methodology and
[`benchmark/results/sample.md`](benchmark/results/sample.md) for a
representative run. Aggregate on the committed sample: **95% token
reduction** across `git`, `ls`, `find`, and `grep` tasks.

## License

MIT.

---

## 中文说明

pi 与 [rtk](https://github.com/rtk-ai/rtk)（Rust Token Killer）的集成。pi-rtk
通过 `tool_call` 事件钩子，在 `bash` 工具被 LLM 调用前把命令透明地改写为
`rtk` 等价形式，从而在常见开发命令上获得 60-90% 的 token 节省。本插件的
做法与 rtk 官方为 OpenCode 提供的 TypeScript 插件结构一致：所有重写规则由
rtk 二进制内部的 `rtk rewrite` 决策，本扩展只是薄代理。

### 前置条件

- pi（`@mariozechner/pi-coding-agent`）
- 系统 `PATH` 中存在 `rtk` ≥ 0.23.0
  - macOS：`brew install rtk`
  - 任意平台：`cargo install --git https://github.com/rtk-ai/rtk`
  - 或下载 [release 二进制](https://github.com/rtk-ai/rtk/releases)

### 安装

```bash
pi install git:github.com/lulucatdev/pi-rtk        # 全局
pi install -l git:github.com/lulucatdev/pi-rtk     # 项目本地
pi -e git:github.com/lulucatdev/pi-rtk             # 临时试用
pi remove git:github.com/lulucatdev/pi-rtk         # 卸载
```

### 行为

- **bash 工具自动改写**：仅 `bash` 工具被拦截，`read`/`grep`/`glob`/`list`
  等 pi 自带工具不受影响。需要时请显式通过 bash 调用 `rtk read`、
  `rtk grep`、`rtk find`。
- **system prompt 注入**：每轮在系统提示后追加一段 awareness 文本，告知
  模型 meta 命令（`rtk gain`、`rtk discover` 等不会被自动改写）。
- **`/rtk` 斜杠命令**：`/rtk`（默认 `rtk gain`）、`/rtk <args>`、`/rtk on`、
  `/rtk off`、`/rtk clear`、`/rtk status`。输出渲染在 widget，不进入 LLM
  上下文。
- **底栏状态**：显示 `rtk <version>` 或 `rtk off`。
- **SKILL.md**：作为可被模型加载的技能说明。

### 配置（仅环境变量）

| 变量                      | 默认    | 含义                                           |
|---------------------------|--------|------------------------------------------------|
| `PI_RTK_DISABLED`         | 未设   | 设为 `1` 完全停用本扩展                         |
| `PI_RTK_ASK_MODE`         | `auto` | rtk ask-rule 命中时：`auto` 静默应用，`confirm` 弹窗确认 |
| `PI_RTK_AWARENESS`        | `1`    | 设为 `0` 不向系统提示追加 awareness            |
| `PI_RTK_TIMEOUT_MS`       | `2000` | `rtk rewrite` 单次超时（毫秒）                  |
| `PI_RTK_QUIET`            | 未设   | 设为 `1` 抑制启动提示                           |

rtk 本身支持的单次旁路也仍然可用：在某条命令前加 `RTK_DISABLED=1`，例如
`RTK_DISABLED=1 git status`，即可让该命令不被改写。

### 错误降级

`rtk` 缺失、版本过低、超时或任何调用失败，本扩展都会原样透传命令，绝不
阻塞执行。

### 与上游 rtk 的关系

本仓库独立于 rtk，无需对 rtk 二进制做任何修改。所有重写决策都由
`rtk rewrite` 完成，规则维护在 rtk 仓库的 `src/discover/registry.rs`。
要新增或调整规则，应向 rtk 上游提 PR。

### 协议

MIT。
