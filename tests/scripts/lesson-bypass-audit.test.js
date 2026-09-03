import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  lessonBypassAudit,
  encodeCcCwd,
  rowText,
  wasApplied,
  readTranscript,
  readHookEmitCap,
  HOOK_EMIT_CAP_FALLBACK,
} from '../../scripts/lesson-bypass-audit.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(HERE, '../../scripts/lesson-bypass-audit.js');

let tmpHome, savedHome;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-lba-'));
  savedHome = process.env.HOME;
  process.env.HOME = tmpHome;
  fs.mkdirSync(path.join(tmpHome, '.claude/logs'), { recursive: true });
});

afterEach(() => {
  process.env.HOME = savedHome;
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

// --- Pure helpers ----------------------------------------------------------

test('encodeCcCwd: replaces EVERY non-[a-zA-Z0-9-] char with -', () => {
  assert.equal(encodeCcCwd('/mnt/data_ssd/dev/projects/claudemd'), '-mnt-data-ssd-dev-projects-claudemd');
  // Per feedback_cc_cwd_encoding_dots.md (v0.9.15): underscore included.
  assert.equal(encodeCcCwd('/home/user/my_project'), '-home-user-my-project');
  assert.equal(encodeCcCwd('/a.b/c'), '-a-b-c');
  // Divergence stressors — must match the hooks' `tr -c 'a-zA-Z0-9-' '-'`
  // (rule-hits.sh:15), NOT the abandoned narrow `/[/._]/g` form which leaves
  // spaces/+/@/() untouched and mis-locates the transcript dir.
  assert.equal(encodeCcCwd('/home/a b/c'), '-home-a-b-c');
  assert.equal(encodeCcCwd('/home/u/proj+v2 (old)@x'), '-home-u-proj-v2--old--x');
});

test('rowText: string content returns as-is', () => {
  assert.equal(rowText({ message: { content: 'hello world' } }), 'hello world');
});

test('rowText: array content extracts text + tool_use + tool_result + thinking', () => {
  const row = {
    message: {
      content: [
        { type: 'text', text: 'pre' },
        { type: 'tool_use', name: 'Read', input: { file_path: '/x/feedback_foo.md' } },
        { type: 'tool_result', content: 'feedback_foo.md content body' },
        { type: 'thinking', thinking: 'reflecting on feedback_bar.md' },
      ],
    },
  };
  const text = rowText(row);
  assert.match(text, /pre/);
  assert.match(text, /Read/);
  assert.match(text, /feedback_foo\.md/);
  assert.match(text, /feedback_bar\.md/);
});

test('rowText: empty / undefined / non-object handled safely', () => {
  assert.equal(rowText(null), '');
  assert.equal(rowText({}), '');
  assert.equal(rowText({ message: null }), '');
  assert.equal(rowText({ message: { content: undefined } }), '');
  assert.equal(rowText({ message: { content: 42 } }), '');
});

test('wasApplied: filename match after suggest ts → true', () => {
  const transcript = [
    { timestamp: '2026-05-24T10:00:00Z', message: { content: 'pre' } },
    {
      timestamp: '2026-05-24T10:05:00Z',
      message: {
        content: [{ type: 'tool_use', name: 'Read', input: { file_path: '/m/feedback_foo.md' } }],
      },
    },
  ];
  assert.equal(wasApplied(transcript, '2026-05-24T10:02:00Z', 'feedback_foo.md'), true);
});

test('wasApplied: match BEFORE suggest ts → false (only post-suggest counts)', () => {
  const transcript = [
    {
      timestamp: '2026-05-24T09:55:00Z',
      message: { content: 'pre-suggest mention of feedback_foo.md' },
    },
    { timestamp: '2026-05-24T10:05:00Z', message: { content: 'unrelated' } },
  ];
  assert.equal(wasApplied(transcript, '2026-05-24T10:00:00Z', 'feedback_foo.md'), false);
});

test('wasApplied: no occurrence → false', () => {
  const transcript = [{ timestamp: '2026-05-24T10:05:00Z', message: { content: 'something else' } }];
  assert.equal(wasApplied(transcript, '2026-05-24T10:00:00Z', 'feedback_foo.md'), false);
});

test('readTranscript: nonexistent path → empty array (no throw)', () => {
  assert.deepEqual(readTranscript('/no/such/path.jsonl'), []);
});

test('readTranscript: malformed lines skipped, valid kept', () => {
  const tmp = path.join(tmpHome, 'sample.jsonl');
  fs.writeFileSync(tmp, '{"a":1}\n{not json}\n{"a":2}\n');
  const rows = readTranscript(tmp);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].a, 1);
  assert.equal(rows[1].a, 2);
});

