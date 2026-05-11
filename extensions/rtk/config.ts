/**
 * Pure configuration helpers for pi-rtk. Kept free of @earendil-works/pi-coding-agent
 * imports so that unit tests can exercise them in isolation.
 */

export type AskMode = "auto" | "confirm";

export interface Config {
	disabled: boolean;
	askMode: AskMode;
	awareness: boolean;
	timeoutMs: number;
	quiet: boolean;
	latex: boolean;
}

export const WIDGET_KEY = "rtk";
export const STATUS_KEY = "rtk";
export const MAX_WIDGET_LINES = 40;
export const DEFAULT_TIMEOUT_MS = 2000;

function parsePositiveInt(raw: string | undefined, fallback: number): number {
	if (!raw) return fallback;
	const n = Number.parseInt(raw, 10);
	return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Parse the extension configuration from a process.env-like record. Taking the
 * environment as an argument (rather than reading process.env directly) makes
 * the function deterministic and trivial to unit test.
 */
export function readConfig(env: Record<string, string | undefined> = process.env): Config {
	const askModeRaw = (env.PI_RTK_ASK_MODE ?? "auto").toLowerCase();
	const askMode: AskMode = askModeRaw === "confirm" ? "confirm" : "auto";
	return {
		disabled: env.PI_RTK_DISABLED === "1",
		askMode,
		awareness: env.PI_RTK_AWARENESS !== "0",
		timeoutMs: parsePositiveInt(env.PI_RTK_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
		quiet: env.PI_RTK_QUIET === "1",
		latex: env.PI_RTK_LATEX !== "0",
	};
}

/**
 * Truncate `text` to at most `max` lines, appending a marker indicating how
 * many lines were hidden. Used by the /rtk widget renderer.
 */
export function clampLines(text: string, max: number): string[] {
	const lines = text.split(/\r?\n/);
	if (lines.length <= max) return lines;
	const kept = lines.slice(0, max);
	kept.push(`… (${lines.length - max} more line(s) truncated)`);
	return kept;
}
