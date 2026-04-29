#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const MAX_COMMAND = 240;
const MAX_ITEM = 220;
const MAX_ERRORS = 10;
const MAX_WARNINGS = 10;
const MAX_OVERFULL = 8;
const MAX_TAIL = 20;

function die(message) {
	console.error(`rtk latex summary`);
	console.error(`status: failed before execution`);
	console.error(`error: ${message}`);
	process.exit(127);
}

function decodeCommand(raw) {
	if (!raw) die("missing encoded command");
	try {
		return Buffer.from(raw, "base64url").toString("utf8");
	} catch (err) {
		die(`could not decode command: ${err instanceof Error ? err.message : String(err)}`);
	}
}

function timestamp() {
	const d = new Date();
	const pad = (n) => String(n).padStart(2, "0");
	return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function truncate(text, max = MAX_ITEM) {
	const compact = String(text).replace(/\s+/g, " ").trim();
	if (compact.length <= max) return compact;
	return `${compact.slice(0, Math.max(0, max - 3))}...`;
}

function uniquePush(items, value, max) {
	const compact = truncate(value);
	if (!compact || items.includes(compact)) return;
	if (items.length < max) items.push(compact);
}

function countMatches(lines, re) {
	let count = 0;
	for (const line of lines) if (re.test(line)) count += 1;
	return count;
}

function summarize(logPath, command, code, signal) {
	let text = "";
	try {
		text = readFileSync(logPath, "utf8");
	} catch (err) {
		text = `[rtk-latex-runner could not read transcript: ${err instanceof Error ? err.message : String(err)}]`;
	}

	const lines = text.split(/\r?\n/);
	const errors = [];
	const warnings = [];
	const overfull = [];
	const artifacts = [];

	for (let i = 0; i < lines.length; i += 1) {
		const line = lines[i];
		const trimmed = line.trim();
		if (!trimmed) continue;

		if (/^(Output written on|\S+\.(?:xdv|dvi) -> \S+\.pdf|\d+ bytes written|Latexmk: All targets)/.test(trimmed)) {
			uniquePush(artifacts, trimmed, 8);
		}

		const overfullMatch = /Overfull \\hbox \(([0-9.]+)pt too wide\)/.exec(trimmed);
		if (overfullMatch && Number.parseFloat(overfullMatch[1]) > 1) {
			uniquePush(overfull, `${trimmed}${lines[i + 1] ? ` ${lines[i + 1].trim()}` : ""}`, MAX_OVERFULL);
		}

		if (/^(LaTeX|Package|Class|pdfTeX|XeTeX|LuaTeX|fontspec|xeCJK|unicode-math|rerunfilecheck).*Warning:/.test(trimmed)) {
			uniquePush(warnings, trimmed, MAX_WARNINGS);
		}

		if (
			/^! /.test(trimmed) ||
			/(LaTeX|Package|Class).* Error:/.test(trimmed) ||
			/(Fatal error|Emergency stop|Undefined control sequence|Runaway argument|File `.*' not found|Missing .* inserted)/i.test(trimmed)
		) {
			const context = lines[i + 1] && /^l\.\d+/.test(lines[i + 1].trim()) ? ` ${lines[i + 1].trim()}` : "";
			uniquePush(errors, `${trimmed}${context}`, MAX_ERRORS);
		}
	}

	const warningCount = countMatches(lines, /Warning:/);
	const overfullCount = countMatches(lines, /Overfull \\hbox \(([0-9.]+)pt too wide\)/);
	const rerunCount = countMatches(lines, /(Rerun|References changed|Label\(s\) may have changed|undefined references)/i);
	const status = code === 0 ? "ok" : `failed (exit ${code}${signal ? `, signal ${signal}` : ""})`;

	const out = [];
	out.push("rtk latex summary");
	out.push(`status: ${status}`);
	out.push(`command: ${truncate(command, MAX_COMMAND)}`);
	out.push(`raw log: ${logPath}`);
	if (artifacts.length > 0) {
		out.push("artifacts:");
		for (const item of artifacts) out.push(`  - ${item}`);
	}
	if (errors.length > 0) {
		out.push("errors:");
		for (const item of errors) out.push(`  - ${item}`);
	}
	if (overfull.length > 0) {
		out.push(`overfull hbox >1pt (${overfullCount} total):`);
		for (const item of overfull) out.push(`  - ${item}`);
	}
	if (warnings.length > 0) {
		out.push(`warnings (${warningCount} total):`);
		for (const item of warnings) out.push(`  - ${item}`);
	}
	if (rerunCount > 0) out.push(`rerun/reference notices: ${rerunCount}`);
	if (errors.length === 0 && warnings.length === 0 && overfull.length === 0) {
		out.push("diagnostics: no LaTeX errors, warnings, or >1pt overfull boxes detected in transcript.");
	}
	if (code !== 0 && errors.length === 0) {
		const tail = lines.map((line) => line.trim()).filter(Boolean).slice(-MAX_TAIL);
		if (tail.length > 0) {
			out.push("tail:");
			for (const line of tail) out.push(`  - ${truncate(line)}`);
		}
	}
	console.log(out.join("\n"));
}

const command = decodeCommand(process.argv[2]);
const logDir = resolve(process.env.PI_RTK_LATEX_LOG_DIR || join(process.cwd(), ".pi", "rtk", "latex"));
mkdirSync(logDir, { recursive: true });
const hash = createHash("sha1").update(process.cwd()).update("\0").update(command).update("\0").update(String(Date.now())).digest("hex").slice(0, 10);
const logPath = join(logDir, `${timestamp()}-${hash}.log`);
const stream = createWriteStream(logPath, { flags: "wx" });
stream.write(`$ ${command}\n\n`);

let finished = false;
function finish(code, signal = null) {
	if (finished) return;
	finished = true;
	const exitCode = Number.isInteger(code) ? code : 1;
	stream.end(() => {
		summarize(logPath, command, exitCode, signal);
		process.exit(exitCode);
	});
}

const child = spawn(command, {
	cwd: process.cwd(),
	env: process.env,
	shell: true,
	stdio: ["ignore", "pipe", "pipe"],
});

child.stdout.on("data", (chunk) => stream.write(chunk));
child.stderr.on("data", (chunk) => stream.write(chunk));
child.on("error", (err) => {
	stream.write(`\n[rtk-latex-runner spawn error] ${err instanceof Error ? err.stack || err.message : String(err)}\n`);
	finish(127);
});
child.on("close", (code, signal) => finish(code, signal));
