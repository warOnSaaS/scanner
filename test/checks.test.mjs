import test from 'node:test';
import assert from 'node:assert/strict';
import { scan, readRobots, readPage, hostOf, slugOf, draftLlms } from '../src/scan.mjs';
import { CHECKS, AREA_SHARE } from '../src/checks.mjs';
import { explain, toText, compare, fixes } from '../src/report.mjs';
import { publicHost, isPrivate } from '../src/net.mjs';
import { fakeFetch, fakeLookup, fakeScan, GOOD_HOME } from './helpers.mjs';

const fail = r => Object.values(r.panels).flatMap(p => p.items.filter(i => !i.pass).map(i => i.label));

test('addresses are cleaned up, and only public names pass', async () => {
  assert.equal(hostOf('https://www.Example.com/about?x=1'), 'example.com');
  assert.equal(hostOf('localhost'), null);
  assert.equal(hostOf('192.168.1.1'), null);
  assert.equal(hostOf('nonsense'), null);
  assert.equal(slugOf('a.b-c.com'), 'a-b-c-com');
  assert.equal(isPrivate('10.1.2.3'), true);
  assert.equal(isPrivate('169.254.169.254'), true);
  assert.equal(isPrivate('93.184.216.34'), false);
  assert.equal(await publicHost('1.2.3.4'), false, 'raw addresses are refused');
  assert.equal(await publicHost('internal.test', fakeLookup), false);
  assert.equal(await publicHost('good.test', fakeLookup), true);
});

test('robots.txt: AI crawlers named, blocked and sitemaps found', () => {
  const r = readRobots('User-agent: GPTBot\nDisallow: /\n# a comment\nUser-agent: ClaudeBot\nAllow: /\nSitemap: https://x.test/s.xml');
  assert.deepEqual(r.named, ['GPTBot', 'ClaudeBot']);
  assert.deepEqual(r.blocked, ['GPTBot']);
  assert.deepEqual(r.sitemaps, ['https://x.test/s.xml']);
  assert.equal(readRobots('').found, false);
});

test('the page reader finds title, structured data, links and words', () => {
  const p = readPage(GOOD_HOME, 'https://good.test/');
  assert.equal(p.h1count, 1);
  assert.equal(p.lang, 'en');
  assert.deepEqual(p.jsonld.types, ['Organization']);
  assert.ok(p.keywords.wordCount >= 250);
  assert.ok(p.internalLinks >= 10);
  assert.equal(p.jsOnly, false);
  assert.ok(p.keywords.inTitle.length >= 2);
});

test('a well-built site passes every check and scores 100', async () => {
  const r = await fakeScan('good.test', { pagespeed: false });
  assert.deepEqual(fail(r), []);
  assert.equal(r.grade, 100);
  assert.equal(r.verdict, 'yes');
  assert.equal(r.findings.pagespeed.status, 'skipped');
});

test('a page that needs JavaScript is marked unreadable and fails the right checks', async () => {
  const r = await fakeScan('empty.test', { pagespeed: false });
  assert.equal(r.verdict, 'unreadable');
  for (const c of ['The words are in the page', 'A file assistants can read', 'Title tag', 'Language declared', 'HSTS']) assert.ok(fail(r).includes(c), c);
  assert.ok(r.grade < 40, `grade ${r.grade}`);
});

test('robots.txt blocking assistants and a fake llms.txt are both caught', async () => {
  const r = await fakeScan('blocked.test', { pagespeed: false });
  assert.equal(r.verdict, 'blocked');
  assert.ok(fail(r).includes('Assistants are allowed in'));
  assert.ok(fail(r).includes('Nothing pretending to be an answer'));
  assert.equal(r.findings.files['llms.txt'].state, 'html');
});

test('a redirect into a private network is refused', async () => {
  const r = await fakeScan('redirect.test', { pagespeed: false });
  assert.equal(r.verdict, 'unreachable');
  assert.equal(r.grade, 0);
});

test('area weights and the grade formula', async () => {
  assert.equal(Object.values(AREA_SHARE).reduce((a, b) => a + b, 0), 1);
  const r = await fakeScan('empty.test', { pagespeed: false });
  const expect = Math.round(r.panels.agents.score * 0.4 + r.panels.search.score * 0.25 + r.panels.performance.score * 0.25 + r.panels.hygiene.score * 0.1);
  assert.equal(r.grade, expect);
});

test('PageSpeed: included with a key, left out without, and the scan still finishes', async () => {
  const withKey = await fakeScan('good.test', { pagespeedKey: 'k' });
  assert.equal(withKey.findings.psi.perf, 93);
  assert.ok(withKey.panels.performance.items.some(i => i.label === 'Google PageSpeed, mobile'));
  assert.ok(withKey.panels.hygiene.items.some(i => i.label === 'Accessibility' && i.pass === true));
  const without = await fakeScan('good.test', { pagespeedKey: '' });
  assert.equal(without.findings.psi, null);
  assert.equal(without.findings.pagespeed.status, 'skipped');
  const broken = await scan('good.test', { pagespeedKey: 'k', lookup: fakeLookup, fetchImpl: (u, o) => u.includes('googleapis') ? Promise.resolve(new Response('', { status: 429 })) : fakeFetch(u, o) });
  assert.equal(broken.findings.pagespeed.status, 'failed');
  assert.match(broken.findings.pagespeed.reason, /quota/);
  assert.equal(broken.grade, 100);
});

test('every check the scan can run has a plain-English explanation', async () => {
  const r = await fakeScan('good.test', { pagespeedKey: 'k' });
  for (const p of Object.values(r.panels)) for (const i of p.items) {
    assert.ok(CHECKS[i.label]?.why && CHECKS[i.label]?.how, i.label);
  }
  assert.equal(Object.keys(CHECKS).length, 29);
});

test('the explained report: points add up, fixes are biggest first, no em dashes', async () => {
  const r = await fakeScan('empty.test', { pagespeed: false });
  const e = explain({ ...r, host: 'empty.test', slug: 'empty-test' });
  for (const a of e.areas) assert.ok(Math.abs(a.checks.reduce((n, c) => n + c.points, 0) - a.share * 100) < 0.6, a.key);
  const f = fixes(r.panels);
  assert.ok(f.every((x, i) => i === 0 || f[i - 1].points >= x.points));
  assert.match(e.summary, /real gaps/);
  const t = toText({ ...r, host: 'empty.test' });
  assert.ok(!t.includes('\u2014') && !JSON.stringify(e).includes('\u2014'));
});

test('compare finds where sites differ', async () => {
  const a = { ...(await fakeScan('good.test', { pagespeed: false })), host: 'good.test' };
  const b = { ...(await fakeScan('empty.test', { pagespeed: false })), host: 'empty.test' };
  const c = compare([b, a]);
  assert.equal(c.ranked[0].host, 'good.test');
  assert.ok(c.differences.some(d => d.check === 'Title tag' && d.passes.includes('good.test') && d.fails.includes('empty.test')));
});

test('the llms.txt draft uses only what the page publishes', async () => {
  const r = await fakeScan('good.test', { pagespeed: false });
  const d = draftLlms('good.test', r.findings);
  assert.match(d, /^# Good Co/);
  assert.match(d, /Email: hello@good.test/);
  assert.match(d, /\[Page number 0\]\(https:\/\/good.test\/page-0\)/);
});
