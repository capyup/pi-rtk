import { test } from "node:test";
import assert from "node:assert/strict";
import { loadExt } from "../helpers/loader.mjs";

const { AWARENESS_TEXT } = await loadExt("awareness");

test("AWARENESS_TEXT is a non-empty string", () => {
	assert.equal(typeof AWARENESS_TEXT, "string");
	assert.ok(AWARENESS_TEXT.length > 100, "awareness text should be substantive");
});

test("AWARENESS_TEXT mentions the bash-only scope", () => {
	assert.match(AWARENESS_TEXT, /bash/i);
});

test("AWARENESS_TEXT lists key meta commands that are not auto-rewritten", () => {
	for (const meta of ["rtk gain", "rtk discover", "rtk proxy", "rtk --version"]) {
		assert.match(AWARENESS_TEXT, new RegExp(meta.replace(/ /g, "\\s+")), `missing mention of \`${meta}\``);
	}
});

test("AWARENESS_TEXT documents the RTK_DISABLED per-command opt-out", () => {
	assert.match(AWARENESS_TEXT, /RTK_DISABLED=1/);
});

test("AWARENESS_TEXT explains that non-bash pi tools bypass the hook", () => {
	assert.match(AWARENESS_TEXT, /read.*grep.*glob.*list/s);
});
