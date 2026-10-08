// Proves the account switch end to end, by rendering: signed out everything is open and a press on Scan shows
// the sign-in prompt; signed in (a throwaway inbox at the account) the scan runs. Screenshots go to .shots/account-*.png.
//   node scripts/verify-account.mjs [base-url]          default https://scanner.waronsaas.com
//   SKIP_SIGNIN=1 node scripts/verify-account.mjs ...   only the signed-out half
// The test account is deleted at the end. Never emails a real person.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { chromium } from 'playwright';
import { Mailbox } from '../../wos-account/scripts/mailbox.mjs';

const base = (process.argv[2] || 'https://scanner.waronsaas.com').replace(/\/$/, '');
const ACCOUNT = process.env.WOS_ACCOUNT_URL || 'https://account.waronsaas.com';
const out = path.resolve('.shots');
fs.mkdirSync(out, { recursive: true });
const SITE = process.env.SITE || 'example.com';
const problems = [];
const note = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) problems.push(what); };
const shot = (p, name, full = false) => p.screenshot({ path: path.join(out, `account-${name}.png`), fullPage: full });
const LINK = /https:\/\/\S+\/auth\/email\/verify\?t=[^\s)>.,]+/g;
/* The inbox keeps every email, and Mailbox.waitFor returns the first match, so look for a link that is not `seen`. */
async function newLink(box, seen, timeoutMs = 120_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const list = await fetch(`${Mailbox.API}/messages`, { headers: { authorization: `Bearer ${box.token}` } }).then(r => r.json());
    for (const m of list['hydra:member'] ?? []) {
      const full = await fetch(`${Mailbox.API}/messages/${m.id}`, { headers: { authorization: `Bearer ${box.token}` } }).then(r => r.json());
      const l = (`${full.text ?? ''}`.match(LINK) || []).find(x => x !== seen);
      if (l) return l;
    }
    await new Promise(r => setTimeout(r, 3000));
  }
  return null;
}

const browser = await chromium.launch({ args: ['--mute-audio'] });
const sizes = [[1440, 900, 'desk'], [390, 844, 'phone']];

// ---- signed out ----
for (const [w, h, tag] of sizes) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, colorScheme: 'dark' });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', e => errors.push(e.message));
  p.on('console', m => m.type() === 'error' && errors.push(m.text()));
  const r = await p.goto(`${base}/`, { waitUntil: 'networkidle' });
  note(r.status() === 200, `${tag}: home is 200 signed out`);
  note(await p.locator('script[data-signin]').getAttribute('data-signed-in') === 'false', `${tag}: prompt script says signed out`);
  note(await p.locator('.nav-acct', { hasText: 'Sign in' }).isVisible(), `${tag}: Sign in link in the header`);
  await p.waitForTimeout(3500);
  await shot(p, `home-out-${tag}`, true);
  await p.fill('.hero [data-scan-form] input', SITE);
  await p.click('.hero [data-scan-form] button');
  const dialog = p.locator('.wos-ap');
  await dialog.waitFor({ timeout: 5000 }).catch(() => {});
  note(await dialog.isVisible(), `${tag}: pressing Scan while signed out shows the prompt`);
  note((await p.locator('.wos-ap h2').textContent().catch(() => '')).includes('Sign in to run a scan'), `${tag}: prompt names the action`);
  note(p.url().includes(`url=${SITE}`), `${tag}: the typed address rides in the URL for after sign-in`);
  await shot(p, `prompt-${tag}`);
  await p.keyboard.press('Escape');
  // reports and compare stay open (any report this copy already has)
  const recent = await (await ctx.request.get(`${base}/api/scans?limit=1`)).json();
  const slug = recent.scans?.[0]?.slug || 'waronsaas-com';
  const rep = await p.goto(`${base}/report/${slug}`, { waitUntil: 'domcontentloaded' });
  note(rep.status() === 200, `${tag}: a report page (/report/${slug}) is 200 signed out`);
  note(!(await p.content()).includes('acc_'), `${tag}: no account id on the report page`);
  if (tag === 'desk') await shot(p, 'report-out-desk', true);
  const cmp = await p.goto(`${base}/compare`, { waitUntil: 'domcontentloaded' });
  note(cmp.status() === 200, `${tag}: compare is 200 signed out`);
  const api = await ctx.request.get(`${base}/api/scan?url=nobody-has-scanned-this-${Date.now()}.example`);
  const j = await api.json().catch(() => ({}));
  note(api.status() === 401 && j.error?.code === 'sign_in', `${tag}: API fresh scan without a session is 401 sign_in`);
  const mcp = await ctx.request.post(`${base}/mcp`, { headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, data: '{}' });
  note(mcp.status() === 401 && /resource_metadata/.test(mcp.headers()['www-authenticate'] || ''), `${tag}: /mcp without a token is 401 with the OAuth challenge`);
  if (errors.length) console.log(`${tag}: page errors: ${errors.join(' | ')}`);
  await ctx.close();
}