test('R11-24: readTranscript counts the lines it skipped', () => {
  const tmp = path.join(tmpHome, 'bad.jsonl');
  fs.writeFileSync(tmp, '{"a":1}\n{not json}\nplain log line\n{"a":2}\n');
  const integrity = { badLines: 0 };
  const rows = readTranscript(tmp, integrity);
  assert.equal(rows.length, 2);
  assert.equal(integrity.badLines, 2);
  // Absent out-param is the historical call shape — must still work.
  assert.equal(readTranscript(tmp).length, 2);
});

// --- Integration: full audit pipeline ---------------------------------------

function writeLog(rows) {
  const log = path.join(tmpHome, '.claude/logs/claudemd.jsonl');
  fs.writeFileSync(log, rows.map(r => JSON.stringify(r)).join('\n') + '\n');
  return log;
}

function writeTranscript(projectDir, sessionId, rows) {
  fs.mkdirSync(projectDir, { recursive: true });
  const p = path.join(projectDir, `${sessionId}.jsonl`);
  fs.writeFileSync(p, rows.map(r => JSON.stringify(r)).join('\n') + '\n');
  return p;
}

test('audit: 1 applied + 1 bypassed → cite-recall 50%', () => {
  const now = new Date().toISOString();
  writeLog([
    {
      ts: now,
      hook: 'memory-prompt-hint',
      event: 'suggest',
      session_id: 'sess-AAAA',
      spec_section: '§11-memory-hint',
      extra: { suggested: ['feedback_applied.md', 'feedback_bypassed.md'], match_count: 2 },
    },
  ]);
  const projectDir = path.join(tmpHome, '.claude/projects/-test-cwd');
  writeTranscript(projectDir, 'sess-AAAA', [
    { timestamp: now, message: { content: [{ type: 'text', text: 'reading feedback_applied.md' }] } },
    // feedback_bypassed.md never mentioned post-suggest → bypassed.
  ]);

  const r = lessonBypassAudit({ days: 30, cwd: '/test/cwd', projectDir });
  assert.equal(r.totalSuggestions, 2);
  assert.equal(r.totalApplied, 1);
  assert.equal(r.totalBypassed, 1);
  assert.equal(r.totalMissingTranscript, 0);
  assert.equal(r.citeRecall, 0.5);
  assert.equal(r.bypassRate, 0.5);
  assert.equal(r.perMemory['feedback_applied.md'].applied, 1);
  assert.equal(r.perMemory['feedback_bypassed.md'].bypassed, 1);
});

test('R11-24: a corrupt row that held the Read scores bypassed — and the audit says how many rows it dropped', () => {
  // This is the damage the counter exists to make visible: cite-recall moves in
  // the alarming direction because a LINE failed to parse, not because a lesson
  // was ignored. The verdict below is still 0% — dropping the row is the right
  // behavior — but the run now carries the number that explains it.
  const now = new Date().toISOString();
  writeLog([
    {
      ts: now,
      hook: 'memory-prompt-hint',
      event: 'suggest',
      session_id: 'sess-CORRUPT',
      spec_section: '§11-memory-hint',
      extra: { suggested: ['feedback_applied.md'], match_count: 1 },
    },
  ]);
  const projectDir = path.join(tmpHome, '.claude/projects/-test-cwd');
  fs.mkdirSync(projectDir, { recursive: true });
  fs.writeFileSync(
    path.join(projectDir, 'sess-CORRUPT.jsonl'),
    [
      JSON.stringify({ timestamp: now, message: { content: [{ type: 'text', text: 'hello' }] } }),
      // The row that read the memory file — truncated mid-write, as a killed
      // session leaves it.
      '{"timestamp":"' + now + '","message":{"content":[{"type":"text","text":"reading feedback_appli',
    ].join('\n') + '\n'
  );

  const r = lessonBypassAudit({ days: 30, cwd: '/test/cwd', projectDir });
  assert.equal(r.totalBypassed, 1, 'the dropped row makes it look bypassed');
  assert.equal(r.citeRecall, 0);
  assert.equal(r.totalMalformedLines, 1, 'and the run reports why the verdict is unreliable');
  assert.equal(r.perSession['sess-CORRUPT'].malformedLines, 1);
});

