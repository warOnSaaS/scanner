/* The web app: one handler for every route, used by the Vercel function and by dev.mjs.

   Pages (people)                     The same thing for agents
   GET /                scan a site    GET|POST /api/scan, GET /api/scan/stream   MCP scan_site
                        follow it      GET /api/scan/status                       MCP get_scan_status
   GET /report/<slug>   read, share    GET /api/report/<slug>                     MCP get_report
   GET /compare         compare        GET|POST /api/compare                      MCP compare_sites
   GET / (recent list)  past scans     GET /api/scans                             MCP list_recent_scans
   GET / (checks)       the checks     GET /api/checks                            MCP list_checks
   GET /api             this list, as JSON. POST /mcp is the MCP server.
   GET /embed           the live scan on a loop, for a preview card on another site.

   The API routes and the MCP tools are both generated from server/ops.mjs, and the pages call
   the API routes, so everything a page can do an agent can do the same way. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createService, ScanError } from './service.mjs';
import { buildMcpServer } from './mcp.mjs';
import { OPERATIONS, runOperation, manifest } from './ops.mjs';
import { homePage, reportPage, comparePage, embedPage, notFoundPage, llmsTxt } from './pages.mjs';

const PUBLIC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const TYPES = { '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8' };

const ipOf = req => String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim().slice(0, 64);
const CORS = { 'access-control-allow-origin': '*' };
const json = (res, status, data, cache = 'no-store') => res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': cache, ...CORS }).end(JSON.stringify(data));
const html = (res, status, body, cache = 'no-store') => res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': cache }).end(body);
const text = (res, body, type = 'text/plain; charset=utf-8') => res.writeHead(200, { 'content-type': type, 'cache-control': 'public, max-age=300, s-maxage=3600' }).end(body);
const wait = ms => new Promise(ok => setTimeout(ok, ms));
const PAGE_CACHE = 'public, max-age=0, s-maxage=600, stale-while-revalidate=86400';

async function readBody(req) {
  if (req.body !== undefined) return typeof req.body === 'string' ? safeJson(req.body) : req.body;
  let s = ''; for await (const c of req) { s += c; if (s.length > 1e6) break; }
  return s ? safeJson(s) : undefined;
}
const safeJson = s => { try { return JSON.parse(s); } catch { return undefined; } };

/* Route table from ops.mjs: [method, regex, op, slugParam] */
const ROUTES = OPERATIONS.flatMap(op => op.api.map(([m, p]) => [m, new RegExp('^' + p.replace(':slug', '([a-z0-9-]+)') + '$'), op, p.includes(':slug')]));

