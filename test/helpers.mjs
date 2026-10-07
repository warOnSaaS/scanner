// A pretend internet for the tests: a few websites served from memory, so no test touches the network.
import http from 'node:http';
import { scan } from '../src/scan.mjs';
import { createService } from '../server/service.mjs';
import { createApp } from '../server/app.mjs';
import { memoryStore } from '../server/store.mjs';
import { limiter } from '../server/limits.mjs';

const words = n => Array.from({ length: n }, (_, i) => ['readiness', 'scanner', 'website', 'assistants', 'search'][i % 5]).join(' ');

export const GOOD_HOME = `<!doctype html><html lang="en"><head>
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Readiness scanner for your website and assistants</title>
<meta name="description" content="A free readiness scanner that shows what AI assistants and search engines can read on your website, with fixes.">
<link rel="canonical" href="https://good.test/">
<meta property="og:title" content="Readiness scanner"><meta property="og:image" content="https://good.test/og.png"><meta property="og:site_name" content="Good Co">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","name":"Good Co"}</script>
</head><body><nav><a href="/a">A</a></nav><h1>Readiness scanner for every website</h1><h2>What we do</h2>
<p>${words(300)}</p>${Array.from({ length: 12 }, (_, i) => `<a href="/page-${i}">Page number ${i}</a>`).join('')}
<a href="mailto:hello@good.test">Email</a><img src="/a.webp" alt="A picture"></body></html>`;

export const BAD_HOME = `<html><head><script src="https://cdn1.x/a.js"></script><script></script><script></script><script></script></head><body><div id="app"></div></body></html>`;

const SITES = {
  'good.test': {
    '/': [200, GOOD_HOME, 'text/html', { 'strict-transport-security': 'max-age=1', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'self'" }],
    '/llms.txt': [200, '# Good Co\n\n> We make a scanner.\n', 'text/plain'],
    '/robots.txt': [200, 'User-agent: *\nAllow: /\nSitemap: https://good.test/sitemap.xml\n', 'text/plain'],
    '/sitemap.xml': [200, '<urlset/>', 'application/xml'],
  },
  'blocked.test': {
    '/': [200, GOOD_HOME, 'text/html'],
    '/llms.txt': [200, '<!doctype html><html><body>Not found</body></html>', 'text/html'],
    '/robots.txt': [200, 'User-agent: GPTBot\nDisallow: /\nUser-agent: ClaudeBot\nDisallow: /\nUser-agent: PerplexityBot\nDisallow: /\n', 'text/plain'],
  },
  'empty.test': { '/': [200, BAD_HOME, 'text/html'] },
  'redirect.test': { '/': [301, '', 'text/html', { location: 'http://internal.test/' }] },
};

export function fakeFetch(url, opts = {}) {
  const u = new URL(url);
  if (u.hostname === 'www.googleapis.com') {
    return Promise.resolve(new Response(JSON.stringify({ lighthouseResult: { categories: { performance: { score: 0.93 }, seo: { score: 1 }, accessibility: { score: 0.95 }, 'best-practices': { score: 1 } }, audits: { 'largest-contentful-paint': { displayValue: '1.2 s' } } } }), { status: 200, headers: { 'content-type': 'application/json' } }));
  }
  const site = SITES[u.hostname.replace(/^www\./, '')];
  const hit = site?.[u.pathname];
  if (!hit) return Promise.resolve(new Response('<html>404</html>', { status: 404, headers: { 'content-type': 'text/html' } }));
  const [status, body, type, headers = {}] = hit;
  return Promise.resolve(new Response(opts.method === 'HEAD' || status === 301 ? null : body, { status, headers: { 'content-type': type, ...headers } }));
}
export const fakeLookup = async host => [{ address: host === 'internal.test' ? '10.0.0.5' : '93.184.216.34' }];
export const fakeScan = (host, o = {}) => scan(host, { ...o, fetchImpl: fakeFetch, lookup: fakeLookup });

export function testService(over = {}) {
  return createService({ store: memoryStore(), limiter: limiter({ perTenMin: 50, perDay: 100 }), scanImpl: fakeScan, isPublic: async h => !h.includes('internal'), pagespeedKey: 'test-key', ...over });
}

export async function testServer(over = {}) {
  const service = over.service || testService(over);
  const handle = createApp({ service, baseUrl: 'http://scanner.test', serveStatic: true });
  const srv = http.createServer((req, res) => handle(req, res));
  await new Promise(ok => srv.listen(0, ok));
  const base = `http://localhost:${srv.address().port}`;
  return { service, base, close: () => new Promise(ok => srv.close(ok)) };
}

/* Read a server-sent event stream to the end: [{ event, data }] */
export async function readStream(url) {
  const r = await fetch(url);
  const text = await r.text();
  return text.split('\n\n').filter(Boolean).map(b => ({ event: (b.match(/^event: (.*)$/m) || [])[1], data: JSON.parse((b.match(/^data: (.*)$/m) || [])[1] || 'null') }));
}
