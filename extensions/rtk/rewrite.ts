import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

/**
 * Possible outcomes of `rtk rewrite <cmd>`:
 *
 *   unchanged   the command has no rtk equivalent (exit 1), a deny rule
 *               matched (exit 2), rtk is unavailable, the call timed out,
 *               or any error occurred — the extension must pass through.
 *   rewrite     exit 0 with stdout — rewrite silently.
 *   ask         exit 3 with stdout — rewrite, but an "ask" rule matched;
 *               the caller decides whether to confirm with the user.
 */
export type RewriteOutcome =
	| { kind: "unchanged" }
	| { kind: "rewrite"; command: string }
	| { kind: "ask"; command: string };

export interface RewriteOptions {
	timeoutMs?: number;
	signal?: AbortSignal;
}

/**
 * Delegates to `rtk rewrite` (the single source of truth defined in
 * src/discover/registry.rs inside rtk itself). The command is passed as a
 * single argv element; rtk handles `&&`, `||`, `;`, `|`, `&` internally.
 *
 * Any failure degrades gracefully to `unchanged` so that a misbehaving rtk
 * never blocks the user's command.
 */
export async function rewriteCommand(
	pi: ExtensionAPI,
	command: string,
	options: RewriteOptions = {},
): Promise<RewriteOutcome> {
	const trimmed = command.trim();
	if (!trimmed) return { kind: "unchanged" };

	try {
		const result = await pi.exec("rtk", ["rewrite", command], {
			timeout: options.timeoutMs ?? 2000,
			signal: options.signal,
		});

		if (result.killed) return { kind: "unchanged" };

		const rewritten = (result.stdout ?? "").trim();

		switch (result.code) {
			case 0: {
				// Rewrite found, auto-allow.
				if (!rewritten || rewritten === command) return { kind: "unchanged" };
				return { kind: "rewrite", command: rewritten };
			}
			case 3: {
				// Rewrite found, ask rule matched.
				if (!rewritten || rewritten === command) return { kind: "unchanged" };
				return { kind: "ask", command: rewritten };
			}
			// case 1: no rtk equivalent
			// case 2: deny rule matched — let the host handle denial
			// any other code: treat as unsupported.
			default:
				return { kind: "unchanged" };
		}
	} catch {
		return { kind: "unchanged" };
	}
}
