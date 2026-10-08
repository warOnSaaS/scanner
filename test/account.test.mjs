// The hosted scanner with the warOnSaaS account: look freely, sign in to scan. The account server is a
// stand-in here (same methods as WosAccount), so no test touches the network.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createApp } from '../server/app.mjs';
import { createAuth, LIMITS } from '../server/auth.mjs';
import { testService, readStream } from './helpers.mjs';

/* A pretend account.waronsaas.com. start() sends the browser to /fake-account; finish() reads the flow cookie
   back the way the real library does, then signs in whoever the test named in ?as=. */
function fakeAccount({ live = new Set(['ses_1']), limits = {} } = {}) {
  const flows = new Map();
  const hits = new Map();
  return {
    live, hits, clientSecret: 'test-secret',
    start({ next = '/', carry = null, prompt = null, provider = null, connection = null, redirectUri } = {}) {
      const id = crypto.randomBytes(8).toString('hex');
      flows.set(id, { next, carry, prompt, provider, connection, redirectUri });
      return { location: `https://account.test/oauth/authorize?flow=${id}${prompt ? '&prompt=none' : ''}${connection ? `&connection=${encodeURIComponent(connection)}` : ''}`, cookie: `wos_acct_flow=${id}; Path=/auth/waronsaas/callback; HttpOnly` };
    },
    async finish(req) {
      const q = new URL(req.url, 'http://x').searchParams;
      const id = /wos_acct_flow=([^;]+)/.exec(req.headers.cookie ?? '')?.[1];
      const flow = flows.get(id);
      const clear = 'wos_acct_flow=; Path=/auth/waronsaas/callback; Max-Age=0';
      if (!flow) return { error: 'expired', next: '/', clear };
      if (q.get('error')) return { error: q.get('error'), next: flow.next, carry: flow.carry, clear };
      const sub = q.get('as') || 'acc_sam';
      return { profile: { sub, sid: q.get('sid') || 'ses_1', name: 'Sam Example', email: `${sub}@example.test`, email_verified: true }, next: flow.next, carry: flow.carry, clear };
    },
    async isLive(sid) { return live.has(sid); },
    async verifyLogoutToken(jwt) { const m = /^logout:([^:]+)(:deleted)?$/.exec(String(jwt ?? '')); return m ? { sub: m[1], deleted: !!m[2] } : null; },
    async limit(account, bucket, max) {
      const k = `${account}:${bucket}`;
      const n = (hits.get(k) || 0) + 1; hits.set(k, n);
      const cap = limits[bucket] ?? max;
      return { ok: n <= cap, remaining: Math.max(0, cap - n), reset_at: '2026-10-07T13:00:00.000Z' };
    },
    endSessionUrl(returnTo) { return `https://account.test/oauth/end-session?post_logout_redirect_uri=${encodeURIComponent(returnTo)}`; },
    flows,
  };
}

async function hostedServer(opts = {}) {
  const account = fakeAccount(opts);
  const env = { AUTH_PROVIDER: 'waronsaas', WOS_ACCOUNT_CLIENT_ID: 'scanner', WOS_ACCOUNT_CLIENT_SECRET: 'test-secret', SESSION_SECRET: 'session-secret' };
  const auth = createAuth({ env, account, siteUrl: 'http://scanner.test' });
  const service = testService({ gate: auth.gate });
  const handle = createApp({ service, auth, baseUrl: 'http://scanner.test', serveStatic: true });
  const srv = http.createServer((req, res) => handle(req, res));
  await new Promise(ok => srv.listen(0, ok));
  const base = `http://localhost:${srv.address().port}`;
  const get = (p, headers = {}) => fetch(base + p, { redirect: 'manual', headers });
  /* Sign in through the browser routes and return our session cookie. */
  async function signIn(as = 'acc_sam', sid = 'ses_1', next = '/') {
    const go = await get(`/auth/waronsaas?next=${encodeURIComponent(next)}`);
    assert.equal(go.status, 302);
    const flow = go.headers.get('set-cookie').split(';')[0];
    const back = await get(`/auth/waronsaas/callback?state=x&as=${as}&sid=${sid}`, { cookie: flow });
    assert.equal(back.status, 302);
    assert.equal(back.headers.get('location'), next);
    const session = back.headers.getSetCookie().find(c => c.startsWith('wos_scanner=')).split(';')[0];
    return session;
  }
  return { account, auth, service, base, get, signIn, close: () => new Promise(ok => srv.close(ok)) };
}

