// End-to-end tests for the extension factory (extensions/rtk/index.ts).
// Invokes the default export with a fake ExtensionAPI, captures all handler
// registrations, then synthesizes tool_call / before_agent_start /
// session_start events and /rtk command invocations to verify behavior.

import { test } from "node:test";
import assert from "node:assert/strict";
import { loadExt } from "../helpers/loader.mjs";
import { createFakePi } from "../helpers/fake-pi.mjs";
import { createFakeCtx } from "../helpers/fake-ctx.mjs";
import { execResult } from "../helpers/fake-exec.mjs";

const [{ default: rtkExtension }, { AWARENESS_TEXT }] = await Promise.all([
	loadExt("index"),
	loadExt("awareness"),
]);

function makeBashToolCallEvent(command) {
	return {
		toolCallId: "call-1",
		toolName: "bash",
		input: { command },
	};
}

function makeNonBashToolCallEvent(toolName, input) {
	return {
		toolCallId: "call-1",
		toolName,
		input,
	};
}

/**
 * Boot the extension with a given pi-rtk environment, queueing a
 * version-probe response matching the requested probe shape.
 */
async function boot({ env = {}, probe = "ok" } = {}) {
	const harness = createFakePi();
	const { execStub } = harness;

	// version.ts calls pi.exec("rtk", ["--version"], ...) once during startup.
	switch (probe) {
		case "ok":
			execStub.enqueue(execResult({ stdout: "rtk 0.37.2\n", code: 0 }));
			break;
		case "not-installed":
			execStub.enqueueError(new Error("spawn ENOENT"));
			break;
		case "too-old":
			execStub.enqueue(execResult({ stdout: "rtk 0.1.0\n", code: 0 }));
			break;
		case "unparseable":
			execStub.enqueue(execResult({ stdout: "weird output", code: 0 }));
			break;
		default:
			throw new Error(`unknown probe kind: ${probe}`);
	}

	// Preserve and scope env mutation so tests don't leak.
	const prior = {};
	for (const key of [
		"PI_RTK_DISABLED",
		"PI_RTK_ASK_MODE",
		"PI_RTK_AWARENESS",
		"PI_RTK_TIMEOUT_MS",
		"PI_RTK_QUIET",
		"PI_RTK_LATEX",
	]) {
		prior[key] = process.env[key];
		if (key in env) process.env[key] = env[key];
		else delete process.env[key];
	}

	try {
		await rtkExtension(harness.pi);
	} finally {
		for (const [k, v] of Object.entries(prior)) {
			if (v === undefined) delete process.env[k];
			else process.env[k] = v;
		}
	}
	return harness;
}

// -----------------------------------------------------------------------------
// Disabled path
// -----------------------------------------------------------------------------

test("PI_RTK_DISABLED=1: factory registers only a stub /rtk command", async () => {
	const h = await boot({ env: { PI_RTK_DISABLED: "1" } });
	assert.equal(h.handlers.size, 0, "no event handlers registered");
	assert.ok(h.commands.has("rtk"), "/rtk still registered as a stub");
	assert.equal(h.execStub.calls.length, 0, "no rtk binary probe attempted");
});

test("PI_RTK_DISABLED=1: /rtk command notifies and does nothing", async () => {
	const h = await boot({ env: { PI_RTK_DISABLED: "1" } });
	const ctx = createFakeCtx();
	await h.runCommand("rtk", "", ctx);
	assert.equal(ctx.ui.notifications.length, 1);
	assert.match(ctx.ui.notifications[0].message, /disabled/i);
});

// -----------------------------------------------------------------------------
// Handler registration when enabled
// -----------------------------------------------------------------------------

test("enabled boot: registers session_start, before_agent_start, tool_call, and /rtk", async () => {
	const h = await boot();
	assert.ok(h.handlers.has("session_start"));
	assert.ok(h.handlers.has("before_agent_start"));
	assert.ok(h.handlers.has("tool_call"));
	assert.ok(h.commands.has("rtk"));
});

