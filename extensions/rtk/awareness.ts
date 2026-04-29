/**
 * System prompt insertion that tells the LLM about rtk's auto-rewrite behavior
 * and its meta commands (which are *not* auto-rewritten). Kept short to avoid
 * inflating every turn's system prompt.
 */
export const AWARENESS_TEXT = `# RTK — token-optimized CLI proxy

All shell commands executed through the \`bash\` tool are automatically rewritten
to use \`rtk\` before execution (for example, \`git status\` becomes \`rtk git
status\`). This is transparent and delivers 60-90% token savings on the
supported command categories: git, cargo, go/pytest/jest/vitest, tsc,
eslint/ruff/biome/prettier, docker/kubectl, aws, pnpm/pip, ls/find/grep/cat
variants, and more. LaTeX build commands (\`latexmk\`, \`xelatex\`, \`pdflatex\`,
etc.) are summarized locally: full transcripts go to \`.pi/rtk/latex/*.log\`,
while the agent sees only status, key diagnostics, and the log path.

The auto-rewrite only applies to the \`bash\` tool. The built-in \`read\`,
\`grep\`, \`glob\`, and \`list\` tools bypass this hook. When token-efficient
file inspection or code search matters, prefer invoking these through bash:
  rtk read <path>          # filtered file reading
  rtk grep <pattern> <path>
  rtk find <pattern> <dir>
  rtk ls <dir>

Meta commands are NOT auto-rewritten. Call them directly through the \`bash\`
tool when the user asks for analytics or when diagnosing rtk itself:
  rtk --version            # installed rtk version
  rtk gain                 # token savings summary
  rtk gain --history       # recent command-by-command savings
  rtk gain --graph         # ASCII graph of savings over time
  rtk discover             # opportunities that were missed
  rtk proxy <cmd>          # run a command raw, without filtering (debug)

Per-command opt-out: prefix a command with \`RTK_DISABLED=1\` to skip the
rewrite for that one invocation, for example
\`RTK_DISABLED=1 git status\`.
`;
