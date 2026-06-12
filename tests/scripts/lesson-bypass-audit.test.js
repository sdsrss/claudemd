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

test('encodeCcCwd: replaces /, ., _ with -', () => {
  assert.equal(
    encodeCcCwd('/mnt/data_ssd/dev/projects/claudemd'),
    '-mnt-data-ssd-dev-projects-claudemd',
  );
  // Per feedback_cc_cwd_encoding_dots.md (v0.9.15): underscore included.
  assert.equal(encodeCcCwd('/home/user/my_project'), '-home-user-my-project');
  assert.equal(encodeCcCwd('/a.b/c'), '-a-b-c');
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
  const transcript = [
    { timestamp: '2026-05-24T10:05:00Z', message: { content: 'something else' } },
  ];
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
    { ts: now, hook: 'memory-prompt-hint', event: 'suggest', session_id: 'sess-0001', extra: { suggested: ['feedback_a.md'], match_count: 1 } },
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
      assert.ok(r.citeRecall >= 0 && r.citeRecall <= 1,
        `cite-recall must be in [0,1], got ${r.citeRecall}`);
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
