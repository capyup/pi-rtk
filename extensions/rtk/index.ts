/**
 * pi-rtk — pi integration for rtk (Rust Token Killer).
 *
 * Intercepts the built-in `bash` tool and rewrites commands through
 * `rtk rewrite` for token-optimized execution. All rewrite decisions live in
 * the upstream rtk Rust registry; this extension is a thin delegate matching
 * the pattern used by rtk's own OpenCode plugin.
 *
 * Configuration (environment variables):
 *   PI_RTK_DISABLED=1            disable the extension entirely
 *   PI_RTK_ASK_MODE=auto|confirm how to handle rtk's "ask" verdict (default: auto)
 *   PI_RTK_AWARENESS=0           skip the system-prompt addition
 *   PI_RTK_TIMEOUT_MS=2000       per-call timeout for `rtk rewrite`
 *   PI_RTK_QUIET=1               suppress startup notifications
 *   PI_RTK_LATEX=0               disable local LaTeX transcript summarization
 */

import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";
import { AWARENESS_TEXT } from "./awareness.js";
import {
	clampLines,
	MAX_WIDGET_LINES,
	readConfig,
	STATUS_KEY,
	WIDGET_KEY,
} from "./config.js";
import { buildLatexRewrite } from "./latex.js";
import { rewriteCommand } from "./rewrite.js";
import { checkRtkInstallation } from "./version.js";

const LATEX_RUNNER_PATH = fileURLToPath(new URL("./latex-runner.mjs", import.meta.url));

