// Screenshots at desk and phone widths into .shots/ (git-ignored), to judge by eye.
//   npm run shots                 against a local server on a free port
//   npm run shots -- <base-url>   against a running deployment
// SITES (comma list) picks the sites scanned live for the mid-scan shots.
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const out = path.resolve('.shots');
fs.mkdirSync(out, { recursive: true });
let base = process.argv[2], srv;
if (!base) { const { serve } = await import('../dev.mjs'); srv = await serve(); base = `http://localhost:${srv.address().port}`; }
const [liveDesk, livePhone] = (process.env.SITES || 'example.com,example.org').split(',');
const reportSite = process.env.REPORT || 'waronsaas.com';
const slug = reportSite.replace(/[^a-z0-9]+/g, '-');

// make sure the report exists
await fetch(`${base}/api/scan?url=${reportSite}`).then(r => r.json());

const shots = [
  ['home', '/', async (p) => { await p.waitForTimeout(4200); }],
  ['scan-midway', (tag) => `/?url=${tag === 'desk' ? liveDesk : livePhone}&rescan=1`, async (p) => { await p.waitForSelector('.con-log li.s-run', { timeout: 10000 }); await p.waitForTimeout(700); }, false],
  ['scan-done', (tag) => `/?url=${reportSite}`, async (p) => { await p.waitForSelector('[data-foot]:not([hidden])', { timeout: 60000 }); await p.waitForTimeout(1300); }, false],
  ['report', `/report/${slug}`, async (p) => { await p.waitForTimeout(1500); }, true],
  ['compare', `/compare?urls=${reportSite},example.com`, async (p) => { await p.click('[data-compare-form] button'); await p.waitForSelector('.cmp-grid', { timeout: 90000 }); await p.waitForTimeout(400); }, true],
  ['embed', '/embed', async (p) => { await p.waitForTimeout(5000); }, false],
];
const browser = await chromium.launch();
const only = process.env.ONLY?.split(',');
for (const [w, h, tag] of [[1440, 900, 'desk'], [390, 844, 'phone']]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, colorScheme: 'dark' });
  for (const [name, url, act, full = true] of shots) {
    if (only && !only.includes(name)) continue;
    const p = await ctx.newPage();
    const errors = [];
    p.on('pageerror', (e) => errors.push(e.message));
    p.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await p.goto(base + (typeof url === 'function' ? url(tag) : url), { waitUntil: 'domcontentloaded' });
    await p.evaluate(() => document.fonts.ready);
    if (act) await act(p);
    const over = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    if (over > 0) console.log(`${name}-${tag}: page is ${over}px wider than the screen`);
    if (name === 'scan-midway' || name === 'scan-done') await p.locator('[data-console]').scrollIntoViewIfNeeded();
    await p.screenshot({ path: path.join(out, `${name}-${tag}.png`), fullPage: full });
    if (errors.length) console.log(`${name}-${tag}: ${errors.join(' | ')}`);
    await p.close();
  }
  await ctx.close();
}
await browser.close();
srv?.close();
console.log(`screenshots in ${out}`);
