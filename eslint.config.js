// ESLint flat config — `npm run lint:js`.
//
// Scope: every .js/.mjs under bin/, scripts/ and tests/ (the code this repo
// maintains), plus this file. tests/fixtures/ is input data for the suites —
// deliberately odd JS/TS/Vue that design-detect must classify — and is not
// linted. The rule set is @eslint/js `recommended` with no local additions:
// the baseline (docs/audit/00-baseline.md) was measured against exactly this
// set, so a rule added later must be added here, not assumed.
import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    ignores: ['node_modules/**', 'tests/fixtures/**', 'coverage/**', '.code-graph/**', 'docs/**', 'tasks/**'],
  },
  js.configs.recommended,
  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      // `_`-prefixed = intentionally unused (a destructured slot, a catch binding
      // kept for readability). Everything else unused is a finding.
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
    },
  },
];
