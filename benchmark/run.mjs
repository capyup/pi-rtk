// pi-rtk effectiveness benchmark.
//
// Compares the size of bash-command output when executed raw vs. when routed
// through pi-rtk's rewrite path. Token count is what ultimately lands in the
// LLM context, so that is the primary metric; byte count, line count, and
// wall time are reported alongside for completeness.
//
// Execution model:
//   - Strictly serial: a single for/await loop, no Promise.all.
//   - Baseline and rtk runs are interleaved within a task (base, rtk, base,
//     rtk, ...) so that per-rep OS-level variance applies to both arms
//     equally, rather than clustering.
//   - One untimed warmup rep per mode per task primes the file-system cache
//     and drops outliers from startup effects.
//   - The rtk arm invokes the same `rewriteCommand` module that the runtime
//     extension uses, so this measures the exact decision path pi-rtk takes
//     in production.
//
// Usage:
//   node benchmark/run.mjs                 # default: 5 reps, writes results to benchmark/results/<timestamp>.md
//   REPS=10 node benchmark/run.mjs         # override repetitions
//   WARMUP=0 node benchmark/run.mjs        # disable warmup
//   BENCH_QUIET=1 node benchmark/run.mjs   # suppress per-rep output

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { loadExt } from "../test/helpers/loader.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");
const REPS = Number.parseInt(process.env.REPS ?? "5", 10);
const WARMUP = Number.parseInt(process.env.WARMUP ?? "1", 10);
const QUIET = process.env.BENCH_QUIET === "1";

const { rewriteCommand } = await loadExt("rewrite");

// ----------------------------------------------------------------------------
// Tasks. Each task is a small, realistic unit of work composed of one or more
// bash commands that a developer would run as part of a session. Chosen to
// cover the main rtk categories (git, directory listing, search, language
// tooling) without requiring an external fixture.
// ----------------------------------------------------------------------------

const TASKS = [
	{
		name: "git-status-log",
		description: "Inspect repo state and recent history",
		commands: [
			"git status",
			"git log --oneline -30",
		],
	},
	{
		name: "git-diff",
		description: "Diff the last three commits",
		commands: ["git diff HEAD~3 HEAD"],
	},
	{
		name: "ls-node-modules",
		description: "List two populated node_modules subtrees",
		commands: [
			"ls -la node_modules/jiti/lib",
			"ls -la node_modules/@mariozechner/pi-coding-agent/dist/core",
		],
	},
	{
		name: "find-dts",
		description: "Find all .d.ts files under node_modules",
		commands: ["find node_modules -name '*.d.ts' -type f"],
	},
	{
		name: "grep-function",
		description: "Search for a common identifier in a small subtree",
		commands: ["grep -rn 'function' node_modules/jiti/lib"],
	},
];

// ----------------------------------------------------------------------------
// Helpers.
// ----------------------------------------------------------------------------

/** Match pi's conservative estimator: Math.ceil(chars / 4). */
function estimateTokens(text) {
	return Math.ceil(text.length / 4);
}

/** pi.exec-compatible shim used when the rewrite module calls through. */
const piExec = {
	exec: (command, args, options = {}) =>
		new Promise((resolveP) => {
			const proc = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], shell: false, cwd: REPO });
			let stdout = "";
			let stderr = "";
			let killed = false;
			let tId;
			const kill = () => {
				if (!killed) {
					killed = true;
					proc.kill("SIGTERM");
				}
			};
			if (options.timeout && options.timeout > 0) tId = setTimeout(kill, options.timeout);
			proc.stdout.on("data", (d) => {
				stdout += d.toString();
			});
			proc.stderr.on("data", (d) => {
				stderr += d.toString();
			});
			proc.on("close", (code) => {
				if (tId) clearTimeout(tId);
				resolveP({ stdout, stderr, code: code ?? 0, killed });
			});
			proc.on("error", () => {
				if (tId) clearTimeout(tId);
				resolveP({ stdout, stderr, code: 1, killed });
			});
		}),
};

/** Spawn `bash -c <command>` and capture stdout + stderr + wall time. */
function runBash(command) {
	return new Promise((resolveP) => {
		const start = performance.now();
		const proc = spawn("bash", ["-c", command], { stdio: ["ignore", "pipe", "pipe"], cwd: REPO });
		let stdout = "";
		let stderr = "";
		proc.stdout.on("data", (d) => {
			stdout += d.toString();
		});
		proc.stderr.on("data", (d) => {
			stderr += d.toString();
		});
		proc.on("close", (code) => {
			resolveP({
				stdout,
				stderr,
				code: code ?? 0,
				millis: performance.now() - start,
			});
		});
		proc.on("error", (err) => {
			resolveP({
				stdout,
				stderr: stderr + String(err.message),
				code: 1,
				millis: performance.now() - start,
			});
		});
	});
}