test("enabled boot: the version probe is the first (and only) startup exec call", async () => {
	const h = await boot();
	assert.equal(h.execStub.calls.length, 1);
	assert.equal(h.execStub.calls[0].command, "rtk");
	assert.deepEqual(h.execStub.calls[0].args, ["--version"]);
});

// -----------------------------------------------------------------------------
// session_start outcomes
// -----------------------------------------------------------------------------

test("session_start (ok): sets the rtk version footer status and emits no warning", async () => {
	const h = await boot();
	const ctx = createFakeCtx();
	await h.fire("session_start", {}, ctx);
	assert.equal(ctx.ui.statuses.get("rtk"), "rtk 0.37.2");
	assert.equal(ctx.ui.notifications.length, 0);
});

test("session_start (not-installed): warns once and does not set a footer status", async () => {
	const h = await boot({ probe: "not-installed" });
	const ctx = createFakeCtx();
	await h.fire("session_start", {}, ctx);
	assert.equal(ctx.ui.notifications.length, 1);
	assert.equal(ctx.ui.notifications[0].type, "warning");
	assert.match(ctx.ui.notifications[0].message, /not installed/i);
	assert.equal(ctx.ui.statuses.has("rtk"), false);
});

test("session_start (too-old): warns with the installed and required versions", async () => {
	const h = await boot({ probe: "too-old" });
	const ctx = createFakeCtx();
	await h.fire("session_start", {}, ctx);
	assert.equal(ctx.ui.notifications.length, 1);
	assert.match(ctx.ui.notifications[0].message, /0\.1\.0/);
	assert.match(ctx.ui.notifications[0].message, /0\.23\.0/);
});

test("session_start (unparseable): warns once", async () => {
	const h = await boot({ probe: "unparseable" });
	const ctx = createFakeCtx();
	await h.fire("session_start", {}, ctx);
	assert.equal(ctx.ui.notifications.length, 1);
	assert.match(ctx.ui.notifications[0].message, /unparseable|weird output/i);
});

test("session_start: PI_RTK_QUIET=1 suppresses startup notifications but keeps the footer", async () => {
	const h = await boot({ env: { PI_RTK_QUIET: "1" } });
	const ctx = createFakeCtx();
	await h.fire("session_start", {}, ctx);
	assert.equal(ctx.ui.notifications.length, 0);
	assert.equal(ctx.ui.statuses.get("rtk"), "rtk 0.37.2");
});

test("session_start: hasUI=false skips all UI calls", async () => {
	const h = await boot();
	const ctx = createFakeCtx({ hasUI: false });
	await h.fire("session_start", {}, ctx);
	assert.equal(ctx.ui.notifications.length, 0);
	assert.equal(ctx.ui.statuses.size, 0);
});

// -----------------------------------------------------------------------------
// before_agent_start (awareness injection)
// -----------------------------------------------------------------------------

test("before_agent_start: appends awareness to the system prompt when enabled", async () => {
	const h = await boot();
	const ctx = createFakeCtx();
	const results = await h.fire("before_agent_start", { systemPrompt: "SYS" }, ctx);
	assert.equal(results.length, 1);
	assert.ok(results[0].systemPrompt.startsWith("SYS"));
	assert.ok(results[0].systemPrompt.includes(AWARENESS_TEXT));
});

test("before_agent_start: PI_RTK_AWARENESS=0 skips the append", async () => {
	const h = await boot({ env: { PI_RTK_AWARENESS: "0" } });
	const ctx = createFakeCtx();
	const results = await h.fire("before_agent_start", { systemPrompt: "SYS" }, ctx);
	assert.equal(results[0], undefined);
});

test("before_agent_start: does not append when rtk is missing", async () => {
	const h = await boot({ probe: "not-installed" });
	const ctx = createFakeCtx();
	const results = await h.fire("before_agent_start", { systemPrompt: "SYS" }, ctx);
	assert.equal(results[0], undefined);
});

// -----------------------------------------------------------------------------
// tool_call hook: bash rewrite
// -----------------------------------------------------------------------------

