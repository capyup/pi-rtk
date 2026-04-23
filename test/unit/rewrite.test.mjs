import { test } from "node:test";
import assert from "node:assert/strict";
import { loadExt } from "../helpers/loader.mjs";
import { makeExecStub, execResult } from "../helpers/fake-exec.mjs";

const { rewriteCommand } = await loadExt("rewrite");

function makePi(stub) {
	return { exec: stub.fn };
}

test("rewrite: empty command short-circuits without invoking rtk", async () => {
	const stub = makeExecStub();
	const outcome = await rewriteCommand(makePi(stub), "", { timeoutMs: 100 });
	assert.deepEqual(outcome, { kind: "unchanged" });
	assert.equal(stub.calls.length, 0, "exec should not be called");
});

test("rewrite: whitespace-only command short-circuits", async () => {
	const stub = makeExecStub();
	const outcome = await rewriteCommand(makePi(stub), "   \t \n ", { timeoutMs: 100 });
	assert.deepEqual(outcome, { kind: "unchanged" });
	assert.equal(stub.calls.length, 0);
});

test("rewrite: exit 0 with different stdout yields rewrite", async () => {
	const stub = makeExecStub();
	stub.enqueue(execResult({ stdout: "rtk git status\n", code: 0 }));
	const outcome = await rewriteCommand(makePi(stub), "git status");
	assert.deepEqual(outcome, { kind: "rewrite", command: "rtk git status" });
});

test("rewrite: exit 0 with identical stdout yields unchanged (idempotent)", async () => {
	const stub = makeExecStub();
	stub.enqueue(execResult({ stdout: "rtk git status", code: 0 }));
	const outcome = await rewriteCommand(makePi(stub), "rtk git status");
	assert.deepEqual(outcome, { kind: "unchanged" });
});

test("rewrite: exit 0 with empty stdout yields unchanged", async () => {
	const stub = makeExecStub();
	stub.enqueue(execResult({ stdout: "", code: 0 }));
	const outcome = await rewriteCommand(makePi(stub), "git status");
	assert.deepEqual(outcome, { kind: "unchanged" });
});

test("rewrite: exit 1 (no rtk equivalent) yields unchanged", async () => {
	const stub = makeExecStub();
	stub.enqueue(execResult({ stdout: "", code: 1 }));
	const outcome = await rewriteCommand(makePi(stub), "echo hello");
	assert.deepEqual(outcome, { kind: "unchanged" });
});

test("rewrite: exit 2 (deny rule) yields unchanged", async () => {
	const stub = makeExecStub();
	stub.enqueue(execResult({ stdout: "", code: 2 }));
	const outcome = await rewriteCommand(makePi(stub), "rm -rf /");
	assert.deepEqual(outcome, { kind: "unchanged" });
});

test("rewrite: exit 3 (ask rule) with different stdout yields ask", async () => {
	const stub = makeExecStub();
	stub.enqueue(execResult({ stdout: "rtk git push", code: 3 }));
	const outcome = await rewriteCommand(makePi(stub), "git push");
	assert.deepEqual(outcome, { kind: "ask", command: "rtk git push" });
});

test("rewrite: exit 3 with identical stdout yields unchanged (already-rtk)", async () => {
	const stub = makeExecStub();
	stub.enqueue(execResult({ stdout: "rtk git push", code: 3 }));
	const outcome = await rewriteCommand(makePi(stub), "rtk git push");
	assert.deepEqual(outcome, { kind: "unchanged" });
});

test("rewrite: unrecognized exit codes yield unchanged", async () => {
	for (const code of [4, 5, 42, 128, 137, 255, -1]) {
		const stub = makeExecStub();
		stub.enqueue(execResult({ stdout: "something", code }));
		const outcome = await rewriteCommand(makePi(stub), "git status");
		assert.deepEqual(outcome, { kind: "unchanged" }, `exit ${code} should be unchanged`);
	}
});

test("rewrite: killed subprocess yields unchanged regardless of code", async () => {
	const stub = makeExecStub();
	stub.enqueue(execResult({ stdout: "rtk git status", code: 0, killed: true }));
	const outcome = await rewriteCommand(makePi(stub), "git status");
	assert.deepEqual(outcome, { kind: "unchanged" });
});

test("rewrite: exec rejection degrades to unchanged", async () => {
	const stub = makeExecStub();
	stub.enqueueError(new Error("ENOENT: rtk not found"));
	const outcome = await rewriteCommand(makePi(stub), "git status");
	assert.deepEqual(outcome, { kind: "unchanged" });
});

test("rewrite: command is passed to rtk as a single argv element", async () => {
	const stub = makeExecStub();
	stub.enqueue(execResult({ stdout: "rtk cargo test && rtk git push", code: 0 }));
	await rewriteCommand(makePi(stub), "cargo test && git push");
	assert.equal(stub.calls.length, 1);
	assert.equal(stub.calls[0].command, "rtk");
	assert.deepEqual(stub.calls[0].args, ["rewrite", "cargo test && git push"]);
});

test("rewrite: respects custom timeout option", async () => {
	const stub = makeExecStub();
	stub.enqueue(execResult({ stdout: "rtk ls", code: 0 }));
	await rewriteCommand(makePi(stub), "ls", { timeoutMs: 7777 });
	assert.equal(stub.calls[0].options?.timeout, 7777);
});

test("rewrite: uses a 2000ms default timeout when none is provided", async () => {
	const stub = makeExecStub();
	stub.enqueue(execResult({ stdout: "rtk ls", code: 0 }));
	await rewriteCommand(makePi(stub), "ls");
	assert.equal(stub.calls[0].options?.timeout, 2000);
});

test("rewrite: forwards abort signal to pi.exec", async () => {
	const stub = makeExecStub();
	stub.enqueue(execResult({ stdout: "rtk ls", code: 0 }));
	const ac = new AbortController();
	await rewriteCommand(makePi(stub), "ls", { signal: ac.signal });
	assert.equal(stub.calls[0].options?.signal, ac.signal);
});

test("rewrite: trims trailing newlines from rtk stdout", async () => {
	const stub = makeExecStub();
	stub.enqueue(execResult({ stdout: "rtk git status\n\n", code: 0 }));
	const outcome = await rewriteCommand(makePi(stub), "git status");
	assert.deepEqual(outcome, { kind: "rewrite", command: "rtk git status" });
});