export default async function rtkExtension(pi: ExtensionAPI) {
	const config = readConfig();

	if (config.disabled) {
		pi.registerCommand("rtk", {
			description: "pi-rtk is disabled (PI_RTK_DISABLED=1).",
			handler: async (_args, ctx) => {
				ctx.ui.notify("pi-rtk is disabled (PI_RTK_DISABLED=1).", "info");
			},
		});
		return;
	}

	const probe = await checkRtkInstallation(pi, config.timeoutMs);
	// Mutable so the user can toggle at runtime via `/rtk off` and `/rtk on`.
	let installed = probe.kind === "ok";
	let runtimeEnabled = installed;

	pi.on("session_start", async (_event, ctx) => {
		if (!ctx.hasUI) return;
		if (!config.quiet) {
			switch (probe.kind) {
				case "not-installed":
					ctx.ui.notify(
						"pi-rtk: `rtk` is not installed or not on PATH. Install from https://github.com/rtk-ai/rtk — the extension is idle until then.",
						"warning",
					);
					break;
				case "too-old":
					ctx.ui.notify(
						`pi-rtk: rtk ${probe.version} is below the required ${probe.minVersion}. Upgrade with "brew upgrade rtk" or "cargo install --git https://github.com/rtk-ai/rtk" — the extension is idle until then.`,
						"warning",
					);
					break;
				case "unparseable":
					ctx.ui.notify(
						`pi-rtk: could not parse rtk version output (${probe.raw}). The extension is idle.`,
						"warning",
					);
					break;
				case "ok":
					// No startup toast; the footer status is enough.
					break;
			}
		}
		if (probe.kind === "ok") {
			ctx.ui.setStatus(STATUS_KEY, `rtk ${probe.version}`);
		}
	});

	pi.on("before_agent_start", (event) => {
		if (!runtimeEnabled || !config.awareness) return undefined;
		return {
			systemPrompt: `${event.systemPrompt}\n\n${AWARENESS_TEXT}`,
		};
	});

	pi.on("tool_call", async (event, ctx) => {
		if (!runtimeEnabled) return undefined;
		if (!isToolCallEventType("bash", event)) return undefined;

		const originalCommand = event.input.command;
		if (typeof originalCommand !== "string" || !originalCommand.trim()) return undefined;

		const outcome = await rewriteCommand(pi, originalCommand, {
			timeoutMs: config.timeoutMs,
			signal: ctx.signal,
		});

		switch (outcome.kind) {
			case "unchanged": {
				if (config.latex) {
					const latexRewrite = buildLatexRewrite(originalCommand, LATEX_RUNNER_PATH);
					if (latexRewrite) event.input.command = latexRewrite;
				}
				return undefined;
			}
			case "rewrite":
				event.input.command = outcome.command;
				return undefined;
			case "ask": {
				if (config.askMode === "auto" || !ctx.hasUI) {
					event.input.command = outcome.command;
					return undefined;
				}
				const ok = await ctx.ui.confirm(
					"rtk ask-rule",
					`Rewrite command?\n\n  from: ${originalCommand}\n    to: ${outcome.command}`,
				);
				if (ok) event.input.command = outcome.command;
				return undefined;
			}
		}
	});

	pi.registerCommand("rtk", {
		description:
			"Run an rtk meta command (default: `rtk gain`). Subcommands: /rtk clear, /rtk on, /rtk off, /rtk status.",
		handler: async (args, ctx) => {
			const trimmed = (args ?? "").trim();

			// Runtime controls first — these work even when rtk is not installed.
			if (trimmed === "clear") {
				ctx.ui.setWidget(WIDGET_KEY, undefined);
				return;
			}
			if (trimmed === "off") {
				runtimeEnabled = false;
				ctx.ui.setStatus(STATUS_KEY, "rtk off");
				ctx.ui.notify("pi-rtk: rewriting disabled for this session.", "info");
				return;
			}
			if (trimmed === "on") {
				if (!installed) {
					ctx.ui.notify(
						"pi-rtk: cannot enable — rtk is not installed or too old.",
						"warning",
					);
					return;
				}
				runtimeEnabled = true;
				if (probe.kind === "ok") ctx.ui.setStatus(STATUS_KEY, `rtk ${probe.version}`);
				ctx.ui.notify("pi-rtk: rewriting enabled.", "info");
				return;
			}
			if (trimmed === "status") {
				const state = runtimeEnabled ? "enabled" : "disabled";
				const version =
					probe.kind === "ok"
						? `rtk ${probe.version}`
						: probe.kind === "too-old"
							? `rtk ${probe.version} (too old, need ${probe.minVersion})`
							: probe.kind === "not-installed"
								? "rtk not installed"
								: `rtk version unparseable (${probe.raw})`;
				ctx.ui.notify(`pi-rtk: ${state}; ${version}`, "info");
				return;
			}

			if (!installed) {
				ctx.ui.notify(
					probe.kind === "not-installed"
						? "pi-rtk: `rtk` is not installed or not on PATH."
						: `pi-rtk: rtk is unavailable (${probe.kind}).`,
					"warning",
				);
				return;
			}

			// Forward everything else to the rtk binary. Argument splitting uses a
			// simple whitespace split because meta commands are well-behaved and
			// the shell is not involved (spawn runs with shell: false).
			const argv = trimmed.length > 0 ? trimmed.split(/\s+/) : ["gain"];
			let result;
			try {
				result = await pi.exec("rtk", argv, { timeout: 15000 });
			} catch (err) {
				ctx.ui.notify(
					`pi-rtk: failed to run rtk ${argv.join(" ")}: ${err instanceof Error ? err.message : String(err)}`,
					"error",
				);
				return;
			}
			const combined = [result.stdout, result.stderr].filter((s) => s && s.trim().length > 0).join("\n");
			const body = combined.trimEnd();
			if (!body) {
				ctx.ui.notify(`pi-rtk: rtk ${argv.join(" ")} produced no output.`, "info");
				return;
			}
			const header = `$ rtk ${argv.join(" ")}`;
			const lines = [header, "", ...clampLines(body, MAX_WIDGET_LINES)];
			if (result.code !== 0) {
				lines.push("", `(exit code ${result.code})`);
			}
			ctx.ui.setWidget(WIDGET_KEY, lines);
		},
		getArgumentCompletions: (prefix: string) => {
			const items = [
				{ value: "gain", label: "gain — token savings summary" },
				{ value: "gain --history", label: "gain --history — recent commands" },
				{ value: "gain --graph", label: "gain --graph — ASCII savings graph" },
				{ value: "gain --daily", label: "gain --daily — day-by-day" },
				{ value: "discover", label: "discover — missed opportunities" },
				{ value: "session", label: "session — adoption across sessions" },
				{ value: "--version", label: "--version — rtk version" },
				{ value: "clear", label: "clear — hide the rtk widget" },
				{ value: "on", label: "on — enable rewriting" },
				{ value: "off", label: "off — disable rewriting" },
				{ value: "status", label: "status — show extension state" },
			];
			const filtered = items.filter((i) => i.value.startsWith(prefix));
			return filtered.length > 0 ? filtered : null;
		},
	});
}