test("tool_call: rewrites a bash command (exit 0) in place", async () => {
	const h = await boot();
	h.execStub.enqueue(execResult({ stdout: "rtk git status\n", code: 0 }));
	const event = makeBashToolCallEvent("git status");
	const ctx = createFakeCtx();
	const [ret] = await h.fire("tool_call", event, ctx);
	assert.equal(ret, undefined, "hook returns nothing (non-blocking)");
	assert.equal(event.input.command, "rtk git status");
});

test("tool_call: auto mode applies an ask-rule rewrite without prompting", async () => {
	const h = await boot();
	h.execStub.enqueue(execResult({ stdout: "rtk git push", code: 3 }));
	const event = makeBashToolCallEvent("git push");
	const ctx = createFakeCtx();
	await h.fire("tool_call", event, ctx);
	assert.equal(event.input.command, "rtk git push");
	assert.equal(ctx.ui.confirmCalls.length, 0);
});

test("tool_call: confirm mode prompts on ask-rule; user accepts", async () => {
	const h = await boot({ env: { PI_RTK_ASK_MODE: "confirm" } });
	h.execStub.enqueue(execResult({ stdout: "rtk git push", code: 3 }));
	const event = makeBashToolCallEvent("git push");
	const ctx = createFakeCtx({ confirmAnswer: true });
	await h.fire("tool_call", event, ctx);
	assert.equal(ctx.ui.confirmCalls.length, 1);
	assert.equal(event.input.command, "rtk git push");
});

test("tool_call: confirm mode prompts on ask-rule; user declines", async () => {
	const h = await boot({ env: { PI_RTK_ASK_MODE: "confirm" } });
	h.execStub.enqueue(execResult({ stdout: "rtk git push", code: 3 }));
	const event = makeBashToolCallEvent("git push");
	const ctx = createFakeCtx({ confirmAnswer: false });
	await h.fire("tool_call", event, ctx);
	assert.equal(ctx.ui.confirmCalls.length, 1);
	assert.equal(event.input.command, "git push", "command untouched on decline");
});

test("tool_call: confirm mode falls back to auto-apply when ctx has no UI", async () => {
	const h = await boot({ env: { PI_RTK_ASK_MODE: "confirm" } });
	h.execStub.enqueue(execResult({ stdout: "rtk git push", code: 3 }));
	const event = makeBashToolCallEvent("git push");
	const ctx = createFakeCtx({ hasUI: false });
	await h.fire("tool_call", event, ctx);
	assert.equal(event.input.command, "rtk git push");
	assert.equal(ctx.ui.confirmCalls.length, 0);
});

test("tool_call: no-equivalent (exit 1) leaves non-LaTeX commands untouched", async () => {
	const h = await boot();
	h.execStub.enqueue(execResult({ stdout: "", code: 1 }));
	const event = makeBashToolCallEvent("echo hello");
	await h.fire("tool_call", event, createFakeCtx());
	assert.equal(event.input.command, "echo hello");
});

test("tool_call: no-equivalent LaTeX command uses the local transcript summarizer", async () => {
	const h = await boot();
	h.execStub.enqueue(execResult({ stdout: "", code: 1 }));
	const event = makeBashToolCallEvent("cd paper && latexmk -xelatex -interaction=nonstopmode main.tex");
	await h.fire("tool_call", event, createFakeCtx());
	assert.match(event.input.command, /^node /);
	assert.match(event.input.command, /latex-runner\.mjs/);
	assert.notEqual(event.input.command, "cd paper && latexmk -xelatex -interaction=nonstopmode main.tex");
});

test("tool_call: PI_RTK_LATEX=0 disables the local LaTeX fallback", async () => {
	const h = await boot({ env: { PI_RTK_LATEX: "0" } });
	h.execStub.enqueue(execResult({ stdout: "", code: 1 }));
	const event = makeBashToolCallEvent("latexmk -xelatex main.tex");
	await h.fire("tool_call", event, createFakeCtx());
	assert.equal(event.input.command, "latexmk -xelatex main.tex");
});