test('signed out: every page is 200, open, and carries the prompt script saying signed-in=false', async () => {
  const s = await hostedServer();
  try {
    await s.service.run('good.test', { account: { sub: 'acc_other' } });
    for (const p of ['/', '/compare', '/report/good-test', '/report/nobody-test']) {
      const r = await s.get(p);
      assert.equal(r.status, p.includes('nobody') ? 404 : 200, p);
      const html = await r.text();
      assert.match(html, /account\.waronsaas\.com\/prompt\.js" defer data-signed-in="false" data-app="Scanner" data-signin="\/auth\/waronsaas"/, p);
      assert.match(html, /href="\/auth\/waronsaas\?next=[^"]*"[^>]*>Sign in</, p);
      assert.ok(!html.includes('acc_other'), `${p} must not show who ran the scan`);
      assert.ok(!html.includes('\u2014'), 'no em dashes');
    }
    const home = await (await s.get('/')).text();
    assert.match(home, /data-scan-form data-tool="scan_site"/);
    assert.match(home, /free account to scan/);
    assert.match(home, /href="\/\?url=waronsaas\.com" data-try data-tool="scan_site"/);
    assert.match(await (await s.get('/report/good-test')).text(), /rescan=1" data-tool="scan_site"/);
    assert.match(await (await s.get('/compare')).text(), /data-compare-form data-tool="compare_sites"/);
    assert.equal((await s.get('/')).headers.get('cache-control'), 'private, no-store', 'pages are rendered per visitor');
    assert.doesNotMatch(await (await s.get('/embed')).text(), /prompt\.js/, 'the embed has nothing to press');
  } finally { await s.close(); }
});

test('signed out: reading is open over the API, starting a scan is 401 sign_in', async () => {
  const s = await hostedServer();
  try {
    await s.service.run('good.test', { account: { sub: 'acc_other' } });
    for (const p of ['/api/report/good-test', '/api/report?url=good.test&detail=full', '/api/scan/status?url=good.test', '/api/scans', '/api/checks', '/api']) {
      const r = await s.get(p); assert.equal(r.status, 200, p);
      assert.ok(!(await r.text()).includes('acc_other'), `${p} must not include the account id`);
    }
    for (const p of ['/api/scan?url=empty.test', '/api/compare?urls=empty.test,blocked.test']) {
      const r = await s.get(p);
      assert.equal(r.status, 401, p);
      const j = await r.json();
      assert.deepEqual(j.error, { code: 'sign_in', message: 'Sign in to your warOnSaaS account' });
    }
    const post = await fetch(`${s.base}/api/scan`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: 'empty.test' }) });
    assert.equal(post.status, 401);
    const ev = await readStream(`${s.base}/api/scan/stream?url=empty.test`);
    assert.equal(ev.at(-1).event, 'fail'); assert.equal(ev.at(-1).data.code, 'sign_in');
    const cached = await s.get('/api/scan?url=good.test');
    assert.equal(cached.status, 200, 'a scan request answered from the last day\'s scan is a view, so it stays open; only a fresh scan needs the account');
    assert.equal((await cached.json()).cached, true);
    const mcp = await fetch(`${s.base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: '{}' });
    assert.equal(mcp.status, 401);
    assert.equal(mcp.headers.get('www-authenticate'), 'Bearer resource_metadata="http://scanner.test/.well-known/oauth-protected-resource"');
    assert.equal((await mcp.json()).error.code, 'sign_in');
    const manifest = await (await s.get('/api')).json();
    assert.equal(manifest.signIn.page, 'http://scanner.test/auth/waronsaas');
  } finally { await s.close(); }
});

test('sign-in: /auth/waronsaas goes to the account, the callback sets our cookie, pages and scans then work', async () => {
  const s = await hostedServer();
  try {
    const go = await s.get('/auth/waronsaas?next=/compare&provider=google&prompt=none');
    assert.equal(go.status, 302);
    assert.match(go.headers.get('location'), /^https:\/\/account\.test\/oauth\/authorize\?flow=.*prompt=none/);
    const flow = [...s.account.flows.values()].at(-1);
    assert.equal(flow.provider, 'google'); assert.equal(flow.redirectUri, 'http://scanner.test/auth/waronsaas/callback');
    assert.equal((await s.get('/auth/waronsaas?next=//evil.test')).status, 302);
    assert.equal([...s.account.flows.values()].at(-1).next, '/', 'an off-site next is dropped');

    const cookie = await s.signIn('acc_sam', 'ses_1', '/compare');
    assert.match(cookie, /^wos_scanner=/);
    const home = await (await s.get('/', { cookie })).text();
    assert.match(home, /data-signed-in="true"/);
    assert.match(home, /Sam Example/); assert.match(home, /href="\/auth\/signout"/);
    const scan = await s.get('/api/scan?url=good.test', { cookie });
    assert.equal(scan.status, 200);
    assert.equal((await scan.json()).scan.host, 'good.test');
    const rec = await s.service.get('good.test');
    assert.equal(rec.by, 'acc_sam', 'who ran the scan is kept with the report');
    assert.ok(!(await (await s.get('/report/good-test')).text()).includes('acc_sam'), 'and never shown');
    assert.ok(!JSON.stringify(await (await s.get('/api/report/good-test?detail=full')).json()).includes('acc_sam'));
    const cmp = await s.get('/api/compare?urls=good.test,empty.test', { cookie });
    assert.equal(cmp.status, 200);
    assert.equal(s.account.hits.get('acc_sam:scanner.scan'), 2, 'one hit per fresh scan (good.test came from the cache the second time)');
    assert.equal(s.account.hits.get('acc_sam:scanner.scan_day'), 2);
  } finally { await s.close(); }
});

test('the callback after a cancelled or silent try: back to the page, still signed out, still open', async () => {
  const s = await hostedServer();
  try {
    const go = await s.get('/auth/waronsaas?next=/compare&prompt=none');
    const flow = go.headers.get('set-cookie').split(';')[0];
    const back = await s.get('/auth/waronsaas/callback?state=x&error=login_required', { cookie: flow });
    assert.equal(back.status, 302); assert.equal(back.headers.get('location'), '/compare');
    assert.ok(!back.headers.getSetCookie().some(c => c.startsWith('wos_scanner=') && !c.includes('Max-Age=0')), 'no session cookie');
    const stale = await s.get('/auth/waronsaas/callback?state=x');
    assert.equal(stale.status, 302); assert.equal(stale.headers.get('location'), '/');
  } finally { await s.close(); }
});

test('per-account limits: the hour, then the day, with the reset time in plain words', async () => {
  const s = await hostedServer({ limits: { 'scanner.scan': 1 } });
  try {
    const cookie = await s.signIn();
    assert.equal((await s.get('/api/scan?url=good.test', { cookie })).status, 200);
    const r = await s.get('/api/scan?url=empty.test', { cookie });
    assert.equal(r.status, 429);
    const j = await r.json();
    assert.equal(j.error.code, 'limit');
    assert.match(j.error.message, new RegExp(`${LIMITS.hour[1]} scans this hour.*13:00 UTC`));
    const d = await hostedServer({ limits: { 'scanner.scan_day': 0 } });
    try {
      const c2 = await d.signIn();
      const rd = await d.get('/api/scan?url=good.test', { cookie: c2 });
      assert.equal(rd.status, 429);
      assert.match((await rd.json()).error.message, new RegExp(`${LIMITS.day[1]} scans today`));
    } finally { await d.close(); }
  } finally { await s.close(); }
});

test('a dead account session (sign out everywhere) signs the person out here too', async () => {
  const s = await hostedServer();
  try {
    const cookie = await s.signIn('acc_sam', 'ses_1');
    assert.match(await (await s.get('/', { cookie })).text(), /data-signed-in="true"/);
    s.account.live.delete('ses_1');
    s.auth.account.live.delete?.('ses_1');
    assert.match(await (await s.get('/', { cookie })).text(), /data-signed-in="false"/);
    assert.equal((await s.get('/api/scan?url=good.test', { cookie })).status, 401);
  } finally { await s.close(); }
});

test('the back channel: the account says sign out everywhere, and that person is out at once', async () => {
  const s = await hostedServer();
  try {
    const sam = await s.signIn('acc_sam', 'ses_1');
    await new Promise(ok => setTimeout(ok, 1100)); // the session's second must be before the logout's
    const riley = await s.signIn('acc_riley', 'ses_1');
    const bad = await fetch(`${s.base}/auth/waronsaas/backchannel`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ logout_token: 'nonsense' }) });
    assert.equal(bad.status, 200, 'always 200');
    assert.match(await (await s.get('/', { cookie: sam })).text(), /data-signed-in="true"/, 'a bad token changes nothing');
    const ok = await fetch(`${s.base}/auth/waronsaas/backchannel`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ logout_token: 'logout:acc_sam:deleted' }) });
    assert.equal(ok.status, 200);
    assert.match(await (await s.get('/', { cookie: sam })).text(), /data-signed-in="false"/, 'Sam is out, even though the account session check still says live');
    assert.equal((await s.get('/api/scan?url=good.test', { cookie: sam })).status, 401);
    assert.match(await (await s.get('/', { cookie: riley })).text(), /data-signed-in="true"/, 'Riley is untouched');
    await new Promise(ok => setTimeout(ok, 1100));
    const samAgain = await s.signIn('acc_sam', 'ses_1');
    assert.match(await (await s.get('/', { cookie: samAgain })).text(), /data-signed-in="true"/, 'a new sign-in after the logout works');
  } finally { await s.close(); }
});

test('sign out clears our cookie and goes to the account to end its session too', async () => {
  const s = await hostedServer();
  try {
    const cookie = await s.signIn();
    const r = await s.get('/auth/signout', { cookie });
    assert.equal(r.status, 302);
    assert.equal(r.headers.get('location'), 'https://account.test/oauth/end-session?post_logout_redirect_uri=http%3A%2F%2Fscanner.test%2F');
    assert.match(r.headers.get('set-cookie'), /^wos_scanner=; .*Max-Age=0/);
  } finally { await s.close(); }
});

test('MCP OAuth: discovery, registration, PKCE, the account as a connection, a token that works on /mcp', async () => {
  const s = await hostedServer();
  try {
    const meta = await (await s.get('/.well-known/oauth-protected-resource')).json();
    assert.deepEqual(meta.authorization_servers, ['http://scanner.test']);
    const as = await (await s.get('/.well-known/oauth-authorization-server')).json();
    assert.equal(as.token_endpoint, 'http://scanner.test/oauth/token');
    assert.deepEqual(as.code_challenge_methods_supported, ['S256']);

    const reg = await fetch(`${s.base}/oauth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'Claude', redirect_uris: ['https://claude.ai/api/mcp/auth_callback', 'http://evil.test/x'] }) });
    assert.equal(reg.status, 201);
    const client = await reg.json();
    assert.deepEqual(client.redirect_uris, ['https://claude.ai/api/mcp/auth_callback'], 'only https or localhost redirects');
    assert.equal(client.token_endpoint_auth_method, 'none');

    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    const authz = new URL(`${s.base}/oauth/authorize`);
    Object.entries({ client_id: client.client_id, redirect_uri: client.redirect_uris[0], response_type: 'code', state: 'st1', code_challenge: challenge, code_challenge_method: 'S256', scope: 'scan' }).forEach(([k, v]) => authz.searchParams.set(k, v));
    const go = await fetch(authz, { redirect: 'manual' });
    assert.equal(go.status, 302);
    assert.match(go.headers.get('location'), /connection=Claude%20via%20Scanner/, 'the person connects the AI app at the account, as a connection');
    const flow = go.headers.get('set-cookie').split(';')[0];
    const back = await s.get('/auth/waronsaas/callback?state=x&as=acc_riley&sid=ses_ai', { cookie: flow });
    assert.equal(back.status, 302);
    const ret = new URL(back.headers.get('location'));
    assert.equal(ret.origin + ret.pathname, 'https://claude.ai/api/mcp/auth_callback');
    assert.equal(ret.searchParams.get('state'), 'st1');
    const code = ret.searchParams.get('code'); assert.ok(code);

    const bad = await fetch(`${s.base}/oauth/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id: client.client_id, redirect_uri: client.redirect_uris[0], code_verifier: 'wrong' }) });
    assert.equal(bad.status, 400); assert.equal((await bad.json()).error, 'invalid_grant');
    const tok = await fetch(`${s.base}/oauth/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id: client.client_id, redirect_uri: client.redirect_uris[0], code_verifier: verifier }) });
    assert.equal(tok.status, 200);
    const t = await tok.json();
    assert.equal(t.token_type, 'Bearer'); assert.ok(t.access_token && t.refresh_token);

    s.account.live.add('ses_ai');
    const mcp = new Client({ name: 'oauth-test', version: '1' });
    await mcp.connect(new StreamableHTTPClientTransport(new URL(`${s.base}/mcp`), { requestInit: { headers: { authorization: `Bearer ${t.access_token}` } } }));
    const r = await mcp.callTool({ name: 'scan_site', arguments: { url: 'good.test', include_pagespeed: false } });
    assert.ok(!r.isError, r.content?.[0]?.text);
    assert.match(r.content[0].text, /good\.test: 100\/100/);
    await mcp.close();
    assert.equal((await s.service.get('good.test')).by, 'acc_riley');
    assert.equal(s.account.hits.get('acc_riley:scanner.scan'), 1);

    const fresh = await fetch(`${s.base}/oauth/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: t.refresh_token, client_id: client.client_id }) });
    assert.equal(fresh.status, 200); assert.ok((await fresh.json()).access_token);

    // The account signs the connection out: the token stops working and cannot be refreshed.
    s.account.live.delete('ses_ai');
    const dead = await fetch(`${s.base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${t.access_token}` }, body: '{}' });
    assert.equal(dead.status, 401);
    const noRefresh = await fetch(`${s.base}/oauth/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: t.refresh_token }) });
    assert.equal(noRefresh.status, 400);

    // A bearer token works on the API too, for code.
    s.account.live.add('ses_ai');
    assert.equal((await s.get('/api/scan?url=empty.test', { authorization: `Bearer ${t.access_token}` })).status, 200);
    assert.equal((await s.get('/api/scan?url=blocked.test', { authorization: 'Bearer nonsense' })).status, 401);
  } finally { await s.close(); }
});

test('open mode: without the account settings the scanner is exactly as before', async () => {
  const auth = createAuth({ env: { AUTH_PROVIDER: 'github' } });
  assert.equal(auth.mode, 'open');
  assert.equal(createAuth({ env: {} }).mode, 'open');
  assert.equal(createAuth({ env: { AUTH_PROVIDER: 'waronsaas' } }).mode, 'open', 'asked for the account but no client: runs open and says so');
  assert.equal(createAuth({ env: { WOS_ACCOUNT_CLIENT_ID: 'x', WOS_ACCOUNT_CLIENT_SECRET: 'y' } }).mode, 'waronsaas', 'a client id alone turns it on');
  assert.equal(createAuth({ env: { WOS_ACCOUNT_CLIENT_ID: 'x', WOS_ACCOUNT_CLIENT_SECRET: 'y', AUTH_PROVIDER: 'local' } }).mode, 'open', 'a self-hoster can keep it off');
});
