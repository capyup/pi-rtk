# pi-rtk benchmark

Effectiveness benchmark: measures how many tokens pi-rtk actually saves
compared to running the same bash commands without the extension.

## How it works

For a fixed set of small, realistic tasks (a few shell commands each), the
benchmark:

1. Executes every task in **baseline** mode (raw bash) and in **rtk** mode
   (through the same `rewriteCommand` path the live extension uses).
2. Runs each mode **N times** (default N=5), serially and interleaved
   (`baseline, rtk, baseline, rtk, …`) so per-rep system noise applies
   equally to both arms.
3. Measures output bytes, lines, estimated tokens
   (`Math.ceil(chars / 4)` — the same formula pi uses for context
   accounting), and wall time per command.
4. Reports per-task and aggregate statistics (mean, σ, min/max, median)
   plus the savings percentage, and writes a timestamped markdown report
   to `benchmark/results/`.

Execution is strictly serial — there is no `Promise.all`, and commands
within a task, reps within a task, and tasks within a run are all
sequenced by a single `for` / `await` loop in one process.

LLM sampling is deliberately excluded. Measuring "how much smaller is the
tool output that pi-rtk feeds into the LLM" is what the extension
actually controls; whatever the LLM does with smaller input is a
multiplier that would add non-reproducible variance without adding
information.

## Running

Requires `rtk` ≥ 0.23.0 on `PATH` and `npm install` already run so that
`node_modules/` is populated (some tasks use it as a stable fixture).

```bash
npm run bench                 # default: 5 reps, 1 warmup
REPS=10 npm run bench         # override repetitions
WARMUP=0 npm run bench        # skip warmup
BENCH_QUIET=1 npm run bench   # suppress per-rep output
```

Reports are written to `benchmark/results/<iso-timestamp>.md` (these are
gitignored; a committed sample lives at `benchmark/results/sample.md`).

## Interpreting the results

- **Variance in tokens/bytes/lines is expected to be 0 per task.** The
  commands operate on a stable fixture and are deterministic; there is
  nothing random in rtk's filtering either. The 5-rep protocol still has
  value as a check that the arms really are deterministic, and because
  wall time genuinely varies.
- **Wall-time σ is non-zero** (scheduler, cache, IO). rtk adds roughly
  100-200 ms per command (rewrite decision + filter pipeline). The
  trade-off is nearly always favorable — saving tens of thousands of
  tokens at the cost of a few hundred milliseconds is a large positive
  expected value for any LLM-driven workflow.
- **A 0% task is not a failure of the extension.** Some commands produce
  output that is already compact (few matches, short lines, no
  redundancy). rtk passes through when there is nothing to compress;
  that is the intended behavior. The aggregate number is what matters
  in practice because a real pi session issues many bash calls of mixed
  character.
- **The aggregate savings compound.** Each bash tool result returns to
  the LLM and is included in every subsequent turn's prompt. A 95%
  reduction on a 100k-token result batch is a 95k-token-per-turn
  reduction, multiplied by the number of remaining turns.

## Fixture stability

The benchmark uses this repository as its own fixture. The `git-diff`
and `git-log` tasks reference `HEAD~3 HEAD` and `--oneline -30`, so they
will drift as new commits land. Tokens saved stay on the same order of
magnitude, but exact numbers in `sample.md` will diverge from re-runs
over time. Re-run locally to see current numbers for your tree.