test("tool_call: deny-rule (exit 2) leaves the command untouched", async () => {
	const h = await boot();
	h.execStub.enqueue(execResult({ stdout: "", code: 2 }));
	const event = makeBashToolCallEvent("rm -rf /");
	await h.fire("tool_call", event, createFakeCtx());
	assert.equal(event.input.command, "rm -rf /");
});

test("tool_call: ignores non-bash tools (read, grep, glob, list)", async () => {
	const h = await boot();
	// Exec stub should NOT be called at all.
	for (const toolName of ["read", "grep", "glob", "list", "edit", "write"]) {
		const event = makeNonBashToolCallEvent(toolName, { path: "/tmp/x" });
		await h.fire("tool_call", event, createFakeCtx());
	}
	// Only the startup version probe should be in the call log.
	assert.equal(h.execStub.calls.length, 1);
});

test("tool_call: empty bash command is a no-op (no rtk call)", async () => {
	const h = await boot();
	const event = makeBashToolCallEvent("");
	await h.fire("tool_call", event, createFakeCtx());
	assert.equal(h.execStub.calls.length, 1, "only the startup probe, no rewrite call");
	assert.equal(event.input.command, "");
});

test("tool_call: if rtk probe failed, the hook passes bash through unchanged", async () => {
	const h = await boot({ probe: "not-installed" });
	const event = makeBashToolCallEvent("git status");
	await h.fire("tool_call", event, createFakeCtx());
	assert.equal(event.input.command, "git status");
});

test("tool_call: after /rtk off, the hook no longer rewrites", async () => {
	const h = await boot();
	await h.runCommand("rtk", "off", createFakeCtx());
	// Any further rewrite attempt must NOT invoke rtk rewrite at all.
	const callsBefore = h.execStub.calls.length;
	const event = makeBashToolCallEvent("git status");
	await h.fire("tool_call", event, createFakeCtx());
	assert.equal(event.input.command, "git status");
	assert.equal(h.execStub.calls.length, callsBefore);
});

test("tool_call: /rtk on after /rtk off restores rewriting", async () => {
	const h = await boot();
	await h.runCommand("rtk", "off", createFakeCtx());
	await h.runCommand("rtk", "on", createFakeCtx());
	h.execStub.enqueue(execResult({ stdout: "rtk git status", code: 0 }));
	const event = makeBashToolCallEvent("git status");
	await h.fire("tool_call", event, createFakeCtx());
	assert.equal(event.input.command, "rtk git status");
});

// -----------------------------------------------------------------------------
// /rtk command handler
// -----------------------------------------------------------------------------

test("/rtk (default): runs `rtk gain` and shows output in the widget", async () => {
	const h = await boot();
	h.execStub.enqueue(execResult({ stdout: "total savings: 100k\nby command: ...", code: 0 }));
	const ctx = createFakeCtx();
	await h.runCommand("rtk", "", ctx);
	const widget = ctx.ui.widgets.get("rtk");
	assert.ok(Array.isArray(widget));
	assert.equal(widget[0], "$ rtk gain");
	assert.deepEqual(h.execStub.calls.at(-1).args, ["gain"]);
});

test("/rtk <args>: splits on whitespace and forwards to rtk", async () => {
	const h = await boot();
	h.execStub.enqueue(execResult({ stdout: "discover output", code: 0 }));
	const ctx = createFakeCtx();
	await h.runCommand("rtk", "discover --since 7", ctx);
	assert.deepEqual(h.execStub.calls.at(-1).args, ["discover", "--since", "7"]);
	assert.equal(ctx.ui.widgets.get("rtk")[0], "$ rtk discover --since 7");
});

test("/rtk clear: removes the widget", async () => {
	const h = await boot();
	h.execStub.enqueue(execResult({ stdout: "savings", code: 0 }));
	const ctx = createFakeCtx();
	await h.runCommand("rtk", "", ctx);
	assert.ok(ctx.ui.widgets.has("rtk"));
	await h.runCommand("rtk", "clear", ctx);
	assert.equal(ctx.ui.widgets.has("rtk"), false);
});

