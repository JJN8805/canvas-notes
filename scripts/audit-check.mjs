// Checks the shipped npm dependencies for known vulnerabilities and fails only on ones that are not accepted below.
// `npm run audit:deps`. (The Rust side: `cargo install cargo-audit`, then `cd src-tauri && cargo audit`; the weekly workflow runs both.)
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

// Accepted for now. Every entry says why and when to look again; a lapsed date makes this script fail so it cannot be forgotten.
const ACCEPTED_UNTIL = '2027-02-14';
const ACCEPTED_REASON =
  'All of these come in through @excalidraw/excalidraw (its Mermaid import, lodash-es, nanoid). They only run on text the user pastes into the drawing tool, offline. The fix is a breaking downgrade of Excalidraw; look again when Excalidraw is upgraded.';
const ACCEPTED = new Set([
  '@chevrotain/cst-dts-gen', '@chevrotain/gast', '@excalidraw/excalidraw', '@excalidraw/mermaid-to-excalidraw', '@mermaid-js/parser',
  'chevrotain', 'chevrotain-allstar', 'katex', 'langium', 'lodash-es', 'mermaid', 'nanoid',
]);

const r = spawnSync('npm', ['audit', '--omit=dev', '--json'], { encoding: 'utf8', shell: process.platform === 'win32' });
let report;
try {
  report = JSON.parse(r.stdout);
} catch {
  console.error('Could not read the npm audit result (no network?).\n' + (r.stderr || r.stdout).slice(0, 500));
  process.exit(2);
}
const found = Object.entries(report.vulnerabilities ?? {});
const fresh = found.filter(([name, v]) => !ACCEPTED.has(name) && ['moderate', 'high', 'critical'].includes(v.severity));
const lapsed = new Date().toISOString().slice(0, 10) > ACCEPTED_UNTIL;
console.log(`${found.length} advisories in shipped packages; ${found.length - fresh.length} accepted (until ${ACCEPTED_UNTIL}).`);
for (const [name, v] of fresh) console.error(`NEW  ${v.severity.padEnd(8)} ${name} ${v.range}`);
if (lapsed) console.error(`The acceptance lapsed on ${ACCEPTED_UNTIL}. Re-read: ${ACCEPTED_REASON}`);

// The Rust side's accepted advisories (src-tauri/.cargo/audit.toml) carry a review date too.
const rustFile = new URL('../src-tauri/.cargo/audit.toml', import.meta.url);
let rustLapsed = false;
if (existsSync(rustFile)) {
  const by = /review-by:\s*(\d{4}-\d{2}-\d{2})/.exec(readFileSync(rustFile, 'utf8'))?.[1];
  if (!by) {
    console.error('src-tauri/.cargo/audit.toml has no "review-by: YYYY-MM-DD" line.');
    rustLapsed = true;
  } else if (new Date().toISOString().slice(0, 10) > by) {
    console.error(`The Rust advisories accepted in src-tauri/.cargo/audit.toml were due for review on ${by}. Upgrade, or read them again and set a new date.`);
    rustLapsed = true;
  }
}
process.exit(fresh.length || lapsed || rustLapsed ? 1 : 0);
