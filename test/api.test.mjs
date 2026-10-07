import test from 'node:test';
import assert from 'node:assert/strict';
import { testServer, readStream } from './helpers.mjs';
import { limiter } from '../server/limits.mjs';

test('GET /api/scan scans, then serves the same scan from the cache', async () => {
  const s = await testServer();
  try {
    const a = await (await fetch(`${s.base}/api/scan?url=https://www.good.test/x`)).json();
    assert.equal(a.ok, true); assert.equal(a.cached, false);
    assert.equal(a.scan.grade, 100);
    assert.equal(a.scan.report, 'http://scanner.test/report/good-test');
    const b = await (await fetch(`${s.base}/api/scan?url=good.test`)).json();
    assert.equal(b.cached, true);
    const full = await (await fetch(`${s.base}/api/scan`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: 'good.test', detail: 'full' }) })).json();
    assert.equal(full.report.areas.length, 4);
    assert.match(full.report.llms, /# Good Co/);
  } finally { await s.close(); }
});

test('bad input and private addresses are refused with plain words', async () => {
  const s = await testServer();
  try {
    let r = await fetch(`${s.base}/api/scan?url=not-a-site`);
    assert.equal(r.status, 400); assert.match((await r.json()).error, /web address/);
    r = await fetch(`${s.base}/api/scan?url=internal.test`);
    assert.equal(r.status, 400); assert.match((await r.json()).error, /public website/);
    r = await fetch(`${s.base}/api/scan`);
    assert.equal(r.status, 400);
    r = await fetch(`${s.base}/api/nothing`);
    assert.equal(r.status, 404);
  } finally { await s.close(); }
});

test('rate limit: fresh scans per visitor are capped, cached ones are free', async () => {
  const s = await testServer({ limiter: limiter({ perTenMin: 2, perDay: 10 }) });
  try {
    for (const h of ['good.test', 'empty.test']) assert.equal((await fetch(`${s.base}/api/scan?url=${h}`)).status, 200);
    const r = await fetch(`${s.base}/api/scan?url=blocked.test`);
    assert.equal(r.status, 429); assert.match((await r.json()).error, /ten minutes/);
    assert.equal((await fetch(`${s.base}/api/scan?url=good.test`)).status, 200, 'a cached scan is not counted');
  } finally { await s.close(); }
});

test('re-scan: rescan=1 scans again only once the last scan is a quarter of an hour old', async () => {
  let t = Date.parse('2026-10-07T12:00:00Z');
  const s = await testServer({ now: () => t });
  try {
    const first = await (await fetch(`${s.base}/api/scan?url=good.test`)).json();
    t += 60e3;
    assert.equal((await (await fetch(`${s.base}/api/scan?url=good.test&rescan=1`)).json()).cached, true);
    t += 20 * 60e3;
    const again = await (await fetch(`${s.base}/api/scan?url=good.test&rescan=true`)).json();
    assert.equal(again.cached, false);
    assert.notEqual(again.scan.scannedAt, first.scan.scannedAt);
  } finally { await s.close(); }
});

test('the stream sends each step, each area, then done; a repeat replays from the cache', async () => {
  const s = await testServer();
  try {
    const ev = await readStream(`${s.base}/api/scan/stream?url=good.test`);
    const kinds = ev.map(e => e.event);
    assert.equal(kinds[0], 'step');
    assert.ok(ev.some(e => e.event === 'step' && e.data.k === 'psi' && e.data.state === 'ok'), 'PageSpeed step');
    assert.deepEqual(ev.filter(e => e.event === 'area').map(e => e.data.key), ['agents', 'search', 'performance', 'hygiene']);
    const done = ev.at(-1);
    assert.equal(done.event, 'done'); assert.equal(done.data.slug, 'good-test'); assert.equal(done.data.report.grade, 100);
    const again = await readStream(`${s.base}/api/scan/stream?url=good.test`);
    assert.ok(again.some(e => e.event === 'cached'));
    assert.equal(again.at(-1).data.cached, true);
    const bad = await readStream(`${s.base}/api/scan/stream?url=nope`);
    assert.equal(bad.at(-1).event, 'fail');
  } finally { await s.close(); }
});