/** Execute one task in one mode ("baseline" or "rtk"), serial, aggregate metrics. */
async function runTaskOnce(task, mode) {
	let bytes = 0;
	let lines = 0;
	let tokens = 0;
	let millis = 0;
	for (const cmd of task.commands) {
		let executedCommand = cmd;
		if (mode === "rtk") {
			const outcome = await rewriteCommand(piExec, cmd, { timeoutMs: 3000 });
			if (outcome.kind !== "unchanged") executedCommand = outcome.command;
		}
		const r = await runBash(executedCommand);
		const output = r.stdout + r.stderr;
		bytes += Buffer.byteLength(output, "utf8");
		lines += output.length > 0 ? output.split(/\r?\n/).length : 0;
		tokens += estimateTokens(output);
		millis += r.millis;
	}
	return { bytes, lines, tokens, millis };
}

function summarize(values) {
	const n = values.length;
	if (n === 0) return { mean: 0, stdev: 0, median: 0, min: 0, max: 0, n };
	const sum = values.reduce((s, v) => s + v, 0);
	const mean = sum / n;
	const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / (n > 1 ? n - 1 : 1);
	const stdev = Math.sqrt(variance);
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(n / 2);
	const median = n % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
	return { mean, stdev, median, min: sorted[0], max: sorted[n - 1], n };
}

