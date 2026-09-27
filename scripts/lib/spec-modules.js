// spec-modules — build per-phase spec modules from marked sections of
// spec/CLAUDE-extended.md (tasks/specs/spec-modules.md r3; audit §10).
//
// The source stays one file: a line `<!-- module: NAME -->` starts a module and
// holds until the next marker; `<!-- module: none -->` marks text no module
// carries (maintainer-only). Text before the first marker is `none`. A chunk
// that starts inside a `##` section (its first heading is `###`) is prefixed
// with that `##` heading, so the module keeps the context the source gave it.
// Metadata (when to load, tier-2 triggers) lives in spec/spec-modules.json and
// is written into each module's frontmatter, where the hooks read it.

import fs from 'node:fs';
import path from 'node:path';

export const MARKER = /^<!-- module: ([a-z][a-z0-9-]*) -->$/;
export const MODULE_DIR = 'spec-modules';

/** { name: [chunkText, ...] } in source order, `none` excluded. */
export function splitModules(text) {
  const out = {};
  let current = 'none';
  let lastH2 = null; // the most recent `##` heading
  let lastH2Before = null; // the `##` heading in force where the current chunk began
  let chunk = [];
  const flush = () => {
    if (current !== 'none' && chunk.some(l => l.trim())) {
      const firstHeading = chunk.find(l => /^#{2,3} /.test(l));
      const lines =
        firstHeading && firstHeading.startsWith('### ') && lastH2Before !== null
          ? [lastH2Before, '', ...chunk]
          : chunk;
      (out[current] ??= []).push(lines.join('\n').replace(/^\n+|\n+$/g, ''));
    }
    chunk = [];
  };
  for (const line of text.split('\n')) {
    const m = MARKER.exec(line);
    if (m) {
      flush();
      current = m[1];
      lastH2Before = lastH2;
      continue;
    }
    if (line.startsWith('## ')) lastH2 = line;
    chunk.push(line);
  }
  flush();
  return out;
}

/** Title line version, e.g. "v7.0.0" from "# AI-CODING-SPEC v7.0.0 — Extended". */
export function specVersion(text) {
  const m = /^# AI-CODING-SPEC (v\d+\.\d+\.\d+)/m.exec(text);
  return m ? m[1] : 'v?';
}

/** One module file: frontmatter the hooks read, a title, then its chunks. */
export function renderModule(name, meta, chunks, version) {
  const fm = [
    '---',
    `module: ${name}`,
    `loads-on: ${meta.loadsOn}`,
    `triggers: ${meta.triggers || ''}`,
    `trigger-window: ${meta.window || 'head'}`,
    '---',
    '',
  ];
  return [
    ...fm,
    `# AI-CODING-SPEC ${version} — module: ${name}`,
    '',
    `<!-- generated from spec/CLAUDE-extended.md by scripts/build-spec-modules.js; edit the source, then rebuild -->`,
    '',
    chunks.join('\n\n'),
    '',
  ].join('\n');
}

/** Build every module; returns { name: fileText }. Throws on a marker name the registry lacks. */
export function buildModules(sourceText, registry) {
  const parts = splitModules(sourceText);
  const version = specVersion(sourceText);
  const unknown = Object.keys(parts).filter(n => !registry[n]);
  if (unknown.length)
    throw new Error(`spec-modules: marker(s) with no registry entry: ${unknown.join(', ')}`);
  const empty = Object.keys(registry).filter(n => !parts[n]);
  if (empty.length)
    throw new Error(`spec-modules: registry entries with no marked text: ${empty.join(', ')}`);
  return Object.fromEntries(
    Object.keys(registry).map(n => [n, renderModule(n, registry[n], parts[n], version)])
  );
}

/** Read source + registry from a repo/plugin root and build. */
export function buildFromRoot(root) {
  const src = fs.readFileSync(path.join(root, 'spec', 'CLAUDE-extended.md'), 'utf8');
  const registry = JSON.parse(fs.readFileSync(path.join(root, 'spec', 'spec-modules.json'), 'utf8')).modules;
  return buildModules(src, registry);
}
