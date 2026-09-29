#!/usr/bin/env node
// Compare two answers to "was this completion claim verified?" (R3,
// tasks/specs/wtree-evidence.md) over the claudemd log:
//   - evidence-gate's verdict, which reads the transcript for code edits and
//     for runner output after the last one (`claim-wtree` rows, extra.verdict);
//   - the fingerprint answer: did a passing verification run happen on exactly
//     the claimed working-tree content (`verify-run` rows with the same wtree)?
// Both row kinds exist only with EVIDENCE_GATE=1 and EVIDENCE_WTREE=1. Log only:
// nothing here, or in either hook, changes a verdict.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { printHelpAndExit, invokedAsMain, parseStrictOrExit } from '../lib/argv.js';

const USAGE = `Usage: node scripts/offline-eval/wtree-verdicts.mjs [--log=PATH] [--since=ISO] [--json]

Cross-tabulate evidence-gate's verdict against the working-tree fingerprint
verdict for every logged completion claim.

Options:
  --log=PATH     claudemd log (default ~/.claude/logs/claudemd.jsonl).
  --since=ISO    Only claims at or after this timestamp.
  --json         Machine-readable output.
  --help, -h     Print this message and exit.

Exit codes: 0 measured | 2 argv-shape error.`;

/** evidence-gate's own reading of a claim. */
export function gateReading(verdict) {
  if (verdict === 'verified') return 'gate-verified';
  if (verdict === 'no-code-edit') return 'gate-no-edit';
  return 'gate-fires';
}

/**
 * rows: parsed log rows. Returns the cross-tab and the claims where the two
 * readings disagree. A fingerprint verdict needs a claim fingerprint; claims
 * without one are counted as `no-fingerprint`.
 */
export function crossTab(rows, since = '') {
  const runs = new Map(); // wtree -> [{ts, session}]
  for (const r of rows) {
    if (r?.hook !== 'verify-log' || r.event !== 'verify-run' || !r.extra?.wtree) continue;
    if (!runs.has(r.extra.wtree)) runs.set(r.extra.wtree, []);
    runs.get(r.extra.wtree).push({ ts: r.ts, session: r.session_id });
  }
  const table = {};
  const disagreements = [];
  let claims = 0;
  for (const r of rows) {
    if (r?.hook !== 'evidence-gate' || r.event !== 'claim-wtree') continue;
    if (since && r.ts < since) continue;
    claims++;
    const gate = gateReading(r.extra?.verdict);
    let wt = 'no-fingerprint';
    if (r.extra?.wtree) {
      const hits = (runs.get(r.extra.wtree) || []).filter(v => v.ts <= r.ts);
      if (hits.some(v => v.session === r.session_id)) wt = 'wtree-verified';
      else if (hits.length) wt = 'wtree-verified-other-session';
      else wt = 'wtree-unverified';
    }
    const key = `${gate} × ${wt}`;
    table[key] = (table[key] || 0) + 1;
    const gateSaysVerified = gate !== 'gate-fires';
    const wtreeSaysVerified = wt.startsWith('wtree-verified');
    if (wt !== 'no-fingerprint' && gateSaysVerified !== wtreeSaysVerified) {
      disagreements.push({ ts: r.ts, session: r.session_id, verdict: r.extra?.verdict, wtree: wt });
    }
  }
  return { claims, table, disagreements };
}

function readRows(file) {
  const out = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      /* a torn line; the rest of the log still counts */
    }
  }
  return out;
}

if (invokedAsMain(import.meta.url)) {
  printHelpAndExit(process.argv.slice(2), USAGE);
  const p = parseStrictOrExit(process.argv.slice(2), { bools: ['--json'], values: ['--log', '--since'] });
  const log = p.values['--log'] || path.join(os.homedir(), '.claude', 'logs', 'claudemd.jsonl');
  const res = fs.existsSync(log)
    ? crossTab(readRows(log), p.values['--since'] || '')
    : { claims: 0, table: {}, disagreements: [] };
  if (p.bools.has('--json')) console.log(JSON.stringify({ log, ...res }, null, 2));
  else {
    console.log(`${res.claims} logged claim(s) in ${log}`);
    for (const [k, n] of Object.entries(res.table).sort()) console.log(`  ${k}: ${n}`);
    console.log(`${res.disagreements.length} disagreement(s)`);
  }
}