test('R11-24: a clean run reports zero malformed lines', () => {
  const now = new Date().toISOString();
  writeLog([
    {
      ts: now,
      hook: 'memory-prompt-hint',
      event: 'suggest',
      session_id: 'sess-CLEAN',
      spec_section: '§11-memory-hint',
      extra: { suggested: ['feedback_applied.md'], match_count: 1 },
    },
  ]);
  const projectDir = path.join(tmpHome, '.claude/projects/-test-cwd');
  writeTranscript(projectDir, 'sess-CLEAN', [
    { timestamp: now, message: { content: [{ type: 'text', text: 'reading feedback_applied.md' }] } },
  ]);
  const r = lessonBypassAudit({ days: 30, cwd: '/test/cwd', projectDir });
  assert.equal(r.totalApplied, 1);
  assert.equal(r.totalMalformedLines, 0);
});

test('audit: missing transcript → counted separately, not in applied/bypassed', () => {
  const now = new Date().toISOString();
  writeLog([
    {
      ts: now,
      hook: 'memory-prompt-hint',
      event: 'suggest',
      session_id: 'sess-missing',
      spec_section: '§11-memory-hint',
      extra: { suggested: ['feedback_x.md'], match_count: 1 },
    },
  ]);
  // No transcript file written.
  const projectDir = path.join(tmpHome, '.claude/projects/-test-cwd');
  fs.mkdirSync(projectDir, { recursive: true });

  const r = lessonBypassAudit({ days: 30, cwd: '/test/cwd', projectDir });
  assert.equal(r.totalSuggestions, 1);
  assert.equal(r.totalMissingTranscript, 1);
  assert.equal(r.totalApplied, 0);
  assert.equal(r.totalBypassed, 0);
  assert.equal(r.citeRecall, null, 'cite-recall null when no measurable events');
});

test('audit: test-session sentinels filtered (session_id=t / test)', () => {
  const now = new Date().toISOString();
  writeLog([
    {
      ts: now,
      hook: 'memory-prompt-hint',
      event: 'suggest',
      session_id: 't',
      extra: { suggested: ['feedback_a.md'], match_count: 1 },
    },
    {
      ts: now,
      hook: 'memory-prompt-hint',
      event: 'suggest',
      session_id: 'test',
      extra: { suggested: ['feedback_b.md'], match_count: 1 },
    },
  ]);
  const projectDir = path.join(tmpHome, '.claude/projects/-test-cwd');
  fs.mkdirSync(projectDir, { recursive: true });

  const r = lessonBypassAudit({ days: 30, cwd: '/test/cwd', projectDir });
  assert.equal(r.totalSuggestEvents, 0, 'test sentinels must be filtered out');
  assert.equal(r.totalSuggestions, 0);
});

test('audit: tool_use Read of memory file counts as applied', () => {
  const now = new Date().toISOString();
  writeLog([
    {
      ts: now,
      hook: 'memory-prompt-hint',
      event: 'suggest',
      session_id: 'sess-tool',
      extra: { suggested: ['feedback_lesson.md'], match_count: 1 },
    },
  ]);
  const projectDir = path.join(tmpHome, '.claude/projects/-test-cwd');
  writeTranscript(projectDir, 'sess-tool', [
    {
      timestamp: now,
      message: {
        content: [
          {
            type: 'tool_use',
            name: 'Read',
            input: { file_path: '/home/x/.claude/projects/-foo/memory/feedback_lesson.md' },
          },
        ],
      },
    },
  ]);

  const r = lessonBypassAudit({ days: 30, cwd: '/test/cwd', projectDir });
  assert.equal(r.totalApplied, 1);
  assert.equal(r.totalBypassed, 0);
});

test('audit: events outside window not counted', () => {
  const ancient = new Date(Date.now() - 60 * 86400 * 1000).toISOString();
  writeLog([
    {
      ts: ancient,
      hook: 'memory-prompt-hint',
      event: 'suggest',
      session_id: 'sess-old',
      extra: { suggested: ['feedback_a.md'], match_count: 1 },
    },
  ]);
  const projectDir = path.join(tmpHome, '.claude/projects/-test-cwd');
  fs.mkdirSync(projectDir, { recursive: true });

  const r = lessonBypassAudit({ days: 30, cwd: '/test/cwd', projectDir });
  assert.equal(r.totalSuggestEvents, 0);
});

