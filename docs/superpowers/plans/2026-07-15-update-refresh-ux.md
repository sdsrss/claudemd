# Update-refresh UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a one-command plugin refresh (`/claudemd-refresh` → `scripts/refresh-plugin.sh`) and point every "how to update" message at it.

**Architecture:** No new hook, no new state. A tracked bash script drives the `claude plugin` CLI three-step; a thin command file wraps it; the existing `upstream_check()` / stale-registration banners and doc copy are re-pointed. Spec: `docs/superpowers/specs/2026-07-15-update-notify-design.md` (r2).

**Tech Stack:** bash (scripts + hooks), node:test (script tests), jq (hook JSON emission).

## Global Constraints

- Level L3 (released-artifact + LLM-visible command metadata) — release itself follows `feedback_claudemd_ship_from_main_atomic.md` (atomic turn, version cascade, Sizing untouched — spec files unchanged).
- Version: 0.47.4 → **0.48.0** (minor, additive user-visible change).
- Tests hermetic: PATH shim for `claude`; never touch real `~/.claude`, network, or the real CLI.
- All user-facing copy English (code/CLI surface); keep `/reload-plugins` mentioned in doctor.js fix strings (`tests/scripts/doctor.test.js:51` pins `/reload-plugins/`).

---

### Task 1: `scripts/refresh-plugin.sh` + node test

**Files:**
- Create: `scripts/refresh-plugin.sh` (mode 755)
- Test: `tests/scripts/refresh-plugin.test.js`

**Interfaces:**
- Produces: `scripts/refresh-plugin.sh` — no args, no env contract; exit 0 on success, 1 when `claude` CLI missing, non-zero (set -e) when any CLI step fails. Task 2's command file and Task 3's banner text reference it by this path.

- [ ] **Step 1: Write the failing test**

`tests/scripts/refresh-plugin.test.js`:

```javascript
// refresh-plugin.test.js — scripts/refresh-plugin.sh drives the `claude plugin`
// CLI three-step (marketplace update → uninstall -y → install) and fails loudly.
// Controls-first (feedback_probe_harness_controls_first): cases 1+2 must produce
// opposite outcomes before the rest is trusted. `claude` is a PATH shim that
// logs argv — no real CLI, no network, no ~/.claude writes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../scripts/refresh-plugin.sh');

function makeShim(dir, body) {
  fs.mkdirSync(dir, { recursive: true });
  const shim = path.join(dir, 'claude');
  fs.writeFileSync(shim, `#!/usr/bin/env bash\n${body}\n`);
  fs.chmodSync(shim, 0o755);
}

function runScript(pathDirs) {
  return spawnSync('bash', [SCRIPT], {
    env: { ...process.env, PATH: pathDirs.join(':') },
    encoding: 'utf8',
  });
}

