import { test } from "node:test";
import assert from "node:assert/strict";
import { loadExt } from "../helpers/loader.mjs";
import { makeExecStub, execResult } from "../helpers/fake-exec.mjs";

const version = await loadExt("version");
const { checkRtkInstallation, MIN_RTK_VERSION, formatVersion } = version;

function makePi(stub) {
	return { exec: stub.fn };
}

test("formatVersion: produces dotted triple", () => {
	assert.equal(formatVersion({ major: 0, minor: 23, patch: 0 }), "0.23.0");
	assert.equal(formatVersion({ major: 1, minor: 2, patch: 3 }), "1.2.3");
});

test("MIN_RTK_VERSION: is 0.23.0", () => {
	assert.deepEqual(MIN_RTK_VERSION, { major: 0, minor: 23, patch: 0 });
});

test("check: parses modern rtk version output", async () => {
	const stub = makeExecStub();
	stub.enqueue(execResult({ stdout: "rtk 0.37.2\n", code: 0 }));
	const r = await checkRtkInstallation(makePi(stub));
	assert.deepEqual(r, { kind: "ok", version: "0.37.2" });
});

test("check: version exactly at the minimum is accepted", async () => {
	const stub = makeExecStub();
	stub.enqueue(execResult({ stdout: "rtk 0.23.0\n", code: 0 }));
	const r = await checkRtkInstallation(makePi(stub));
	assert.deepEqual(r, { kind: "ok", version: "0.23.0" });
});

test("check: version above the minimum is accepted", async () => {
	const stub = makeExecStub();
	stub.enqueue(execResult({ stdout: "rtk 1.0.0", code: 0 }));
	const r = await checkRtkInstallation(makePi(stub));
	assert.deepEqual(r, { kind: "ok", version: "1.0.0" });
});

test("check: version below the minimum is rejected", async () => {
	const stub = makeExecStub();
	stub.enqueue(execResult({ stdout: "rtk 0.22.9\n", code: 0 }));
	const r = await checkRtkInstallation(makePi(stub));
	assert.deepEqual(r, { kind: "too-old", version: "0.22.9", minVersion: "0.23.0" });
});

test("check: patch-level below minimum of same minor is still accepted (ok)", async () => {
	const stub = makeExecStub();
	stub.enqueue(execResult({ stdout: "rtk 0.23.0", code: 0 }));
	const r = await checkRtkInstallation(makePi(stub));
	assert.equal(r.kind, "ok");
});

test("check: much-older 0.1.x is rejected", async () => {
	const stub = makeExecStub();
	stub.enqueue(execResult({ stdout: "rtk 0.1.99", code: 0 }));
	const r = await checkRtkInstallation(makePi(stub));
	assert.equal(r.kind, "too-old");
	assert.equal(r.version, "0.1.99");
});

test("check: unparseable output returns unparseable", async () => {
	const stub = makeExecStub();
	stub.enqueue(execResult({ stdout: "some other thing", code: 0 }));
	const r = await checkRtkInstallation(makePi(stub));
	assert.equal(r.kind, "unparseable");
	assert.equal(r.raw, "some other thing");
});

test("check: empty output returns unparseable", async () => {
	const stub = makeExecStub();
	stub.enqueue(execResult({ stdout: "", code: 0 }));
	const r = await checkRtkInstallation(makePi(stub));
	assert.equal(r.kind, "unparseable");
});

test("check: non-zero exit maps to not-installed", async () => {
	const stub = makeExecStub();
	stub.enqueue(execResult({ stdout: "", stderr: "command not found", code: 127 }));
	const r = await checkRtkInstallation(makePi(stub));
	assert.deepEqual(r, { kind: "not-installed" });
});

test("check: killed subprocess maps to not-installed", async () => {
	const stub = makeExecStub();
	stub.enqueue(execResult({ stdout: "rtk 0.37.2", code: 0, killed: true }));
	const r = await checkRtkInstallation(makePi(stub));
	assert.deepEqual(r, { kind: "not-installed" });
});

test("check: exec rejection maps to not-installed", async () => {
	const stub = makeExecStub();
	stub.enqueueError(new Error("spawn ENOENT"));
	const r = await checkRtkInstallation(makePi(stub));
	assert.deepEqual(r, { kind: "not-installed" });
});

test("check: forwards the requested timeout to pi.exec", async () => {
	const stub = makeExecStub();
	stub.enqueue(execResult({ stdout: "rtk 0.37.2", code: 0 }));
	await checkRtkInstallation(makePi(stub), 1234);
	assert.equal(stub.calls[0].options?.timeout, 1234);
});

test("check: falls back to stderr when stdout is empty", async () => {
	// Some tools print version to stderr. Our parser considers both streams.
	const stub = makeExecStub();
	stub.enqueue(execResult({ stdout: "", stderr: "rtk 0.30.0", code: 0 }));
	const r = await checkRtkInstallation(makePi(stub));
	assert.deepEqual(r, { kind: "ok", version: "0.30.0" });
});

test("check: tolerates extra trailing text after the version", async () => {
	const stub = makeExecStub();
	stub.enqueue(execResult({ stdout: "rtk 0.37.2 (release)\n", code: 0 }));
	const r = await checkRtkInstallation(makePi(stub));
	assert.deepEqual(r, { kind: "ok", version: "0.37.2" });
});
