/* The scanner as a service: cache, limits, the public-address check, the scan, progress and storage.
   ops.mjs is the only caller: the web pages (through the API), the API and the MCP tools all go
   through it, so they share one cache, one set of limits and one answer. */
import { scan as scanSite, draftLlms } from '../src/scan.mjs';
import { hostOf, slugOf, publicHost } from '../src/net.mjs';
import { limiter as makeLimiter } from './limits.mjs';
import { memoryStore } from './store.mjs';

/* code: 'sign_in' or 'limit' when the API should answer { error: { code, message } } rather than a plain string. */
export class ScanError extends Error {
  constructor(status, message, code = null) { super(message); this.status = status; if (code) this.code = code; }
}

/* The default gate before a fresh scan: the per-visitor limits. The hosted scanner swaps in the
   account gate from auth.mjs (a signed-in account, its allowance, then these as a backstop). */
export const visitorGate = async ({ ip, limiter }) => { const blocked = limiter.check(ip); return blocked ? { status: 429, message: blocked } : null; };

/* A re-scan inside this window is answered from the scan just made: nobody's site gets fetched
   over and over by someone pressing the button. */
export const RESCAN_AFTER_MS = 15 * 60e3;

export function createService({
  store = memoryStore(), limiter = makeLimiter(), scanImpl = scanSite, isPublic = publicHost,
  pagespeedKey = process.env.PAGESPEED_KEY || '', ttlMs = 24 * 3600e3, now = () => Date.now(), gate = visitorGate,
} = {}) {
  const running = new Map();   // slug -> { job, steps, startedAt, host, listeners }

  const ageOf = rec => now() - new Date(rec.scannedAt).getTime();
  const fresh = (rec, wantPsi) => {
    if (!rec) return false;
    if (ageOf(rec) > (rec.verdict === 'unreachable' ? 10 * 60e3 : ttlMs)) return false;
    // A scan without PageSpeed does not answer a request for one, unless PageSpeed already failed on it.
    return !wantPsi || !!rec.findings?.psi || rec.findings?.pagespeed?.status === 'failed';
  };
  const slugFor = input => { const h = hostOf(input); return h ? slugOf(h) : String(input || '').toLowerCase().replace(/[^a-z0-9-]/g, ''); };

  async function get(input) { const slug = slugFor(input); return slug ? store.get(slug) : null; }

  /* run('example.com', { ip, account, pagespeed, onStep, force }) resolves to { report, cached }.
     force asks for a new scan even when there is one from the last day (a re-scan).
     account: who is asking ({ sub, ... }) on the hosted scanner; kept with the report, never shown. */
  async function run(input, { ip = '', account = null, pagespeed = true, onStep = () => {}, force = false } = {}) {
    const host = hostOf(input);
    if (!host) throw new ScanError(400, 'That does not look like a web address. Try example.com.');
    const slug = slugOf(host);
    const wantPsi = pagespeed !== false && !!pagespeedKey;

    const cached = await store.get(slug);
    if (fresh(cached, wantPsi) && (!force || ageOf(cached) < RESCAN_AFTER_MS)) return { report: cached, cached: true };
    const on = running.get(slug);
    if (on) { on.listeners.add(onStep); try { return { report: await on.job, cached: false }; } finally { on.listeners.delete(onStep); } }

    const no = await gate({ ip, account, limiter });
    if (no) throw new ScanError(no.status, no.message, no.code);
    if (!(await isPublic(host)) && !(await isPublic('www.' + host))) throw new ScanError(400, 'That address does not point to a public website.');
    limiter.take(ip);

    const usePsi = wantPsi && limiter.pagespeed();
    const t0 = now();
    const state = { host, steps: [], startedAt: new Date(t0).toISOString(), listeners: new Set([onStep]) };
    state.job = (async () => {
      const r = await scanImpl(host, {
        pagespeed: usePsi ? true : (!pagespeedKey && pagespeed !== false ? 'auto' : false), pagespeedKey,
        onStep: s => { state.steps.push({ ...s, t: now() - t0 }); for (const l of state.listeners) { try { l(s); } catch {} } },
      });
      if (wantPsi && !usePsi) r.findings.pagespeed = { status: 'skipped', reason: 'The scanner has used its Google PageSpeed allowance for today, so the speed test was left out.' };
      const rec = { slug, host, scannedAt: new Date(now()).toISOString(), verdict: r.verdict, grade: r.grade,
        panels: r.panels, findings: r.findings, llms: r.verdict === 'unreachable' ? null : draftLlms(host, r.findings), steps: state.steps,
        ...(account?.sub && { by: account.sub }) };
      try { return await store.put(rec); } catch (e) { console.error('[store] write', slug, e.message); return rec; }
    })();
    running.set(slug, state);
    try { return { report: await state.job, cached: false }; } finally { running.delete(slug); }
  }

  /* Where a scan is up to: running (with the requests so far), done (with the report) or none.
     Progress is kept by the server instance doing the scan. */
  async function status(input) {
    const slug = slugFor(input);
    const on = running.get(slug);
    if (on) return { state: 'running', slug, host: on.host, startedAt: on.startedAt, steps: on.steps.map(({ t, ...s }) => s) };
    const rec = slug ? await store.get(slug) : null;
    return rec ? { state: 'done', slug, host: rec.host, report: rec } : { state: 'none', slug };
  }

  /* Start a scan and return straight away; status() follows it. */
  function start(input, opts = {}) {
    const p = run(input, opts); p.catch(() => {});
    return p;
  }

  const list = (limit = 20) => store.list ? store.list(Math.max(1, Math.min(100, limit))) : [];

  return { run, start, get, status, list, store, limiter, hasPagespeed: !!pagespeedKey };
}
