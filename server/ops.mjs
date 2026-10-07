/* Everything the scanner can do, in one list. The MCP tools and the API routes are both generated
   from it, and the web pages call those API routes, so a person on the page and an agent over MCP
   or HTTP do exactly the same things through exactly the same functions.

   scan          scan a site, or re-scan it (rescan: true); the page watches it live on /api/scan/stream
   scan_status   where a scan is up to: the requests so far, or the finished report
   report        read a site's last report, with its share link
   compare       two to five sites side by side
   recent        the sites scanned most recently
   checks        every check, why it matters and how to fix it

   test/parity.test.mjs fails if one of these is missing from MCP or the API, or if a page calls
   an API route that is not in this list. */
import { z } from 'zod';
import { brief, explain, compare as compareReports } from '../src/report.mjs';
import { CHECKS, AREA_NAME, AREA_SHARE, AREA_ABOUT } from '../src/checks.mjs';
import { hostOf } from '../src/net.mjs';
import { ScanError } from './service.mjs';

const bool = z.union([z.boolean(), z.enum(['true', 'false', '1', '0', 'yes', 'no'])]).transform(v => v === true || v === 'true' || v === '1' || v === 'yes');
const list = z.union([z.array(z.string()), z.string()]).transform(v => (Array.isArray(v) ? v : v.split(/[\s,]+/)).map(s => s.trim()).filter(Boolean));
const num = z.union([z.number(), z.string()]).transform(Number);

const areaLine = b => Object.entries(b.areas).map(([k, v]) => `${AREA_NAME[k]} ${v}`).join(', ');
function sayBrief(b, cached) {
  return [`${b.host}: ${b.grade}/100, ${b.verdict}.${cached ? ` (from a scan made ${b.scannedAt})` : ''}`, b.summary,
    `Areas: ${areaLine(b)}.`,
    ...(b.fixes.length ? ['Top fixes:', ...b.fixes.slice(0, 5).map(f => `- ${f.check} (+${f.points} pts): ${f.how}`)] : []),
    typeof b.pagespeed === 'string' ? b.pagespeed : `Google PageSpeed on a phone: ${b.pagespeed.performance}/100.`,
    `Share this report: ${b.report}`].join('\n');
}
function sayFull(e) {
  const lines = [`${e.host}: ${e.grade}/100, ${e.verdict.label}. Scanned ${e.scannedAt}.`, e.verdict.note, e.summary, ''];
  for (const a of e.areas) {
    lines.push(`${a.name}: ${a.score}/100 (${Math.round(a.share * 100)}% of the score)`);
    for (const c of a.checks) lines.push(`- ${c.pass ? 'PASS' : 'FAIL'} ${c.label}: ${c.note}${c.pass ? '' : ` Fix (+${c.points} pts): ${c.how}`}`);
    lines.push('');
  }
  if (e.llms) lines.push('First-draft llms.txt from the home page:', e.llms, '');
  lines.push(`Share this report: ${e.url}`);
  return lines.join('\n');
}