// ---- signed in ----
if (!process.env.SKIP_SIGNIN) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: 'dark' });
  const p = await ctx.newPage();
  const box = await Mailbox.create();
  console.log(`mailbox ${box.address.replace(/^[^@]+/, 'wos-test-...')}`);
  const sent = await ctx.request.post(`${ACCOUNT}/auth/email`, { form: { email: box.address, next: '/' } });
  note(sent.status() === 200, 'asked the account for a sign-in link');
  const mail = await box.waitFor(/Sign in|sign-in link/i);
  const link = (mail.text.match(/https:\/\/\S+\/auth\/email\/verify\?t=\S+/) || [])[0]?.replace(/[)>.,]+$/, '');
  note(!!link, 'the email has the sign-in link');
  await p.goto(link, { waitUntil: 'domcontentloaded' });
  await p.getByRole('button', { name: /continue|sign in/i }).first().click();
  await p.waitForLoadState('networkidle');
  note(new URL(p.url()).hostname === new URL(ACCOUNT).hostname, 'signed in at the account');

  // The app, in the same browser: it should sign in by itself (the hint cookie), with no clicks.
  const sameSite = new URL(base).hostname.endsWith('waronsaas.com');
  await p.goto(`${base}/`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(1500);
  let signedIn = (await p.locator('script[data-signin]').getAttribute('data-signed-in')) === 'true';
  if (sameSite) note(signedIn, 'the scanner signed in silently, no clicks');
  else {
    console.log('info localhost cannot see the .waronsaas.com hint cookie, so this presses Sign in');
    await p.click('.nav-acct:has-text("Sign in")');
    await p.waitForLoadState('networkidle');
    signedIn = (await p.locator('script[data-signin]').getAttribute('data-signed-in')) === 'true';
    note(signedIn, 'the scanner signed in through the account (already signed in there, so no second prompt)');
  }
  note(await p.locator('.nav-acct', { hasText: 'Sign out' }).isVisible(), 'Sign out in the header');
  await p.waitForTimeout(2500);
  await shot(p, 'home-in-desk', true);

  // An action works: run a scan and wait for the report footer.
  await p.fill('.hero [data-scan-form] input', SITE);
  await p.click('.hero [data-scan-form] button');
  note(!(await p.locator('.wos-ap').isVisible()), 'no prompt when signed in');
  await p.waitForSelector('[data-foot]:not([hidden])', { timeout: 90000 }).catch(() => {});
  const grade = await p.locator('[data-grade]').textContent();
  note(/^\d+$/.test(grade) && grade !== '00', `the scan ran signed in (${SITE} scored ${grade})`);
  await p.locator('[data-console]').scrollIntoViewIfNeeded();
  await shot(p, 'scan-in-desk');
  const me = await ctx.request.get(`${base}/api/scan?url=${SITE}`);
  note(me.status() === 200, 'API scan with the session cookie is 200');

  await p.setViewportSize({ width: 390, height: 844 });
  await p.goto(`${base}/`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(2500);
  note((await p.locator('script[data-signin]').getAttribute('data-signed-in')) === 'true', 'phone: still signed in');
  await shot(p, 'home-in-phone', true);

  // Sign out goes through the account's end-session and comes back signed out.
  await p.setViewportSize({ width: 1440, height: 900 });
  await p.goto(`${base}/`, { waitUntil: 'networkidle' });
  await p.click('.nav-acct:has-text("Sign out")');
  await p.waitForLoadState('networkidle');
  const cameBack = p.url().startsWith(base);
  if (sameSite) note(cameBack, `Sign out came back to the scanner (landed on ${p.url()})`);
  else console.log(`info after Sign out the account sent the browser to ${p.url()} (localhost is not a registered post-logout address)`);
  if (!cameBack) await p.goto(`${base}/`, { waitUntil: 'networkidle' });
  note((await p.locator('script[data-signin]').getAttribute('data-signed-in')) === 'false', 'Sign out leaves the scanner signed out');
  note(await p.locator('.nav-acct', { hasText: 'Sign in' }).isVisible(), 'and the header offers Sign in again');

  // Sign in once more (a fresh link), so the account can be deleted, and so deleting it can be seen to reach the scanner.
  const again = await ctx.request.post(`${ACCOUNT}/auth/email`, { form: { email: box.address, next: '/' } });
  note(again.status() === 200, 'asked for a second sign-in link');
  const l2 = await newLink(box, link);
  note(!!l2, 'the second email has a new link');
  await p.goto(l2, { waitUntil: 'domcontentloaded' });
  await p.getByRole('button', { name: /continue|sign in/i }).first().click();
  await p.waitForLoadState('networkidle');
  await p.goto(`${base}/`, { waitUntil: 'networkidle' });
  if (!sameSite) { await p.click('.nav-acct:has-text("Sign in")'); await p.waitForLoadState('networkidle'); }
  await p.waitForTimeout(1000);
  note((await p.locator('script[data-signin]').getAttribute('data-signed-in')) === 'true', 'signed in again');

  // Clean up: delete the test account. Its sessions die with it, so the scanner's cookie must stop working
  // too (isLive caches a minute, so allow up to that).
  const del = await ctx.request.post(`${ACCOUNT}/api/tools/account.delete`, { headers: { 'x-wos-call': '1', 'content-type': 'application/json' }, data: { confirm: 'delete' } });
  note(del.ok(), `deleted the test account (${del.status()})`);
  let out2 = false;
  for (let i = 0; i < 14 && !out2; i++) {
    await p.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
    out2 = (await p.locator('script[data-signin]').getAttribute('data-signed-in')) === 'false';
    if (!out2) await p.waitForTimeout(5000);
  }
  note(out2, 'a dead account session signs the scanner out too (sign out everywhere reaches the app)');
  await ctx.close();
}

await browser.close();
console.log(`screenshots in ${out}`);
if (problems.length) { console.error(`\n${problems.length} problem(s):\n- ${problems.join('\n- ')}`); process.exit(1); }
