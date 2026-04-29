import { Buffer } from "node:buffer";

const DISABLE_RE = /(?:^|\s)(?:RTK_DISABLED=1|PI_RTK_LATEX=0)(?=\s|$)/;
const RUNNER_RE = /latex-runner\.mjs/;
const LATEX_COMMAND_RE = /(?:^|[;&|(){}]\s*)(?:(?:env\s+)?(?:[A-Za-z_][A-Za-z0-9_]*=(?:'[^']*'|"[^"]*"|\S+)\s+)*)?(?:\S*\/)?(?:latexmk|xelatex|pdflatex|lualatex|tectonic|bibtex|bibtex8|biber|makeindex|makeglossaries|xdvipdfmx)(?=$|[\s;&|(){}])/;

export function isLatexCommand(command: string): boolean {
	const trimmed = command.trim();
	if (!trimmed) return false;
	if (DISABLE_RE.test(trimmed)) return false;
	if (RUNNER_RE.test(trimmed)) return false;
	return LATEX_COMMAND_RE.test(trimmed);
}

export function shellQuote(value: string): string {
	return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function buildLatexRewrite(command: string, runnerPath: string): string | null {
	if (!runnerPath || !isLatexCommand(command)) return null;
	const encoded = Buffer.from(command, "utf8").toString("base64url");
	return `node ${shellQuote(runnerPath)} ${shellQuote(encoded)}`;
}