export function createApp({ service = createService(), baseUrl = process.env.SITE_URL || '', serveStatic = false } = {}) {
  const origin = req => (baseUrl || `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers['x-forwarded-host'] || req.headers.host}`).replace(/\/$/, '');
  const ctxFor = req => ({ service, ip: ipOf(req), reportUrl: slug => `${origin(req)}/report/${slug}` });

  /* The scan operation, streamed: each request as it happens, then each area as it is scored. */
  async function streamScan(req, res, q) {
    res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' });
    const emit = (event, data) => { try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch {} };
    let live = false;
    try {
      const args = { url: q.get('url') || q.get('domain') || '', detail: 'full', ...(q.has('pagespeed') && { include_pagespeed: q.get('pagespeed') }), ...(q.has('rescan') && { rescan: q.get('rescan') }) };
      const { data } = await runOperation('scan', args, { ...ctxFor(req), onStep: s => { live = true; emit('step', s); } });
      const e = data.report;
      if (!live) {
        // From the cache: replay the stored requests quickly rather than fetch someone's site twice in a day.
        const rec = await service.get(e.slug);
        emit('cached', { minutes: Math.max(1, Math.round((Date.now() - new Date(e.scannedAt).getTime()) / 60e3)) });
        const last = new Map(); for (const s of rec?.steps || []) last.set(s.k, s);
        for (const s of last.values()) { emit('step', { ...s, state: 'run' }); await wait(50); emit('step', s); await wait(80); }
      }
      for (const a of e.areas) { emit('area', a); await wait(data.cached ? 140 : 220); }
      emit('done', { ok: true, cached: data.cached, slug: e.slug, report: e });
    } catch (err) {
      if (!(err instanceof ScanError)) console.error('[scan-stream]', err);
      emit('fail', { error: err instanceof ScanError ? err.message : 'The scan did not finish. Try again in a moment.' });
    }
    res.end();
  }

  async function mcp(req, res) {
    if (req.method !== 'POST') return json(res, 405, { error: 'This is an MCP endpoint. Add it to Claude, ChatGPT, Claude Code or Codex as a connector; see the home page.' });
    const c = ctxFor(req);
    const server = buildMcpServer(service, { ip: c.ip, reportUrl: c.reportUrl });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => { transport.close(); server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res, await readBody(req));
  }

  return async function handle(req, res) {
    const u = new URL(req.url, 'http://x');
    const p = (u.searchParams.get('__p') ?? u.pathname).replace(/\/+$/, '') || '/';
    u.searchParams.delete('__p');
    const q = u.searchParams;
    try {
      if (p === '/mcp') return await mcp(req, res);
      if (req.method === 'OPTIONS') return res.writeHead(204, { ...CORS, 'access-control-allow-methods': 'GET, POST', 'access-control-allow-headers': 'content-type' }).end();
      if (p === '/api') return json(res, 200, manifest(origin(req)), 'public, max-age=300');
      if (p === '/api/scan/stream' || p === '/api/scan-stream') return await streamScan(req, res, q);

      for (const [m, re, op, slugged] of ROUTES) {
        const hit = p.match(re); if (!hit || m !== req.method) continue;
        const args = m === 'POST' ? { ...Object.fromEntries(q), ...((await readBody(req)) || {}) } : Object.fromEntries(q);
        if (slugged) args.url = hit[1];
        try {
          const { data } = await runOperation(op.id, args, ctxFor(req));
          return json(res, 200, { ok: true, ...data }, op.id === 'checks' ? 'public, max-age=300' : 'no-store');
        } catch (e) { if (e instanceof ScanError) return json(res, e.status, { ok: false, error: e.message }); throw e; }
      }
      if (p.startsWith('/api/')) return json(res, ROUTES.some(([, re]) => re.test(p)) ? 405 : 404, { ok: false, error: 'No such route. GET /api lists them all.' });

      if (p === '/') return html(res, 200, homePage({ origin: origin(req), hasPagespeed: service.hasPagespeed }), PAGE_CACHE);
      if (p === '/compare') return html(res, 200, comparePage({ origin: origin(req) }), PAGE_CACHE);
      if (p === '/embed') return html(res, 200, embedPage({ origin: origin(req) }), PAGE_CACHE);
      const rp = p.match(/^\/report\/([a-z0-9-]+)$/);
      if (rp) {
        try {
          const { data } = await runOperation('report', { url: rp[1], detail: 'full' }, ctxFor(req));
          return html(res, 200, reportPage(data.report, { origin: origin(req) }), 'public, max-age=0, s-maxage=60, stale-while-revalidate=3600');
        } catch (e) { if (e.status === 404) return html(res, 404, notFoundPage({ origin: origin(req), slug: rp[1] })); throw e; }
      }
      if (p === '/llms.txt') return text(res, llmsTxt({ origin: origin(req) }));
      if (p === '/robots.txt') return text(res, `User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /embed\n\nSitemap: ${origin(req)}/sitemap.xml\n`);
      if (p === '/sitemap.xml') return text(res, `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${origin(req)}/</loc></url><url><loc>${origin(req)}/compare</loc></url></urlset>\n`, 'application/xml; charset=utf-8');
      if (serveStatic) {
        const file = path.join(PUBLIC, path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
        if (file.startsWith(PUBLIC) && fs.existsSync(file) && fs.statSync(file).isFile()) {
          return res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' }).end(fs.readFileSync(file));
        }
      }
      return html(res, 404, notFoundPage({ origin: origin(req) }));
    } catch (e) {
      console.error('[app]', p, e);
      if (!res.headersSent) return json(res, 500, { ok: false, error: 'Something went wrong on our side. Try again in a moment.' });
      res.end();
    }
  };
}
