/* Fetching other people's sites, safely and politely.

   Only public internet addresses may be scanned. A name that resolves to a private, loopback,
   link-local or cloud-metadata address is refused, and so is every redirect hop that does,
   so the scanner cannot be pointed at anything inside a network. */
import dns from 'node:dns/promises';
import net from 'node:net';

export const USER_AGENT = 'warOnSaaS-Scanner/0.1 (+https://github.com/warOnSaaS/scanner; site readiness scan)';
export const TIMEOUT = 8000;

const PRIVATE = [/^0\./, /^10\./, /^127\./, /^169\.254\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, /^19[89]\.1[89]\./, /^2(2[4-9]|[3-5]\d)\./, /^::1$/, /^::$/, /^f[cd]/i, /^fe[89ab]/i, /^::ffff:(10|127|169\.254|192\.168|172\.(1[6-9]|2\d|3[01]))\./i];
export const isPrivate = ip => PRIVATE.some(r => r.test(ip));

const dnsLookup = host => dns.lookup(host, { all: true });
const okHost = new Map();
/* lookup(host) resolves to [{ address }]. Injectable so tests never touch the network. */
export async function publicHost(host, lookup = dnsLookup) {
  if (!host || net.isIP(host)) return false;                       // names only, never raw addresses
  const cache = lookup === dnsLookup;
  if (cache && okHost.has(host)) return okHost.get(host);
  let ok = false;
  try { const all = await lookup(host); ok = all.length > 0 && all.every(a => !isPrivate(a.address)); } catch { ok = false; }
  if (cache) { okHost.set(host, ok); if (okHost.size > 5000) okHost.clear(); }
  return ok;
}

/* A GET (or HEAD) that follows up to six redirects by hand, checking every hop. */
export function makeGet({ fetchImpl = fetch, lookup = dnsLookup, userAgent = USER_AGENT, timeout = TIMEOUT } = {}) {
  return async function get(url, { method = 'GET', cap = 900_000 } = {}) {
    const c = new AbortController(); const t = setTimeout(() => c.abort(), timeout);
    const t0 = Date.now();
    try {
      let at = url, r;
      for (let hop = 0; hop < 6; hop++) {
        let h; try { h = new URL(at); } catch { return { ok: false, status: 0, ms: Date.now() - t0, error: 'bad address' }; }
        if (!/^https?:$/.test(h.protocol) || !(await publicHost(h.hostname, lookup))) return { ok: false, status: 0, ms: Date.now() - t0, error: 'not a public address' };
        r = await fetchImpl(at, { method, redirect: 'manual', signal: c.signal, headers: { 'User-Agent': userAgent, Accept: '*/*' } });
        const loc = r.status >= 300 && r.status < 400 && r.headers.get('location');
        if (!loc) break;
        at = new URL(loc, at).href;
      }
      const body = method === 'GET' ? (await r.text()).slice(0, cap) : '';
      return { ok: r.ok, status: r.status, url: at, ms: Date.now() - t0,
        type: r.headers.get('content-type') || '', headers: r.headers, body, bytes: body.length };
    } catch (e) { return { ok: false, status: 0, ms: Date.now() - t0, error: e.name === 'AbortError' ? 'timeout' : e.message }; }
    finally { clearTimeout(t); }
  };
}

/* "https://www.Example.com/about" becomes "example.com". Anything that is not a public-looking
   name comes back null. The scan reads the home page, so paths are dropped. */
export function hostOf(input) {
  let s = String(input || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/[^a-z0-9.-]/g, '');
  if (!s || !s.includes('.') || s.length > 253 || s.split('.').pop().length < 2) return null;
  if (/^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|\[)/.test(s)) return null;
  return s.replace(/^www\./, '');
}
export const slugOf = h => h.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
