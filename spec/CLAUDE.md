# AI-CODING-SPEC v9.0.1 — Core

<!-- Canonical: `~/.claude/CLAUDE.md` | Modules: `~/.claude/spec-modules/` | History: `~/.claude/CLAUDE-changelog.md`. -->

## §1 Language

Reply in the language the user types in (none yet: English); task notifications, hook text and subagent reports do not change it. Code, comments, identifiers, commit messages and log text are English unless the project's existing convention differs.

## §5 Ask first

Stop and ask before these, naming them on one line `[AUTH REQUIRED op:<what> scope:<files> risk:<why>]`: deleting files or directories you did not create in this task; a DB schema change or data migration; CI, deploy or infra config; adding, removing or bumping a production dependency; `.env`, secrets, `~/.claude/settings.json`, hooks or MCP config; auth, payment or crypto code; a breaking change to a public API; push, tag, publish or deploy the user did not ask for. An approval covers the op and scope it names.

## §7 Commit and verify

- In a git repo, commit each verified change locally as its own commit, on the current branch (a project convention wins). Push, tag and release only when asked.
- Say done, fixed or passing only after running the check in this session and reading its output.

## §8 Safety

Never:
- `rm -rf`, `rm -f` or `find -delete` on a variable that could be empty: guard it, `rm -rf "${DIR:?}/x"`.
- secrets in code, logs or commits (a leak: stop, use a placeholder, suggest rotation);
- disable SSL or certificate verification; `DELETE` / `UPDATE` / `DROP` without `WHERE`;
- run scripts of unknown origin: `curl` / `wget` piped into a shell, or `npx` of a package with no lockfile or local install (ask first);
- recursive scans of `~/.claude/` without a depth cap;
- use a bypass a hook's deny names (an `[allow-…]` / `[skip-…]` token, a `DISABLE_*` switch) unless the user authorized it for that command: it is the user's exit, not yours.

Temporary files go in the session scratchpad; delete anything you created elsewhere before you report.

## §10 Report

A task that changed files or ran checks ends with `## 汇报` (`## Report` for an English-speaking user) and up to three parts, empty ones left out:
- **变更** (Changes): what changed, which files, the commit.
- **验证** (Verification): one line per check, `<command>` → 通过 / 失败 / 未运行 / 无法运行 (passed / failed / not run / could not run), then the numbers or the reason; failures that predate the task on their own line.
- **遗留** (Open items): only what the user must decide or needs to know — risks, unfinished work, choices with your pick.

A trivial change reports in one sentence that names its check.

## §12 Ship

Before tagging, releasing, publishing or deploying, Read `~/.claude/spec-modules/ship.md`.
