// Copies the warOnSaaS Account client (one file, no dependencies) into lib/account-client.mjs.
//   node scripts/sync-account.mjs [path-to-wos-account]   (default: $WOS_ACCOUNT_DIR or ../wos-account)
// Never edit lib/account-client.mjs by hand: run this again when the account repo changes.
import fs from 'node:fs';
import path from 'node:path';

const src = path.resolve(process.argv[2] ?? process.env.WOS_ACCOUNT_DIR ?? path.join('..', 'wos-account'), 'client', 'account-client.mjs');
if (!fs.existsSync(src)) { console.error(`sync-account: no account client at ${src}. Pass the path to the account repo or set WOS_ACCOUNT_DIR.`); process.exit(1); }
const body = fs.readFileSync(src, 'utf8');
const out = path.resolve('lib', 'account-client.mjs');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, `// Copied from warOnSaaS/account client/account-client.mjs by scripts/sync-account.mjs. Do not edit here.\n${body}`);
console.log(`synced account client (${body.length} bytes) into lib/account-client.mjs`);