test('control A: success shim — 3 CLI calls in order, exit 0', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'refresh-ok-'));
  try {
    const log = path.join(tmp, 'calls.log');
    makeShim(path.join(tmp, 'bin'), `echo "$*" >> "${log}"`);
    const r = runScript([path.join(tmp, 'bin'), '/usr/bin', '/bin']);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.equal(fs.readFileSync(log, 'utf8'), [
      'plugin marketplace update claudemd',
      'plugin uninstall claudemd@claudemd -y',
      'plugin install claudemd@claudemd',
      '',
    ].join('\n'));
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('control B: marketplace-update failure stops the pipeline before uninstall', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'refresh-fail-'));
  try {
    const log = path.join(tmp, 'calls.log');
    makeShim(path.join(tmp, 'bin'),
      `echo "$*" >> "${log}"\n[[ "$*" == plugin\\ marketplace\\ update* ]] && exit 1\nexit 0`);
    const r = runScript([path.join(tmp, 'bin'), '/usr/bin', '/bin']);
    assert.notEqual(r.status, 0);
    assert.ok(!fs.readFileSync(log, 'utf8').includes('uninstall'),
      'set -e must stop before uninstall');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('claude CLI missing from PATH: exit 1 + stderr names the problem', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'refresh-none-'));
  try {
    fs.mkdirSync(path.join(tmp, 'empty'));
    const r = runScript([path.join(tmp, 'empty')]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /'claude' CLI not found/);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/scripts/refresh-plugin.test.js`
Expected: 3 failing tests (script file does not exist — bash exits 127/126).

- [ ] **Step 3: Write the script**

`scripts/refresh-plugin.sh`:

```bash
#!/usr/bin/env bash
# refresh-plugin.sh — one-shot refresh of the installed claudemd plugin to the
# latest released version, for /claudemd-refresh. Claude Code has no working
# `/plugin update`; the sanctioned refresh is marketplace-update → uninstall →
# install, driven here via the `claude plugin` CLI so it runs as one command.
#
# This refreshes the on-disk plugin CACHE (the hook code that runs). The
# ~/.claude spec + manifest sync happens automatically afterwards: the next
# SessionStart bootstrap (or the first prompt's version-sync hook) runs
# install.js when it sees manifest-version < plugin-version. So:
#   run this → RESTART Claude Code (or /reload-plugins) → sync is automatic.
set -euo pipefail

PLUGIN="claudemd@claudemd"
MARKET="claudemd"

if ! command -v claude >/dev/null 2>&1; then
  echo "refresh-plugin: 'claude' CLI not found on PATH — run the manual sequence instead (see README §Update)" >&2
  exit 1
fi

echo "==> 1/3 marketplace update ($MARKET) — git-pull the marketplace clone"
claude plugin marketplace update "$MARKET"

echo "==> 2/3 uninstall $PLUGIN (-y: non-interactive)"
claude plugin uninstall "$PLUGIN" -y

echo "==> 3/3 install $PLUGIN (pulls the just-updated marketplace version)"
claude plugin install "$PLUGIN"

echo
echo "Plugin cache refreshed. Now RESTART Claude Code (or /reload-plugins);"
echo "the first new session auto-syncs the spec + manifest via install.js."
```

Then: `chmod +x scripts/refresh-plugin.sh` (commit the exec bit).

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/scripts/refresh-plugin.test.js`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add scripts/refresh-plugin.sh tests/scripts/refresh-plugin.test.js
git commit -m "feat(refresh): ship one-shot plugin refresh script (was local-only update.sh)"
```

---

### Task 2: `/claudemd-refresh` command file

**Files:**
- Create: `commands/claudemd-refresh.md`

**Interfaces:**
- Consumes: `scripts/refresh-plugin.sh` (Task 1).
- Produces: slash command `/claudemd-refresh` — referenced by banner text (Task 3) and README (Task 4).

- [ ] **Step 1: Write the command file**

`commands/claudemd-refresh.md`:

```markdown
---
name: claudemd-refresh
description: Refresh the installed claudemd plugin to the latest released version in one shot (marketplace update → uninstall → install via the claude CLI). Use when the SessionStart banner reports a newer version, or /claudemd-doctor flags a stale plugin cache. Restart Claude Code afterwards — spec + manifest then sync automatically.
---

Usage: `/claudemd-refresh`

Run: `bash "${CLAUDE_PLUGIN_ROOT}/scripts/refresh-plugin.sh"`

On success, tell the user: **restart Claude Code** (or `/reload-plugins`). Nothing else is needed — the first new session auto-runs `install.js` (SessionStart bootstrap / version-sync hook) to sync `~/.claude` spec + manifest; `/claudemd-install` is NOT part of this flow. Suggest verifying afterwards with `/claudemd-status` (installed == latest).

If the script fails with `'claude' CLI not found`, have the user paste the manual sequence one line at a time:

```
/plugin marketplace update claudemd
/plugin uninstall claudemd@claudemd
/plugin install claudemd@claudemd
/reload-plugins
```
```

- [ ] **Step 2: Verify the referenced script path resolves**

Run: `test -x "$(pwd)/scripts/refresh-plugin.sh" && echo ok`
Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add commands/claudemd-refresh.md
git commit -m "feat(refresh): /claudemd-refresh command wrapping refresh-plugin.sh"
```

---

### Task 3: banner copy → /claudemd-refresh (RED-first on pinned test text)

**Files:**
- Modify: `hooks/session-start-check.sh:182` (upstream banner), `hooks/session-start-check.sh:258` (stale-registration banner)
- Test: `tests/hooks/session-start.test.sh` (Case 8 ~line 137, Case 18 ~line 334)

**Interfaces:**
- Consumes: `/claudemd-refresh` (Task 2) — banner text references the command by name only.

- [ ] **Step 1: Update test expectations (RED)**

In `tests/hooks/session-start.test.sh` Case 8, replace the assertion
`echo "$OUT8" | grep -q 'plugin marketplace update claudemd'` with
`echo "$OUT8" | grep -q '/claudemd-refresh'`.

In Case 18's `&&`-chain (after `grep -q 'stale plugin registration'`), add the line:

```bash
   && echo "$OUT18" | grep -q '/claudemd-refresh' \
```

- [ ] **Step 2: Run to verify RED**

Run: `bash tests/hooks/session-start.test.sh; echo "exit=$?"`
Expected: `FAIL: 8 ...` and `FAIL: 18 ...`, exit ≥ 2 (banner still carries the 4-command list).

- [ ] **Step 3: Edit the two banner strings**

`hooks/session-start-check.sh` line 182, replace the whole `additionalContext` value with:

```
        additionalContext: ("[claudemd] " + $new + " available (you have " + $cur + "). Run /claudemd-refresh, then restart Claude Code. Disable this notice: DISABLE_UPSTREAM_CHECK=1")
```

Line 258, replace the `additionalContext` value with:

```
          additionalContext: ("[claudemd] stale plugin registration: hooks are running from v" + $old + " but v" + $new + " is installed. Auto-sync skipped (a sync from the old dir would downgrade the spec). Fix: run /claudemd-refresh, then restart Claude Code.")
```

- [ ] **Step 4: Run to verify GREEN**

Run: `bash tests/hooks/session-start.test.sh; echo "exit=$?"`
Expected: all cases PASS, `exit=0`.

- [ ] **Step 5: Commit**

```bash
git add hooks/session-start-check.sh tests/hooks/session-start.test.sh
git commit -m "feat(refresh): upgrade + stale-root banners point at /claudemd-refresh"
```

---

### Task 4: copy sweep — commands/claudemd-update.md, install.js, doctor.js, README

**Files:**
- Modify: `commands/claudemd-update.md:10-17`, `scripts/install.js:85`, `scripts/doctor.js:100`, `scripts/doctor.js:161`, `README.md` (lines 61, ~110 table, §Project layout counts, §Update 243-262, troubleshooting 315)
- Tests already pinning these: `tests/scripts/doctor.test.js:51` (`/reload-plugins/`), `tests/scripts/install.test.js:109` (`/refusing downgrade/`), `tests/scripts/readme-drift.test.js` (commands count), `tests/scripts/help-discoverability.test.js`

- [ ] **Step 1: commands/claudemd-update.md** — replace the "Canonical refresh sequence (paste each line):" sentence + code block with:

```markdown
Canonical plugin refresh: `/claudemd-refresh` (one command; restart afterwards). Manual fallback (paste each line):

```
/plugin marketplace update claudemd
/plugin uninstall claudemd@claudemd
/plugin install claudemd@claudemd
/reload-plugins
```
```

- [ ] **Step 2: scripts/install.js:85** — inside the refusing-downgrade message, replace `(/plugin marketplace update claudemd, /plugin uninstall claudemd@claudemd, /plugin install claudemd@claudemd, /reload-plugins), ` with `(/claudemd-refresh — or manually: /plugin marketplace update claudemd, /plugin uninstall claudemd@claudemd, /plugin install claudemd@claudemd, /reload-plugins), `

- [ ] **Step 3: scripts/doctor.js** — line 100: `Fix: /plugin uninstall claudemd@claudemd, /plugin install claudemd@claudemd, /reload-plugins.` → `Fix: /claudemd-refresh (or /plugin uninstall claudemd@claudemd, /plugin install claudemd@claudemd, /reload-plugins).` Line 161: `Fix: /plugin uninstall claudemd@claudemd then /plugin install claudemd@claudemd, then /reload-plugins.` → `Fix: /claudemd-refresh (or /plugin uninstall claudemd@claudemd then /plugin install claudemd@claudemd, then /reload-plugins).`

- [ ] **Step 4: README.md** —
  - line 61: `| 15 slash commands |` → `| 16 slash commands |` and append `· /claudemd-refresh` to the list.
  - Commands table: add row after `/claudemd-update`:
    `| /claudemd-refresh | v0.48.0 — one-shot plugin refresh (marketplace update → uninstall → install via the claude CLI). Restart Claude Code afterwards; spec + manifest sync is automatic. Fired by the SessionStart upgrade banner. |`
  - §Project layout: bump the `commands/` count (readme-drift.test.js enforces the exact number = `ls commands/*.md | wc -l` after Task 2).
  - §Update (line ~245): lead with `/claudemd-refresh`, keep the 4-command block labeled as manual fallback.
  - Troubleshooting line ~315: after "Use the canonical sequence in the [Update](#update) section:" insert `/claudemd-refresh — or manually: `.

- [ ] **Step 5: Full suite**

Run: `npm test`
Expected: all suites pass (drift suites confirm counts; doctor/install message tests still match).

- [ ] **Step 6: Commit**

```bash
git add commands/claudemd-update.md scripts/install.js scripts/doctor.js README.md
git commit -m "docs(refresh): point all update copy at /claudemd-refresh (manual sequence kept as fallback)"
```

---

### Task 5: release 0.48.0 (atomic, per ship runbook)

**Files:**
- Modify: `package.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` (version + counts in descriptions if any), `CHANGELOG.md` (top entry)

- [ ] **Step 1: version cascade** — bump 0.47.4 → 0.48.0 in all four sites, then:

Run: `node scripts/version-cascade-check.js`
Expected: exit 0. Backstop: `grep -rn "0\.47\.4" spec/ tests/ scripts/ README.md .claude-plugin/ package.json` → only historical mentions (CHANGELOG).

- [ ] **Step 2: CHANGELOG top entry** — include the released-artifact checklist items:

```markdown
## 0.48.0 — 2026-07-15

**feat: one-command plugin refresh (`/claudemd-refresh`)**

- New `scripts/refresh-plugin.sh` + `/claudemd-refresh`: marketplace update →
  uninstall → install in one shot; restart afterwards — spec/manifest sync is
  automatic (version-sync hook / SessionStart bootstrap). Replaces the pasted
  4-command sequence everywhere user-facing copy taught it.
- Upgrade + stale-registration banners now say "Run /claudemd-refresh, then
  restart Claude Code."
- Migration: nothing to do; old manual sequence still works and stays
  documented in README §Update as the fallback. Opt-out of the banner:
  `DISABLE_UPSTREAM_CHECK=1` (unchanged).
```

- [ ] **Step 3: pre-ship gates** — `npm test` green; `gh run list --branch main --limit 1` green; staged-diff self-review.

- [ ] **Step 4: atomic ship (one turn, single AUTH already covers it)**

```bash
git add -A && git commit -m "release(0.48.0): /claudemd-refresh one-command plugin refresh"
git push origin main
git tag v0.48.0 && git push origin v0.48.0
gh release create v0.48.0 --title "v0.48.0" --notes-file <(sed -n '/^## 0.48.0/,/^## /p' CHANGELOG.md | head -n -1)
gh run watch --exit-status $(gh run list --branch main --limit 1 --json databaseId -q '.[0].databaseId')
```

Expected: CI green (Iron Law #2 evidence).

- [ ] **Step 5: post-ship refresh + memory sync** — on this machine run the new flow itself (`/claudemd-refresh` → restart → `node scripts/status.js` shows installed == 0.48.0). Update durable memories: `reference_plugin_update_manual_refresh.md` (canonical is now `/claudemd-refresh`) and the post-ship section of `feedback_claudemd_ship_from_main_atomic.md`; refresh both MEMORY.md index lines.

---

## Self-review notes

- Spec coverage: design §1→Task 1, §2→Task 2, §3→Tasks 3+4; success criteria 1-2→Task 3, 3→Task 1, 4→Task 4 Step 5, 5→Task 5 Step 5. No gaps.
- doctor.js keeps `/reload-plugins` in both fix strings → doctor.test.js:51 stays green by construction.
- Case 18 does not currently assert command text; the added `/claudemd-refresh` grep is a genuine RED before the hook edit (banner text at line 258 has no such token).
