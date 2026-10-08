/* Sign-in for the hosted scanner: "look freely, sign in to scan".

   Every page, report and share link is open to anyone. Starting a scan needs a free warOnSaaS
   account (account.waronsaas.com), and scans are counted per account there, so one person gets
   the same allowance from the web page, the API and every AI app.

   Two ways in, both carrying the account id (sub) and the account session (sid):
     browser  GET /auth/waronsaas -> the account -> GET /auth/waronsaas/callback -> our own cookie
     AI apps  the usual MCP OAuth (discovery, registration, PKCE) at /oauth/*; where the person would
              sign in we send them to the account as a connection ("Claude via Scanner"), then issue
              our own bearer tokens to the app. Codes, client ids and tokens are sealed, not stored.
   account.isLive(sid) is asked (cached a minute) whenever a cookie or token is read, so "sign out
   everywhere" on the account reaches the scanner. The account also POSTs /auth/waronsaas/backchannel the
   moment someone signs out everywhere or deletes their account; that ends their sessions on this
   instance at once (the scanner keeps no table of sessions, so other instances catch up through isLive).

   Self-hosted copies: AUTH_PROVIDER=github or local (or no WOS_ACCOUNT_CLIENT_ID) leaves the scanner
   as it always was, open with per-visitor limits; the scanner never had a sign-in of its own. */
import crypto from 'node:crypto';
import { WosAccount, authProvider } from '../lib/account-client.mjs';

export const APP = 'Scanner';
export const SIGN_IN = { code: 'sign_in', message: 'Sign in to your warOnSaaS account' };
export const LIMITS = { hour: ['scanner.scan', 20, 3600], day: ['scanner.scan_day', 100, 86400] };
const COOKIE = 'wos_scanner';
const DAY = 86400;
const now = () => Math.floor(Date.now() / 1000);
const b64u = b => Buffer.from(b).toString('base64url');
const safeNext = n => (typeof n === 'string' && n.startsWith('/') && !n.startsWith('//') ? n : '/');
const okRedirect = uri => { try { const u = new URL(uri); return u.protocol === 'https:' || (u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)); } catch { return false; } };
const when = iso => { const d = new Date(iso); return isNaN(d) ? 'the top of the hour' : `${d.toISOString().slice(11, 16)} UTC${d.toISOString().slice(0, 10) === new Date().toISOString().slice(0, 10) ? '' : ` on ${d.toISOString().slice(0, 10)}`}`; };

/* Sealed blobs: AES-256-GCM with a key from the session secret. Nothing here needs a database. */
function sealer(secret) {
  const key = crypto.createHash('sha256').update(`wos-scanner:${secret}`).digest();
  return {
    seal(obj) { const iv = crypto.randomBytes(12); const c = crypto.createCipheriv('aes-256-gcm', key, iv); const out = Buffer.concat([c.update(JSON.stringify(obj)), c.final()]); return [iv, c.getAuthTag(), out].map(b64u).join('.'); },
    open(s, kind) {
      try {
        const [iv, tag, out] = String(s).split('.').map(x => Buffer.from(x, 'base64url'));
        const d = crypto.createDecipheriv('aes-256-gcm', key, iv); d.setAuthTag(tag);
        const o = JSON.parse(Buffer.concat([d.update(out), d.final()]).toString());
        return o.k === kind && (!o.exp || o.exp >= now()) ? o : null;
      } catch { return null; }
    },
  };
}

async function readBody(req) {
  if (req.body !== undefined) return typeof req.body === 'string' ? parse(req.body, req.headers['content-type']) : req.body;
  let s = ''; for await (const c of req) { s += c; if (s.length > 1e6) break; }
  return parse(s, req.headers['content-type']);
}
const parse = (s, type = '') => { if (!s) return {}; if (/json/.test(type)) { try { return JSON.parse(s); } catch { return {}; } } return Object.fromEntries(new URLSearchParams(s)); };
const cookieOf = (req, name) => new RegExp(`(?:^|;\\s*)${name}=([^;]+)`).exec(req.headers.cookie ?? '')?.[1];

/* The open scanner: no sign-in, scans counted per visitor address, as it always was. */
export function openAuth() {
  return {
    mode: 'open', app: APP,
    async session() { return null; },
    async bearer() { return null; },
    async who() { return null; },
    async routes() { return false; },
    async gate({ ip, limiter }) { const blocked = limiter.check(ip); return blocked ? { status: 429, message: blocked } : null; },
    challenge: null,
  };
}

