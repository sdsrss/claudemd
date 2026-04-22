import { readSettings, writeSettings } from './lib/settings-merge.js';

const NAME_MAP = {
  'banned-vocab': 'BANNED_VOCAB',
  'ship-baseline': 'SHIP_BASELINE',
  'residue-audit': 'RESIDUE_AUDIT',
  'memory-read-check': 'MEMORY_READ',
  'sandbox-disposal-check': 'SANDBOX_DISPOSAL',
  'session-start-check': 'SESSION_START',
};

export async function toggle(name) {
  const upper = NAME_MAP[name];
  if (!upper) throw new Error(`unknown hook: ${name}`);
  const key = `DISABLE_${upper}_HOOK`;
  const s = readSettings();
  s.env ||= {};
  let newState;
  if (s.env[key] === '1') {
    delete s.env[key];
    newState = 'enabled';
  } else {
    s.env[key] = '1';
    newState = 'disabled';
  }
  writeSettings(s);
  return { hook: name, newState };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const name = process.argv[2];
  if (!name) {
    console.error(
      'Usage: node toggle.js <hook-name>\n' +
      '  hook-name: ' + Object.keys(NAME_MAP).join(' | ')
    );
    process.exit(1);
  }
  toggle(name).then(r => console.log(JSON.stringify(r, null, 2)))
    .catch(e => { console.error(e.message); process.exit(1); });
}
