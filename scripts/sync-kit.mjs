// Copies the warOnSaaS UI kit (ui-design) into public/ui, the kit's files the page serves as they are.
// It reads a git ref (default main) rather than the working tree, so unfinished work on another
// branch of the kit never ships here.
//   node scripts/sync-kit.mjs [path-to-ui-design] [ref]   (defaults: $UI_DESIGN_DIR or ../waronsaas-ui-design, main)
// Never edit public/ui by hand: what the kit lacks is built in public/app/scan.css in the kit's style.
// public/ui is git-ignored (ui-design's repo is private for now); .vercelignore still uploads it.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const kit = path.resolve(process.argv[2] ?? process.env.UI_DESIGN_DIR ?? path.join('..', 'waronsaas-ui-design'));
const ref = process.argv[3] ?? process.env.UI_DESIGN_REF ?? 'main';
const files = [
  ['src/ui.css'], ['src/tokens.css'],
  ['fonts/geist.woff2'], ['fonts/geist-mono.woff2'], ['fonts/departure-mono.woff2'],
  ['fonts/OFL-Geist.txt'], ['fonts/OFL-DepartureMono.txt'],
  ['www/logo.svg', 'logo.svg'], ['NOTICE'], ['LICENSE'],
];
const git = (...a) => execFileSync('git', ['-C', kit, ...a], { maxBuffer: 64 << 20 });
let rev;
try { rev = git('rev-parse', '--short', ref).toString().trim(); }
catch { console.error(`sync-kit: no ui-design checkout with a "${ref}" branch at ${kit}. Pass its path or set UI_DESIGN_DIR.`); process.exit(1); }

const out = path.resolve('public', 'ui');
fs.rmSync(out, { recursive: true, force: true });
let bytes = 0;
for (const [from, to = from] of files) {
  const body = git('show', `${ref}:${from}`);
  fs.mkdirSync(path.dirname(path.join(out, to)), { recursive: true });
  fs.writeFileSync(path.join(out, to), body);
  bytes += body.length;
}
fs.copyFileSync(path.join(out, 'logo.svg'), path.resolve('public', 'favicon.svg'));
fs.writeFileSync(path.join(out, 'SYNCED.txt'), `Copied from warOnSaaS/ui-design ${ref} at ${rev} by scripts/sync-kit.mjs. Do not edit.\n`);
console.log(`synced ui-design ${ref} ${rev} (${files.length} files, ${bytes} bytes) into public/ui`);