test('audit: non-suggest events ignored (only memory-prompt-hint + suggest)', () => {
  const now = new Date().toISOString();
  writeLog([
    {
      ts: now,
      hook: 'memory-prompt-hint',
      event: 'suggest',
      session_id: 'sess-0001',
      extra: { suggested: ['feedback_a.md'], match_count: 1 },
    },
    { ts: now, hook: 'memory-read-check', event: 'deny', session_id: 'sess-0001', extra: null },
    { ts: now, hook: 'banned-vocab', event: 'deny', session_id: 'sess-0002', extra: null },
  ]);
  const projectDir = path.join(tmpHome, '.claude/projects/-test-cwd');
  writeTranscript(projectDir, 'sess-0001', [
    { timestamp: now, message: { content: 'mention of feedback_a.md' } },
  ]);

  const r = lessonBypassAudit({ days: 30, cwd: '/test/cwd', projectDir });
  assert.equal(r.totalSuggestEvents, 1);
  assert.equal(r.totalApplied, 1);
});

// --- Byte-exact production fixture per feedback_test_fixture_format_drift ---

test('audit on real ~/.claude/logs/claudemd.jsonl — basic shape sanity', () => {
  // Restore real HOME for this test so we hit the production log.
  process.env.HOME = savedHome;
  try {
    const r = lessonBypassAudit({ days: 30, cwd: process.cwd() });
    assert.equal(typeof r.totalSuggestEvents, 'number');
    assert.ok(r.totalSuggestEvents >= 0);
    assert.ok(typeof r.totalApplied === 'number');
    assert.ok(typeof r.totalBypassed === 'number');
    // citeRecall is null OR a number in [0,1].
    if (r.citeRecall !== null) {
      assert.ok(r.citeRecall >= 0 && r.citeRecall <= 1, `cite-recall must be in [0,1], got ${r.citeRecall}`);
    }
    // perMemory keys must be plausible filenames.
    for (const k of Object.keys(r.perMemory)) {
      assert.match(k, /\.md$/, `perMemory key looks like a filename: ${k}`);
    }
  } finally {
    process.env.HOME = tmpHome;
  }
});

// --- CLI argv discipline (per feedback_cli_flag_shape_silent_fallback) ------

test('CLI rejects space-form --days 30', () => {
  const r = spawnSync(process.execPath, [SCRIPT, '--days', '30'], {
    env: { ...process.env, HOME: tmpHome },
    encoding: 'utf8',
  });
  assert.equal(r.status, 2, `expected exit 2, stderr: ${r.stderr}`);
  assert.match(r.stderr, /requires '=value' form/);
});

test('CLI rejects unknown flag', () => {
  const r = spawnSync(process.execPath, [SCRIPT, '--bogus=1'], {
    env: { ...process.env, HOME: tmpHome },
    encoding: 'utf8',
  });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /Unknown flag.*--bogus/);
});

test('CLI rejects non-integer --days', () => {
  const r = spawnSync(process.execPath, [SCRIPT, '--days=abc'], {
    env: { ...process.env, HOME: tmpHome },
    encoding: 'utf8',
  });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /positive integer/);
});