test("/rtk status: reports enabled state and the installed version", async () => {
	const h = await boot();
	const ctx = createFakeCtx();
	await h.runCommand("rtk", "status", ctx);
	assert.equal(ctx.ui.notifications.length, 1);
	const msg = ctx.ui.notifications[0].message;
	assert.match(msg, /enabled/);
	assert.match(msg, /0\.37\.2/);
});

test("/rtk status: reports disabled state after /rtk off", async () => {
	const h = await boot();
	const ctx = createFakeCtx();
	await h.runCommand("rtk", "off", ctx);
	await h.runCommand("rtk", "status", ctx);
	const last = ctx.ui.notifications.at(-1).message;
	assert.match(last, /disabled/);
});

test("/rtk on: refuses when rtk is not installed", async () => {
	const h = await boot({ probe: "not-installed" });
	const ctx = createFakeCtx();
	await h.runCommand("rtk", "on", ctx);
	assert.equal(ctx.ui.notifications.at(-1).type, "warning");
	assert.match(ctx.ui.notifications.at(-1).message, /not installed|cannot enable/i);
});

test("/rtk (meta call) short-circuits when rtk is missing", async () => {
	const h = await boot({ probe: "not-installed" });
	const ctx = createFakeCtx();
	const callsBefore = h.execStub.calls.length;
	await h.runCommand("rtk", "", ctx);
	assert.equal(h.execStub.calls.length, callsBefore, "no rtk subprocess attempted");
	assert.equal(ctx.ui.notifications.length, 1);
	assert.equal(ctx.ui.notifications[0].type, "warning");
});

test("/rtk: when the subprocess emits no output, notifies instead of setting a blank widget", async () => {
	const h = await boot();
	h.execStub.enqueue(execResult({ stdout: "", stderr: "", code: 0 }));
	const ctx = createFakeCtx();
	await h.runCommand("rtk", "", ctx);
	assert.equal(ctx.ui.widgets.has("rtk"), false);
	assert.equal(ctx.ui.notifications.length, 1);
	assert.match(ctx.ui.notifications[0].message, /no output/i);
});

test("/rtk: appends an exit-code note when the subprocess fails", async () => {
	const h = await boot();
	h.execStub.enqueue(execResult({ stdout: "bad output", stderr: "oops", code: 7 }));
	const ctx = createFakeCtx();
	await h.runCommand("rtk", "", ctx);
	const lines = ctx.ui.widgets.get("rtk");
	assert.ok(lines.some((l) => /exit code 7/.test(l)), `expected exit-code note; got: ${JSON.stringify(lines)}`);
});

test("/rtk: truncates very long output to MAX_WIDGET_LINES", async () => {
	const h = await boot();
	const many = Array.from({ length: 200 }, (_, i) => `line ${i}`).join("\n");
	h.execStub.enqueue(execResult({ stdout: many, code: 0 }));
	const ctx = createFakeCtx();
	await h.runCommand("rtk", "", ctx);
	const widget = ctx.ui.widgets.get("rtk");
	// Header (2 lines) + MAX_WIDGET_LINES (40) + truncation marker (1) = 43 lines.
	assert.ok(widget.length <= 43, `widget too long: ${widget.length}`);
	assert.ok(widget.some((l) => /truncated/.test(l)), "truncation marker missing");
});

test("/rtk: autocompletion returns meta-command suggestions filtered by prefix", async () => {
	const h = await boot();
	const cmd = h.commands.get("rtk");
	assert.equal(typeof cmd.getArgumentCompletions, "function");
	const all = cmd.getArgumentCompletions("");
	assert.ok(Array.isArray(all) && all.length > 0);
	const gain = cmd.getArgumentCompletions("gain");
	assert.ok(gain.every((i) => i.value.startsWith("gain")));
	const none = cmd.getArgumentCompletions("zzzzz");
	assert.equal(none, null);
});
