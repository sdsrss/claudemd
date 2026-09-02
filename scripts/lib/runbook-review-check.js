// v0.61.0 — runbook review-step presence scan (advisory; doctor check
// `runbook-review-step`). Origin: 2026-07-27 v0.60.0 incident — spec v6.24.0
// added §EXT §12 `Gated = missing`, but the same-day sweep found ALL SIX
// projects' ship runbooks/release flows lacked a review-before-tag step
// entirely (claudemd's had `self-review /` as an equal option; the other five
// had no review step at all). Rule text loaded ≠ rule enforced — the checklist
// at the decision point wins (feedback_rule_text_vs_checklist_placement.md).
//
// Detection direction is ABSENCE of a review step in files that ARE ship
// runbooks — never keyword-hit on "self-review": the fixed runbooks
// legitimately contain that word as a named degrade, and the live corpus had
// zero occurrences of the two-option anti-pattern to match on
// (tasks/deferred-2026-07-27-doctor-runbook-review-check.md, point 2).
//
// This module only LISTS files — rewriting a runbook is a §5-scoped write to
// user-authored durable memory and stays the operator's call. Same posture as
// memory-maintenance.js.

import fs from 'node:fs';
import path from 'node:path';
import { projectsRoot } from './paths.js';

// A file counts as a ship-runbook candidate via the strongest matching tier:
//   stamp — carries a `covers: §EXT §12` fast-path stamp (definitive: only
//           ship runbooks are stamped, §2.2 Runbook fast-path)
//   name  — filename mentions runbook
//   flow  — filename mentions ship/release AND body has ≥2 distinct ship-flow
//           tokens (excludes e.g. "cargo build --release" notes)
const STAMP_RE = /covers:\s*§EXT\s*§12/;
const NAME_RUNBOOK_RE = /runbook/i;
const NAME_SHIPPY_RE = /(ship|release)/i;
const FLOW_TOKENS = [
  /git tag/i,
  /push origin/i,
  /gh release/i,
  /npm publish/i,
  /(release|publish)\.yml/i,
  /打\s*tag/,
  /发版|发布流程/,
];

// Review-step fingerprint. Anchored on the shapes the 2026-07-27 sweep wrote
// plus reasonable self-authored variants; NOT on the word "self-review".
const REVIEW_FINGERPRINT_RE = new RegExp(
  [
    'Author\\s*≠\\s*reviewer',
    'review\\s+before\\s+tag',
    'fresh[- ]subagent\\s+review',
    // 中文: “tag/发版/发布…前…评审/review” within a short span
    '(tag|发版|发布)[^\\n]{0,20}前[^\\n]{0,30}(评审|review)',
  ].join('|'),
  'i'
);

function countFlowTokens(content) {
  let n = 0;
  for (const re of FLOW_TOKENS) if (re.test(content)) n += 1;
  return n;
}

function classifyCandidate(name, content) {
  if (STAMP_RE.test(content)) return 'stamp';
  if (NAME_RUNBOOK_RE.test(name)) return 'name';
  if (NAME_SHIPPY_RE.test(name) && countFlowTokens(content) >= 2) return 'flow';
  return null;
}

// scanRunbookReviewSteps({rootDir}) — walks <root>/*/memory/*.md two levels
// deep (explicit, no recursion — §8 posture), classifies ship-runbook
// candidates, and lists those lacking a review-step fingerprint.
export function scanRunbookReviewSteps({ rootDir } = {}) {
  const root = rootDir || projectsRoot();
  const out = { missing: [], scannedRunbooks: 0 };

  let projects;
  try {
    projects = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return out;
  }

  for (const ent of projects) {
    if (!ent.isDirectory()) continue;
    const memDir = path.join(root, ent.name, 'memory');
    let files;
    try {
      files = fs.readdirSync(memDir).filter(f => f.endsWith('.md'));
    } catch {
      continue;
    } // no memory dir — nothing to scan
    const projectMisses = [];
    let projectHasFingerprintedRunbook = false;
    for (const f of files) {
      if (f === 'MEMORY.md') continue;
      let content;
      try {
        content = fs.readFileSync(path.join(memDir, f), 'utf8');
      } catch {
        continue;
      }
      const tier = classifyCandidate(f, content);
      if (!tier) continue;
      out.scannedRunbooks += 1;
      if (REVIEW_FINGERPRINT_RE.test(content)) {
        projectHasFingerprintedRunbook = true;
      } else {
        projectMisses.push({ project: ent.name, file: f, tier });
      }
    }
    // Flow-tier suppression: when the project already has a fingerprinted
    // runbook, its release-ADJACENT lessons (tier 'flow') need not repeat the
    // step — §11-EXT-MEM ship-runbook consolidation puts the flow in ONE file.
    // Live-corpus FP this closes: code-graph-mcp's
    // feedback_workflow_dispatch_release_refs.md (a tag-ref contract note)
    // flagged beside its fingerprinted feedback_full_release_flow.md.
    // stamp/name tiers are never suppressed — a second stamped or *runbook*-
    // named file is itself the runbook (or consolidation drift worth seeing).
    for (const m of projectMisses) {
      if (m.tier === 'flow' && projectHasFingerprintedRunbook) continue;
      out.missing.push(m);
    }
  }
  out.missing.sort((a, b) => a.project.localeCompare(b.project) || a.file.localeCompare(b.file));
  return out;
}
