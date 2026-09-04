// home-sandbox.mjs — SINGLE SOURCE for "this suite must not touch the real
// ~/.claude". R11-27, node half (the bash half is tests/lib/assert.sh).
//
// The defect this exists for is written down two directories away, in
// clean-residue.test.js: three CLI cases there spawned the script with a
// hand-written env literal that set TMPDIR but not CLAUDEMD_STATE_DIR, so
// `--apply` ran the destructive reaper against the MAINTAINER'S LIVE
// ~/.claude/.claudemd-state. It was invisible until an unrelated change added a
// `remaining` count and the suite started failing on whatever that live
// directory happened to hold. The env literal was not wrong; it was one key
// short, and nothing could tell the difference.
//
// Twenty-four node suites redirect HOME and forty-one mkdtemp a sandbox, each
// with its own spelling. A per-suite literal is exactly as correct as the day
// it was written: when a new redirect seam appears in scripts/lib/paths.js,
// every one of those copies silently keeps writing to the real home for the
// seam it does not know about. So the seam list lives here, once, and
// tests/scripts/home-sandbox-consumers.test.js derives the real set from the
// source and fails when this list is short.
//
// Usage:
//   const box = useHomeSandbox('bk');            // registers beforeEach/afterEach
//   test('…', () => { fs.writeFileSync(box.claude('CLAUDE.md'), 'x'); });
//   spawnSync(process.execPath, [SCRIPT], { env: box.env({ CLAUDEMD_CONFIRM: '1' }) });
//
// `box.home` and friends are GETTERS: each beforeEach mints a fresh directory,
// so a value captured at module scope would point at the previous test's.
import { beforeEach, afterEach } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Every environment variable that redirects a WRITE off the real home. Not
// behaviour flags (CLAUDEMD_CONFIRM, CLAUDEMD_PURGE, …) — those belong in the
// per-test `extra` argument, because their value is what the test is about.
//
// HOME and TMPDIR are unconditional; the CLAUDEMD_* ones are the path seams
// scripts/lib/paths.js reads. The consumer gate re-derives that set from source
// and fails if a new `*_DIR` seam is missing here.
export const PATH_SEAMS = ['HOME', 'TMPDIR', 'CLAUDEMD_STATE_DIR', 'CLAUDEMD_CLAUDE_TMP_DIR'];

// A directory whose child lost its write bit cannot be unlinked, and rmSync
// with force:true does not chmod its way in — a real `clean-residue --apply`
// run met exactly that on 2026-09-04 and reported it as an undeletable target.
// A test sandbox that a suite deliberately chmod-ed (there are several, probing
// unreadable-directory paths) must still come back, or the leak lands in the
// user's TMPDIR and run-all.sh's containment assertion fires on the next run.
function forceRemove(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
    return;
  } catch {
    /* fall through to the chmod pass */
  }
  const walk = abs => {
    let st;
    try {
      st = fs.lstatSync(abs);
    } catch {
      return;
    }
    if (st.isSymbolicLink()) return;
    if (st.isDirectory()) {
      try {
        fs.chmodSync(abs, 0o700);
      } catch {
        /* best effort */
      }
      let ents;
      try {
        ents = fs.readdirSync(abs);
      } catch {
        return;
      }
      for (const e of ents) walk(path.join(abs, e));
    }
  };
  walk(dir);
  // Second attempt, and the last. If the chmod pass did not rescue the tree —
  // a root-owned entry is the case that survives it, and that was one of the
  // two real causes found on 2026-09-04 — throw something that NAMES the
  // sandbox. The bare rmSync error here says only ENOTEMPTY and a path deep
  // inside, which is the least useful moment for a test helper to be terse.
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (e) {
    throw new Error(
      `home sandbox ${dir} could not be removed (${e.code || e.name}); it is leaking into ` +
        `${BASE_TMP} and /claudemd-clean-residue will report it as unreapable`,
      { cause: e }
    );
  }
}

