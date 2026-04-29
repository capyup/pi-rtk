import { test } from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { loadExt } from "../helpers/loader.mjs";

const { isLatexCommand, shellQuote, buildLatexRewrite } = await loadExt("latex");

test("latex: detects common LaTeX build commands", () => {
	assert.equal(isLatexCommand("latexmk -xelatex main.tex"), true);
	assert.equal(isLatexCommand("cd paper && latexmk -xelatex -interaction=nonstopmode main.tex"), true);
	assert.equal(isLatexCommand("env TEXINPUTS=.:tex// xelatex main.tex"), true);
	assert.equal(isLatexCommand("/Library/TeX/texbin/pdflatex main.tex"), true);
	assert.equal(isLatexCommand("biber main"), true);
});

test("latex: ignores unrelated commands and explicit opt-outs", () => {
	assert.equal(isLatexCommand("echo latexmk"), false);
	assert.equal(isLatexCommand("grep latexmk README.md"), false);
	assert.equal(isLatexCommand("RTK_DISABLED=1 latexmk main.tex"), false);
	assert.equal(isLatexCommand("PI_RTK_LATEX=0 latexmk main.tex"), false);
	assert.equal(isLatexCommand("node /tmp/latex-runner.mjs abc"), false);
});

test("latex: shellQuote is POSIX-safe for single quotes", () => {
	assert.equal(shellQuote("/tmp/a b"), "'/tmp/a b'");
	assert.equal(shellQuote("/tmp/o'hara"), "'/tmp/o'\\''hara'");
});

test("latex: buildLatexRewrite wraps the command with the runner and base64url payload", () => {
	const original = "cd paper && latexmk -xelatex main.tex";
	const rewritten = buildLatexRewrite(original, "/tmp/latex runner.mjs");
	assert.match(rewritten, /^node '\/tmp\/latex runner\.mjs' '[A-Za-z0-9_-]+'$/);
	const encoded = rewritten.match(/'([A-Za-z0-9_-]+)'$/)?.[1];
	assert.equal(Buffer.from(encoded, "base64url").toString("utf8"), original);
});

test("latex: buildLatexRewrite returns null for non-LaTeX commands", () => {
	assert.equal(buildLatexRewrite("git status", "/tmp/latex-runner.mjs"), null);
	assert.equal(buildLatexRewrite("latexmk main.tex", ""), null);
});
