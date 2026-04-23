// Integration tests that exercise the real `rtk` binary on PATH. These
// verify that the exit-code contract pi-rtk relies on has not drifted from
// what rtk actually produces.
//
// Skipped automatically when `rtk` is not installed, so the test suite still
// runs (and passes) on machines without rtk.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { loadExt } from "../helpers/loader.mjs";

const { rewriteCommand } = await loadExt("rewrite");
const { checkRtkInstallation } = await loadExt("version");

// Minimal pi.exec stand-in mirroring @mariozechner/pi-coding-agent's
// execCommand. Only the parts used by version.ts / rewrite.ts.
const realExecPi = {
	exec: (command, args, options = {}) =>
		new Promise((resolveP) => {
			const proc = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], shell: false });
			let stdout = "";
			let stderr = "";
			let killed = false;
			let timeoutId;
			const kill = () => {
				if (!killed) {
					killed = true;
					proc.kill("SIGTERM");
				}
			};
			if (options.signal) options.signal.addEventListener("abort", kill, { once: true });
			if (options.timeout && options.timeout > 0) timeoutId = setTimeout(kill, options.timeout);
			proc.stdout.on("data", (d) => {
				stdout += d.toString();
			});
			proc.stderr.on("data", (d) => {
				stderr += d.toString();
			});
			proc.on("close", (code) => {
				if (timeoutId) clearTimeout(timeoutId);
				resolveP({ stdout, stderr, code: code ?? 0, killed });
			});
			proc.on("error", () => {
				if (timeoutId) clearTimeout(timeoutId);
				resolveP({ stdout, stderr, code: 1, killed });
			});
		}),
};

async function detectRtk() {
	const probe = await checkRtkInstallation(realExecPi, 5000);
	return probe.kind === "ok" ? probe : null;
}

const rtkProbe = await detectRtk();
const skip = rtkProbe === null;
if (skip) {
	console.log("integration/rtk-binary: skipping — rtk binary not available on PATH");
}

test("integration: rtk --version parses cleanly", { skip }, () => {
	assert.match(rtkProbe.version, /^\d+\.\d+\.\d+$/);
});

test("integration: empty command short-circuits (no subprocess)", { skip }, async () => {
	const outcome = await rewriteCommand(realExecPi, "", { timeoutMs: 5000 });
	assert.deepEqual(outcome, { kind: "unchanged" });
});

test("integration: `echo hello` has no rtk equivalent", { skip }, async () => {
	const outcome = await rewriteCommand(realExecPi, "echo hello", { timeoutMs: 5000 });
	assert.deepEqual(outcome, { kind: "unchanged" });
});

test("integration: `git status` is rewritten to `rtk git status`", { skip }, async () => {
	const outcome = await rewriteCommand(realExecPi, "git status", { timeoutMs: 5000 });
	assert.ok(outcome.kind === "rewrite" || outcome.kind === "ask", `got ${outcome.kind}`);
	assert.equal(outcome.command, "rtk git status");
});

test("integration: already-rtk command is not double-wrapped", { skip }, async () => {
	const outcome = await rewriteCommand(realExecPi, "rtk git status", { timeoutMs: 5000 });
	// Either: unchanged outcome, or a rewrite/ask whose command is still
	// "rtk git status" (rtk never produces "rtk rtk git status").
	if (outcome.kind === "unchanged") {
		assert.ok(true);
	} else {
		assert.equal(outcome.command, "rtk git status");
	}
});

test("integration: `ls .` is rewritten to `rtk ls .`", { skip }, async () => {
	const outcome = await rewriteCommand(realExecPi, "ls .", { timeoutMs: 5000 });
	assert.ok(outcome.kind !== "unchanged", "ls should have an rtk equivalent");
	assert.equal(outcome.command, "rtk ls .");
});

test("integration: the binary is reachable as `rtk` on PATH", { skip }, async () => {
	const result = await realExecPi.exec("rtk", ["--version"], { timeout: 5000 });
	assert.equal(result.code, 0);
	assert.match(result.stdout + result.stderr, /rtk \d+\.\d+\.\d+/);
});
