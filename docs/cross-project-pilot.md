# Cross-project pilot — claudemd portability framework

Status: framework only. **No pilot runs recorded yet.** This document exists
to make the audit observation "claudemd is self-tested only" actionable —
it gives the next operator a concrete checklist for installing claudemd in
an unrelated project and recording where the spec/hooks fit, where they
chafe, and what changes would make claudemd a true general-purpose plugin
rather than a self-targeted one.

## Pilot scope (one project per row)

For each pilot project, record observations across these axes:

| Axis | What to measure | How |
|---|---|---|
| Install footprint | `~/.claude/CLAUDE.md` already personalized? | `install.js` warns; record the prior content (private to operator) |
| Spec rule fit | Does §10-V banned vocab fire on commit messages? | `gh pr list --state merged --limit 50` → `claudemd-cli lint` each title; tally hits |
| §8 SAFETY fit | Any legitimate `rm -rf $VAR` workflows? | Run `pre-bash-safety` against project's CI scripts + Makefiles; record bypasses needed |
| §11 MEMORY.md fit | Project has its own MEMORY.md already? | Conflict surface; record |
| Hook overhead | Wall-clock impact on `git commit` / `git push` / common bash | `bash scripts/perf-baseline.sh` from this repo against the pilot project |
| Spec contradictions | Project CLAUDE.md says X, claudemd spec says Y | Per §3 TRUST: project wins; record specific clauses |

## Picking a pilot project

Bias toward projects where claudemd would be most useful (high-stakes
git history, multi-author commits, frequent ship cadence) but most likely
to chafe (different language conventions, existing CI rules):

- Strong fit candidates: any TypeScript / Python / Rust monorepo with
  conventional-commits + non-English commit messages + spec docs.
- Strong contrast candidates: small CLI tools with single-author history,
  or repos enforcing different commit conventions (gitmoji, Jira-prefix).

## Pilot duration

Minimum 2 weeks of real activity — long enough for `claudemd-audit
--days=14` to surface signal, short enough that drift in the operator's
mental model stays bounded. Daily memory: keep a freeform `pilot-log.md`
listing what fired and what got bypassed.

## Pilot exit criteria

Decide one of three outcomes:

1. **Adopt as-is** — install becomes permanent in this project. Record
   which spec rules contributed value vs which bypassed routinely.
2. **Adopt with project override** — extend project `CLAUDE.md` with
   `SAFE_DELETE_PATHS:` / autonomy level / kill-switch env vars.
   Document which.
3. **Reject** — record specific spec/hook clauses incompatible with the
   project. Feed back into a `tasks/cross-project-friction.md` ticket
   for the spec maintainer.

## Reporting back

If outcome is (3) or (2 with non-trivial overrides), open a GitHub issue
on `sdsrss/claudemd` titled `pilot: <project name> — <one-line outcome>`.
Body sections: setup notes, top-3 frictions, top-3 fits, suggested spec
changes (cite specific §). This is the single signal channel for spec
generality vs claudemd-self-fit.

## Pilot results table

| Project | Started | Outcome | Top friction | Top fit | Issue |
|---|---|---|---|---|---|
| _(none yet)_ | | | | | |

The first row that fills this table is what this framework was written for.

## Companion: hook overhead measurement

`scripts/perf-baseline.sh` measures hook chain overhead on 6
representative bash commands. Run from the claudemd repo root, against
the pilot project's working directory:

```bash
cd <pilot-project>
bash <claudemd-repo>/scripts/perf-baseline.sh --runs 20
```

Quote the output's `delta_ms` column in the pilot log. The audit-era
estimate was 200-400 ms per command (5月9日 audit, never measured).
Replace with whatever this script produces.
