// Fails if anything in the repo has an em dash, or still names the project this was extracted from.
import fs from 'node:fs';
import path from 'node:path';
const SKIP = new Set(['node_modules', '.git', '.shots', '.vercel', 'reports', 'ui']);
// Private names (old brand, clients) live one per line in the git-ignored .names file, so they are never published.
const BANNED = [['\u2014', 'an em dash']];
try { for (const n of fs.readFileSync('.names', 'utf8').split('\n').map((l) => l.trim()).filter(Boolean)) BANNED.push([new RegExp(n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '.?'), 'i'), 'a private name']); } catch {}
const bad = [];
(function walk(dir) {
  for (const f of fs.readdirSync(dir)) {
    if (SKIP.has(f) || f === 'check-clean.mjs' || f === '.names') continue;
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) { walk(p); continue; }
    if (!/\.(mjs|js|json|css|md|txt|html|svg)$/.test(f) || f === 'package-lock.json') continue;
    const s = fs.readFileSync(p, 'utf8');
    for (const [re, what] of BANNED) if (typeof re === 'string' ? s.includes(re) : re.test(s)) bad.push(`${p}: ${what}`);
  }
})('.');
if (bad.length) { console.error(bad.join('\n')); process.exit(1); }
console.log('clean: no em dashes, no private names');