// Resolved ONCE, at import, before any sandbox has patched TMPDIR. `os.tmpdir()`
// reads $TMPDIR, and this helper sets $TMPDIR — so a second useHomeSandbox() in
// the same file used to mkdtemp INSIDE the first sandbox: tearing the first down
// deleted the second, and the next beforeEach mkdtemp-ed into a deleted tree
// (ENOENT). Found by the pre-tag review of v0.74.0. Every sandbox now comes from
// the real system temp directory regardless of what is currently patched.
const BASE_TMP = os.tmpdir();

function makeSandbox(label) {
  const home = fs.mkdtempSync(path.join(BASE_TMP, `claudemd-${label}-`));
  // The three directories a claudemd process expects to find or create. Made
  // eagerly so a spawned child writes into the sandbox rather than failing and
  // falling back to a default that is outside it.
  const claudeDir = path.join(home, '.claude');
  const stateDir = path.join(claudeDir, '.claudemd-state');
  const claudeTmp = path.join(claudeDir, 'tmp');
  const tmp = path.join(home, 'tmp');
  for (const d of [claudeDir, stateDir, claudeTmp, tmp]) fs.mkdirSync(d, { recursive: true });
  return { home, claudeDir, stateDir, claudeTmp, tmp };
}

function seamValues(s) {
  return {
    HOME: s.home,
    TMPDIR: s.tmp,
    CLAUDEMD_STATE_DIR: s.stateDir,
    CLAUDEMD_CLAUDE_TMP_DIR: s.claudeTmp,
  };
}

/**
 * Create a sandbox home and register node:test hooks that mint a fresh one per
 * test and remove it afterwards. Returns an accessor, not a path.
 *
 * @param {string} label short slug used in the mkdtemp template
 * @param {{patchProcessEnv?: boolean}} [opts] patchProcessEnv=false leaves this
 *   process's env alone (for suites that only ever spawn children)
 */
export function useHomeSandbox(label, { patchProcessEnv = true } = {}) {
  let current = null;
  let saved = null;

  beforeEach(() => {
    current = makeSandbox(label);
    if (!patchProcessEnv) return;
    // Saved and restored key by key, including "was not set at all" — assigning
    // the old value back unconditionally turns an unset variable into an empty
    // string, which is not the same thing to `process.env.X || fallback`.
    saved = Object.fromEntries(PATH_SEAMS.map(k => [k, process.env[k]]));
    for (const [k, v] of Object.entries(seamValues(current))) process.env[k] = v;
  });

  afterEach(() => {
    if (patchProcessEnv && saved) {
      for (const k of PATH_SEAMS) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
      saved = null;
    }
    // Cleared FIRST: forceRemove can now throw (a sandbox it cannot rescue),
    // and leaving `current` set would carry a deleted-or-half-deleted directory
    // into the next test, where every path built from it is wrong for a second,
    // unrelated reason.
    const doomed = current;
    current = null;
    if (doomed) forceRemove(doomed.home);
  });

  const live = () => {
    if (!current)
      throw new Error('home sandbox accessed outside a test — useHomeSandbox registers per-test hooks');
    return current;
  };

  return {
    get home() {
      return live().home;
    },
    get stateDir() {
      return live().stateDir;
    },
    get claudeTmp() {
      return live().claudeTmp;
    },
    get tmp() {
      return live().tmp;
    },
    /** Path inside the sandbox's ~/.claude, creating no directories. */
    claude(...parts) {
      return path.join(live().claudeDir, ...parts);
    },
    /** A fresh named directory inside the sandbox, for a second fixture root. */
    dir(name) {
      const d = path.join(live().home, name);
      fs.mkdirSync(d, { recursive: true });
      return d;
    },
    /** Environment for spawnSync: every path seam, plus whatever the test adds. */
    env(extra = {}) {
      return { ...process.env, ...seamValues(live()), ...extra };
    },
  };
}
