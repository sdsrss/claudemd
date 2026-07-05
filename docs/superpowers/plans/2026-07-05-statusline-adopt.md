# claudemd statusLine Auto-Registration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a claudemd-owned PS1-style statusLine (`user@host:/path (branch) Model [ctx:N%]`) that install auto-wires only into an empty slot, plus a `/claudemd-statusline` command to adopt/check/remove it — never clobbering another provider.

**Architecture:** A bash renderer (`scripts/statusline.sh`) copied to the stable path `~/.claude/claudemd-statusline.sh` (survives plugin-version-dir churn) and referenced from `settings.json.statusLine` as `bash "$HOME/.claude/claudemd-statusline.sh"`. A node core lib (`scripts/lib/statusline.js`) owns the `detect`/`adopt`/`remove` state machine over settings.json, reusing existing `settings-merge`/`backup`/`paths` libs. A thin CLI wraps the lib for the command; install/uninstall call the lib directly.

**Tech Stack:** Node ≥20 (ESM, `node --test`), bash 3.2+, `jq`. No new dependencies.

## Global Constraints

- **Node ≥20**, ESM (`import`), matches `package.json engines`.
- **Renderer is bash 3.2-safe**: `#!/usr/bin/env bash`; process substitution + brace-group reads OK; `mapfile` BANNED (bash 4+). `whoami` / `hostname -s` / `git -C` / `jq` only.
- **One `jq` invocation** per render; each field uses `// ""` (NOT `// empty`) so exactly three lines emit.
- **Colors (ANSI)**: user@host `01;32` bold-green · path `01;34` bold-blue · branch `00;35` magenta · model `00;36` cyan · ctx `00;32` green `<50` / `00;33` yellow `50–79` / `00;31` red `≥80`.
- **Stable path**: renderer copied to `~/.claude/claudemd-statusline.sh`; settings command literal is exactly `bash "$HOME/.claude/claudemd-statusline.sh"`. Never write a plugin-cache version-dir path into settings.json.
- **§5 hard-AUTH**: the `/claudemd-statusline` command shows the settings diff and asks once before writing — binds even under `AUTONOMY_LEVEL: aggressive`. The install path writes only when the slot is empty (non-clobbering) and only when `CLAUDEMD_NO_STATUSLINE` ≠ `1`.
- **Ctx field**: `.context_window.used_percentage` (empirically live — the machine's existing `~/.claude/statusline-command.sh` renders `[ctx:6%]` from it). Absent → segment hides.
- **Test hermeticity** (`feedback_hook_env_test_hermeticity.md`): every suite that exercises install/adopt `delete process.env.CLAUDEMD_NO_STATUSLINE` in `beforeEach`; sandbox `HOME` via `mkdtempSync`; never touch the real `~/.claude`.
- **Marker constant**: settings ownership = `settings.statusLine.command` includes the substring `claudemd-statusline.sh`.

---

### Task 1: Renderer `scripts/statusline.sh`

**Files:**
- Create: `scripts/statusline.sh`
- Test: `tests/scripts/statusline.test.js`

**Interfaces:**
- Consumes: stdin JSON with `.cwd` / `.workspace.current_dir`, `.model.display_name`, `.context_window.used_percentage`.
- Produces: one stdout line (no trailing newline) with ANSI-colored segments. Exit 0 always.

- [ ] **Step 1: Write the failing test**

`tests/scripts/statusline.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPT = path.join(REPO_ROOT, 'scripts/statusline.sh');
const ESC = '\x1b';

function render(payload) {
  return spawnSync('bash', [SCRIPT], { input: JSON.stringify(payload), encoding: 'utf8' }).stdout;
}

test('full payload renders PS1-colored segments', () => {
  const out = render({ cwd: '/tmp/nonrepo-xyz', model: { display_name: 'Opus 4.8 (1M context)' }, context_window: { used_percentage: 6 } });
  assert.match(out, new RegExp(`^${ESC}\\[01;32m.+@.+${ESC}\\[00m:`));            // user@host green + colon
  assert.ok(out.includes(`${ESC}[01;34m/tmp/nonrepo-xyz${ESC}[00m`));             // path blue
  assert.ok(out.includes(`${ESC}[00;36mOpus 4.8 (1M context)${ESC}[00m`));        // model cyan
  assert.ok(out.includes(`${ESC}[00;32m[ctx:6%]${ESC}[00m`));                     // ctx green (<50)
});

test('ctx threshold colors at boundaries', () => {
  const ctx = (p) => render({ cwd: '', model: { display_name: '' }, context_window: { used_percentage: p } });
  assert.ok(ctx(49).includes(`${ESC}[00;32m[ctx:49%]`), 'green <50');
  assert.ok(ctx(50).includes(`${ESC}[00;33m[ctx:50%]`), 'yellow 50');
  assert.ok(ctx(79).includes(`${ESC}[00;33m[ctx:79%]`), 'yellow 79');
  assert.ok(ctx(80).includes(`${ESC}[00;31m[ctx:80%]`), 'red 80');
  assert.ok(ctx(6.2).includes(`${ESC}[00;32m[ctx:6%]`), 'decimal floored');
});

test('ctx hidden when absent or non-numeric', () => {
  assert.ok(!render({ cwd: '', model: { display_name: '' } }).includes('[ctx:'));
  assert.ok(!render({ cwd: '', model: { display_name: '' }, context_window: { used_percentage: 'N/A' } }).includes('[ctx:'));
});

test('empty stdin → user@host only, exit 0', () => {
  const res = spawnSync('bash', [SCRIPT], { input: '', encoding: 'utf8' });
  assert.equal(res.status, 0);
  assert.match(res.stdout, new RegExp(`^${ESC}\\[01;32m.+@.+${ESC}\\[00m:$`));
});

test('git repo → branch segment; non-repo → none', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-repo-'));
  const genv = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
  execSync('git init -q && git commit -q --allow-empty -m init', { cwd: repo, env: genv });
  const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: repo, encoding: 'utf8' }).trim();
  assert.ok(render({ cwd: repo, model: { display_name: '' } }).includes(`${ESC}[00;35m(${branch})${ESC}[00m`));
  fs.rmSync(repo, { recursive: true, force: true });

  const nonrepo = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-nonrepo-'));
  assert.ok(!render({ cwd: nonrepo, model: { display_name: '' } }).includes(`${ESC}[00;35m(`));
  fs.rmSync(nonrepo, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/scripts/statusline.test.js`
Expected: FAIL — `scripts/statusline.sh` does not exist (spawn returns empty stdout / non-zero).

- [ ] **Step 3: Write the renderer**

`scripts/statusline.sh`:

```bash
#!/usr/bin/env bash
# claudemd statusLine — PS1-style: user@host:path (branch) model [ctx:N%]
# Reads Claude Code's statusLine JSON on stdin; prints one line to stdout.
# Colors mirror bash PS1 (green user@host, blue path, magenta branch, cyan
# model); [ctx:N%] is threshold-colored: <50 green, 50-79 yellow, >=80 red.
# Never exits non-zero and never blanks on bad input (no `set -e`).
input=$(cat)
cwd=""; model=""; used=""
if [ -n "$input" ]; then
  # One jq call, three newline-delimited outputs. `// ""` (NOT `// empty`) keeps
  # exactly three lines so the reads stay aligned even when a field is absent.
  {
    IFS= read -r cwd
    IFS= read -r model
    IFS= read -r used
  } < <(jq -r '
    .cwd // .workspace.current_dir // "",
    .model.display_name // "",
    (.context_window.used_percentage // "")
  ' <<<"$input" 2>/dev/null)
fi

# user@host — bold green
user_host="\033[01;32m$(whoami)@$(hostname -s)\033[00m"

# path — bold blue
path_part=""
[ -n "$cwd" ] && path_part="\033[01;34m${cwd}\033[00m"

# branch — magenta; detached HEAD → short SHA; only inside a repo
branch_part=""
if [ -n "$cwd" ] && [ -d "$cwd" ]; then
  branch=$(git -C "$cwd" rev-parse --abbrev-ref HEAD 2>/dev/null)
  if [ -n "$branch" ] && [ "$branch" != "HEAD" ]; then
    branch_part=" \033[00;35m(${branch})\033[00m"
  elif [ -n "$branch" ]; then
    sha=$(git -C "$cwd" rev-parse --short HEAD 2>/dev/null)
    [ -n "$sha" ] && branch_part=" \033[00;35m(detached:${sha})\033[00m"
  fi
fi

# model — cyan
model_part=""
[ -n "$model" ] && model_part=" \033[00;36m${model}\033[00m"

# context usage — semantic threshold color (guards non-numeric before arithmetic)
ctx_part=""
used_int=${used%.*}
case "$used_int" in
  ''|*[!0-9]*) : ;;
  *)
    if   [ "$used_int" -ge 80 ]; then c=31
    elif [ "$used_int" -ge 50 ]; then c=33
    else c=32; fi
    ctx_part=" \033[00;${c}m[ctx:${used_int}%]\033[00m"
  ;;
esac

printf '%b' "${user_host}:${path_part}${branch_part}${model_part}${ctx_part}"
```

- [ ] **Step 4: Make the renderer executable**

Run: `chmod 0755 scripts/statusline.sh`

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --test tests/scripts/statusline.test.js`
Expected: PASS — all 5 tests green.

- [ ] **Step 6: Commit**

```bash
git add scripts/statusline.sh tests/scripts/statusline.test.js
git commit -m "feat(statusline): PS1-style renderer with semantic ctx threshold colors"
```

---

### Task 2: Extract `backupSettingsFile()` into `backup.js`

**Files:**
- Modify: `scripts/lib/backup.js` (add export)
- Modify: `scripts/install.js:149-167` (replace inline block with the helper)

**Interfaces:**
- Produces: `backupSettingsFile(retainCount = 5) → { backup: string|null, pruned: string[] }`. Copies `settings.json` to a `.claudemd-backup-<isoStamp>` sibling (numeric-suffix on collision), prunes to `retainCount`. `{ backup: null, pruned: [] }` when no settings.json.
- Consumed by: `install.js` and Task 3 `adopt()` (command path).

- [ ] **Step 1: Add the helper to `backup.js`**

Append to `scripts/lib/backup.js` (it already imports `settingsPath`; `isoStamp` and `pruneSettingsBackups` are defined above in the same file):

```js
// Pre-mutation safety copy of settings.json, shared by install.js and the
// statusline adopt path. Mirrors the inline block install.js used pre-extraction:
// `.claudemd-backup-<isoStamp>` sibling, numeric-suffixed on the (vanishingly
// rare) same-ms collision, then rotate to `retainCount` newest.
export function backupSettingsFile(retainCount = 5) {
  const p = settingsPath();
  if (!fs.existsSync(p)) return { backup: null, pruned: [] };
  let candidate = `${p}.claudemd-backup-${isoStamp()}`;
  if (fs.existsSync(candidate)) {
    for (let i = 1; i < 1000; i++) {
      const next = `${candidate}-${i}`;
      if (!fs.existsSync(next)) { candidate = next; break; }
    }
  }
  fs.copyFileSync(p, candidate);
  const pruned = pruneSettingsBackups(retainCount);
  return { backup: candidate, pruned };
}
```

- [ ] **Step 2: Rewire `install.js` to use it**

In `scripts/install.js`, change the import on line 5 from:

```js
import { createBackup, pruneBackups, pruneSettingsBackups, isoStamp } from './lib/backup.js';
```

to:

```js
import { createBackup, pruneBackups, backupSettingsFile } from './lib/backup.js';
```

Then replace the block at lines 149-167 (from `// §2.7 safety:` through the closing of the `if (fs.existsSync(settingsPath()))`) with:

```js
  // §2.7 safety: pre-merge backup of settings.json before any modification.
  const { backup: settingsBackup, pruned: settingsBackupsPruned } = backupSettingsFile(5);
```

(Delete the now-unused `let settingsBackup = null;` / `let settingsBackupsPruned = [];` declarations and the inline candidate/collision/copy/prune code — `backupSettingsFile` now owns them. `isoStamp` and `pruneSettingsBackups` are no longer imported by install.js.)

- [ ] **Step 3: Run install tests to verify identical behavior**

Run: `node --test tests/scripts/install.test.js`
Expected: PASS — including `pre-merge settings.json backup created…`, `fresh install (no settings.json): settingsBackup is null`, and `same-stamp settings.json backup gets numeric suffix (F10)`. These assert the extracted behavior unchanged.

- [ ] **Step 4: Commit**

```bash
git add scripts/lib/backup.js scripts/install.js
git commit -m "refactor(backup): extract backupSettingsFile() shared by install + statusline adopt"
```

---

### Task 3: Core state machine `scripts/lib/statusline.js`

**Files:**
- Create: `scripts/lib/statusline.js`
- Test: `tests/scripts/statusline-adopt.test.js`

**Interfaces:**
- Consumes: `readSettings`/`writeSettings` (settings-merge), `settingsPath`/`stateDir`/`homeSpec` (paths), `backupSettingsFile` (backup, Task 2).
- Produces:
  - `detect(pluginRoot = null) → { verdict: 'absent'|'claudemd'|'foreign', current: string|null, dest: { exists: bool, matchesShipped: bool } }`
  - `adopt({ pluginRoot, force = false, emptyOnly = false, dryRun = false, backupSettings = true }) → { action, from, to, settingsBackup? }` where `action ∈ {'set','refreshed','replaced','skipped-foreign','foreign','dry-run'}`
  - `remove() → { action: 'removed'|'restored'|'not-ours', restored?: string|null }`
  - `pluginRoot` is REQUIRED by `adopt` (throws if missing) — `resolvePluginRoot` cannot self-derive correctly from `scripts/lib/`.

- [ ] **Step 1: Write the failing test**

`tests/scripts/statusline-adopt.test.js`:

```js
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { detect, adopt, remove } from '../../scripts/lib/statusline.js';

let tmpHome, savedHome, pluginRoot;
const settingsFile = () => path.join(tmpHome, '.claude/settings.json');
const destFile = () => path.join(tmpHome, '.claude/claudemd-statusline.sh');
const prevFile = () => path.join(tmpHome, '.claude/.claudemd-state/statusline-prev.json');
const readS = () => JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
const writeS = (o) => fs.writeFileSync(settingsFile(), JSON.stringify(o, null, 2));
const CMD = 'bash "$HOME/.claude/claudemd-statusline.sh"';

beforeEach(() => {
  delete process.env.CLAUDEMD_NO_STATUSLINE;
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-sl-'));
  pluginRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-slpkg-'));
  savedHome = process.env.HOME;
  process.env.HOME = tmpHome;
  fs.mkdirSync(path.join(tmpHome, '.claude'), { recursive: true });
  fs.mkdirSync(path.join(pluginRoot, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(pluginRoot, 'scripts/statusline.sh'), '#!/usr/bin/env bash\necho claudemd-sl\n');
});
afterEach(() => {
  process.env.HOME = savedHome;
  fs.rmSync(tmpHome, { recursive: true, force: true });
  fs.rmSync(pluginRoot, { recursive: true, force: true });
});

test('absent → set (settings written, DEST copied+exec)', () => {
  assert.equal(detect().verdict, 'absent');
  const r = adopt({ pluginRoot });
  assert.equal(r.action, 'set');
  assert.equal(readS().statusLine.command, CMD);
  assert.ok(fs.existsSync(destFile()));
  assert.ok((fs.statSync(destFile()).mode & 0o111) !== 0, 'DEST is executable');
  assert.equal(detect().verdict, 'claudemd');
});

test('claudemd → refreshed (settings unchanged, DEST re-copied)', () => {
  adopt({ pluginRoot });
  const before = fs.readFileSync(settingsFile(), 'utf8');
  fs.rmSync(destFile());
  const r = adopt({ pluginRoot });
  assert.equal(r.action, 'refreshed');
  assert.equal(fs.readFileSync(settingsFile(), 'utf8'), before);
  assert.ok(fs.existsSync(destFile()));
});

test('foreign + emptyOnly → skipped, nothing touched', () => {
  writeS({ statusLine: { type: 'command', command: 'node /other/x.js' } });
  const r = adopt({ pluginRoot, emptyOnly: true });
  assert.equal(r.action, 'skipped-foreign');
  assert.equal(readS().statusLine.command, 'node /other/x.js');
  assert.ok(!fs.existsSync(destFile()));
});

test('foreign, no force → foreign report, untouched', () => {
  writeS({ statusLine: { type: 'command', command: 'node /other/x.js' } });
  const r = adopt({ pluginRoot });
  assert.equal(r.action, 'foreign');
  assert.equal(readS().statusLine.command, 'node /other/x.js');
  assert.ok(!fs.existsSync(destFile()));
});

test('foreign + force → replaced, prior saved', () => {
  writeS({ statusLine: { type: 'command', command: 'node /other/x.js' } });
  const r = adopt({ pluginRoot, force: true });
  assert.equal(r.action, 'replaced');
  assert.equal(readS().statusLine.command, CMD);
  assert.equal(JSON.parse(fs.readFileSync(prevFile(), 'utf8')).command, 'node /other/x.js');
});

test('remove after set → key cleared, DEST gone', () => {
  adopt({ pluginRoot });
  const r = remove();
  assert.equal(r.action, 'removed');
  assert.equal(readS().statusLine, undefined);
  assert.ok(!fs.existsSync(destFile()));
});

test('remove after force → prior restored, DEST gone', () => {
  writeS({ statusLine: { type: 'command', command: 'node /other/x.js' } });
  adopt({ pluginRoot, force: true });
  const r = remove();
  assert.equal(r.action, 'restored');
  assert.equal(readS().statusLine.command, 'node /other/x.js');
  assert.ok(!fs.existsSync(destFile()));
  assert.ok(!fs.existsSync(prevFile()));
});

test('remove when foreign → not-ours, untouched', () => {
  writeS({ statusLine: { type: 'command', command: 'node /other/x.js' } });
  const r = remove();
  assert.equal(r.action, 'not-ours');
  assert.equal(readS().statusLine.command, 'node /other/x.js');
});

test('dry-run → no writes', () => {
  const r = adopt({ pluginRoot, dryRun: true });
  assert.equal(r.action, 'dry-run');
  assert.ok(!fs.existsSync(destFile()));
  const sPath = settingsFile();
  assert.ok(!fs.existsSync(sPath) || readS().statusLine === undefined);
});

test('adopt throws without pluginRoot', () => {
  assert.throws(() => adopt({}), /pluginRoot/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/scripts/statusline-adopt.test.js`
Expected: FAIL — `scripts/lib/statusline.js` does not exist (import throws).

- [ ] **Step 3: Write the lib**

`scripts/lib/statusline.js`:

```js
import fs from 'node:fs';
import path from 'node:path';
import { readSettings, writeSettings } from './settings-merge.js';
import { settingsPath, stateDir, homeSpec } from './paths.js';
import { backupSettingsFile } from './backup.js';

const MARKER = 'claudemd-statusline.sh';
const COMMAND = 'bash "$HOME/.claude/claudemd-statusline.sh"';

const destPath = () => homeSpec('claudemd-statusline.sh');
const prevPath = () => path.join(stateDir(), 'statusline-prev.json');
const shippedRenderer = (pluginRoot) => path.join(pluginRoot, 'scripts', 'statusline.sh');
const loadSettings = () => (fs.existsSync(settingsPath()) ? readSettings() : {});

export function detect(pluginRoot = null) {
  const settings = loadSettings();
  const cmd = settings.statusLine && typeof settings.statusLine.command === 'string'
    ? settings.statusLine.command
    : null;
  const verdict = !cmd ? 'absent' : (cmd.includes(MARKER) ? 'claudemd' : 'foreign');
  const dest = destPath();
  const exists = fs.existsSync(dest);
  let matchesShipped = false;
  if (pluginRoot && exists) {
    try {
      matchesShipped = fs.readFileSync(dest, 'utf8') === fs.readFileSync(shippedRenderer(pluginRoot), 'utf8');
    } catch { matchesShipped = false; }
  }
  return { verdict, current: cmd, dest: { exists, matchesShipped } };
}

function copyRenderer(pluginRoot) {
  const dest = destPath();
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(shippedRenderer(pluginRoot), dest);
  fs.chmodSync(dest, 0o755);
}

function setStatusLine() {
  const settings = loadSettings();
  settings.statusLine = { type: 'command', command: COMMAND };
  writeSettings(settings);
}

export function adopt({ pluginRoot, force = false, emptyOnly = false, dryRun = false, backupSettings = true } = {}) {
  if (!pluginRoot) throw new Error('adopt: pluginRoot required');
  const { verdict, current } = detect(pluginRoot);

  if (verdict === 'claudemd') {
    if (dryRun) return { action: 'dry-run', from: current, to: current };
    copyRenderer(pluginRoot);
    return { action: 'refreshed', from: current, to: current };
  }

  if (verdict === 'foreign') {
    if (emptyOnly) return { action: 'skipped-foreign', from: current, to: null };
    if (!force) return { action: 'foreign', from: current, to: null };
    if (dryRun) return { action: 'dry-run', from: current, to: COMMAND };
    const settingsBackup = backupSettings ? backupSettingsFile().backup : null;
    fs.mkdirSync(stateDir(), { recursive: true });
    fs.writeFileSync(prevPath(), JSON.stringify({ command: current }, null, 2));
    copyRenderer(pluginRoot);
    setStatusLine();
    return { action: 'replaced', from: current, to: COMMAND, settingsBackup };
  }

  // absent
  if (dryRun) return { action: 'dry-run', from: null, to: COMMAND };
  const settingsBackup = backupSettings ? backupSettingsFile().backup : null;
  copyRenderer(pluginRoot);
  setStatusLine();
  return { action: 'set', from: null, to: COMMAND, settingsBackup };
}

export function remove() {
  const { verdict, current } = detect();
  if (verdict !== 'claudemd') return { action: 'not-ours', restored: null };
  const settings = loadSettings();
  let action = 'removed';
  let restored = null;
  if (fs.existsSync(prevPath())) {
    try {
      const prev = JSON.parse(fs.readFileSync(prevPath(), 'utf8'));
      if (prev && typeof prev.command === 'string') {
        settings.statusLine = { type: 'command', command: prev.command };
        restored = prev.command;
        action = 'restored';
      } else {
        delete settings.statusLine;
      }
    } catch {
      delete settings.statusLine;
    }
    try { fs.unlinkSync(prevPath()); } catch { /* best-effort */ }
  } else {
    delete settings.statusLine;
  }
  writeSettings(settings);
  try { fs.unlinkSync(destPath()); } catch { /* best-effort */ }
  return { action, restored };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/scripts/statusline-adopt.test.js`
Expected: PASS — all 10 tests green.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/statusline.js tests/scripts/statusline-adopt.test.js
git commit -m "feat(statusline): detect/adopt/remove state machine over settings.json"
```

---

### Task 4: CLI wrapper `scripts/statusline-adopt.js`

**Files:**
- Create: `scripts/statusline-adopt.js`
- Test: `tests/scripts/statusline-cli.test.js`

**Interfaces:**
- Consumes: `detect`/`adopt`/`remove` (Task 3), `resolvePluginRoot` (paths — correct here because this file lives in `scripts/`), `parseStrict`/`ArgvError`/`printHelpAndExit` (argv).
- Produces: CLI `node scripts/statusline-adopt.js <detect|adopt|remove> [--force|--empty-only|--dry-run|--json]`. Always prints one JSON line. Exit 0 ok / 1 failure / 2 argv-shape.

- [ ] **Step 1: Write the failing test**

`tests/scripts/statusline-cli.test.js`:

```js
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CLI = path.join(REPO_ROOT, 'scripts/statusline-adopt.js');

let tmpHome, savedHome;
function run(args) {
  return spawnSync(process.execPath, [CLI, ...args], {
    env: { ...process.env, HOME: tmpHome, CLAUDE_PLUGIN_ROOT: REPO_ROOT },
    encoding: 'utf8',
  });
}

beforeEach(() => {
  delete process.env.CLAUDEMD_NO_STATUSLINE;
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-slcli-'));
  savedHome = process.env.HOME;
  fs.mkdirSync(path.join(tmpHome, '.claude'), { recursive: true });
});
afterEach(() => {
  process.env.HOME = savedHome;
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

test('detect on empty slot → absent', () => {
  const r = run(['detect', '--json']);
  assert.equal(r.status, 0);
  assert.equal(JSON.parse(r.stdout).verdict, 'absent');
});

test('adopt then detect → claudemd', () => {
  assert.equal(JSON.parse(run(['adopt']).stdout).action, 'set');
  assert.equal(JSON.parse(run(['detect', '--json']).stdout).verdict, 'claudemd');
  assert.ok(fs.existsSync(path.join(tmpHome, '.claude/claudemd-statusline.sh')));
});

test('unknown mode → exit 2', () => {
  assert.equal(run(['bogus']).status, 2);
});

test('unknown flag → exit 2', () => {
  assert.equal(run(['adopt', '--nope']).status, 2);
});

test('--help → exit 0 with usage', () => {
  const r = run(['--help']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /Usage: node scripts\/statusline-adopt\.js/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/scripts/statusline-cli.test.js`
Expected: FAIL — CLI does not exist (spawn status non-zero, empty stdout).

- [ ] **Step 3: Write the CLI**

`scripts/statusline-adopt.js`:

```js
#!/usr/bin/env node
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseStrict, ArgvError, printHelpAndExit } from './lib/argv.js';
import { resolvePluginRoot } from './lib/paths.js';
import { detect, adopt, remove } from './lib/statusline.js';

const USAGE = `Usage: node scripts/statusline-adopt.js <detect|adopt|remove> [flags]

Manage claudemd's statusLine registration in ~/.claude/settings.json.

Modes:
  detect            Print JSON verdict (absent|claudemd|foreign) + dest state. No writes.
  adopt             Empty slot → set. claudemd → refresh renderer. foreign → no-op
                    unless --force. Copies the renderer to ~/.claude/claudemd-statusline.sh.
  remove            Remove claudemd's statusLine (restore prior if saved). No-op if not ours.

Flags:
  --force           adopt: replace a foreign statusLine (saves prior for remove).
  --empty-only      adopt: only write when the slot is empty (install-time guard).
  --dry-run         adopt: print the transition, write nothing.
  --json            Machine-readable JSON (adopt/remove always emit JSON regardless).
  --help, -h        Print this message and exit.

Exit codes: 0 success | 1 failure | 2 argv-shape error.`;

// realpath BOTH sides so a symlinked invocation path still matches (mirrors
// design-detect.js — a bare href compare silently no-ops under a symlinked dir).
const invokedAsMain = (() => {
  try { return fs.realpathSync(fileURLToPath(import.meta.url)) === fs.realpathSync(process.argv[1]); }
  catch { return false; }
})();

if (invokedAsMain) {
  const argv = process.argv.slice(2);
  printHelpAndExit(argv, USAGE);
  const [mode, ...rest] = argv;
  if (!['detect', 'adopt', 'remove'].includes(mode || '')) {
    console.error(`Unknown mode: '${mode || ''}'. Expected detect|adopt|remove.`);
    process.exit(2);
  }
  let parsed;
  try {
    parsed = parseStrict(rest, { bools: ['--force', '--empty-only', '--dry-run', '--json'] });
  } catch (e) {
    if (e instanceof ArgvError) { console.error(e.message); process.exit(2); }
    throw e;
  }
  const pluginRoot = resolvePluginRoot(import.meta.url);
  try {
    let out;
    if (mode === 'detect') out = detect(pluginRoot);
    else if (mode === 'adopt') out = adopt({
      pluginRoot,
      force: parsed.bools.has('--force'),
      emptyOnly: parsed.bools.has('--empty-only'),
      dryRun: parsed.bools.has('--dry-run'),
    });
    else out = remove();
    process.stdout.write(JSON.stringify(out) + '\n');
    process.exit(0);
  } catch (e) {
    console.error(`statusline-adopt failed: ${e.message}`);
    process.exit(1);
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/scripts/statusline-cli.test.js`
Expected: PASS — all 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add scripts/statusline-adopt.js tests/scripts/statusline-cli.test.js
git commit -m "feat(statusline): statusline-adopt CLI wrapper (detect/adopt/remove)"
```

---

### Task 5: install.js auto-adopt (empty-slot-only + opt-out)

**Files:**
- Modify: `scripts/install.js` (import + call before return)
- Modify: `tests/scripts/install.test.js` (fixture renderer + 3 new tests + `beforeEach` hermeticity)

**Interfaces:**
- Consumes: `adopt` from Task 3 (aliased `adoptStatusline`).
- Produces: install result gains `statusline: { action, ... }` where `action ∈ {'set','skipped-foreign','refreshed','opted-out','error'}`.

- [ ] **Step 1: Add fixture renderer + failing tests to `install.test.js`**

In `tests/scripts/install.test.js` `beforeEach`, add hermeticity + a fixture renderer (so install's copy has a real source). After the existing `fs.mkdirSync(path.join(tmpHome, '.claude'), …)` line, add:

```js
  delete process.env.CLAUDEMD_NO_STATUSLINE;
```

After the hooks.json fixture write (end of `beforeEach`), add:

```js
  fs.mkdirSync(path.join(pluginRoot, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(pluginRoot, 'scripts/statusline.sh'), '#!/usr/bin/env bash\necho fixture-sl\n');
```

Add these tests at the end of the file:

```js
test('fresh install sets claudemd statusLine into the empty slot', async () => {
  const res = await install({ pluginRoot });
  assert.equal(res.statusline.action, 'set');
  const s = JSON.parse(fs.readFileSync(path.join(tmpHome, '.claude/settings.json'), 'utf8'));
  assert.equal(s.statusLine.command, 'bash "$HOME/.claude/claudemd-statusline.sh"');
  assert.ok(fs.existsSync(path.join(tmpHome, '.claude/claudemd-statusline.sh')));
});

test('install does NOT clobber a foreign statusLine', async () => {
  fs.writeFileSync(path.join(tmpHome, '.claude/settings.json'),
    JSON.stringify({ statusLine: { type: 'command', command: 'node /foreign/sl.js' } }));
  const res = await install({ pluginRoot });
  assert.equal(res.statusline.action, 'skipped-foreign');
  const s = JSON.parse(fs.readFileSync(path.join(tmpHome, '.claude/settings.json'), 'utf8'));
  assert.equal(s.statusLine.command, 'node /foreign/sl.js');
  assert.ok(!fs.existsSync(path.join(tmpHome, '.claude/claudemd-statusline.sh')));
});

test('CLAUDEMD_NO_STATUSLINE=1 skips the statusLine write', async () => {
  process.env.CLAUDEMD_NO_STATUSLINE = '1';
  try {
    const res = await install({ pluginRoot });
    assert.equal(res.statusline.action, 'opted-out');
    const sPath = path.join(tmpHome, '.claude/settings.json');
    const s = fs.existsSync(sPath) ? JSON.parse(fs.readFileSync(sPath, 'utf8')) : {};
    assert.equal(s.statusLine, undefined);
  } finally {
    delete process.env.CLAUDEMD_NO_STATUSLINE;
  }
});
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `node --test tests/scripts/install.test.js`
Expected: FAIL — `res.statusline` is `undefined` (install does not set it yet).

- [ ] **Step 3: Wire install.js**

Add the import after line 8 (`import { HOOK_BASENAMES } …`):

```js
import { adopt as adoptStatusline } from './lib/statusline.js';
```

In `install()`, immediately before the final `return { spec: specResult, … }` (line 228), insert:

```js
  // StatusLine auto-adopt — empty-slot-only (never clobbers a foreign provider),
  // opt-out via CLAUDEMD_NO_STATUSLINE. best-effort: a statusline failure must
  // never fail the install (same posture as cachePrune). settings.json was
  // already backed up above, so backupSettings:false.
  let statusline;
  if (process.env.CLAUDEMD_NO_STATUSLINE === '1') {
    statusline = { action: 'opted-out' };
  } else {
    try {
      statusline = adoptStatusline({ pluginRoot, emptyOnly: true, backupSettings: false });
    } catch (e) {
      statusline = { action: 'error', error: e.message };
    }
  }
  if (statusline.action === 'set') {
    process.stderr.write('[claudemd] statusLine set (user@host:path (branch) model [ctx:N%]). Undo: /claudemd-statusline remove\n');
  } else if (statusline.action === 'skipped-foreign') {
    process.stderr.write('[claudemd] statusLine already owned by another provider — left untouched. Take over: /claudemd-statusline --force\n');
  }
```

Then add `statusline` to the returned object:

```js
  return { spec: specResult, backupDir, settingsBackup, settingsBackupsPruned, entries, cachePruned, userContentDetected, statusline };
```

- [ ] **Step 4: Run to verify all install tests pass**

Run: `node --test tests/scripts/install.test.js`
Expected: PASS — new statusline tests green; existing idempotency/backup/manifest tests still green (statusline is not a hook, so `manifest.entries.length` 12/16 assertions are unchanged; the `idempotent 3x` test still holds because run 1 sets statusLine and runs 2–3 refresh without a settings diff).

- [ ] **Step 5: Commit**

```bash
git add scripts/install.js tests/scripts/install.test.js
git commit -m "feat(install): auto-adopt statusLine into empty slot (opt-out CLAUDEMD_NO_STATUSLINE)"
```

---

### Task 6: uninstall.js cleanup

**Files:**
- Modify: `scripts/uninstall.js` (import + call + both return objects)
- Modify: `tests/scripts/uninstall.test.js` (2 new tests; reuse its existing HOME-sandbox `beforeEach`)

**Interfaces:**
- Consumes: `remove` from Task 3 (aliased `removeStatusline`).
- Produces: uninstall result gains `statusline: { action, restored? }`.

- [ ] **Step 1: Add failing tests to `uninstall.test.js`**

Read the existing `tests/scripts/uninstall.test.js` `beforeEach` first (it sandboxes `HOME` in a mkdtemp and installs a manifest — mirror its setup). Add `delete process.env.CLAUDEMD_NO_STATUSLINE;` to its `beforeEach`. Then add:

```js
test('uninstall removes a claudemd-owned statusLine + the renderer', async () => {
  // Arrange: adopt claudemd's statusLine into the sandbox home.
  const pluginRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-unpkg-'));
  fs.mkdirSync(path.join(pluginRoot, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(pluginRoot, 'scripts/statusline.sh'), '#!/usr/bin/env bash\necho x\n');
  const { adopt } = await import('../../scripts/lib/statusline.js');
  adopt({ pluginRoot });
  assert.ok(fs.existsSync(path.join(tmpHome, '.claude/claudemd-statusline.sh')));

  const res = await uninstall({});
  assert.equal(res.statusline.action, 'removed');
  const s = JSON.parse(fs.readFileSync(path.join(tmpHome, '.claude/settings.json'), 'utf8'));
  assert.equal(s.statusLine, undefined);
  assert.ok(!fs.existsSync(path.join(tmpHome, '.claude/claudemd-statusline.sh')));
  fs.rmSync(pluginRoot, { recursive: true, force: true });
});

test('uninstall leaves a foreign statusLine untouched', async () => {
  fs.writeFileSync(path.join(tmpHome, '.claude/settings.json'),
    JSON.stringify({ statusLine: { type: 'command', command: 'node /foreign/sl.js' } }));
  const res = await uninstall({});
  assert.equal(res.statusline.action, 'not-ours');
  const s = JSON.parse(fs.readFileSync(path.join(tmpHome, '.claude/settings.json'), 'utf8'));
  assert.equal(s.statusLine.command, 'node /foreign/sl.js');
});
```

(If `uninstall.test.js` does not already import `os`, add `import os from 'node:os';`.)

- [ ] **Step 2: Run to verify the new tests fail**

Run: `node --test tests/scripts/uninstall.test.js`
Expected: FAIL — `res.statusline` is `undefined`.

- [ ] **Step 3: Wire uninstall.js**

Add the import after line 6 (`import { HOOK_BASENAMES } …`):

```js
import { remove as removeStatusline } from './lib/statusline.js';
```

Right after the settings hook-eviction block (after `writeSettings(s);` on line 57, before the `if (!m.exists || !m.data)` early return on line 65), insert:

```js
  // StatusLine cleanup — runs unconditionally (like the settings eviction
  // above) so a manifest-less uninstall still un-wires our statusLine. No-op
  // when the slot is empty or owned by another provider.
  let statusline = { action: 'not-ours', restored: null };
  try { statusline = removeStatusline(); } catch (e) { statusline = { action: 'error', error: e.message }; }
```

Add `statusline` to BOTH return objects — the no-manifest early return (line 66) and the final return (line 103):

```js
    return { specAction: 'noop', warning: 'already-uninstalled', settingsRemoved, statusline };
```

```js
  return { specAction: outcome, settingsRemoved, statusline };
```

- [ ] **Step 4: Run to verify all uninstall tests pass**

Run: `node --test tests/scripts/uninstall.test.js`
Expected: PASS — new statusline tests green; existing tests unaffected (statusline removal is additive and no-ops on the foreign/empty settings those tests use).

- [ ] **Step 5: Commit**

```bash
git add scripts/uninstall.js tests/scripts/uninstall.test.js
git commit -m "feat(uninstall): un-wire claudemd statusLine + delete renderer on uninstall"
```

---

### Task 7: `/claudemd-statusline` command

**Files:**
- Create: `commands/claudemd-statusline.md`

**Interfaces:**
- Consumes: `scripts/statusline-adopt.js` (Task 4) via `${CLAUDE_PLUGIN_ROOT}`.
- Produces: the slash command surface (no automated test — verified manually in Task 8).

- [ ] **Step 1: Write the command file**

`commands/claudemd-statusline.md`:

```markdown
---
name: claudemd-statusline
description: Register claudemd's PS1-style statusLine (user@host:path (branch) model [ctx:N%]) in ~/.claude/settings.json. Use when (1) the user asks to add / configure / set up a statusline or status bar, (2) a fresh machine has no statusline and the user wants the claudemd one, (3) the user wants claudemd to take over the statusline from another provider (--force). Modes - check (report current owner, no writes), remove (un-wire + restore prior). Idempotent: never duplicates, never clobbers another provider's slot without --force.
---

Usage: `/claudemd-statusline` | `/claudemd-statusline --force` | `/claudemd-statusline check` | `/claudemd-statusline remove`

## Step 0 — detect (deterministic, no writes)

Run: `node ${CLAUDE_PLUGIN_ROOT}/scripts/statusline-adopt.js detect --json`

Branch on `verdict`:
- `absent` → slot is free. Continue to Step 1 (adopt).
- `claudemd` → already configured. Report the stable path `~/.claude/claudemd-statusline.sh` and `dest.matchesShipped`. If `false`, offer to re-run adopt (refreshes the renderer copy). STOP unless the user wants a refresh.
- `foreign` → another provider owns the slot (report `current`). Do NOT write. Tell the user their existing statusline is untouched and that `/claudemd-statusline --force` will take it over (saving the current command so `remove` can restore it). Continue to Step 1 ONLY if the user passed `--force`.

## `check` mode (no writes)

Run Step 0. Report `verdict`, `current`, and whether `~/.claude/claudemd-statusline.sh` exists and matches the shipped renderer (`dest.matchesShipped`). STOP.

## `remove` mode

Show the transition first: run `detect --json`; if `verdict` is `claudemd`, state what `settings.statusLine` will become (restored prior command if one was saved, else removed) and that `~/.claude/claudemd-statusline.sh` will be deleted. Then run:
`node ${CLAUDE_PLUGIN_ROOT}/scripts/statusline-adopt.js remove`
Report the `action` (`removed` / `restored` / `not-ours`). If `not-ours`, nothing was changed.

## Step 1 — consent gate (always, binds under AUTONOMY_LEVEL: aggressive)

Writing `~/.claude/settings.json` is a §5 hard-AUTH action. BEFORE writing, show the user exactly what changes:
- the `statusLine` command that will be set: `bash "$HOME/.claude/claudemd-statusline.sh"`
- for `foreign` + `--force`: the current command that will be saved for restore
- that the renderer is copied to `~/.claude/claudemd-statusline.sh`

Preview with `--dry-run` if useful: `node ${CLAUDE_PLUGIN_ROOT}/scripts/statusline-adopt.js adopt [--force] --dry-run`. Ask once, then proceed.

## Step 2 — adopt

Run (add `--force` only for the `foreign` take-over the user approved):
`node ${CLAUDE_PLUGIN_ROOT}/scripts/statusline-adopt.js adopt [--force]`

## Step 3 — verify + report

Re-run `node ${CLAUDE_PLUGIN_ROOT}/scripts/statusline-adopt.js detect --json` and cite `verdict: claudemd` as the completion evidence. Report: the `action` from Step 2 (`set` / `replaced` / `refreshed`), the settings backup path (if any), and — for a `--force` replace — that the prior command was saved and is restorable via `/claudemd-statusline remove`.
```

- [ ] **Step 2: Sanity-check the command wiring**

Run: `node scripts/statusline-adopt.js detect --json`
Expected: valid JSON with a `verdict` field (proves the path the command invokes works from the repo).

- [ ] **Step 3: Commit**

```bash
git add commands/claudemd-statusline.md
git commit -m "feat(statusline): /claudemd-statusline command (detect/consent/adopt/check/remove)"
```

---

### Task 8: Version bump, docs, and full-suite + real-CC verification

**Files:**
- Modify: `package.json` (version)
- Modify: plugin manifest(s) carrying the version (locate in Step 1)
- Modify: `CHANGELOG.md` (root plugin changelog)
- Modify: `README.md` (document the command)

**Interfaces:**
- Consumes: `scripts/version-cascade-check.js` (`npm run version-check`) to catch any version-coupled file the grep misses.

- [ ] **Step 1: Find every occurrence of the current version**

Run: `grep -rn "0\.24\.1" --include=*.json --include=*.md --include=*.js . | grep -v node_modules | grep -v CHANGELOG | grep -v /docs/`
Expected: at least `package.json`. Note whether `.claude-plugin/plugin.json` or `plugin.json` and any `marketplace.json` carry it.

- [ ] **Step 2: Bump the version to 0.25.0**

Edit each manifest found in Step 1: `"version": "0.24.1"` → `"version": "0.25.0"`. (Minor bump — additive user-visible feature per §2-EXT Released-artifact checklist.)

- [ ] **Step 3: Run the version-cascade check**

Run: `npm run version-check`
Expected: exit 0, all manifests in sync at 0.25.0. If it flags a file the grep missed, bump it too and re-run.

- [ ] **Step 4: Add the CHANGELOG entry**

Prepend a `## 0.25.0` entry to `CHANGELOG.md` (match the file's existing heading style). Content:

```markdown
## 0.25.0 — statusLine auto-registration

**New:** claudemd now ships a PS1-style statusLine — `user@host:/path (branch) Model [ctx:N%]` —
with a semantic context-pressure color ([ctx:N%] green <50%, yellow 50–79%, red ≥80%).

- **Auto (install):** a fresh install wires it into `~/.claude/settings.json` **only when the
  statusLine slot is empty**. An existing statusline (any other provider) is never touched.
- **Command:** `/claudemd-statusline` (adopt) · `check` · `remove` · `--force` (take over a
  foreign slot, saving the prior command for restore). The command always shows the diff and
  asks before writing.
- **Opt-out:** set `CLAUDEMD_NO_STATUSLINE=1` to skip the install-time write entirely.
- **Revert:** `/claudemd-statusline remove` restores the prior statusline (or clears the slot)
  and deletes `~/.claude/claudemd-statusline.sh`.

Migration: existing users with a statusline already configured see no change (empty-slot-only).
To adopt claudemd's line, run `/claudemd-statusline` (or `--force` to replace another provider's).
```

- [ ] **Step 5: Document the command in README.md**

Add a short subsection under the commands/features area (match README's existing structure) describing `/claudemd-statusline` with the four modes, the `CLAUDEMD_NO_STATUSLINE` opt-out, and the empty-slot-only install behavior. Keep it to facts (`feedback_project_doc_facts_only.md`).

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS — `tests/run-all.sh` runs scripts + hooks tests, all green.

- [ ] **Step 7: Real-CC render verification (resolves spec open-questions #1, #2)**

- Confirm the ctx field: the machine's existing `~/.claude/statusline-command.sh` already renders `[ctx:6%]` from `.context_window.used_percentage` on this CC version — that is the live evidence the field is correct. Cite it.
- Confirm `$HOME` expansion + real output by rendering the shipped script against a captured payload the way CC invokes it (through a shell):

Run: `printf '%s' '{"cwd":"'"$PWD"'","model":{"display_name":"Opus 4.8 (1M context)"},"context_window":{"used_percentage":6}}' | bash -c 'bash "$HOME/.claude/claudemd-statusline.sh"'`

(First copy the renderer into place for the probe, or run `bash scripts/statusline.sh` directly with the same stdin.) Expected: a colored line ending in a green `[ctx:6%]`, with `$HOME` resolved (no literal `$HOME` in the path). If `$HOME` does not expand in the real CC render, fall back to the unquoted form `bash ~/.claude/claudemd-statusline.sh` in `COMMAND` (the path has no spaces) and re-run Task 3's tests with the adjusted constant.

- [ ] **Step 8: Commit**

```bash
git add package.json CHANGELOG.md README.md .claude-plugin/plugin.json plugin.json 2>/dev/null
git commit -m "release(0.25.0): statusLine auto-registration — command + empty-slot install + docs"
```

(Adjust the `git add` to the manifest paths actually found in Step 1.)

---

## Self-Review

**Spec coverage** (against `2026-07-05-statusline-adopt-design.md`):
- Renderer format/colors/degradation → Task 1 ✓
- Semantic ctx thresholds (50/80) → Task 1 ✓
- Stable-path copy + `$HOME` command → Task 3 (`COMMAND`, `copyRenderer`) ✓ + Task 8 Step 7 verification
- detect/adopt/remove state machine (absent/claudemd/foreign, force, prev-restore) → Task 3 ✓
- Settings backup discipline → Task 2 (shared helper) ✓
- Install empty-slot-only + opt-out env + first-run stderr → Task 5 ✓
- Uninstall cleanup → Task 6 ✓
- Command + always-consent gate + check/remove → Task 7 ✓
- L3 cascade (version 0.25.0, CHANGELOG migration note, README, opt-out+revert, version-check) → Task 8 ✓
- Tests on sandbox settings.json, never real home → Tasks 3/5/6 (`mkdtempSync` HOME) ✓
- Test hermeticity (`delete CLAUDEMD_NO_STATUSLINE`) → Tasks 3/4/5/6 `beforeEach` ✓

**Placeholder scan:** none — every code/test step carries full content.

**Type/name consistency:** `COMMAND` literal `bash "$HOME/.claude/claudemd-statusline.sh"` is identical in Task 3 (lib), Task 5 (install test assertion), and Task 8 (CHANGELOG). `MARKER` substring `claudemd-statusline.sh` matches the DEST basename. `detect/adopt/remove` signatures match between Task 3 (definition), Task 4 (CLI), Task 5 (install), Task 6 (uninstall). `action` enums are consistent across producer (lib) and assertions.

**Deferred to implementation (not gaps):** the exact plugin-manifest path(s) for the version bump (Task 8 Step 1 grep resolves it); the exact README insertion point (match existing structure); the `$HOME`-vs-tilde final call (Task 8 Step 7, with fallback specified).
```

Not applicable — obligation carried into Task 8: `mem_save` (§11 global-state-hard: settings.json + renderer are ≥2 opaque `~/.claude/` writes) at ship, recording the stable-path/`$HOME`/foreign-skip decisions.
