# StatusLine multi-provider coexistence — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** claudemd's statusLine coexists with other providers — when a composite host (code-graph) owns the `~/.claude/settings.json` `statusLine` slot, claudemd registers itself as a guest provider (so both segments render) instead of clobbering it; empty-slot behavior is unchanged.

**Architecture:** A composite-host **adapter** layer (`scripts/lib/statusline-hosts.js`) recognizes hosts by their slot command and reads/writes their provider registry. `detect()` gains a `host` verdict; `adopt()`/`remove()` branch by strategy: **own** (empty slot → set our renderer, today's behavior), **guest** (host owns slot → register into its registry), and — deferred to v0.26.1 — **host-wrap** (non-composite foreign + `--force`). Folds in review Minors M2 (renderer newline-strip) and M5 (`--json`/`--dry-run` UX).

**Tech Stack:** Node.js ESM (`node:test`, `node:fs`), bash-3.2 renderer, `jq`. No new dependencies.

## Global Constraints

Every task's requirements implicitly include these (verbatim from the spec):

- **Never clobber a foreign non-composite slot** without `--force`; **never silently write another plugin's registry on install** (install only auto-sets an *empty* slot; guest registration is command + consent).
- **Guest command MUST be an absolute path**: `bash "<abs-home>/.claude/claudemd-statusline.sh"` (code-graph runs providers via `execFileSync` — NO shell — and expands only `~`, NOT `$HOME`; the `$HOME` form would ENOENT and silently blank). The **slot-owner** command stays `bash "$HOME/.claude/claudemd-statusline.sh"` (CC runs it through a shell). Renderer FILE is the same; only the command STRING differs by invoker.
- code-graph registry lives in **two** files, both written atomically (tmp+rename): primary `~/.cache/code-graph/statusline-registry.json`, durable mirror `~/.claude/statusline-providers.json`.
- Provider entry: `{ id: "claudemd", command: <abs>, needsStdin: true }`. Insert at the **front** of the list (after any `_previous`) → renders `claudemd | code-graph`.
- Renderer stays mode **0755**. Provider id is `claudemd`. Host detected by `command.includes('statusline-composite')`.
- **No SessionStart hook**; strategy recomputed per command/install run. **Consent-driven supersede** of a manual PS1 — no silent heuristic replacement.
- bash-3.2 / macOS portable. Tests use a `mkdtemp` HOME + a fake code-graph registry; each test resets `delete process.env.CLAUDEMD_NO_STATUSLINE`.
- Target **v0.26.0**; AI-CODING-SPEC content unchanged (stays v6.14.1). All existing **574** Node tests still pass.

---

### Task 1: code-graph registry path helpers

**Files:**
- Modify: `scripts/lib/paths.js` (add two exports near `settingsPath`, `logsDir`)
- Test: `tests/scripts/paths.test.js` (create if absent; else append)

**Interfaces:**
- Produces: `codeGraphRegistryPath() -> string` (`~/.cache/code-graph/statusline-registry.json`), `codeGraphProvidersBackupPath() -> string` (`~/.claude/statusline-providers.json`). Both derive from the existing module-local `home()` (`process.env.HOME || os.homedir()`), so a `mkdtemp` HOME redirects them in tests.

- [ ] **Step 1: Write the failing test**

Create/append `tests/scripts/paths.test.js`:
```js
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { codeGraphRegistryPath, codeGraphProvidersBackupPath } from '../../scripts/lib/paths.js';

let tmpHome, savedHome;
beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-paths-'));
  savedHome = process.env.HOME;
  process.env.HOME = tmpHome;
});
afterEach(() => {
  process.env.HOME = savedHome;
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

test('code-graph registry paths derive from HOME', () => {
  assert.equal(codeGraphRegistryPath(), path.join(tmpHome, '.cache/code-graph/statusline-registry.json'));
  assert.equal(codeGraphProvidersBackupPath(), path.join(tmpHome, '.claude/statusline-providers.json'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/scripts/paths.test.js`
Expected: FAIL — `codeGraphRegistryPath is not a function` (export missing).

- [ ] **Step 3: Add the exports**

In `scripts/lib/paths.js`, after the `logsDir` / `settingsPath` block, add:
```js
// code-graph's composite statusline registry — primary in ~/.cache (volatile)
// + durable mirror in ~/.claude (code-graph self-heals the primary from it).
// claudemd registers itself as a guest provider here rather than clobbering the
// single statusLine slot. Both are code-graph-owned; we read/write our own entry.
export const codeGraphRegistryPath        = () => path.join(home(), '.cache/code-graph/statusline-registry.json');
export const codeGraphProvidersBackupPath = () => path.join(home(), '.claude/statusline-providers.json');
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/scripts/paths.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/paths.js tests/scripts/paths.test.js
git commit -m "feat(statusline): code-graph registry path helpers"
```

---

### Task 2: code-graph composite-host adapter

**Files:**
- Create: `scripts/lib/statusline-hosts.js`
- Test: `tests/scripts/statusline-hosts.test.js`

**Interfaces:**
- Consumes: `codeGraphRegistryPath()`, `codeGraphProvidersBackupPath()` (Task 1).
- Produces:
  - `CLAUDEMD_PROVIDER_ID = 'claudemd'`
  - `codeGraphAdapter = { id:'code-graph', matches(cmd)->bool, listProviders()->[{id,command,needsStdin}], isRegistered(id)->bool, register(entry,{front})->bool, unregister(id)->bool }`
  - `HOST_ADAPTERS = [codeGraphAdapter]`
  - `detectHost(command) -> adapter|null`
  - `manualPsCandidates(providers) -> [{id,command,needsStdin}]` (providers that look like a hand-made PS1 — supersede candidates)

- [ ] **Step 1: Write the failing test**

Create `tests/scripts/statusline-hosts.test.js`:
```js
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  codeGraphAdapter, detectHost, manualPsCandidates, CLAUDEMD_PROVIDER_ID, HOST_ADAPTERS,
} from '../../scripts/lib/statusline-hosts.js';

let tmpHome, savedHome;
const primary = () => path.join(tmpHome, '.cache/code-graph/statusline-registry.json');
const mirror  = () => path.join(tmpHome, '.claude/statusline-providers.json');
const seed = (list) => {
  fs.mkdirSync(path.dirname(primary()), { recursive: true });
  fs.mkdirSync(path.dirname(mirror()), { recursive: true });
  fs.writeFileSync(primary(), JSON.stringify(list));
  fs.writeFileSync(mirror(), JSON.stringify(list));
};
const readP = () => JSON.parse(fs.readFileSync(primary(), 'utf8'));
const readM = () => JSON.parse(fs.readFileSync(mirror(), 'utf8'));

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-hosts-'));
  savedHome = process.env.HOME;
  process.env.HOME = tmpHome;
});
afterEach(() => {
  process.env.HOME = savedHome;
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

test('detectHost recognizes a code-graph composite command, not a plain one', () => {
  assert.equal(detectHost('node "/x/scripts/statusline-composite.js"'), codeGraphAdapter);
  assert.equal(detectHost('node "/x/other.js"'), null);
  assert.equal(detectHost(null), null);
});

test('register inserts our provider at the front (after _previous) in BOTH files', () => {
  seed([
    { id: '_previous', command: 'bash "/h/.claude/old.sh"', needsStdin: true },
    { id: 'code-graph', command: 'node "/cg/statusline.js"', needsStdin: false },
  ]);
  const changed = codeGraphAdapter.register(
    { id: CLAUDEMD_PROVIDER_ID, command: 'bash "/h/.claude/claudemd-statusline.sh"', needsStdin: true },
    { front: true },
  );
  assert.equal(changed, true);
  for (const read of [readP, readM]) {
    const ids = read().map((p) => p.id);
    assert.deepEqual(ids, ['_previous', 'claudemd', 'code-graph'], 'claudemd after _previous, before code-graph');
  }
});

test('register is idempotent when the entry is unchanged', () => {
  seed([{ id: 'code-graph', command: 'node "/cg/statusline.js"', needsStdin: false }]);
  const entry = { id: CLAUDEMD_PROVIDER_ID, command: 'bash "/h/.claude/claudemd-statusline.sh"', needsStdin: true };
  assert.equal(codeGraphAdapter.register(entry, { front: true }), true);
  assert.equal(codeGraphAdapter.register(entry, { front: true }), false, 're-register is a no-op');
  assert.equal(readP().filter((p) => p.id === 'claudemd').length, 1);
});

test('unregister removes our provider from BOTH files, leaves others', () => {
  seed([
    { id: 'claudemd', command: 'bash "/h/.claude/claudemd-statusline.sh"', needsStdin: true },
    { id: 'code-graph', command: 'node "/cg/statusline.js"', needsStdin: false },
  ]);
  assert.equal(codeGraphAdapter.unregister('claudemd'), true);
  for (const read of [readP, readM]) {
    assert.deepEqual(read().map((p) => p.id), ['code-graph']);
  }
  assert.equal(codeGraphAdapter.unregister('claudemd'), false, 'second unregister is a no-op');
});

test('read prefers primary, falls back to durable mirror', () => {
  fs.mkdirSync(path.dirname(mirror()), { recursive: true });
  fs.writeFileSync(mirror(), JSON.stringify([{ id: 'code-graph', command: 'node "/cg/s.js"', needsStdin: false }]));
  assert.equal(codeGraphAdapter.isRegistered('code-graph'), true, 'self-heals from mirror when primary absent');
});

test('manualPsCandidates picks a ~/.claude bash PS1, not plugins or claudemd', () => {
  const providers = [
    { id: 'user-ps1', command: 'bash "/home/x/.claude/statusline-command.sh"', needsStdin: true },
    { id: 'code-graph', command: 'node "/cg/statusline.js"', needsStdin: false },
    { id: 'claudemd', command: 'bash "/home/x/.claude/claudemd-statusline.sh"', needsStdin: true },
  ];
  assert.deepEqual(manualPsCandidates(providers).map((p) => p.id), ['user-ps1']);
});

test('HOST_ADAPTERS contains the code-graph adapter', () => {
  assert.ok(HOST_ADAPTERS.includes(codeGraphAdapter));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/scripts/statusline-hosts.test.js`
Expected: FAIL — cannot find module `statusline-hosts.js`.

- [ ] **Step 3: Write the adapter**

Create `scripts/lib/statusline-hosts.js`:
```js
import fs from 'node:fs';
import path from 'node:path';
import { codeGraphRegistryPath, codeGraphProvidersBackupPath } from './paths.js';

// A composite host owns the single statusLine slot but renders MANY providers
// from a registry, so claudemd registers as a guest instead of clobbering the
// slot. Each adapter knows how to recognize its host and read/write our entry.
export const CLAUDEMD_PROVIDER_ID = 'claudemd';

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}
function writeJsonAtomic(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  fs.renameSync(tmp, p);
}

// --- code-graph adapter ---
// Registry format (code-graph's): [{ id, command, needsStdin }]. Read prefers
// the volatile ~/.cache primary and falls back to the durable ~/.claude mirror
// (which code-graph self-heals the primary from); write updates BOTH, mirroring
// code-graph's own writeRegistry so a later code-graph run preserves our entry.
function cgRead() {
  const primary = readJson(codeGraphRegistryPath());
  if (Array.isArray(primary) && primary.length) return primary;
  const backup = readJson(codeGraphProvidersBackupPath());
  return Array.isArray(backup) ? backup : [];
}
function cgWrite(list) {
  if (!list || list.length === 0) {
    for (const p of [codeGraphRegistryPath(), codeGraphProvidersBackupPath()]) {
      try { fs.unlinkSync(p); } catch { /* ok */ }
    }
    return;
  }
  writeJsonAtomic(codeGraphRegistryPath(), list);
  try { writeJsonAtomic(codeGraphProvidersBackupPath(), list); } catch { /* mirror best-effort */ }
}

export const codeGraphAdapter = {
  id: 'code-graph',
  matches: (command) => typeof command === 'string' && command.includes('statusline-composite'),
  listProviders: () => cgRead(),
  isRegistered: (id) => cgRead().some((p) => p.id === id),
  register(entry, { front = false } = {}) {
    const list = cgRead();
    const idx = list.findIndex((p) => p.id === entry.id);
    if (idx >= 0) {
      if (list[idx].command === entry.command && !!list[idx].needsStdin === !!entry.needsStdin) return false;
      list[idx] = entry;
    } else if (front) {
      // Render after any pre-existing statusline (_previous) but before others.
      const insertAt = list[0] && list[0].id === '_previous' ? 1 : 0;
      list.splice(insertAt, 0, entry);
    } else {
      list.push(entry);
    }
    cgWrite(list);
    return true;
  },
  unregister(id) {
    const list = cgRead();
    const filtered = list.filter((p) => p.id !== id);
    if (filtered.length === list.length) return false;
    cgWrite(filtered);
    return true;
  },
};

export const HOST_ADAPTERS = [codeGraphAdapter];

export function detectHost(command) {
  return HOST_ADAPTERS.find((a) => a.matches(command)) || null;
}

// Providers that look like a hand-made PS1 the user might want claudemd to
// supersede: a bash script under ~/.claude/ that is neither claudemd's renderer
// nor a composite host. Used ONLY to OFFER a supersede choice — never applied
// silently (consent-driven).
export function manualPsCandidates(providers) {
  return (providers || []).filter((p) =>
    typeof p.command === 'string' &&
    /\bbash\b/.test(p.command) &&
    /\/\.claude\//.test(p.command) &&
    !p.command.includes('claudemd-statusline.sh') &&
    !p.command.includes('statusline-composite') &&
    p.id !== 'code-graph' && p.id !== CLAUDEMD_PROVIDER_ID,
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/scripts/statusline-hosts.test.js`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/statusline-hosts.js tests/scripts/statusline-hosts.test.js
git commit -m "feat(statusline): code-graph composite-host adapter (register/unregister/detect)"
```

---

### Task 3: `detect()` gains the `host` verdict

**Files:**
- Modify: `scripts/lib/statusline.js` (imports; `detect()`; add `GUEST_COMMAND`)
- Test: `tests/scripts/statusline-adopt.test.js` (append)

**Interfaces:**
- Consumes: `detectHost`, `codeGraphAdapter`, `CLAUDEMD_PROVIDER_ID` (Task 2).
- Produces: `detect(pluginRoot)` now returns `{ verdict:'absent'|'claudemd'|'host'|'foreign', host:string|null, current:string|null, providers:array|null, guestRegistered:boolean, dest:{exists,matchesShipped} }`. `GUEST_COMMAND() -> 'bash "<abs renderer path>"'`.

- [ ] **Step 1: Write the failing test**

Append to `tests/scripts/statusline-adopt.test.js`:
```js
test('detect: a code-graph composite slot → verdict host (not foreign)', () => {
  writeS({ statusLine: { type: 'command', command: 'node "/cg/0.1/scripts/statusline-composite.js"' } });
  const d = detect();
  assert.equal(d.verdict, 'host');
  assert.equal(d.host, 'code-graph');
  assert.equal(d.guestRegistered, false);
});

test('detect: host + claudemd already in registry → guestRegistered true', () => {
  writeS({ statusLine: { type: 'command', command: 'node "/cg/scripts/statusline-composite.js"' } });
  const reg = path.join(tmpHome, '.cache/code-graph/statusline-registry.json');
  fs.mkdirSync(path.dirname(reg), { recursive: true });
  fs.writeFileSync(reg, JSON.stringify([{ id: 'claudemd', command: 'bash "/x/claudemd-statusline.sh"', needsStdin: true }]));
  assert.equal(detect().guestRegistered, true);
});

test('detect: a plain non-composite command stays foreign', () => {
  writeS({ statusLine: { type: 'command', command: 'node /other/x.js' } });
  assert.equal(detect().verdict, 'foreign');
  assert.equal(detect().host, null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/scripts/statusline-adopt.test.js`
Expected: FAIL — first case gets `verdict:'foreign'` (no host detection yet).

- [ ] **Step 3: Update `detect()` and add `GUEST_COMMAND`**

In `scripts/lib/statusline.js`, add to the imports:
```js
import { detectHost, HOST_ADAPTERS, CLAUDEMD_PROVIDER_ID } from './statusline-hosts.js';
```
After the `COMMAND` constant, add:
```js
// Slot-owner command (CC runs it through a shell → $HOME expands).
// Guest command (a composite host runs it via execFileSync → no shell, only
// ~ expands, NOT $HOME) MUST be an absolute path, or it ENOENTs and blanks.
const GUEST_COMMAND = () => `bash "${destPath()}"`;
```
Replace the whole `detect` function body with:
```js
export function detect(pluginRoot = null) {
  const settings = loadSettings();
  const present = settings.statusLine != null && settings.statusLine !== '';
  const cmd = settings.statusLine && typeof settings.statusLine.command === 'string'
    ? settings.statusLine.command
    : null;
  let verdict, host = null, providers = null, guestRegistered = false;
  if (!present) {
    verdict = 'absent';
  } else if (cmd && cmd.includes(MARKER)) {
    verdict = 'claudemd';
  } else {
    const adapter = cmd ? detectHost(cmd) : null;
    if (adapter) {
      verdict = 'host';
      host = adapter.id;
      providers = adapter.listProviders();
      guestRegistered = adapter.isRegistered(CLAUDEMD_PROVIDER_ID);
    } else {
      verdict = 'foreign';
    }
  }
  const dest = destPath();
  const exists = fs.existsSync(dest);
  let matchesShipped = false;
  if (pluginRoot && exists) {
    try {
      matchesShipped = fs.readFileSync(dest, 'utf8') === fs.readFileSync(shippedRenderer(pluginRoot), 'utf8');
    } catch { matchesShipped = false; }
  }
  return { verdict, host, current: cmd, providers, guestRegistered, dest: { exists, matchesShipped } };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/scripts/statusline-adopt.test.js`
Expected: PASS (existing I1/M1/foreign tests unchanged — a plain `node /other/x.js` still `foreign`; new host cases pass).

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/statusline.js tests/scripts/statusline-adopt.test.js
git commit -m "feat(statusline): detect() host verdict + absolute-path guest command"
```

---

### Task 4: `adopt()` guest path + supersede + host-detected

**Files:**
- Modify: `scripts/lib/statusline.js` (`adopt()`)
- Test: `tests/scripts/statusline-adopt.test.js` (append)

**Interfaces:**
- Consumes: `detect()`, `GUEST_COMMAND()`, `HOST_ADAPTERS`, `CLAUDEMD_PROVIDER_ID`, `copyRenderer`, `stateDir`, `prevPath`.
- Produces: `adopt({ pluginRoot, force, emptyOnly, dryRun, supersede, backupSettings })`. New actions: `host-detected` (emptyOnly + host — install no-op), `registered` / `already-registered` (guest). `supersede` is a provider id string or null. The prev file for a superseded provider is `{ superseded: {id,command,needsStdin} }`.

- [ ] **Step 1: Write the failing test**

Append to `tests/scripts/statusline-adopt.test.js`:
```js
const seedCg = (list) => {
  const reg = path.join(tmpHome, '.cache/code-graph/statusline-registry.json');
  const mir = path.join(tmpHome, '.claude/statusline-providers.json');
  fs.mkdirSync(path.dirname(reg), { recursive: true });
  fs.writeFileSync(reg, JSON.stringify(list));
  fs.writeFileSync(mir, JSON.stringify(list));
  writeS({ statusLine: { type: 'command', command: 'node "/cg/scripts/statusline-composite.js"' } });
};
const cgReg = () => JSON.parse(fs.readFileSync(path.join(tmpHome, '.cache/code-graph/statusline-registry.json'), 'utf8'));

test('adopt: host + emptyOnly → host-detected, nothing written', () => {
  seedCg([{ id: 'code-graph', command: 'node "/cg/statusline.js"', needsStdin: false }]);
  const r = adopt({ pluginRoot, emptyOnly: true });
  assert.equal(r.action, 'host-detected');
  assert.equal(r.host, 'code-graph');
  assert.equal(cgReg().some((p) => p.id === 'claudemd'), false);
  assert.ok(!fs.existsSync(destFile()));
});

test('adopt: host (command) → registers claudemd at front, copies renderer', () => {
  seedCg([{ id: 'code-graph', command: 'node "/cg/statusline.js"', needsStdin: false }]);
  const r = adopt({ pluginRoot });
  assert.equal(r.action, 'registered');
  assert.equal(r.host, 'code-graph');
  assert.deepEqual(cgReg().map((p) => p.id), ['claudemd', 'code-graph']);
  const me = cgReg().find((p) => p.id === 'claudemd');
  assert.equal(me.command, `bash "${destFile()}"`, 'guest command is absolute path');
  assert.equal(me.needsStdin, true);
  assert.ok(fs.existsSync(destFile()));
});

test('adopt: host re-register is idempotent → already-registered', () => {
  seedCg([{ id: 'code-graph', command: 'node "/cg/statusline.js"', needsStdin: false }]);
  adopt({ pluginRoot });
  const r = adopt({ pluginRoot });
  assert.equal(r.action, 'already-registered');
  assert.equal(cgReg().filter((p) => p.id === 'claudemd').length, 1);
});

test('adopt: host + supersede → old provider saved to prev and removed', () => {
  seedCg([
    { id: 'user-ps1', command: 'bash "/home/x/.claude/statusline-command.sh"', needsStdin: true },
    { id: 'code-graph', command: 'node "/cg/statusline.js"', needsStdin: false },
  ]);
  const r = adopt({ pluginRoot, supersede: 'user-ps1' });
  assert.equal(r.action, 'registered');
  assert.equal(r.superseded, 'user-ps1');
  assert.deepEqual(cgReg().map((p) => p.id), ['claudemd', 'code-graph'], 'user-ps1 gone, claudemd at front');
  const prev = JSON.parse(fs.readFileSync(prevFile(), 'utf8'));
  assert.equal(prev.superseded.id, 'user-ps1');
  assert.equal(prev.superseded.command, 'bash "/home/x/.claude/statusline-command.sh"');
});

test('adopt: host + dry-run → no writes', () => {
  seedCg([{ id: 'code-graph', command: 'node "/cg/statusline.js"', needsStdin: false }]);
  const r = adopt({ pluginRoot, dryRun: true });
  assert.equal(r.action, 'dry-run');
  assert.equal(cgReg().some((p) => p.id === 'claudemd'), false);
  assert.ok(!fs.existsSync(destFile()));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/scripts/statusline-adopt.test.js`
Expected: FAIL — `host-detected`/`registered` not produced (adopt has no host branch).

- [ ] **Step 3: Add the host branch to `adopt()`**

In `scripts/lib/statusline.js`, change the `adopt` signature to add `supersede`:
```js
export function adopt({ pluginRoot, force = false, emptyOnly = false, dryRun = false, supersede = null, backupSettings = true } = {}) {
```
Immediately after the existing `if (verdict === 'claudemd') { ... }` block and BEFORE the `if (verdict === 'foreign')` block, insert:
```js
  if (verdict === 'host') {
    const adapter = HOST_ADAPTERS.find((a) => a.id === detect(pluginRoot).host);
    if (emptyOnly) return { action: 'host-detected', host: adapter.id, to: null };
    if (dryRun) return { action: 'dry-run', host: adapter.id, to: GUEST_COMMAND(), supersede };
    copyRenderer(pluginRoot);
    let superseded = null;
    if (supersede) {
      const prov = adapter.listProviders().find((p) => p.id === supersede);
      if (prov) {
        fs.mkdirSync(stateDir(), { recursive: true });
        fs.writeFileSync(prevPath(), JSON.stringify({ superseded: prov }, null, 2));
        adapter.unregister(supersede);
        superseded = prov.id;
      }
    }
    const changed = adapter.register(
      { id: CLAUDEMD_PROVIDER_ID, command: GUEST_COMMAND(), needsStdin: true },
      { front: true },
    );
    return { action: (changed || superseded) ? 'registered' : 'already-registered', host: adapter.id, to: GUEST_COMMAND(), superseded };
  }
```
(`detect(pluginRoot)` is already destructured at the top of `adopt` as `const { verdict, current } = detect(pluginRoot);` — change that line to `const { verdict, current, host } = detect(pluginRoot);` and use `host` instead of the extra `detect()` call: `const adapter = HOST_ADAPTERS.find((a) => a.id === host);`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/scripts/statusline-adopt.test.js`
Expected: PASS (all new host-adopt cases + existing cases).

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/statusline.js tests/scripts/statusline-adopt.test.js
git commit -m "feat(statusline): adopt() guest registration + supersede + host-detected"
```

---

### Task 5: `remove()` guest path

**Files:**
- Modify: `scripts/lib/statusline.js` (`remove()`)
- Test: `tests/scripts/statusline-adopt.test.js` (append)

**Interfaces:**
- Consumes: `detect()`, `HOST_ADAPTERS`, `CLAUDEMD_PROVIDER_ID`, `prevPath`, `destPath`.
- Produces: `remove()` new action `unregistered` (with `{ host, restored }`) when the slot is a host and claudemd is a registered guest. Restores a superseded provider from `prev.superseded`. Slot-owner path (action `removed`/`restored`/`not-ours`) unchanged.

- [ ] **Step 1: Write the failing test**

Append to `tests/scripts/statusline-adopt.test.js`:
```js
test('remove: guest → unregister claudemd, code-graph slot + entry intact', () => {
  seedCg([{ id: 'code-graph', command: 'node "/cg/statusline.js"', needsStdin: false }]);
  adopt({ pluginRoot });
  const r = remove();
  assert.equal(r.action, 'unregistered');
  assert.equal(r.host, 'code-graph');
  assert.deepEqual(cgReg().map((p) => p.id), ['code-graph'], 'code-graph provider survives');
  assert.equal(readS().statusLine.command, 'node "/cg/scripts/statusline-composite.js"', 'host still owns the slot');
  assert.ok(!fs.existsSync(destFile()), 'renderer deleted');
});

test('remove: guest that superseded a PS1 → restores it', () => {
  seedCg([
    { id: 'user-ps1', command: 'bash "/home/x/.claude/statusline-command.sh"', needsStdin: true },
    { id: 'code-graph', command: 'node "/cg/statusline.js"', needsStdin: false },
  ]);
  adopt({ pluginRoot, supersede: 'user-ps1' });
  const r = remove();
  assert.equal(r.action, 'unregistered');
  assert.equal(r.restored, 'user-ps1');
  assert.deepEqual(cgReg().map((p) => p.id), ['user-ps1', 'code-graph'], 'user-ps1 back at front, claudemd gone');
  assert.ok(!fs.existsSync(prevFile()));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/scripts/statusline-adopt.test.js`
Expected: FAIL — `remove()` returns `not-ours` (no host branch).

- [ ] **Step 3: Add the guest branch to `remove()`**

In `scripts/lib/statusline.js`, replace the opening of `remove()`:
```js
export function remove() {
  const { verdict } = detect();
  if (verdict !== 'claudemd') return { action: 'not-ours', restored: null };
```
with:
```js
export function remove() {
  const d = detect();
  if (d.verdict === 'host' && d.guestRegistered) {
    const adapter = HOST_ADAPTERS.find((a) => a.id === d.host);
    adapter.unregister(CLAUDEMD_PROVIDER_ID);
    let restored = null;
    if (fs.existsSync(prevPath())) {
      try {
        const prev = JSON.parse(fs.readFileSync(prevPath(), 'utf8'));
        if (prev && prev.superseded && prev.superseded.id) {
          adapter.register(prev.superseded, { front: true });
          restored = prev.superseded.id;
        }
      } catch { /* prev unreadable — just drop it */ }
      try { fs.unlinkSync(prevPath()); } catch { /* best-effort */ }
    }
    try { fs.unlinkSync(destPath()); } catch { /* best-effort */ }
    return { action: 'unregistered', host: d.host, restored };
  }
  const { verdict } = d;
  if (verdict !== 'claudemd') return { action: 'not-ours', restored: null };
```
(The rest of `remove()` — the slot-owner restore/clear + `unlinkSync(destPath())` — is unchanged.)

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/scripts/statusline-adopt.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/statusline.js tests/scripts/statusline-adopt.test.js
git commit -m "feat(statusline): remove() unregisters guest + restores superseded provider"
```

---

### Task 6: M2 — renderer strips embedded newlines

**Files:**
- Modify: `scripts/statusline.sh` (after the jq read block, before `user_host`)
- Test: `tests/scripts/statusline.test.js` (append)

**Interfaces:** none (renderer output only). Consumes the existing `cwd` / `model` shell vars.

- [ ] **Step 1: Write the failing test**

Append to `tests/scripts/statusline.test.js` (match the file's existing helper for running the renderer; this uses a direct `execFileSync` on `bash`):
```js
test('M2: a field containing a newline still yields a single output line', () => {
  const { execFileSync } = require('node:child_process');
  const script = require('node:path').join(__dirname, '../../scripts/statusline.sh');
  const payload = JSON.stringify({ cwd: '/tmp/a\nb', model: { display_name: 'Opus\n4.8' }, context_window: { used_percentage: 5 } });
  const out = execFileSync('bash', [script], { input: payload, encoding: 'utf8' });
  assert.equal(out.split('\n').length, 1, 'output must be exactly one line');
  assert.match(out, /Opus 4\.8/, 'newline in model collapsed to a space');
});
```
(If `statusline.test.js` is ESM and lacks `require`, use `import { execFileSync } from 'node:child_process'` at the top and `new URL('../../scripts/statusline.sh', import.meta.url)` for the path — match the file's existing style.)

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/scripts/statusline.test.js`
Expected: FAIL — output splits into 2 lines (the raw newline is printed).

- [ ] **Step 3: Strip newlines after the read**

In `scripts/statusline.sh`, immediately after the `fi` that closes the `if [ -n "$input" ]` block (current line 27) and before the `# user@host` comment, insert:
```bash
# M2: a field carrying a literal newline (pathological cwd/model) would break the
# one-line contract even though NUL-delimiting keeps the FIELDS aligned. Collapse
# CR/LF in the two free-text fields to a space (bash-3.2 parameter expansion).
cwd=${cwd//$'\r'/}; cwd=${cwd//$'\n'/ }
model=${model//$'\r'/}; model=${model//$'\n'/ }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/scripts/statusline.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/statusline.sh tests/scripts/statusline.test.js
git commit -m "fix(statusline): strip embedded newlines in cwd/model — one-line guarantee (M2)"
```

---

### Task 7: M5 — CLI `--json` gating, human output, `--supersede`, dry-run all branches

**Files:**
- Modify: `scripts/statusline-adopt.js` (USAGE; parse `--supersede=<id>`; human vs JSON output)
- Test: `tests/scripts/statusline-cli.test.js` (append)

**Interfaces:**
- Consumes: `detect`/`adopt`/`remove` (with the `host`/guest actions from Tasks 3–5), `parseStrict` (supports `strings` keys returning `parsed.strings.get('--supersede')`).
- Produces: CLI default is a one-line human summary; `--json` emits the raw object. `adopt --supersede=<id>` threads `supersede` into `adopt`. `--dry-run` already returns a `dry-run` shape in every branch (Task 4 host branch included).

- [ ] **Step 1: Write the failing test**

Append to `tests/scripts/statusline-cli.test.js` (follow the file's existing spawn helper — shown here as `run(args, env)` returning `{stdout}`):
```js
test('M5: detect default is human-readable, --json is machine-readable', () => {
  // fresh empty slot in the sandbox HOME
  const r1 = run(['detect']);
  assert.doesNotMatch(r1.stdout, /^\s*\{/, 'default output is not raw JSON');
  assert.match(r1.stdout, /absent/, 'human summary names the verdict');
  const r2 = run(['detect', '--json']);
  const obj = JSON.parse(r2.stdout);
  assert.equal(obj.verdict, 'absent');
});
```
(Use the same sandbox-HOME setup the other cases in this file use. `run` is the file's existing helper that spawns `node scripts/statusline-adopt.js`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/scripts/statusline-cli.test.js`
Expected: FAIL — default `detect` currently prints JSON, so `doesNotMatch(/^\s*\{/)` fails.

- [ ] **Step 3: Add `--supersede`, gate output on `--json`**

In `scripts/statusline-adopt.js`:
- Add `--supersede` to USAGE (under Flags): `  --supersede=<id>  adopt(host): supersede a named provider (saves it for remove).`
- Change the parse call to accept the string flag:
```js
    parsed = parseStrict(rest, { bools: ['--force', '--empty-only', '--dry-run', '--json'], strings: ['--supersede'] });
```
- Thread `supersede` into the adopt call:
```js
    else if (mode === 'adopt') out = adopt({
      pluginRoot,
      force: parsed.bools.has('--force'),
      emptyOnly: parsed.bools.has('--empty-only'),
      dryRun: parsed.bools.has('--dry-run'),
      supersede: parsed.strings.get('--supersede') || null,
    });
```
- Replace the output line `process.stdout.write(JSON.stringify(out) + '\n');` with:
```js
    if (parsed.bools.has('--json')) {
      process.stdout.write(JSON.stringify(out) + '\n');
    } else {
      process.stdout.write(renderHuman(mode, out) + '\n');
    }
```
- Add a `renderHuman` helper (module scope, above the main guard):
```js
function renderHuman(mode, out) {
  if (mode === 'detect') {
    const bits = [`verdict: ${out.verdict}`];
    if (out.host) bits.push(`host: ${out.host}`, `claudemd-registered: ${out.guestRegistered}`);
    if (out.current) bits.push(`current: ${out.current}`);
    bits.push(`renderer: ${out.dest.exists ? 'present' : 'absent'}${out.dest.exists ? (out.dest.matchesShipped ? ' (matches shipped)' : ' (differs from shipped)') : ''}`);
    return bits.join('\n');
  }
  // adopt / remove
  const tail = [out.host && `host=${out.host}`, out.superseded && `superseded=${out.superseded}`, out.restored && `restored=${out.restored}`, out.to && `to=${out.to}`].filter(Boolean).join('  ');
  return `action: ${out.action}${tail ? '  ' + tail : ''}`;
}
```

Note: `parseStrict` must support a `strings` option returning `parsed.strings` (a Map). If it does not yet, add it to `scripts/lib/argv.js` following the existing `bools` handling (parse `--key=value`, reject a bare `--key` with no `=` as an ArgvError — same strict shape as the rest of the module). Confirm by reading `scripts/lib/argv.js#parseStrict` before implementing; if `strings` already exists, use it as-is.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/scripts/statusline-cli.test.js`
Expected: PASS. Then run `node --test tests/scripts/` to confirm no other CLI-output assertions regressed (the command doc uses `detect --json`, which is unaffected).

- [ ] **Step 5: Commit**

```bash
git add scripts/statusline-adopt.js scripts/lib/argv.js tests/scripts/statusline-cli.test.js
git commit -m "feat(statusline): CLI --json gating, human output, --supersede (M5)"
```

---

### Task 8: install — host-detected note (no registry write)

**Files:**
- Modify: `scripts/install.js` (the statusLine note block, ~lines 226–232)
- Test: `tests/scripts/install.test.js` (append)

**Interfaces:**
- Consumes: `adoptStatusline({ emptyOnly:true })` now returns `{action:'host-detected', host}` when a composite host owns the slot.
- Produces: a stderr note for `host-detected`; `statusline` field carries the action. No registry write on install.

- [ ] **Step 1: Write the failing test**

Append to `tests/scripts/install.test.js` (uses the file's existing sandbox-HOME + `pluginRoot` with a renderer fixture; add a code-graph composite slot before install):
```js
test('install with a code-graph host in the slot → host-detected, no registry write', async () => {
  fs.writeFileSync(path.join(tmpHome, '.claude/settings.json'),
    JSON.stringify({ statusLine: { type: 'command', command: 'node "/cg/scripts/statusline-composite.js"' } }));
  const res = await install({ pluginRoot });
  assert.equal(res.statusline.action, 'host-detected');
  assert.equal(res.statusline.host, 'code-graph');
  // install must NOT have written claudemd into code-graph's registry
  assert.ok(!fs.existsSync(path.join(tmpHome, '.cache/code-graph/statusline-registry.json')));
  // slot untouched
  const s = JSON.parse(fs.readFileSync(path.join(tmpHome, '.claude/settings.json'), 'utf8'));
  assert.equal(s.statusLine.command, 'node "/cg/scripts/statusline-composite.js"');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/scripts/install.test.js`
Expected: FAIL — `res.statusline.action` is `skipped-foreign` (old detect classified the composite as foreign) OR the note branch is missing.

- [ ] **Step 3: Add the host-detected note**

In `scripts/install.js`, in the statusline note block, add a branch (after the `skipped-foreign` branch):
```js
  } else if (statusline.action === 'host-detected') {
    process.stderr.write(`[claudemd] statusLine owned by a composite host (${statusline.host}) — run /claudemd-statusline to add claudemd's segment alongside it.\n`);
  } else if (statusline.action === 'skipped-foreign') {
```
(i.e. insert the `host-detected` branch immediately before the existing `skipped-foreign` branch.)

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/scripts/install.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/install.js tests/scripts/install.test.js
git commit -m "feat(install): host-detected statusLine note (no registry write)"
```

---

### Task 9: `/claudemd-statusline` command — host/guest/supersede UX

**Files:**
- Modify: `commands/claudemd-statusline.md`

**Interfaces:** documents the Task 3–7 behavior for the agent. No code.

- [ ] **Step 1: Update the command doc**

In `commands/claudemd-statusline.md`:
- In **Step 0 — detect**, add a `host` branch after the `foreign` bullet:
```markdown
- `host` → the slot is owned by a composite host (`host`, e.g. `code-graph`) that renders multiple providers. Do NOT clobber it. Run `detect --json` and read `providers` + `guestRegistered`:
  - `guestRegistered: true` → claudemd is already a segment. Report and STOP unless the user wants a refresh (re-run adopt).
  - `guestRegistered: false` → claudemd will register as a guest so both segments show (`claudemd | code-graph`). If any provider looks like a hand-made PS1 (a `bash` script under `~/.claude/` that isn't a plugin — e.g. `user-ps1`), list it and ASK: supersede it (`adopt --supersede=<id>`, saved for restore) or keep both (`adopt`). Continue to Step 1.
```
- In **`remove` mode**, add: `If verdict is host and guestRegistered, remove unregisters claudemd from the host's registry (restoring a superseded provider if one was saved) and deletes the renderer; the host keeps the slot. Report action unregistered (with restored, if any).`
- In **Step 1 — consent gate**, add: `for host (guest register): the absolute-path command bash "<abs>/.claude/claudemd-statusline.sh" written into the host's registry (~/.cache/code-graph/statusline-registry.json + ~/.claude/statusline-providers.json), and — if superseding — which provider is replaced.`
- In **Step 2 — adopt**, add: `for the host case, pass --supersede=<id> only if the user chose to supersede.`
- In **Step 3 — verify + report**, add: `for the host case, cite guestRegistered: true from a re-run detect --json and the action (registered / already-registered), plus the superseded id if any.`

- [ ] **Step 2: Verify the doc references only real flags/actions**

Run: `node scripts/statusline-adopt.js --help`
Expected: `--supersede=<id>` appears in the usage; the doc's flags/actions match.

- [ ] **Step 3: Commit**

```bash
git add commands/claudemd-statusline.md
git commit -m "docs(statusline): command UX for host/guest coexistence + supersede"
```

---

### Task 10: Release v0.26.0

**Files:**
- Modify: `package.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` (×2) → `0.26.0`
- Modify: `CHANGELOG.md` (new `[0.26.0]` entry)
- Modify: `README.md` (the `/claudemd-statusline` row — note coexistence + `--supersede`)
- Delete: `tasks/statusline-v0251-deferred.md` (M2 + M5 now shipped; note host-wrap moved)
- Create: `tasks/statusline-host-wrap-deferred.md` (the deferred host-wrap strategy, below)

**Interfaces:** none.

- [ ] **Step 1: Bump the four version spots**

`grep -rn '"version": "0.25.1"' package.json .claude-plugin/` then set each to `0.26.0` (package.json:3, plugin.json:4, marketplace.json:9 and :16). Verify: `grep -rn "0\.25\.1" package.json .claude-plugin/` returns nothing.

- [ ] **Step 2: Add the CHANGELOG entry** (above `## [0.25.1]`)

```markdown
## [0.26.0] - 2026-07-06

**Minor — statusLine multi-provider coexistence.** When a composite host (code-graph) owns the `statusLine` slot, `/claudemd-statusline` now registers claudemd as a *guest* provider in the host's registry so both segments render (`claudemd | code-graph`), instead of clobbering the slot. Empty-slot behavior is unchanged. Spec content unchanged (v6.14.1).

- **Adaptive strategy** (`scripts/lib/statusline.js` + new `scripts/lib/statusline-hosts.js`): `detect()` reports `absent | claudemd | host | foreign`. `host` → guest-register (front of the host registry, absolute-path command so code-graph's `execFileSync` runner — which expands `~` but not `$HOME` — can run it); `absent` → own the slot (v0.25.x); non-composite `foreign` → report/`--force` (host-wrap deferred to v0.26.1, see `tasks/statusline-host-wrap-deferred.md`).
- **Supersede consent**: `/claudemd-statusline` offers to replace a detected hand-made PS1 provider (`--supersede=<id>`, saved for restore) or keep both — never silent.
- **Install**: a composite host in the slot yields a `host-detected` note (run `/claudemd-statusline`) — install never writes another plugin's registry.
- **remove/uninstall**: guest mode unregisters claudemd from the host registry (restoring a superseded provider) and deletes the renderer; the host keeps the slot.
- **M2**: renderer strips embedded newlines in cwd/model (one-line guarantee). **M5**: CLI default is human-readable, `--json` for machine output; `--supersede=<id>` added.
- Tests: `statusline-hosts.test.js` (adapter), plus host/guest/supersede cases across `statusline-adopt.test.js`, `statusline-cli.test.js`, `install.test.js`.
```

- [ ] **Step 3: Update README** — in the `/claudemd-statusline` row, append: `When another composite provider (e.g. code-graph) owns the slot, claudemd registers as a guest so both segments render; --supersede=<id> replaces a named provider.`

- [ ] **Step 4: Move the deferred note**

Delete `tasks/statusline-v0251-deferred.md`. Create `tasks/statusline-host-wrap-deferred.md`:
```markdown
# Deferred — host-wrap strategy (statusLine, → v0.26.1)

v0.26.0 shipped the coexistence framework + guest/own strategies + M2/M5. The
host-wrap strategy (non-composite foreign owns the slot + `--force` → claudemd
takes the slot and wraps the prior command) was deferred: it is not reachable on
a machine where code-graph (a composite host that re-claims the slot) is
installed, and it adds a composite path to the renderer.

**Spec:** `docs/superpowers/specs/2026-07-06-statusline-coexistence-design.md` §host-wrap.
**Implement when:** a user reports a non-composite foreign statusline they want claudemd to wrap.
**Shape:** on `adopt({force:true})` over `verdict:'foreign'`, save the prior command to `stateDir()/statusline-wrap.json` + prev, set the slot to claudemd's renderer; the renderer, if the wrap file exists, runs the wrapped command via `bash -c "$cmd"` (shell → `$HOME`/`~` expand) with the stdin JSON piped, and prepends its trimmed output + ` | ` separator. `remove` restores prior + deletes the wrap file. Add tests: wrap runs + joins; remove restores; hostile wrap output can't corrupt the line (`printf %s`, no `%b`).
```

- [ ] **Step 5: Full suite + atomic ship**

```bash
npm test 2>&1 | grep -E "^# (tests|pass|fail) |OVERALL"
```
Expected: `# fail 0`, `OVERALL: all suites passed`, and the count risen by the tasks' new tests.

Then follow `feedback_claudemd_ship_from_main_atomic` (commit + push + tag `v0.26.0` + push tag + `gh release create`) in one turn, after confirming main's CI baseline is green (`gh run list --branch main --limit 1`). Watch `ci` + `npm-publish` to green and `npm view claudemd-cli version` → `0.26.0` before claiming shipped.

---

## Self-Review (writing-plans)

**Spec coverage:** own-strategy (unchanged) — Task 3 detect keeps `absent`→`adopt` set. guest register — Tasks 2/4. absolute-path guest command — Global Constraints + Task 3 `GUEST_COMMAND` + Task 4 assertion. both-file atomic registry write — Task 2. front insertion / `_previous` — Task 2. supersede consent — Task 4 (`--supersede`) + Task 9 (ASK). install host-detected, no write — Task 8. remove/uninstall guest — Task 5 (uninstall calls `remove()` unconditionally, already wired v0.25.1). M2 — Task 6. M5 — Task 7. host-wrap — explicitly deferred (Task 10 note) per YAGNI. No gaps.

**Placeholder scan:** every code step carries complete code; the one conditional (`parseStrict` `strings` support in Task 7) names the exact file/function to check and the fallback. No TBD/TODO.

**Type consistency:** `detect()` return shape (`verdict/host/current/providers/guestRegistered/dest`) is defined in Task 3 and consumed identically in Tasks 4/5/7/8. `adopt` options (`supersede`) defined Task 4, used Task 7. Adapter methods (`matches/listProviders/isRegistered/register/unregister`) defined Task 2, used Tasks 3/4/5. prev-file shape `{superseded:{id,command,needsStdin}}` written Task 4, read Task 5. Provider id `claudemd`, guest command `bash "<abs>"` consistent throughout.
