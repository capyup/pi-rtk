import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

/**
 * Minimum rtk version that provides the `rtk rewrite` subcommand used by this
 * extension. Matches the requirement baked into the upstream rtk hooks.
 */
export const MIN_RTK_VERSION = { major: 0, minor: 23, patch: 0 } as const;

export type VersionCheckResult =
	| { kind: "ok"; version: string }
	| { kind: "not-installed" }
	| { kind: "too-old"; version: string; minVersion: string }
	| { kind: "unparseable"; raw: string };

export function formatVersion(v: { major: number; minor: number; patch: number }): string {
	return `${v.major}.${v.minor}.${v.patch}`;
}

function parseVersion(raw: string): { major: number; minor: number; patch: number } | undefined {
	// `rtk --version` prints lines such as "rtk 0.37.2".
	const match = /rtk\s+(\d+)\.(\d+)\.(\d+)/.exec(raw);
	if (!match) return undefined;
	return {
		major: Number(match[1]),
		minor: Number(match[2]),
		patch: Number(match[3]),
	};
}

function isAtLeast(
	actual: { major: number; minor: number; patch: number },
	required: { major: number; minor: number; patch: number },
): boolean {
	if (actual.major !== required.major) return actual.major > required.major;
	if (actual.minor !== required.minor) return actual.minor > required.minor;
	return actual.patch >= required.patch;
}

/**
 * Probe the rtk binary once at extension startup. Uses a short timeout so a
 * hung binary cannot delay pi initialization.
 */
export async function checkRtkInstallation(
	pi: ExtensionAPI,
	timeoutMs = 2000,
): Promise<VersionCheckResult> {
	try {
		const result = await pi.exec("rtk", ["--version"], { timeout: timeoutMs });
		if (result.code !== 0 || result.killed) {
			return { kind: "not-installed" };
		}
		const parsed = parseVersion(result.stdout || result.stderr);
		if (!parsed) {
			return { kind: "unparseable", raw: (result.stdout || result.stderr).trim() };
		}
		if (!isAtLeast(parsed, MIN_RTK_VERSION)) {
			return {
				kind: "too-old",
				version: formatVersion(parsed),
				minVersion: formatVersion(MIN_RTK_VERSION),
			};
		}
		return { kind: "ok", version: formatVersion(parsed) };
	} catch {
		return { kind: "not-installed" };
	}
}