function fmtNum(x, decimals = 0) {
	return x.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function fmtPct(x) {
	return `${x >= 0 ? "" : ""}${x.toFixed(1)}%`;
}

function fmtMs(x) {
	return `${x.toFixed(1)} ms`;
}

// ----------------------------------------------------------------------------
// Preflight: require rtk to be installed.
// ----------------------------------------------------------------------------

const verProbe = await runBash("rtk --version");
if (verProbe.code !== 0) {
	console.error("pi-rtk benchmark: `rtk` is not installed or not on PATH.");
	console.error("Install from https://github.com/rtk-ai/rtk, then rerun.");
	process.exit(2);
}
const rtkVersion = (verProbe.stdout || verProbe.stderr).trim();

// Sanity: require node_modules to be present so find / grep tasks are meaningful.
const nmProbe = await runBash("test -d node_modules && echo ok || echo missing");
if (nmProbe.stdout.trim() !== "ok") {
	console.error("pi-rtk benchmark: node_modules/ is missing. Run `npm install` first.");
	process.exit(2);
}

// ----------------------------------------------------------------------------
// Main run.
// ----------------------------------------------------------------------------

const startTime = new Date();
const nodeVer = process.version;
const platform = `${process.platform}/${process.arch}`;

if (!QUIET) {
	console.log(`pi-rtk benchmark`);
	console.log(`  ${rtkVersion}`);
	console.log(`  node ${nodeVer} on ${platform}`);
	console.log(`  reps=${REPS}, warmup=${WARMUP}, serial=true, cwd=${REPO}`);
	console.log();
}

const taskResults = [];

for (const task of TASKS) {
	if (!QUIET) console.log(`[${task.name}] ${task.description}`);

	// Warmup (untimed, interleaved).
	for (let w = 0; w < WARMUP; w++) {
		await runTaskOnce(task, "baseline");
		await runTaskOnce(task, "rtk");
	}

	const base = [];
	const rtk = [];
	for (let i = 0; i < REPS; i++) {
		const b = await runTaskOnce(task, "baseline");
		base.push(b);
		const r = await runTaskOnce(task, "rtk");
		rtk.push(r);
		if (!QUIET) {
			const savings = b.tokens > 0 ? ((b.tokens - r.tokens) / b.tokens) * 100 : 0;
			console.log(
				`  rep ${i + 1}/${REPS}: baseline=${fmtNum(b.tokens)} tok, rtk=${fmtNum(r.tokens)} tok, Δ=${fmtPct(-savings)} (${fmtPct(savings)} savings)`,
			);
		}
	}

	const baseTokens = summarize(base.map((m) => m.tokens));
	const rtkTokens = summarize(rtk.map((m) => m.tokens));
	const baseBytes = summarize(base.map((m) => m.bytes));
	const rtkBytes = summarize(rtk.map((m) => m.bytes));
	const baseLines = summarize(base.map((m) => m.lines));
	const rtkLines = summarize(rtk.map((m) => m.lines));
	const baseTime = summarize(base.map((m) => m.millis));
	const rtkTime = summarize(rtk.map((m) => m.millis));

	const tokenSavingsPct = baseTokens.mean > 0 ? ((baseTokens.mean - rtkTokens.mean) / baseTokens.mean) * 100 : 0;

	taskResults.push({
		task,
		baseTokens,
		rtkTokens,
		baseBytes,
		rtkBytes,
		baseLines,
		rtkLines,
		baseTime,
		rtkTime,
		tokenSavingsPct,
	});

	if (!QUIET) {
		console.log(
			`  SUMMARY baseline=${fmtNum(baseTokens.mean, 0)}±${fmtNum(baseTokens.stdev, 0)} tok  rtk=${fmtNum(rtkTokens.mean, 0)}±${fmtNum(rtkTokens.stdev, 0)} tok  savings=${fmtPct(tokenSavingsPct)}`,
		);
		console.log();
	}
}

// Aggregate: totals across all tasks.
const totalBaseMean = taskResults.reduce((s, r) => s + r.baseTokens.mean, 0);
const totalRtkMean = taskResults.reduce((s, r) => s + r.rtkTokens.mean, 0);
const totalSavingsPct = totalBaseMean > 0 ? ((totalBaseMean - totalRtkMean) / totalBaseMean) * 100 : 0;

// ----------------------------------------------------------------------------
// Report.
// ----------------------------------------------------------------------------

const ts = startTime.toISOString().replace(/[:.]/g, "-").replace(/Z$/, "");
const outDir = resolve(HERE, "results");
mkdirSync(outDir, { recursive: true });
const outPath = resolve(outDir, `${ts}.md`);

const md = [];
md.push(`# pi-rtk benchmark`);
md.push("");
md.push(`- timestamp: \`${startTime.toISOString()}\``);
md.push(`- rtk: \`${rtkVersion}\``);
md.push(`- node: \`${nodeVer}\` on \`${platform}\``);
md.push(`- reps: **${REPS}** per arm, warmup: ${WARMUP}, **serial** (interleaved baseline/rtk)`);
md.push(`- token estimator: \`Math.ceil(chars / 4)\` — same formula pi uses for context accounting`);
md.push("");
md.push(`## Aggregate`);
md.push("");
md.push(`| metric | baseline (mean) | rtk (mean) | savings |`);
md.push(`|---|---:|---:|---:|`);
md.push(`| tokens | ${fmtNum(totalBaseMean)} | ${fmtNum(totalRtkMean)} | **${fmtPct(totalSavingsPct)}** |`);
md.push("");
md.push(`## Per-task results`);
md.push("");
md.push(`| task | baseline tokens (mean ± σ) | rtk tokens (mean ± σ) | savings | baseline ms (median) | rtk ms (median) |`);
md.push(`|---|---:|---:|---:|---:|---:|`);
for (const r of taskResults) {
	md.push(
		`| \`${r.task.name}\` | ${fmtNum(r.baseTokens.mean)} ± ${fmtNum(r.baseTokens.stdev)} | ${fmtNum(r.rtkTokens.mean)} ± ${fmtNum(r.rtkTokens.stdev)} | **${fmtPct(r.tokenSavingsPct)}** | ${fmtMs(r.baseTime.median)} | ${fmtMs(r.rtkTime.median)} |`,
	);
}
md.push("");
md.push(`## Detail`);
md.push("");
for (const r of taskResults) {
	md.push(`### \`${r.task.name}\` — ${r.task.description}`);
	md.push("");
	md.push(`Commands:`);
	md.push("```bash");
	for (const c of r.task.commands) md.push(c);
	md.push("```");
	md.push("");
	md.push(
		`| metric | baseline mean | baseline σ | baseline min | baseline max | rtk mean | rtk σ | rtk min | rtk max |`,
	);
	md.push(`|---|---:|---:|---:|---:|---:|---:|---:|---:|`);
	for (const [label, base, rtk] of [
		["tokens", r.baseTokens, r.rtkTokens],
		["bytes", r.baseBytes, r.rtkBytes],
		["lines", r.baseLines, r.rtkLines],
		["wall ms", r.baseTime, r.rtkTime],
	]) {
		md.push(
			`| ${label} | ${fmtNum(base.mean, label === "wall ms" ? 1 : 0)} | ${fmtNum(base.stdev, label === "wall ms" ? 1 : 0)} | ${fmtNum(base.min, label === "wall ms" ? 1 : 0)} | ${fmtNum(base.max, label === "wall ms" ? 1 : 0)} | ${fmtNum(rtk.mean, label === "wall ms" ? 1 : 0)} | ${fmtNum(rtk.stdev, label === "wall ms" ? 1 : 0)} | ${fmtNum(rtk.min, label === "wall ms" ? 1 : 0)} | ${fmtNum(rtk.max, label === "wall ms" ? 1 : 0)} |`,
		);
	}
	md.push("");
}

md.push(`## Notes`);
md.push("");
md.push(`This benchmark isolates rtk's output-compression effect by executing each`);
md.push(`command twice — once raw, once via the same \`rewriteCommand\` path the`);
md.push(`live extension uses. LLM sampling is deliberately excluded so variance`);
md.push(`comes only from system noise (scheduler, file cache, IO). All arms run`);
md.push(`strictly serially in a single process.`);
md.push("");
md.push(`In a real pi session, the savings observed here apply to **every** bash`);
md.push(`tool call. Because tool results are returned to the LLM on each subsequent`);
md.push(`turn, the effective reduction in per-turn prompt tokens scales multiplicatively`);
md.push(`with the number of tool calls in a conversation.`);
md.push("");

writeFileSync(outPath, md.join("\n"));

if (!QUIET) {
	console.log(`--- aggregate ---`);
	console.log(`  baseline mean: ${fmtNum(totalBaseMean)} tok`);
	console.log(`  rtk mean:      ${fmtNum(totalRtkMean)} tok`);
	console.log(`  savings:       ${fmtPct(totalSavingsPct)}`);
	console.log();
	console.log(`report written to ${outPath}`);
}
