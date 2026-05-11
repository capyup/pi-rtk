# pi-rtk

[![test](https://github.com/lulucatdev/pi-rtk/actions/workflows/test.yml/badge.svg)](https://github.com/lulucatdev/pi-rtk/actions/workflows/test.yml)

pi integration for [rtk](https://github.com/rtk-ai/rtk) (Rust Token Killer):
transparently rewrites `bash` tool calls to their token-optimized `rtk`
equivalents, mirroring the behavior of rtk's own hooks for Claude Code,
Cursor, Codex, OpenCode, and others.

The extension hooks pi's `tool_call` event, feeds each bash command through
`rtk rewrite`, and substitutes the rewritten command in place before
execution. Most rewrite decisions are delegated to the rtk binary's registry; pi-rtk also
ships a small local LaTeX fallback that captures verbose TeX transcripts to disk
and returns a compact build summary. The core integration otherwise keeps the
same shape as rtk's official OpenCode plugin.

## Measured effectiveness

The repository ships an effectiveness benchmark (`npm run bench`) that
executes each task twice per rep — once raw, once through the same
`rewriteCommand` path the live extension uses — with 5 repetitions per arm,
strictly serial and interleaved. The arms are deterministic on a stable
fixture, so the 5-rep protocol serves as a check that both paths really are
deterministic; wall time has genuine variance and is reported separately.

Numbers below are from the committed sample run in
[`benchmark/results/sample.md`](benchmark/results/sample.md) on `rtk 0.37.2`
/ `node 25.9.0` / `darwin/arm64`. Re-run locally with `npm run bench` for
your own environment.

### Aggregate

| metric | baseline (mean) | rtk (mean) | savings |
|---|---:|---:|---:|
| tokens | 117,505 | 5,856 | **95.0%** |

### Per task (5 reps per arm, serial)

| task | baseline tokens (mean ± σ) | rtk tokens (mean ± σ) | savings | baseline ms (median) | rtk ms (median) |
|---|---:|---:|---:|---:|---:|
| `git-status-log` — `git status` + `git log --oneline -30` | 112 ± 0 | 67 ± 0 | **40.2%** | 18.2 ms | 228.8 ms |
| `git-diff` — `git diff HEAD~3 HEAD` | 48,870 ± 0 | 4,288 ± 0 | **91.2%** | 13.2 ms | 125.2 ms |
| `ls-node-modules` — two `ls -la` subtrees | 2,345 ± 0 | 829 ± 0 | **64.6%** | 13.7 ms | 215.7 ms |
| `find-dts` — `find node_modules -name '*.d.ts' -type f` | 65,746 ± 0 | 240 ± 0 | **99.6%** | 111.1 ms | 162.4 ms |
| `grep-function` — `grep -rn 'function' node_modules/jiti/lib` | 432 ± 0 | 432 ± 0 | **0.0%** | 5.8 ms | 111.4 ms |

### How to read this

- **Token savings scale with output volume.** The two large tasks
  (`git-diff` and `find-dts`) dominate the aggregate. `git-diff` shrinks
  from 5,302 lines to 532, and `find-dts` collapses 3,802 file paths into
  13 grouped lines. These are the cases rtk was built for.
- **A 0% task is not a failure.** `grep-function` produces 20 short
  matches with no redundancy; rtk has nothing to compress and passes
  through verbatim. Keeping this task in the benchmark demonstrates
  that the measurement does not cherry-pick.
- **Wall-time overhead is ~100-200 ms per command** (rewrite decision
  plus filter pipeline). On `find-dts` this translates to 54 ms traded
  for 65,506 saved tokens — a large positive expected value for any
  LLM-driven workflow, because every saved token is also saved on every
  subsequent turn's prompt.
- **σ = 0 for tokens/bytes/lines is expected.** Commands operate on a
  stable fixture and rtk's filtering is deterministic; the 5-rep
  protocol checks that, and isolates scheduler / cache / IO noise to
  the wall-time column (σ = 0.5 to 8 ms on the sample).
- **Fixture caveat.** `git-diff` and `git-log` reference `HEAD~3 HEAD`
  and the 30 most recent commits, so absolute numbers drift as new
  commits land. Order-of-magnitude savings do not change.

For methodology detail and tuning knobs (`REPS`, `WARMUP`, `BENCH_QUIET`)
see [`benchmark/README.md`](benchmark/README.md).

## Requirements

- pi (`@mariozechner/pi-coding-agent`) ≥ 0.69.0
- `rtk` ≥ 0.23.0 on `PATH` — install via `brew install rtk`,
  `cargo install --git https://github.com/rtk-ai/rtk`, or the prebuilt
  binaries on the [rtk releases page](https://github.com/rtk-ai/rtk/releases).

## Installation

```bash
pi install git:github.com/capyup/pi-rtk        # global
pi install -l git:github.com/capyup/pi-rtk     # project-local
pi -e git:github.com/capyup/pi-rtk             # run once without installing
pi update git:github.com/capyup/pi-rtk         # pull the latest
pi remove git:github.com/capyup/pi-rtk         # uninstall
```

## What the extension does

- **Hook on `tool_call`**: when the LLM calls the built-in `bash` tool,
  the extension invokes `rtk rewrite <command>` and rewrites
  `event.input.command` in place when rtk returns a token-optimized
  equivalent. Same pattern as rtk's official OpenCode plugin.
- **LaTeX build summaries**: when upstream `rtk rewrite` has no equivalent
  for `latexmk`, `xelatex`, `pdflatex`, `lualatex`, `tectonic`, `bibtex`,
  `biber`, `makeindex`, `makeglossaries`, or `xdvipdfmx`, pi-rtk wraps the
  original shell command in a local runner. The full stdout/stderr transcript
  is written to `.pi/rtk/latex/*.log`; the agent only sees status, artifact
  lines, important errors/warnings, overfull boxes above 1pt, and the log path.
- **System-prompt addition**: appends a short awareness block to every
  turn's system prompt so the model knows about the bash-only scope and
  about meta commands (`rtk gain`, `rtk discover`, …) that are not
  auto-rewritten.
- **`/rtk` slash command**: `/rtk`, `/rtk gain --history`,
  `/rtk discover`, `/rtk on`, `/rtk off`, `/rtk clear`, `/rtk status`.
  Output is shown in a transient widget so it never enters LLM context.
- **Footer status**: shows `rtk <version>` (or `rtk off` after `/rtk off`).
- **Skill**: a SKILL.md describing rtk usage that the model can pull in.

## Scope

The auto-rewrite only fires for the `bash` tool. The built-in `read`,
`grep`, `glob`, and `list` tools bypass the hook. When token efficiency
matters for file inspection or code search, prefer invoking `rtk read`,
`rtk grep`, or `rtk find` through bash.

## Configuration

All configuration is via environment variables; no settings file is read.

| Variable                  | Default | Effect                                                             |
|---------------------------|---------|--------------------------------------------------------------------|
| `PI_RTK_DISABLED`         | unset   | If `1`, disable the extension entirely                             |
| `PI_RTK_ASK_MODE`         | `auto`  | `auto` silently applies rtk "ask" rewrites; `confirm` prompts      |
| `PI_RTK_AWARENESS`        | `1`     | Set `0` to skip the system-prompt addition                         |
| `PI_RTK_TIMEOUT_MS`       | `2000`  | Per-call timeout for `rtk rewrite` (ms)                            |
| `PI_RTK_QUIET`            | unset   | If `1`, suppress startup notifications                             |
| `PI_RTK_LATEX`            | `1`     | Set `0` to disable local LaTeX transcript summarization            |
| `PI_RTK_LATEX_LOG_DIR`    | unset   | Override the default `.pi/rtk/latex` transcript directory          |

`rtk`'s own per-command opt-out also works: prefix a command with
`RTK_DISABLED=1` (for example `RTK_DISABLED=1 git status`) to bypass the
rewrite for that one invocation.

## Failure model

If `rtk` is missing, below the minimum version, or fails for any reason,
the extension passes the original command through unchanged. It never
blocks execution of the LLM's bash calls.

A startup notification appears once per session if rtk is missing or too
old (suppressible with `PI_RTK_QUIET=1`).

## Relationship to upstream rtk

This package is independent of rtk and does not require any change to
the rtk binary. General rewrite decisions are delegated to `rtk rewrite`,
which is the single source of truth defined in `src/discover/registry.rs`
of the rtk repository. The only local exception is the LaTeX transcript
summarizer, which exists because TeX builds are especially verbose and already
produce canonical `.log` files. For non-LaTeX rewrite rules, file a PR against
rtk itself.

## Development

Clone the repo and install dev dependencies:

```bash
git clone https://github.com/lulucatdev/pi-rtk.git
cd pi-rtk
npm install
```

### Correctness tests (102 tests, ~0.8 s local)

```bash
npm test                  # all suites
npm run test:unit         # unit tests only (57)
npm run test:e2e          # e2e tests only (38)
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

CI runs the full suite plus a benchmark smoke-run on
`{ubuntu-latest, macos-latest} × Node {22, 24}`.

### Effectiveness benchmark

```bash
npm run bench               # default: 5 reps per arm
REPS=10 npm run bench       # more reps
WARMUP=0 npm run bench      # skip warmup
BENCH_QUIET=1 npm run bench # suppress per-rep progress
```

Reports are written to `benchmark/results/<timestamp>.md`. Timestamped
reports are gitignored; the committed [`benchmark/results/sample.md`](benchmark/results/sample.md)
shows the expected shape.

See [`benchmark/README.md`](benchmark/README.md) for full methodology.

## License

MIT.

---

## 中文说明

pi 与 [rtk](https://github.com/rtk-ai/rtk)（Rust Token Killer）的集成。
pi-rtk 通过 `tool_call` 事件钩子，在 `bash` 工具被 LLM 调用前把命令透明地
改写为 `rtk` 等价形式。所有重写决策由 rtk 二进制内部的 `rtk rewrite` 完成，
本扩展是薄代理，结构与 rtk 官方为 OpenCode 提供的 TypeScript 插件一致。

### 实测效果

仓库内置基准 `npm run bench`：每个任务跑两遍（raw vs 同样走 `rewriteCommand`
路径），每 arm 重复 5 次，**严格串行**并交错执行（base, rtk, base, rtk, ...）
以让系统扰动均匀分布。由于 fixture 稳定、rtk 过滤确定，tokens/bytes/lines
的 σ 恒为 0；5 次重复用于验证"两路都是确定的"，wall time 方差单独列出。

下表取自仓库提交的 sample 运行（`rtk 0.37.2` / `node 25.9.0` / `darwin/arm64`），
本地 `npm run bench` 可复现。

#### 聚合

| 指标 | baseline（均值） | rtk（均值） | 节省 |
|---|---:|---:|---:|
| tokens | 117,505 | 5,856 | **95.0%** |

#### 分任务（每 arm 5 次串行）

| 任务 | baseline tokens (均值 ± σ) | rtk tokens (均值 ± σ) | 节省 | baseline ms (中位数) | rtk ms (中位数) |
|---|---:|---:|---:|---:|---:|
| `git-status-log` — `git status` + `git log --oneline -30` | 112 ± 0 | 67 ± 0 | **40.2%** | 18.2 ms | 228.8 ms |
| `git-diff` — `git diff HEAD~3 HEAD` | 48,870 ± 0 | 4,288 ± 0 | **91.2%** | 13.2 ms | 125.2 ms |
| `ls-node-modules` — 两处 `ls -la` 子树 | 2,345 ± 0 | 829 ± 0 | **64.6%** | 13.7 ms | 215.7 ms |
| `find-dts` — `find node_modules -name '*.d.ts' -type f` | 65,746 ± 0 | 240 ± 0 | **99.6%** | 111.1 ms | 162.4 ms |
| `grep-function` — `grep -rn 'function' node_modules/jiti/lib` | 432 ± 0 | 432 ± 0 | **0.0%** | 5.8 ms | 111.4 ms |

#### 解读

- **节省量与输出体积成正比**：`git-diff` 与 `find-dts` 两个大任务贡献了
  绝大部分节省。`git-diff` 从 5,302 行压到 532 行，`find-dts` 把 3,802
  条文件路径聚合为 13 行——这就是 rtk 的典型场景。
- **0% 任务不是失败**：`grep-function` 只有 20 条短匹配，没有冗余可压，
  rtk 原样透传。保留这个任务恰恰证明基准不是挑 cherry 的。
- **rtk 时间成本约 100-200 ms / 命令**（重写决策 + 过滤管线）。以 `find-dts`
  为例：多花 54 ms 换来省下 65,506 tokens；对任何 LLM 工作流这都是高正
  期望值，因为每一条被省下的 token 在后续每一轮对话中也同样不会出现。
- **tokens/bytes/lines 的 σ 为 0 是预期结果**：命令在稳定 fixture 上完全
  确定，rtk 也是确定的；5 次重复用来验证这一点，并把系统噪声隔离到 wall
  time 一列（sample 上 σ 为 0.5-8 ms）。
- **Fixture 会漂**：`git-diff` 和 `git-log` 引用 `HEAD~3 HEAD` 与最近 30
  条提交，绝对数会随提交演进变化；量级不变。

方法学与调节参数（`REPS`、`WARMUP`、`BENCH_QUIET`）详见
[`benchmark/README.md`](benchmark/README.md)。

### 前置条件

- pi（`@mariozechner/pi-coding-agent`）≥ 0.69.0
- 系统 `PATH` 中存在 `rtk` ≥ 0.23.0
  - macOS：`brew install rtk`
  - 任意平台：`cargo install --git https://github.com/rtk-ai/rtk`
  - 或下载 [release 二进制](https://github.com/rtk-ai/rtk/releases)

### 安装

```bash
pi install git:github.com/lulucatdev/pi-rtk        # 全局
pi install -l git:github.com/lulucatdev/pi-rtk     # 项目本地
pi -e git:github.com/lulucatdev/pi-rtk             # 临时试用（不安装）
pi update git:github.com/lulucatdev/pi-rtk         # 拉取最新
pi remove git:github.com/lulucatdev/pi-rtk         # 卸载
```

### 行为

- **bash 工具自动改写**：只拦截 `bash` 工具，`read`/`grep`/`glob`/`list`
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

| 变量                      | 默认    | 含义                                                     |
|---------------------------|--------|---------------------------------------------------------|
| `PI_RTK_DISABLED`         | 未设   | 设为 `1` 完全停用本扩展                                  |
| `PI_RTK_ASK_MODE`         | `auto` | rtk ask-rule 命中时：`auto` 静默应用，`confirm` 弹窗确认 |
| `PI_RTK_AWARENESS`        | `1`    | 设为 `0` 不向系统提示追加 awareness                      |
| `PI_RTK_TIMEOUT_MS`       | `2000` | `rtk rewrite` 单次超时（毫秒）                            |
| `PI_RTK_QUIET`            | 未设   | 设为 `1` 抑制启动提示                                    |

rtk 本身支持的单次旁路也仍然可用：在某条命令前加 `RTK_DISABLED=1`，例如
`RTK_DISABLED=1 git status`，即可让该命令不被改写。

### 错误降级

`rtk` 缺失、版本过低、超时或任何调用失败，本扩展都会原样透传命令，绝不
阻塞执行。

### 与上游 rtk 的关系

本仓库独立于 rtk，无需对 rtk 二进制做任何修改。所有重写决策都由
`rtk rewrite` 完成，规则维护在 rtk 仓库的 `src/discover/registry.rs`。
要新增或调整规则，应向 rtk 上游提 PR。

### 开发

```bash
git clone https://github.com/lulucatdev/pi-rtk.git
cd pi-rtk
npm install

npm test                  # 正确性测试（102 条，本机 ~0.8 s）
npm run test:unit         # 仅 unit（57 条）
npm run test:e2e          # 仅 e2e（38 条）
npm run test:integration  # 依赖真实 rtk，无 rtk 时自动跳过（7 条）

npm run bench             # 效果基准（5 任务 × 5 次 × 2 arm，本机 ~8 s）
```

CI 矩阵 `{ubuntu-latest, macos-latest} × Node {22, 24}`，每个 job 完整跑
正确性测试并烟测 benchmark 脚本。

### 协议

MIT。
 协议

MIT。
