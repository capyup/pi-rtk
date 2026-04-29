import { test } from "node:test";
import assert from "node:assert/strict";
import { loadExt } from "../helpers/loader.mjs";

const config = await loadExt("config");
const { readConfig, clampLines, DEFAULT_TIMEOUT_MS, MAX_WIDGET_LINES, WIDGET_KEY, STATUS_KEY } = config;

test("readConfig: empty env yields defaults", () => {
	const c = readConfig({});
	assert.equal(c.disabled, false);
	assert.equal(c.askMode, "auto");
	assert.equal(c.awareness, true);
	assert.equal(c.timeoutMs, DEFAULT_TIMEOUT_MS);
	assert.equal(c.quiet, false);
	assert.equal(c.latex, true);
});

test("readConfig: PI_RTK_DISABLED=1 sets disabled", () => {
	assert.equal(readConfig({ PI_RTK_DISABLED: "1" }).disabled, true);
});

test("readConfig: PI_RTK_DISABLED other values do not disable", () => {
	assert.equal(readConfig({ PI_RTK_DISABLED: "0" }).disabled, false);
	assert.equal(readConfig({ PI_RTK_DISABLED: "true" }).disabled, false);
	assert.equal(readConfig({ PI_RTK_DISABLED: "" }).disabled, false);
});

test("readConfig: PI_RTK_ASK_MODE is case-insensitive and validates values", () => {
	assert.equal(readConfig({ PI_RTK_ASK_MODE: "confirm" }).askMode, "confirm");
	assert.equal(readConfig({ PI_RTK_ASK_MODE: "CONFIRM" }).askMode, "confirm");
	assert.equal(readConfig({ PI_RTK_ASK_MODE: "Confirm" }).askMode, "confirm");
	assert.equal(readConfig({ PI_RTK_ASK_MODE: "auto" }).askMode, "auto");
	assert.equal(readConfig({ PI_RTK_ASK_MODE: "garbage" }).askMode, "auto");
	assert.equal(readConfig({ PI_RTK_ASK_MODE: "" }).askMode, "auto");
});

test("readConfig: PI_RTK_AWARENESS=0 disables awareness, anything else enables", () => {
	assert.equal(readConfig({ PI_RTK_AWARENESS: "0" }).awareness, false);
	assert.equal(readConfig({ PI_RTK_AWARENESS: "1" }).awareness, true);
	assert.equal(readConfig({ PI_RTK_AWARENESS: "false" }).awareness, true);
	assert.equal(readConfig({ PI_RTK_AWARENESS: "" }).awareness, true);
});

test("readConfig: PI_RTK_TIMEOUT_MS parses positive integers", () => {
	assert.equal(readConfig({ PI_RTK_TIMEOUT_MS: "500" }).timeoutMs, 500);
	assert.equal(readConfig({ PI_RTK_TIMEOUT_MS: "30000" }).timeoutMs, 30000);
});

test("readConfig: PI_RTK_TIMEOUT_MS falls back on non-positive or unparseable", () => {
	assert.equal(readConfig({ PI_RTK_TIMEOUT_MS: "0" }).timeoutMs, DEFAULT_TIMEOUT_MS);
	assert.equal(readConfig({ PI_RTK_TIMEOUT_MS: "-1" }).timeoutMs, DEFAULT_TIMEOUT_MS);
	assert.equal(readConfig({ PI_RTK_TIMEOUT_MS: "abc" }).timeoutMs, DEFAULT_TIMEOUT_MS);
	assert.equal(readConfig({ PI_RTK_TIMEOUT_MS: "" }).timeoutMs, DEFAULT_TIMEOUT_MS);
});

test("readConfig: PI_RTK_QUIET=1 enables quiet mode", () => {
	assert.equal(readConfig({ PI_RTK_QUIET: "1" }).quiet, true);
	assert.equal(readConfig({ PI_RTK_QUIET: "0" }).quiet, false);
	assert.equal(readConfig({ PI_RTK_QUIET: "" }).quiet, false);
});

test("readConfig: PI_RTK_LATEX=0 disables LaTeX summarization", () => {
	assert.equal(readConfig({ PI_RTK_LATEX: "0" }).latex, false);
	assert.equal(readConfig({ PI_RTK_LATEX: "1" }).latex, true);
	assert.equal(readConfig({ PI_RTK_LATEX: "" }).latex, true);
});

test("readConfig: unspecified env argument defaults to process.env", () => {
	// Deliberately do not mutate real env; simply confirm it runs and returns
	// a well-formed Config.
	const c = readConfig();
	assert.equal(typeof c.disabled, "boolean");
	assert.equal(typeof c.askMode, "string");
	assert.equal(typeof c.awareness, "boolean");
	assert.equal(typeof c.timeoutMs, "number");
	assert.equal(typeof c.quiet, "boolean");
	assert.equal(typeof c.latex, "boolean");
});

test("clampLines: returns all lines when at or below limit", () => {
	assert.deepEqual(clampLines("a\nb\nc", 3), ["a", "b", "c"]);
	assert.deepEqual(clampLines("a\nb\nc", 5), ["a", "b", "c"]);
	assert.deepEqual(clampLines("", 5), [""]);
	assert.deepEqual(clampLines("single", 5), ["single"]);
});

test("clampLines: truncates and appends a marker when above limit", () => {
	const result = clampLines("a\nb\nc\nd\ne", 3);
	assert.equal(result.length, 4);
	assert.deepEqual(result.slice(0, 3), ["a", "b", "c"]);
	assert.match(result[3], /2 more line\(s\) truncated/);
});

test("clampLines: handles CRLF line endings", () => {
	assert.deepEqual(clampLines("a\r\nb\r\nc", 5), ["a", "b", "c"]);
});

test("constants: WIDGET_KEY, STATUS_KEY, MAX_WIDGET_LINES exposed and sensible", () => {
	assert.equal(WIDGET_KEY, "rtk");
	assert.equal(STATUS_KEY, "rtk");
	assert.ok(Number.isInteger(MAX_WIDGET_LINES) && MAX_WIDGET_LINES > 0);
});
