// One line reading `null` takes down four readers (Round-14 audit ALG-M1).
//
// `JSON.parse("null")` succeeds and returns `null`, so every one of these
// readers walked past its `try/catch` — which is guarding against a PARSE
// failure — and then dereferenced a property on it. A JSONL line that is any
// other non-object (`3`, `"x"`, `[]`) is handled: the property read yields
// undefined and the row is counted or skipped. Only `null` throws, and the four
// call sites are the entire read surface for the two JSONL formats this repo
// consumes: Claude Code transcripts and its own rule-hits log.
//
// The blast radius is not uniform, which is why this is one gate rather than
// four fixes: `claudemd audit` printed a V8 stack and exited 1, and exit 1 is
// also its "hits found" code — so a corrupt log line reads as a §10-V finding.
//
// This file is a CLASS gate. A new JSONL reader belongs in READERS below.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { parseTranscript, countStringContentAssistantRows } from '../../scripts/lib/lint.js';
import { readLogRows, readHits } from '../../scripts/lib/rule-hits-parse.js';
import { readTranscript, wasApplied } from '../../scripts/lesson-bypass-audit.js';
import { samplingAudit } from '../../scripts/sampling-audit.js';

const assistantRow = t =>
  JSON.stringify({
    type: 'assistant',
    timestamp: new Date().toISOString(),
    message: { content: [{ type: 'text', text: t }] },
  });

// Every non-object JSON scalar, not just `null`: the fix must be "this line is
// not an object", not "this line is not the literal null".
const NON_OBJECT_LINES = ['null', '3', '"a string"', '[]', 'true'];

function transcriptWithNulls() {
  return (
    [assistantRow('Done: first turn.'), ...NON_OBJECT_LINES, assistantRow('Done: second turn.')].join(
      '\n'
    ) + '\n'
  );
}

test('ALG-M1: lint.parseTranscript survives a bare null line and counts it', () => {
  const integrity = {};
  const turns = parseTranscript(transcriptWithNulls(), integrity);
  assert.equal(turns.length, 2, 'both real turns must still be scanned');
  assert.equal(
    integrity.badLines,
    NON_OBJECT_LINES.length,
    'and every non-object line must be counted, not silently dropped'
  );
});

test('ALG-M1: lint.countStringContentAssistantRows survives a bare null line', () => {
  assert.equal(countStringContentAssistantRows(transcriptWithNulls()), 0);
  const withStringContent =
    [JSON.stringify({ type: 'assistant', message: { content: 'plain text' } }), 'null'].join('\n') +
    '\n';
  assert.equal(countStringContentAssistantRows(withStringContent), 1);
});

test('ALG-M1: rule-hits readLogRows counts a bare null line as corrupt', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-nullrow-'));
  try {
    const logPath = path.join(dir, 'claudemd.jsonl');
    const good = ts => JSON.stringify({ ts, hook: 'banned-vocab', event: 'deny', spec_section: '§10-V' });
    fs.writeFileSync(
      logPath,
      [good('2026-09-06T00:00:00Z'), ...NON_OBJECT_LINES, good('2026-09-06T01:00:00Z')].join('\n') + '\n'
    );

    const { rows, totalLines, badJson } = readLogRows(logPath);
    assert.equal(totalLines, 2 + NON_OBJECT_LINES.length);
    assert.equal(badJson, NON_OBJECT_LINES.length, 'non-object rows are corrupt rows');
    assert.equal(rows.length, 2, 'and the usable rows still come back');

    // readHits is the consumer `claudemd audit` actually calls.
    const hits = readHits(logPath, 3650);
    assert.equal(hits.hits.length, 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('ALG-M1: lesson-bypass readTranscript/wasApplied survive a bare null line', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-nullrow-lb-'));
  try {
    const p = path.join(dir, 't.jsonl');
    fs.writeFileSync(p, transcriptWithNulls());
    const integrity = {};
    const rows = readTranscript(p, integrity);
    assert.equal(integrity.badLines, NON_OBJECT_LINES.length);
    // wasApplied walks every row and reads `row.timestamp`.
    assert.equal(wasApplied(rows, '2000-01-01T00:00:00Z', 'feedback_x.md'), false);
    const withHit = rows.concat([
      { timestamp: new Date().toISOString(), type: 'assistant', message: { content: 'read feedback_x.md' } },
    ]);
    assert.equal(wasApplied(withHit, '2000-01-01T00:00:00Z', 'feedback_x.md'), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('ALG-M1: samplingAudit survives a bare null line and counts it malformed', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-nullrow-sa-'));
  try {
    fs.writeFileSync(path.join(dir, 'nulls.jsonl'), transcriptWithNulls());
    const r = await samplingAudit({ projectsDir: dir, days: 3650 });
    assert.equal(r.scannedTranscripts, 1);
    assert.equal(r.totalAssistantTextRows, 2, 'the two real turns still scanned');
    assert.equal(r.malformedTranscripts.length, 1);
    assert.equal(r.malformedTranscripts[0].lines, NON_OBJECT_LINES.length);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
