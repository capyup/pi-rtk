---
name: rtk
description: Use rtk (Rust Token Killer) — a CLI proxy that filters and compresses command output for 60-90% token savings. Use when running shell commands inside pi, when investigating token usage, or when the user mentions "rtk", "token savings", "/rtk", or "compact CLI output".
---

# rtk usage in pi

`rtk` is a high-performance Rust binary that wraps common CLI tools (`git`,
`cargo`, `pytest`, `jest`, `vitest`, `tsc`, `eslint`, `ruff`, `docker`,
`kubectl`, `aws`, `pnpm`, `pip`, `ls`, `find`, `grep`, `cat`, …) and returns a
condensed, token-optimized version of their output. The pi-rtk extension
installs a `tool_call` hook that **automatically rewrites bash commands** to
their `rtk` equivalents before execution. Most of the time, no action is
required — write the bash command normally, the hook will replace it.

## When the auto-rewrite applies

- The hook only fires for the `bash` tool. The pi-native `read`, `grep`,
  `glob`, and `list` tools bypass it.
- Any rewrite-eligible command (see categories above) is replaced by its
  `rtk <cmd>` form.
- `rtk` already in the command (`rtk git status`) is preserved unchanged; the
  hook never produces `rtk rtk …`.
- Commands joined with `&&`, `||`, `;`, or `|` are handled per-segment by rtk
  itself.

## When to call rtk explicitly through bash

Use these forms when token efficiency matters or when the auto-rewrite cannot
help (because the operation goes through a non-bash tool):

| Need                              | Command                              |
|-----------------------------------|--------------------------------------|
| Inspect a long source file        | `rtk read <path>` (vs. the read tool)|
| Inspect with signatures only      | `rtk read <path> -l aggressive`      |
| Code search                       | `rtk grep <pattern> <path>`          |
| Locate files                      | `rtk find <pattern> <dir>`           |
| Token-optimized directory listing | `rtk ls <dir>` or `rtk tree <dir>`   |
| Compact diff                      | `rtk diff <a> <b>`                   |

## Meta commands (NOT auto-rewritten — call directly)

| Command                | Purpose                                           |
|------------------------|---------------------------------------------------|
| `rtk --version`        | Installed rtk version                             |
| `rtk gain`             | Token savings summary                             |
| `rtk gain --history`   | Recent command-by-command savings                 |
| `rtk gain --graph`     | ASCII graph of savings                            |
| `rtk gain --daily`     | Day-by-day breakdown                              |
| `rtk gain --all --format json` | JSON export                               |
| `rtk discover`         | Find missed savings opportunities                 |
| `rtk session`          | rtk adoption across recent sessions               |
| `rtk proxy <cmd>`      | Run a command raw without filtering (debug)       |

These are also reachable through the `/rtk` slash command in pi:

- `/rtk` — run `rtk gain` and show output in a transient widget
- `/rtk <args>` — run `rtk <args>` and show output in the widget
- `/rtk clear` — hide the widget
- `/rtk on` / `/rtk off` — enable or disable rewriting for the current session
- `/rtk status` — show extension state

## Per-command opt-out

Prefix any single command with `RTK_DISABLED=1` to bypass the rewrite for that
one invocation, for example `RTK_DISABLED=1 git status`.

## Configuration (environment variables)

| Variable                | Effect                                                |
|-------------------------|-------------------------------------------------------|
| `PI_RTK_DISABLED=1`     | Disable the extension entirely                        |
| `PI_RTK_ASK_MODE=auto`  | Default — silently apply rtk's "ask" rewrites         |
| `PI_RTK_ASK_MODE=confirm` | Prompt before applying "ask" rewrites               |
| `PI_RTK_AWARENESS=0`    | Skip the system-prompt addition                       |
| `PI_RTK_TIMEOUT_MS=2000`| Per-call timeout for `rtk rewrite`                    |
| `PI_RTK_QUIET=1`        | Suppress startup notifications                        |

## Failure model

If `rtk` is missing, too old (< 0.23.0), or fails for any reason, the
extension passes the original command through unchanged. It never blocks the
user's command.