/* ctx: { service, ip, reportUrl(slug), onStep(step) } */
export const OPERATIONS = [
  {
    id: 'scan', tool: 'scan_site', title: 'Scan a website',
    api: [['GET', '/api/scan'], ['POST', '/api/scan']], stream: '/api/scan/stream',
    description: 'Scan one website\'s home page: what AI assistants and search engines can read, speed and security basics. Returns a score out of 100, the four area scores, the fixes worth the most points and a share link. A site scanned in the last day comes back from that scan; set rescan to true to scan it again.',
    input: {
      url: z.string().describe('The site, for example example.com or https://www.example.com'),
      include_pagespeed: bool.optional().describe('Include Google PageSpeed on a phone, about 20 seconds more. Default true.'),
      rescan: bool.optional().describe('Scan again even if there is a scan from the last day. Default false.'),
      detail: z.enum(['summary', 'full']).optional().describe('summary (default) or full: every check, PageSpeed and an llms.txt draft'),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
    async run({ url, include_pagespeed, rescan, detail }, ctx) {
      const { report, cached } = await ctx.service.run(url, { ip: ctx.ip, pagespeed: include_pagespeed !== false, force: !!rescan, onStep: ctx.onStep });
      return reportAnswer(report, cached, detail, ctx);
    },
  },
  {
    id: 'scan_status', tool: 'get_scan_status', title: 'Follow a scan',
    api: [['GET', '/api/scan/status']],
    description: 'Where a scan of a site is up to. While it runs: each request made so far and what came back. Once finished: the score and the share link. Use it to follow a scan someone started on the web page or in another agent.',
    input: { url: z.string().describe('The site, for example example.com') },
    annotations: { readOnlyHint: true, openWorldHint: false },
    async run({ url }, ctx) {
      const s = await ctx.service.status(url);
      if (s.state === 'running') return { data: s, text: [`${s.host} is being scanned (started ${s.startedAt}). So far:`, ...s.steps.map(x => `- ${x.label}: ${x.state}${x.note ? `, ${x.note}` : ''}`)].join('\n') };
      if (s.state === 'none') return { data: s, text: `Nothing is running for ${hostOf(url) || url} and it has no report yet. Use scan_site.` };
      const b = brief(s.report, { url: ctx.reportUrl(s.report.slug) });
      return { data: { state: 'done', slug: s.slug, host: s.host, scan: b }, text: `Finished.\n${sayBrief(b, true)}` };
    },
  },
  {
    id: 'report', tool: 'get_report', title: 'Read a report',
    api: [['GET', '/api/report/:slug'], ['GET', '/api/report']],
    description: 'Read a site\'s last report without scanning it again, with its share link. detail "full" adds every check with why it matters and how to fix it, Google PageSpeed numbers and a first-draft llms.txt.',
    input: { url: z.string().describe('The site, for example example.com'), detail: z.enum(['summary', 'full']).optional().describe('summary (default) or full') },
    annotations: { readOnlyHint: true, openWorldHint: false },
    async run({ url, detail }, ctx) {
      const rec = await ctx.service.get(url);
      if (!rec) throw new ScanError(404, `There is no report for ${hostOf(url) || url} yet. Scan it first.`);
      return reportAnswer(rec, true, detail, ctx);
    },
  },
  {
    id: 'compare', tool: 'compare_sites', title: 'Compare websites',
    api: [['GET', '/api/compare'], ['POST', '/api/compare']],
    description: 'Compare two to five sites: scores, the four areas, and the checks one passes and another fails. Uses each site\'s scan from the last day, or scans it.',
    input: {
      urls: list.pipe(z.array(z.string()).min(2).max(5)).describe('Two to five sites, for example ["mysite.com", "competitor.com"]'),
      include_pagespeed: bool.optional().describe('Include Google PageSpeed. Default false, to keep a comparison quick.'),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
    async run({ urls, include_pagespeed }, ctx) {
      const hosts = [...new Set(urls.map(u => hostOf(u)).filter(Boolean))];
      if (hosts.length < 2) throw new ScanError(400, 'Give at least two different web addresses.');
      const out = await Promise.all(hosts.map(h => ctx.service.run(h, { ip: ctx.ip, pagespeed: include_pagespeed === true }).then(r => r.report, e => ({ error: e.message, host: h }))));
      const ok = out.filter(r => !r.error);
      const errors = out.filter(r => r.error).map(r => ({ host: r.host, error: r.error }));
      if (ok.length < 2) throw new ScanError(400, `Could not scan enough of them. ${errors.map(e => `${e.host}: ${e.error}`).join(' ')}`);
      const c = compareReports(ok);
      const sites = c.ranked.map(r => ({ ...r, slug: ok.find(o => o.host === r.host).slug, report: ctx.reportUrl(ok.find(o => o.host === r.host).slug) }));
      const text = [c.summary, '', ...sites.map(r => `${r.host}: ${r.grade}/100 (${r.verdict}). ${areaLine(r)}. Report: ${r.report}`),
        ...(c.differences.length ? ['', 'Where they differ:', ...c.differences.map(d => `- ${d.check}: passes on ${d.passes.join(', ') || 'none'}; fails on ${d.fails.join(', ') || 'none'}.`)] : []),
        ...(errors.length ? ['', `Not scanned: ${errors.map(e => `${e.host}: ${e.error}`).join(' ')}`] : [])].join('\n');
      return { data: { summary: c.summary, sites, differences: c.differences, errors }, text };
    },
  },
  {
    id: 'recent', tool: 'list_recent_scans', title: 'List recent scans',
    api: [['GET', '/api/scans']],
    description: 'The sites scanned most recently, newest first, with their scores and report links.',
    input: { limit: num.pipe(z.number().int().min(1).max(100)).optional().describe('How many, 1 to 100. Default 20.') },
    annotations: { readOnlyHint: true, openWorldHint: false },
    async run({ limit }, ctx) {
      const scans = (await ctx.service.list(limit || 20)).map(e => ({ ...e, report: ctx.reportUrl(e.slug) }));
      return { data: { scans }, text: scans.length ? scans.map(s => `${s.host}: ${s.grade}/100, scanned ${s.scannedAt}. ${s.report}`).join('\n') : 'No scans yet.' };
    },
  },
  {
    id: 'checks', tool: 'list_checks', title: 'List the checks',
    api: [['GET', '/api/checks']],
    description: 'Every check the scan runs, why it matters and how to fix it, and how the score adds up.',
    input: {},
    annotations: { readOnlyHint: true, openWorldHint: false },
    async run() {
      const areas = Object.keys(AREA_SHARE).map(k => ({ key: k, name: AREA_NAME[k], share: AREA_SHARE[k], about: AREA_ABOUT[k] }));
      const text = ['The score is out of 100: ' + areas.map(a => `${a.name} ${Math.round(a.share * 100)}%`).join(', ') + '. Inside each area, each check carries a weight.', '',
        ...Object.entries(CHECKS).map(([l, c]) => `${l}. Why: ${c.why} Fix: ${c.how}`)].join('\n');
      return { data: { areas, checks: Object.entries(CHECKS).map(([label, c]) => ({ label, ...c })) }, text };
    },
  },
];

function reportAnswer(rec, cached, detail, ctx) {
  const url = ctx.reportUrl(rec.slug);
  if (detail === 'full') { const e = explain(rec, { url }); return { data: { cached, report: e }, text: sayFull(e) }; }
  const b = brief(rec, { url });
  return { data: { cached, scan: b }, text: sayBrief(b, cached) };
}

/* Run one operation by id with raw arguments (from a query string, a JSON body or an MCP call). */
export async function runOperation(id, raw, ctx) {
  const op = OPERATIONS.find(o => o.id === id);
  if (!op) throw new ScanError(404, 'No such operation.');
  const parsed = z.object(op.input).safeParse(raw || {});
  if (!parsed.success) throw new ScanError(400, parsed.error.issues.map(i => `${i.path.join('.') || 'input'}: ${i.message}`).join('; '));
  return op.run(parsed.data, ctx);
}

/* The machine-readable list, served at /api: each capability with its MCP tool and API routes. */
export function manifest(origin) {
  return {
    name: 'warOnSaaS Scanner', mcp: `${origin}/mcp`,
    operations: OPERATIONS.map(o => ({ id: o.id, title: o.title, description: o.description, mcpTool: o.tool,
      api: o.api.map(([m, p]) => `${m} ${p}`), ...(o.stream && { stream: `GET ${o.stream}` }), input: Object.keys(o.input) })),
  };
}