test('without a PageSpeed key the scan still runs and says why speed is partial', async () => {
  const s = await testServer({ pagespeedKey: '' });
  try {
    const j = await (await fetch(`${s.base}/api/scan?url=good.test&detail=full`)).json();
    assert.equal(j.report.pagespeed.included, false);
    assert.match(j.report.pagespeed.reason, /No PageSpeed key/);
    assert.ok(!j.report.areas.find(a => a.key === 'performance').checks.some(c => c.label === 'Google PageSpeed, mobile'));
  } finally { await s.close(); }
});

test('reports, status, compare, recent scans and checks', async () => {
  const s = await testServer();
  try {
    assert.equal((await fetch(`${s.base}/api/report/good-test`)).status, 404);
    assert.equal((await (await fetch(`${s.base}/api/scan/status?url=good.test`)).json()).state, 'none');
    await fetch(`${s.base}/api/scan?url=good.test`);
    const rep = await (await fetch(`${s.base}/api/report/good-test`)).json();
    assert.equal(rep.scan.host, 'good.test');
    assert.equal((await (await fetch(`${s.base}/api/report?url=good.test&detail=full`)).json()).report.areas.length, 4);
    assert.equal((await (await fetch(`${s.base}/api/scan/status?url=good.test`)).json()).state, 'done');
    const cmp = await (await fetch(`${s.base}/api/compare?urls=good.test,empty.test`)).json();
    assert.equal(cmp.sites[0].host, 'good.test');
    assert.ok(cmp.differences.length > 5);
    const recent = await (await fetch(`${s.base}/api/scans`)).json();
    assert.deepEqual(recent.scans.map(x => x.host).sort(), ['empty.test', 'good.test']);
    const checks = await (await fetch(`${s.base}/api/checks`)).json();
    assert.equal(checks.checks.length, 29);
  } finally { await s.close(); }
});

test('status shows the requests of a scan while it runs', async () => {
  let release;
  const gate = new Promise(ok => { release = ok; });
  const { fakeScan } = await import('./helpers.mjs');
  const s = await testServer({ scanImpl: async (h, o) => { o.onStep({ k: 'home', label: `GET ${h}/`, state: 'ok', note: '200' }); await gate; return fakeScan(h, o); } });
  try {
    const pending = fetch(`${s.base}/api/scan?url=good.test`);
    await new Promise(ok => setTimeout(ok, 80));
    const st = await (await fetch(`${s.base}/api/scan/status?url=good.test`)).json();
    assert.equal(st.state, 'running');
    assert.equal(st.steps[0].label, 'GET good.test/');
    release();
    assert.equal((await (await pending).json()).ok, true);
  } finally { await s.close(); }
});

test('pages: home, report, compare, not found, llms.txt', async () => {
  const s = await testServer();
  try {
    const home = await (await fetch(`${s.base}/`)).text();
    assert.match(home, /Can AI assistants read your website\?/);
    assert.match(home, /data-console/);
    await fetch(`${s.base}/api/scan?url=good.test`);
    const rep = await fetch(`${s.base}/report/good-test`);
    assert.equal(rep.status, 200);
    const html = await rep.text();
    assert.match(html, /good\.test scores 100\/100/);
    assert.match(html, /og:title/);
    assert.equal((await fetch(`${s.base}/report/nobody-test`)).status, 404);
    assert.equal((await fetch(`${s.base}/compare`)).status, 200);
    assert.match(await (await fetch(`${s.base}/llms.txt`)).text(), /MCP server/);
    for (const page of [home, html]) assert.ok(!page.includes('\u2014'), 'no em dashes');
  } finally { await s.close(); }
});
