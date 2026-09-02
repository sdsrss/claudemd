// Canonical "is this transcript row a real typed user turn" predicate — JS side.
//
// SINGLE SOURCE with the jq definition in hooks/lib/hook-common.sh
// (HOOK_USER_TURN_JQ); tests/scripts/user-turn-parity.test.js runs both engines
// over tests/fixtures/user-turn-shapes.jsonl and requires identical verdicts.
// Same seam model as the §10-V dual-engine parity gate and the cwd encoder.
//
// Why one definition (2026-07-27 audit, H2): three consumers each resolved the
// last-user boundary differently while all three cited the same memory,
// feedback_cc_user_content_string_vs_array. The differences were not cosmetic —
// a prompt carrying an attachment (array content with a text block) was a turn
// boundary for two engines and not for the third, so §10-V Path 2 kept scanning
// prose from a turn the user had already interrupted. That is the v0.23.19
// deny-loop field report, reachable again through a different content shape.
//
// The rules, and what each one is for:
//   - type must be "user";
//   - isMeta rows are harness bookkeeping (local-command output, caveats), not
//     input the user typed;
//   - string content is the ordinary typed-prompt shape;
//   - array content counts ONLY when it carries a text block and NO tool_result
//     block — tool_result rows arrive as user entries but are mid-turn, and a
//     row carrying both is a tool result with trailing text, not a new prompt;
//   - <system-reminder> payloads are injected context in a user-shaped row, so
//     they are excluded in either content shape.
// Iterating content unconditionally is what broke session-end-check.sh before
// v0.23.x (jq "Cannot iterate over string" → whole filter errored → hook silently
// exited 0), so both engines branch on type first.

const SYSTEM_REMINDER = '<system-reminder';

function textBlocks(content) {
  return content.filter(x => x && typeof x === 'object' && x.type === 'text');
}

/** Joined text of a user turn, or '' when the row is not one. */
export function userTurnText(row) {
  if (!isUserTurn(row)) return '';
  const c = row.message.content;
  if (typeof c === 'string') return c;
  return textBlocks(c)
    .map(x => (typeof x.text === 'string' ? x.text : ''))
    .join('\n');
}

/** True when `row` is a real typed user turn (a turn boundary). */
export function isUserTurn(row) {
  if (!row || typeof row !== 'object') return false;
  if (row.type !== 'user') return false;
  if (row.isMeta === true) return false;

  const content = row.message && row.message.content;

  if (typeof content === 'string') return !content.startsWith(SYSTEM_REMINDER);
  if (!Array.isArray(content)) return false;

  const texts = textBlocks(content);
  if (texts.length === 0) return false;
  if (content.some(x => x && typeof x === 'object' && x.type === 'tool_result')) return false;

  const joined = texts.map(x => (typeof x.text === 'string' ? x.text : '')).join('\n');
  return !joined.startsWith(SYSTEM_REMINDER);
}