/* The hosted scanner. account: a WosAccount (or a stand-in with the same methods, for tests). */
export function createAuth({ env = process.env, account, siteUrl = env.SITE_URL || 'https://scanner.waronsaas.com' } = {}) {
  if (authProvider(env) !== 'waronsaas') return openAuth();
  account ??= WosAccount.fromEnv(env, { redirectUri: `${siteUrl.replace(/\/$/, '')}/auth/waronsaas/callback`, secret: env.SESSION_SECRET });
  if (!account) { console.error('[auth] AUTH_PROVIDER=waronsaas but WOS_ACCOUNT_CLIENT_ID and WOS_ACCOUNT_CLIENT_SECRET are not set; the scanner runs open.'); return openAuth(); }
  const { seal, open } = sealer(env.SESSION_SECRET || env.WOS_ACCOUNT_CLIENT_SECRET || account.clientSecret || 'dev');
  const secure = origin => origin.startsWith('https:');
  const redirectUri = origin => `${origin}/auth/waronsaas/callback`;
  const json = (res, status, data, extra = {}) => res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'access-control-allow-origin': '*', ...extra }).end(JSON.stringify(data));
  const redirect = (res, location, cookies = []) => res.writeHead(302, { location, 'cache-control': 'no-store', ...(cookies.length && { 'set-cookie': cookies }) }).end();
  const person = p => ({ sub: p.sub, sid: p.sid, name: p.name || p.github_login || p.email || '', email: p.email || '' });
  const cookie = (value, origin, maxAge = 30 * DAY) => `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure(origin) ? '; Secure' : ''}`;
  // Accounts the back channel told us about: sub -> when. Anything issued before then is dead.
  const ended = new Map();
  const alive = async raw => {
    if (!raw || (ended.get(raw.sub) ?? 0) > (raw.iat ?? 0)) return null;
    return (await account.isLive(raw.sid)) ? person(raw) : null;
  };
  const tokens = (who, cid) => ({
    access_token: seal({ k: 'access', ...who, cid, iat: now(), exp: now() + 30 * DAY }),
    refresh_token: seal({ k: 'refresh', ...who, cid, iat: now(), exp: now() + 365 * DAY }),
    token_type: 'Bearer', expires_in: 30 * DAY, scope: 'scan',
  });

  const auth = {
    mode: 'waronsaas', app: APP, account,
    challenge: origin => `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"`,

    /* The browser's session, from our cookie: { sub, sid, name, email } or null. */
    async session(req) {
      const raw = cookieOf(req, COOKIE);
      return alive(raw ? open(raw, 'session') : null);
    },
    /* An AI app's or a script's session, from a bearer token we issued. */
    async bearer(req) {
      const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? '');
      return alive(m ? open(m[1].trim(), 'access') : null);
    },
    /* Either, for the API routes: a cookie from the page, or a token from code. */
    async who(req) { return (await auth.bearer(req)) || (await auth.session(req)); },

    /* Before a fresh scan: a signed-in account, under its hourly and daily allowance; the visitor
       limits stay as a backstop against abuse. null means go ahead. */
    async gate({ ip, account: who, limiter }) {
      if (!who) return { status: 401, ...SIGN_IN };
      const hour = await account.limit(who.sub, ...LIMITS.hour);
      if (!hour.ok) return { status: 429, code: 'limit', message: `That is ${LIMITS.hour[1]} scans this hour for your account. More at ${when(hour.reset_at)}.` };
      const day = await account.limit(who.sub, ...LIMITS.day);
      if (!day.ok) return { status: 429, code: 'limit', message: `That is ${LIMITS.day[1]} scans today for your account. More at ${when(day.reset_at)}.` };
      const blocked = limiter.check(ip);
      return blocked ? { status: 429, code: 'limit', message: blocked } : null;
    },

    /* The sign-in and OAuth routes. True when the request was one of them. */
    async routes(req, res, p, q, origin) {
      if (p === '/auth/waronsaas') {
        const { location, cookie: flow } = account.start({ next: safeNext(q.get('next')), prompt: q.get('prompt') === 'none' ? 'none' : null,
          provider: ['github', 'google'].includes(q.get('provider')) ? q.get('provider') : null, redirectUri: redirectUri(origin), secure: secure(origin) });
        return redirect(res, location, [flow]), true;
      }
      if (p === '/auth/waronsaas/callback') {
        const r = await account.finish(req);
        const mcp = r.carry?.mcp;
        if (mcp) {
          // An AI app's sign-in: hand it a code (or the refusal) at its own redirect address.
          const back = new URL(mcp.ru);
          if (mcp.s) back.searchParams.set('state', mcp.s);
          if (r.error) back.searchParams.set('error', r.error === 'login_required' ? 'login_required' : 'access_denied');
          else back.searchParams.set('code', seal({ k: 'code', ...person(r.profile), cid: mcp.c, ru: mcp.ru, cc: mcp.cc, exp: now() + 300 }));
          return redirect(res, back.toString(), [r.clear]), true;
        }
        if (r.error) return redirect(res, safeNext(r.next), [r.clear]), true;
        // The scanner keeps no table of people: the account id is the person, carried in our cookie.
        return redirect(res, safeNext(r.next), [r.clear, cookie(seal({ k: 'session', ...person(r.profile), iat: now(), exp: now() + 30 * DAY }), origin)]), true;
      }
      if (p === '/auth/signout') {
        return redirect(res, account.endSessionUrl(origin + '/'), [cookie('', origin, 0)]), true;
      }
      if (p === '/auth/waronsaas/backchannel') {
        // The account says someone signed out everywhere or deleted their account. Always 200.
        if (req.method !== 'POST') return json(res, 405, { ok: false }), true;
        const b = await readBody(req);
        const hit = account.verifyLogoutToken ? await account.verifyLogoutToken(b.logout_token).catch(() => null) : null;
        if (hit?.sub) ended.set(hit.sub, now());
        if (ended.size > 5000) ended.delete(ended.keys().next().value);
        return json(res, 200, { ok: true }), true;
      }

      // ---- MCP OAuth: the scanner is the authorization server AI apps talk to ----
      if (p.startsWith('/.well-known/oauth-protected-resource')) {
        return json(res, 200, { resource: `${origin}/mcp`, authorization_servers: [origin], bearer_methods_supported: ['header'], scopes_supported: ['scan'], resource_name: 'warOnSaaS Scanner' }, { 'cache-control': 'public, max-age=300' }), true;
      }
      if (p === '/.well-known/oauth-authorization-server' || p === '/.well-known/openid-configuration') {
        return json(res, 200, { issuer: origin, authorization_endpoint: `${origin}/oauth/authorize`, token_endpoint: `${origin}/oauth/token`, registration_endpoint: `${origin}/oauth/register`,
          response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'], code_challenge_methods_supported: ['S256'],
          token_endpoint_auth_methods_supported: ['none'], scopes_supported: ['scan'] }, { 'cache-control': 'public, max-age=300' }), true;
      }
      if (p === '/oauth/register') {
        if (req.method !== 'POST') return json(res, 405, { error: 'invalid_request' }), true;
        const b = await readBody(req);
        const uris = Array.isArray(b.redirect_uris) ? b.redirect_uris.filter(okRedirect) : [];
        if (!uris.length) return json(res, 400, { error: 'invalid_redirect_uri', error_description: 'redirect_uris must be https, or http on localhost.' }), true;
        const name = String(b.client_name ?? '').slice(0, 80);
        const client_id = seal({ k: 'client', r: uris, n: name });
        return json(res, 201, { client_id, client_name: name, redirect_uris: uris, grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none', client_id_issued_at: now() }), true;
      }
      if (p === '/oauth/authorize') {
        const c = open(q.get('client_id'), 'client');
        const ru = q.get('redirect_uri');
        if (!c || !c.r.includes(ru)) return json(res, 400, { error: 'invalid_client', error_description: 'This sign-in link is not valid. Start again from your app.' }), true;
        const back = new URL(ru);
        if (q.get('state')) back.searchParams.set('state', q.get('state'));
        const refuse = (error, error_description) => { back.searchParams.set('error', error); back.searchParams.set('error_description', error_description); return redirect(res, back.toString()), true; };
        if (q.get('response_type') !== 'code') return refuse('unsupported_response_type', 'Only response_type=code is supported.');
        if (!q.get('code_challenge') || (q.get('code_challenge_method') || 'S256') !== 'S256') return refuse('invalid_request', 'PKCE with S256 is required.');
        const { location, cookie: flow } = account.start({ next: '/', carry: { mcp: { c: q.get('client_id'), ru, s: q.get('state') || '', cc: q.get('code_challenge') } },
          connection: `${c.n || 'An AI app'} via ${APP}`, redirectUri: redirectUri(origin), secure: secure(origin) });
        return redirect(res, location, [flow]), true;
      }
      if (p === '/oauth/token') {
        if (req.method !== 'POST') return json(res, 405, { error: 'invalid_request' }), true;
        const b = await readBody(req);
        if (b.grant_type === 'authorization_code') {
          const code = open(b.code, 'code');
          if (!code) return json(res, 400, { error: 'invalid_grant', error_description: 'That code has expired or is not valid.' }), true;
          if (b.client_id && b.client_id !== code.cid) return json(res, 400, { error: 'invalid_client' }), true;
          if (b.redirect_uri && b.redirect_uri !== code.ru) return json(res, 400, { error: 'invalid_grant', error_description: 'redirect_uri does not match.' }), true;
          if (!b.code_verifier || b64u(crypto.createHash('sha256').update(b.code_verifier).digest()) !== code.cc) return json(res, 400, { error: 'invalid_grant', error_description: 'PKCE verification failed.' }), true;
          return json(res, 200, tokens(person(code), code.cid)), true;
        }
        if (b.grant_type === 'refresh_token') {
          const t = open(b.refresh_token, 'refresh');
          if (!t || (b.client_id && b.client_id !== t.cid)) return json(res, 400, { error: 'invalid_grant' }), true;
          if (!(await account.isLive(t.sid))) return json(res, 400, { error: 'invalid_grant', error_description: 'That connection was signed out. Connect again.' }), true;
          return json(res, 200, tokens(person(t), t.cid)), true;
        }
        return json(res, 400, { error: 'unsupported_grant_type' }), true;
      }
      return false;
    },
  };
  return auth;
}

/* What the pages need to know: are we signed in, and where do sign in and sign out go. */
export function authView(auth, who, path = '/') {
  if (auth.mode !== 'waronsaas') return { mode: 'open', signedIn: false, name: '', signInUrl: '', signOutUrl: '' };
  return { mode: 'waronsaas', signedIn: !!who, name: who?.name || '', signInUrl: `/auth/waronsaas?next=${encodeURIComponent(safeNext(path))}`, signOutUrl: '/auth/signout' };
}