test('CLI --json emits parseable JSON', () => {
  const r = spawnSync(process.execPath, [SCRIPT, '--json', '--cwd=/nonexistent'], {
    env: { ...process.env, HOME: tmpHome },
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.totalSuggestEvents, 0);
  assert.equal(parsed.citeRecall, null);
});

test('the emit cap is read from the hook, and a broken join is distinguishable (条目 24)', () => {
  // The audit divides by the hook's own `MAX=` emit cap. An indent or a rename
  // there made the regex miss and the code fell back to 5 in silence, so the
  // bypass rate kept being reported against a denominator that no longer
  // matched the hook — with nothing in the output saying the join had broken.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-emitcap-'));
  try {
    fs.mkdirSync(path.join(root, 'hooks'), { recursive: true });
    const hookPath = path.join(root, 'hooks/memory-prompt-hint.sh');

    fs.writeFileSync(hookPath, '#!/usr/bin/env bash\nMAX=9\necho hi\n');
    assert.deepEqual(
      readHookEmitCap(root),
      { cap: 9, source: 'hook' },
      'a cap the hook actually declares must be derived, not defaulted'
    );

    // The exact shape that used to fall back in silence.
    fs.writeFileSync(hookPath, '#!/usr/bin/env bash\n  MAX=9\necho hi\n');
    assert.deepEqual(
      readHookEmitCap(root),
      { cap: HOOK_EMIT_CAP_FALLBACK, source: 'fallback-no-anchor' },
      'a present-but-unparseable hook must report the fallback AS a fallback'
    );

    fs.rmSync(hookPath);
    assert.deepEqual(
      readHookEmitCap(root),
      { cap: HOOK_EMIT_CAP_FALLBACK, source: 'fallback-missing-file' },
      'a missing hook file is a different case from a broken anchor'
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the live hook still carries the MAX= anchor this audit reads', () => {
  // The join above only helps if the real hook satisfies it today; without this
  // the suite would be green on a repo whose audit silently uses the fallback.
  const res = readHookEmitCap(path.resolve(HERE, '../..'));
  assert.equal(res.source, 'hook', 'hooks/memory-prompt-hint.sh no longer exposes `MAX=<n>` at line start');
  assert.ok(res.cap >= 1 && res.cap <= 50, `implausible emit cap ${res.cap}`);
});

// R11-25 (2026-09-03 audit): --cwd here and --project in spec-coherence-audit
// name the same thing — the CC project whose ~/.claude/projects/<encoded> dir
// to read — so whichever one you typed second was an argv-shape error.
test('R11-25: --project is an alias for --cwd, and a conflicting pair is refused', () => {
  const run = args =>
    spawnSync(process.execPath, [SCRIPT, ...args, '--json'], {
      env: { ...process.env, HOME: tmpHome },
      encoding: 'utf8',
    });

  const viaProject = run(['--project=/work/aliased']);
  assert.equal(viaProject.status, 0, `stderr=${viaProject.stderr}`);
  assert.equal(JSON.parse(viaProject.stdout).cwd, '/work/aliased');

  const viaCwd = run(['--cwd=/work/aliased']);
  assert.equal(viaCwd.status, 0, `stderr=${viaCwd.stderr}`);
  assert.deepEqual(JSON.parse(viaCwd.stdout), JSON.parse(viaProject.stdout), 'the two spellings must agree');

  // Same value twice is fine; two different values is a mistake worth naming.
  assert.equal(run(['--cwd=/a', '--project=/a']).status, 0);
  const conflict = run(['--cwd=/a', '--project=/b']);
  assert.equal(conflict.status, 1);
  assert.match(conflict.stderr, /--cwd and --project are aliases but were given different values/);
});

test('R11-24: a FULLY corrupt transcript keeps its malformed count across the candidate loop', () => {
  // Pre-tag review N1: the candidate loop was last-wins, and a fully-corrupt
  // file yields rows.length === 0 so it does NOT break — the next (absent)
  // candidate then overwrote badLines with 0. The row landed in
  // missingTranscript reporting malformedLines: 0, i.e. naming the wrong cause,
  // which is the exact failure the counter was added to prevent. Needs TWO
  // candidates, so the log row must carry a top-level `project`.
  const now = new Date().toISOString();
  const projectDir = path.join(tmpHome, '.claude/projects/-row-project');
  fs.mkdirSync(projectDir, { recursive: true });
  fs.writeFileSync(path.join(projectDir, 'sess-ALLBAD.jsonl'), '{broken\nalso broken\n{"x":\n');
  writeLog([
    {
      ts: now,
      hook: 'memory-prompt-hint',
      event: 'suggest',
      session_id: 'sess-ALLBAD',
      project: '-row-project',
      spec_section: '§11-memory-hint',
      extra: { suggested: ['feedback_applied.md'], match_count: 1 },
    },
  ]);

  const r = lessonBypassAudit({
    days: 30,
    cwd: '/test/cwd',
    projectDir: path.join(tmpHome, '.claude/projects/-test-cwd'),
  });
  assert.equal(r.totalMissingTranscript, 1, 'zero parseable rows still reads as "missing" to the scorer');
  assert.equal(r.totalMalformedLines, 3, 'but the run must say the file was corrupt, not absent');
  assert.equal(r.perSession['sess-ALLBAD'].malformedLines, 3);
});
