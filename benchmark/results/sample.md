# pi-rtk benchmark

- timestamp: `2026-04-23T07:21:35.633Z`
- rtk: `rtk 0.37.2`
- node: `v25.9.0` on `darwin/arm64`
- reps: **5** per arm, warmup: 1, **serial** (interleaved baseline/rtk)
- token estimator: `Math.ceil(chars / 4)` — same formula pi uses for context accounting

## Aggregate

| metric | baseline (mean) | rtk (mean) | savings |
|---|---:|---:|---:|
| tokens | 117,505 | 5,856 | **95.0%** |

## Per-task results

| task | baseline tokens (mean ± σ) | rtk tokens (mean ± σ) | savings | baseline ms (median) | rtk ms (median) |
|---|---:|---:|---:|---:|---:|
| `git-status-log` | 112 ± 0 | 67 ± 0 | **40.2%** | 18.2 ms | 228.8 ms |
| `git-diff` | 48,870 ± 0 | 4,288 ± 0 | **91.2%** | 13.2 ms | 125.2 ms |
| `ls-node-modules` | 2,345 ± 0 | 829 ± 0 | **64.6%** | 13.7 ms | 215.7 ms |
| `find-dts` | 65,746 ± 0 | 240 ± 0 | **99.6%** | 111.1 ms | 162.4 ms |
| `grep-function` | 432 ± 0 | 432 ± 0 | **0.0%** | 5.8 ms | 111.4 ms |

## Detail

### `git-status-log` — Inspect repo state and recent history

Commands:
```bash
git status
git log --oneline -30
```

| metric | baseline mean | baseline σ | baseline min | baseline max | rtk mean | rtk σ | rtk min | rtk max |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| tokens | 112 | 0 | 112 | 112 | 67 | 0 | 67 | 67 |
| bytes | 446 | 0 | 446 | 446 | 268 | 0 | 268 | 268 |
| lines | 14 | 0 | 14 | 14 | 9 | 0 | 9 | 9 |
| wall ms | 18.0 | 0.5 | 17.2 | 18.6 | 225.6 | 8.3 | 214.4 | 233.9 |

### `git-diff` — Diff the last three commits

Commands:
```bash
git diff HEAD~3 HEAD
```

| metric | baseline mean | baseline σ | baseline min | baseline max | rtk mean | rtk σ | rtk min | rtk max |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| tokens | 48,870 | 0 | 48,870 | 48,870 | 4,288 | 0 | 4,288 | 4,288 |
| bytes | 195,493 | 0 | 195,493 | 195,493 | 17,163 | 0 | 17,163 | 17,163 |
| lines | 5,302 | 0 | 5,302 | 5,302 | 532 | 0 | 532 | 532 |
| wall ms | 13.1 | 0.8 | 11.9 | 13.9 | 124.6 | 5.3 | 116.9 | 130.4 |

### `ls-node-modules` — List two populated node_modules subtrees

Commands:
```bash
ls -la node_modules/jiti/lib
ls -la node_modules/@mariozechner/pi-coding-agent/dist/core
```

| metric | baseline mean | baseline σ | baseline min | baseline max | rtk mean | rtk σ | rtk min | rtk max |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| tokens | 2,345 | 0 | 2,345 | 2,345 | 829 | 0 | 829 | 829 |
| bytes | 9,379 | 0 | 9,379 | 9,379 | 3,316 | 0 | 3,316 | 3,316 |
| lines | 142 | 0 | 142 | 142 | 136 | 0 | 136 | 136 |
| wall ms | 14.2 | 1.1 | 13.0 | 15.7 | 215.9 | 3.5 | 212.2 | 219.6 |

### `find-dts` — Find all .d.ts files under node_modules

Commands:
```bash
find node_modules -name '*.d.ts' -type f
```

| metric | baseline mean | baseline σ | baseline min | baseline max | rtk mean | rtk σ | rtk min | rtk max |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| tokens | 65,746 | 0 | 65,746 | 65,746 | 240 | 0 | 240 | 240 |
| bytes | 262,982 | 0 | 262,982 | 262,982 | 958 | 0 | 958 | 958 |
| lines | 3,802 | 0 | 3,802 | 3,802 | 13 | 0 | 13 | 13 |
| wall ms | 111.3 | 2.5 | 108.5 | 115.3 | 165.2 | 4.7 | 162.3 | 173.2 |

### `grep-function` — Search for a common identifier in a small subtree

Commands:
```bash
grep -rn 'function' node_modules/jiti/lib
```

| metric | baseline mean | baseline σ | baseline min | baseline max | rtk mean | rtk σ | rtk min | rtk max |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| tokens | 432 | 0 | 432 | 432 | 432 | 0 | 432 | 432 |
| bytes | 1,725 | 0 | 1,725 | 1,725 | 1,725 | 0 | 1,725 | 1,725 |
| lines | 21 | 0 | 21 | 21 | 21 | 0 | 21 | 21 |
| wall ms | 6.0 | 0.7 | 5.4 | 7.1 | 114.6 | 5.3 | 110.7 | 122.5 |

## Notes

This benchmark isolates rtk's output-compression effect by executing each
command twice — once raw, once via the same `rewriteCommand` path the
live extension uses. LLM sampling is deliberately excluded so variance
comes only from system noise (scheduler, file cache, IO). All arms run
strictly serially in a single process.

In a real pi session, the savings observed here apply to **every** bash
tool call. Because tool results are returned to the LLM on each subsequent
turn, the effective reduction in per-turn prompt tokens scales multiplicatively
with the number of tool calls in a conversation.
