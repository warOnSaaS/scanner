/* The pages, rendered on the server: the scanner (home), a report, the looping preview (embed)
   and not found. Built on warOnSaaS ui-design (public/ui, the midnight scheme) plus public/app/scan.css.
   Reports render on the server so a link pasted into Slack or X unfurls with the grade. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { AREAS } from '../src/report.mjs';
import { CHECKS, AREA_NAME, AREA_SHARE, AREA_ABOUT } from '../src/checks.mjs';

const PUBLIC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
export const GITHUB = 'https://github.com/warOnSaaS/scanner';
export const HUB = 'https://waronsaas-site.vercel.app';

/* Fingerprinted asset URLs, so a new deploy never meets a cached old copy. */
const version = f => { try { return crypto.createHash('sha256').update(fs.readFileSync(path.join(PUBLIC, f))).digest('hex').slice(0, 10); } catch { return '0'; } };
export const ASSETS = Object.fromEntries(['app/scan.css', 'app/scan.js', 'ui/src/ui.css', 'ui/src/tokens.css'].map(f => [f, `/${f}?v=${version(f)}`]));

let TANK = '';
try {
  TANK = fs.readFileSync(path.join(PUBLIC, 'ui', 'logo.svg'), 'utf8').replace(/<!--[\s\S]*?-->\s*/, '')
    .replace(/ width="\d+" height="\d+"/, '').replace(/role="img" aria-label="[^"]*"/, 'aria-hidden="true" focusable="false"')
    .replace('<svg ', '<svg class="tank" ').trim();
} catch {}

export const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const date = iso => { try { return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }); } catch { return ''; } };
const I = {
  arrow: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h9M8.5 4.5 12 8l-3.5 3.5"/></svg>',
  copy: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="5" y="5" width="8.5" height="8.5" rx="2"/><path d="M3 10.5V4a1.5 1.5 0 0 1 1.5-1.5H10"/></svg>',
  gh: '<svg viewBox="0 0 16 16" aria-hidden="true" class="fill"><path d="M8 .2a8 8 0 0 0-2.53 15.6c.4.07.55-.17.55-.38v-1.4c-2.23.48-2.7-.94-2.7-.94-.36-.93-.89-1.17-.89-1.17-.73-.5.05-.49.05-.49.8.06 1.23.83 1.23.83.71 1.23 1.88.87 2.33.66.07-.52.28-.87.5-1.07-1.77-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 0 1 4 0c1.53-1.03 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.28.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48v2.2c0 .21.15.46.55.38A8 8 0 0 0 8 .2z"/></svg>',
};

function shell({ origin, title, description, canonical = '/', body, page = '', ld = null, robots = 'index,follow', og = true }) {
  return `<!doctype html>
<html lang="en" data-scheme="midnight" data-shape="round" data-type="grotesk" data-surface="bordered" data-motion="subtle">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="robots" content="${robots}">
<link rel="canonical" href="${esc(origin + canonical)}">
${og ? `<meta property="og:type" content="website"><meta property="og:site_name" content="warOnSaaS Scanner">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(origin + canonical)}"><meta property="og:image" content="${esc(origin)}/og.png">
<meta name="twitter:card" content="summary_large_image">` : ''}
<meta name="theme-color" content="#09090b">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="preload" href="/ui/fonts/geist.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="${ASSETS['ui/src/ui.css']}">
<link rel="stylesheet" href="${ASSETS['ui/src/tokens.css']}">
<link rel="stylesheet" href="${ASSETS['app/scan.css']}">
${ld ? `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>` : ''}
</head>
<body class="${page}">
${body}
<script src="${ASSETS['app/scan.js']}" defer></script>
</body></html>
`;
}

const header = () => `<header class="top"><div class="top-in">
  <a class="brand" href="/" aria-label="warOnSaaS Scanner, home">${TANK}<span>Scanner</span><em>by warOnSaaS</em></a>
  <nav class="nav" aria-label="Main"><a href="/compare">Compare</a><a href="/#checks">What it checks</a><a href="/#agents">Use it from your agent</a><a class="nav-gh" href="${GITHUB}">${I.gh}<span>GitHub</span></a></nav>
</div></header>`;

const footer = () => `<footer class="foot"><div class="foot-in">
  <p class="foot-l"><a href="${HUB}" class="foot-brand">${TANK}warOnSaaS</a> Free and open source, Apache-2.0.</p>
  <p class="foot-r"><a href="/">Run a scan</a><a href="/compare">Compare sites</a><a href="/#checks">What it checks</a><a href="/#agents">Agents</a><a href="/llms.txt">llms.txt</a><a href="${GITHUB}">Source</a><a href="${HUB}">More from warOnSaaS</a></p>
</div></footer>`;

const composer = ({ id = 'scan', value = '', big = false } = {}) => `<form class="ask${big ? ' ask-big' : ''}" action="/" method="get" data-scan-form role="search">
  <label class="ask-in"><span class="ask-pre">https://</span><input id="${id}" name="url" value="${esc(value)}" placeholder="yoursite.com" autocomplete="url" inputmode="url" spellcheck="false" autocapitalize="off" aria-label="Website address" required></label>
  <button class="ask-go" type="submit"><span>Scan</span>${I.arrow}</button>
</form>`;

/* The live scan, the hero. scan.js drives it: from the stream, or replaying a recorded example. */
const consoleBox = ({ example = true, loop = false } = {}) => `<div class="con" data-console${example ? ' data-example' : ''}${loop ? ' data-loop' : ''}>
  <div class="con-bar">
    <span class="dots" aria-hidden="true"><i></i><i></i><i></i></span>
    <span class="con-title">scan <b data-host>waronsaas-site.vercel.app</b></span>
    <span class="con-chip" data-chip>${example ? 'Example' : 'Ready'}</span>
    <span class="con-time" data-time>0.0s</span>
  </div>
  <div class="con-body">
    <div class="con-logwrap"><ol class="con-log" data-log aria-live="polite" aria-label="What the scan is doing"></ol></div>
    <aside class="con-score" aria-label="Score">
      <div class="con-grade"><b data-grade>00</b><small>/100</small></div>
      <p class="con-verdict" data-verdict><span>Waiting for the home page</span></p>
      <ul class="con-areas" data-areas>${AREAS.map(k => `<li data-area="${k}"><span>${AREA_NAME[k]}</span><i><s></s></i><b>--</b></li>`).join('')}</ul>
    </aside>
  </div>
  <div class="con-foot" data-foot hidden>
    <p data-summary></p>
    <div class="con-act"><a class="btn" data-open href="/">Open the full report ${I.arrow}</a><button class="btn btn-ghost" type="button" data-share>${I.copy}<span>Copy link</span></button></div>
  </div>
</div>`;

export function homePage({ origin, hasPagespeed = true }) {
  const areaCard = k => {
    const labels = Object.keys(CHECK_AREA).filter(l => CHECK_AREA[l] === k);
    return `<article class="area">
    <header><h3>${AREA_NAME[k]}</h3><span class="share">${Math.round(AREA_SHARE[k] * 100)}%</span></header>
    <p>${esc(AREA_ABOUT[k])}</p>
    <ul>${labels.map(l => `<li><b>${esc(l)}</b><span>${esc(CHECKS[l].why)}</span></li>`).join('')}</ul>
  </article>`;
  };
  const mcp = `${origin}/mcp`;
  const copy = v => `<div class="copy"><code>${esc(v)}</code><button type="button" data-copy="${esc(v)}" aria-label="Copy">${I.copy}</button></div>`;
  const body = `${header()}
<main id="main">
<section class="hero">
  <div class="hero-in">
    <p class="pill"><i class="pulse"></i>Free<span class="sep"></span>no sign-up<span class="sep"></span>open source</p>
    <h1>Can AI assistants read your website?</h1>
    <p class="lede">Put in your website address. In about thirty seconds you see what ChatGPT, Claude and Google can read on your home page, a score out of 100, and the fix for every gap.</p>
    ${composer({ big: true })}
    <p class="hint">Try <a href="/?url=waronsaas-site.vercel.app" data-try>waronsaas-site.vercel.app</a> or <a href="/?url=example.com" data-try>example.com</a>. We fetch your home page and six public files, the way any crawler does.</p>
  </div>
  <div class="hero-con">${consoleBox({ example: true })}</div>
</section>

<section class="band band-recent" id="recent" data-recent hidden>
  <div class="band-h band-row"><div><p class="kicker">Recently scanned</p><h2>Sites other people just checked.</h2></div><a class="btn btn-ghost" href="/compare">Compare two sites ${I.arrow}</a></div>
  <ol class="recent" data-recent-list></ol>
</section>

<section class="band" id="checks">
  <div class="band-h">
    <p class="kicker">What the scan checks</p>
    <h2>Twenty-nine checks in four areas, one score out of 100.</h2>
    <p class="lede">No AI model is involved, so the same website gets the same score every time. Each area counts for a fixed share of the score, and each check inside it carries a weight. The report shows what every fix is worth in points.</p>
  </div>
  <div class="areas">${AREAS.map(areaCard).join('')}</div>
  ${hasPagespeed ? '' : '<p class="small">Google PageSpeed is not switched on for this copy of the scanner, so speed is judged from the page itself.</p>'}
</section>

<section class="band" id="agents">
  <div class="band-h">
    <p class="kicker">Use it from your agent</p>
    <h2>Run scans from Claude, ChatGPT, Claude Code or Codex.</h2>
    <p class="lede">The scanner is also an MCP server. Add it once and ask your assistant to scan a site, read a report or compare you with a competitor. Everything this page does, an agent can do too: scan_site, get_scan_status, get_report, compare_sites, list_recent_scans and list_checks.</p>
  </div>
  <div class="cards">
    <article class="card"><header><h3>Claude</h3><span>Web, desktop and phone</span></header>
      <p>Settings, then Connectors, then Add custom connector. Paste this address.</p>${copy(mcp)}</article>
    <article class="card"><header><h3>ChatGPT</h3><span>Developer mode</span></header>
      <p>Settings, then Apps and Connectors, then Create. Paste this address, no sign-in needed.</p>${copy(mcp)}</article>
    <article class="card"><header><h3>Claude Code</h3><span>Terminal</span></header>
      <p>One command, then ask it to scan a site.</p>${copy(`claude mcp add --transport http scanner ${mcp}`)}</article>
    <article class="card"><header><h3>Codex</h3><span>Terminal</span></header>
      <p>One command, then ask it to scan a site.</p>${copy(`codex mcp add scanner --url ${mcp}`)}</article>
    <article class="card"><header><h3>On your own computer</h3><span>Command line</span></header>
      <p>Scan from your machine, print the report or save it as JSON.</p>${copy('npx github:warOnSaaS/scanner example.com')}</article>
    <article class="card"><header><h3>From your code</h3><span>HTTP</span></header>
      <p>JSON back, or a live stream of each step with <code>/api/scan/stream</code>. <a href="/api">Every route</a>.</p>${copy(`curl "${origin}/api/scan?url=example.com"`)}</article>
  </div>
  <p class="try-say">Try saying: <q>Scan mysite.com and tell me the three fixes worth the most.</q> <q>Compare mysite.com with competitor.com.</q></p>
</section>

<section class="band band-last">
  <div class="band-h">
    <p class="kicker">What it does not do</p>
    <h2>A first look, not an audit.</h2>
  </div>
  <ul class="limits">
    <li>It reads the home page and a handful of public files: llms.txt, llms-full.txt, ai.txt, .well-known/ucp, robots.txt and sitemap.xml. It does not crawl the whole site, log in or fill in forms.</li>
    <li>Some sites turn automated visitors away. The scan reports what it saw; an AI assistant's own crawler may be treated differently.</li>
    <li>A site scanned in the last day is served from that scan, so nobody's server gets fetched twice in a day. Each visitor can run a few fresh scans every ten minutes.</li>
  </ul>
</section>
</main>
${footer()}`;
  return shell({ origin, title: 'Website scanner: can AI assistants read your site?', page: 'is-home',
    description: 'A free scan of what ChatGPT, Claude and Google can read on your website: a score out of 100 and the fix for every gap. Open source, with an MCP server for your own agents.',
    body, ld: { '@context': 'https://schema.org', '@graph': [
      { '@type': 'WebApplication', name: 'warOnSaaS Scanner', url: origin + '/', applicationCategory: 'DeveloperApplication', operatingSystem: 'Any', offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
        description: 'Scans a website for what AI assistants and search engines can read, and scores it out of 100.' },
      { '@type': 'Organization', name: 'warOnSaaS', url: HUB, sameAs: ['https://github.com/warOnSaaS'] },
    ] } });
}

/* Which area each check belongs to, read from a scan's own structure so it cannot drift. */
const CHECK_AREA = {
  'A file assistants can read': 'agents', 'Nothing pretending to be an answer': 'agents', 'Assistants are allowed in': 'agents', 'Structured data that parses': 'agents', 'The words are in the page': 'agents', 'A sitemap to crawl': 'agents',
  'Title tag': 'search', 'Meta description': 'search', 'One H1': 'search', 'Title and H1 agree': 'search', 'Title matches the page': 'search', 'Canonical URL': 'search', 'Social card': 'search', 'Enough text to rank on': 'search', 'Internal links': 'search', 'Images described': 'search',
  'Server response': 'performance', 'HTML weight': 'performance', 'Third-party code': 'performance', 'Render-blocking scripts': 'performance', 'Modern image formats': 'performance', 'Google PageSpeed, mobile': 'performance',
  'HTTPS': 'hygiene', 'HSTS': 'hygiene', 'MIME sniffing off': 'hygiene', 'Content Security Policy': 'hygiene', 'Language declared': 'hygiene', 'Mobile viewport': 'hygiene', 'Accessibility': 'hygiene',
};
export { CHECK_AREA };

const ring = n => {
  const r = 54, C = 2 * Math.PI * r, off = C * (1 - n / 100);
  return `<svg class="ring t-${n >= 80 ? 'good' : n >= 50 ? 'warn' : 'bad'}" viewBox="0 0 140 140" role="img" aria-label="${n} out of 100">
  <circle cx="70" cy="70" r="${r}" class="ring-bg"/><circle cx="70" cy="70" r="${r}" class="ring-fg" stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}" transform="rotate(-90 70 70)"/>
  <text x="70" y="84" text-anchor="middle">${n}</text></svg>`;
};

/* e: the explained report, exactly what the report operation (get_report, /api/report) returns. */
export function reportPage(e, { origin }) {
  const rec = e;
  const url = e.url || `${origin}/report/${e.slug}`;
  const tone = n => n >= 80 ? 'good' : n >= 50 ? 'warn' : 'bad';
  const unreachable = e.verdict.key === 'unreachable';
  const ps = e.pagespeed;
  const area = a => `<section class="rp-area" id="area-${a.key}">
    <header><div><h3>${esc(a.name)}</h3><p>${esc(a.about)} ${Math.round(a.share * 100)}% of the score.</p></div><span class="rp-s t-${a.tone}">${a.score}<small>/100</small></span></header>
    <div class="ui-acc">${a.checks.map(c => `<details><summary><span class="mark ${c.pass ? 'y' : 'n'}" aria-label="${c.pass ? 'Pass' : 'Fail'}"></span><span class="ck"><b>${esc(c.label)}</b><span>${esc(c.note)}</span></span>${c.pass ? '' : `<span class="ui-tag pts">+${c.points} pts</span>`}</summary>
      <div class="ui-acc-b">${c.why ? `<p><b>Why it matters.</b> ${esc(c.why)}</p>` : ''}${!c.pass && c.how ? `<p><b>How to fix it.</b> ${esc(c.how)}</p>` : ''}<p class="worth">${c.pass ? `Passing. Worth ${c.points} of the 100 points.` : `Fixing this adds about ${c.points} points to the score.`}</p></div></details>`).join('')}</div>
  </section>`;

  const body = `${header()}
<main id="main" class="rp">
<section class="rp-top">
  <p class="kicker">Report<span class="sep"></span>scanned ${esc(date(e.scannedAt))}</p>
  <h1><a href="https://${esc(e.host)}" rel="nofollow noopener">${esc(e.host)}</a></h1>
  <div class="rp-head">
    <div class="rp-ring">${ring(e.grade)}<span>Score</span></div>
    <div class="rp-v">
      <span class="verdict t-${e.verdict.tone}">${esc(e.verdict.label)}</span>
      <p class="rp-note">${esc(e.verdict.note)}</p>
      ${e.summary ? `<p class="rp-mean">${esc(e.summary)}</p>` : ''}
      <div class="rp-act"><button class="btn" type="button" data-copy="${esc(url)}">${I.copy}<span>Copy link</span></button><a class="btn btn-ghost" href="/?url=${encodeURIComponent(e.host)}&amp;rescan=1">Scan again</a><a class="btn btn-ghost" href="/compare?urls=${encodeURIComponent(e.host)}">Compare</a><a class="btn btn-ghost" href="/api/report/${esc(rec.slug)}">JSON</a></div>
    </div>
  </div>
  ${unreachable ? '' : `<ul class="rp-strip">${e.areas.map(a => `<li><a href="#area-${a.key}"><span>${esc(a.name)}</span><b class="t-${a.tone}">${a.score}</b><i><s style="width:${a.score}%" class="t-${a.tone}"></s></i><small>${Math.round(a.share * 100)}% of the score</small></a></li>`).join('')}</ul>`}
</section>

${unreachable ? '' : `
${e.fixes.length ? `<section class="rp-sec">
  <h2>Fix these first</h2>
  <ol class="fixes">${e.fixes.slice(0, 5).map(f => `<li><span class="ui-tag pts">+${f.points} pts</span><div><b>${esc(f.label)}</b><p>${esc(f.how)}</p><small>Found: ${esc(f.note)}</small></div></li>`).join('')}</ol>
</section>` : ''}

<section class="rp-sec">
  <h2>Google PageSpeed, on a phone</h2>
  ${ps.included ? `<div class="ui-stats">${[['Speed', ps.perf], ['Accessibility', ps.a11y], ['Search basics', ps.seo], ['Best practices', ps.bp]].map(([l, v]) => `<div><b class="t-${tone(v ?? 0)}">${v ?? '--'}</b><span>${l}</span></div>`).join('')}</div>
  <p class="small">Largest paint ${esc(ps.lcp || '--')}, layout shift ${esc(ps.cls || '--')}, blocking time ${esc(ps.tbt || '--')}${ps.weightKb ? `, ${ps.weightKb} KB in total` : ''}. These are Google's own Lighthouse numbers for this run; they move a little from one run to the next.</p>`
    : `<p class="small">${esc(ps.reason)} Every other check still ran, and the score is worked out from them.</p>`}
</section>

<section class="rp-sec">
  <h2>Every check</h2>
  <div class="rp-areas">${e.areas.map(area).join('')}</div>
</section>

${e.llms ? `<section class="rp-sec rp-llms">
  <div><h2>A first draft of your llms.txt</h2>
  <p>Built from your own home page. Fill in anything marked [fill in], put it at <code>/llms.txt</code>, and assistants have a plain summary to read.</p>
  <p class="small"><b>How much does it matter?</b> It takes ten minutes, so it is worth doing, but do not expect it to move much on its own. Evidence that AI tools look for the file is mixed. Letting assistants in, having the words in the page and publishing structured data matter more.</p></div>
  <figure class="file"><figcaption><b>llms.txt</b><button type="button" class="btn btn-ghost btn-sm" data-copy-from="llms">${I.copy}<span>Copy</span></button></figcaption><pre id="llms">${esc(e.llms)}</pre></figure>
</section>` : ''}`}

<section class="rp-sec rp-again">
  <h2>Scan another site</h2>
  ${composer({ id: 'again' })}
  <p class="small">Scanned ${esc(date(e.scannedAt))}. The scan requests the home page and a handful of well-known addresses, the way any crawler does. Run it from your own agent: <a href="/#agents">Claude, ChatGPT, Claude Code and Codex</a>.</p>
</section>
</main>
${footer()}`;
  return shell({ origin, canonical: `/report/${rec.slug}`, robots: 'noindex,follow', page: 'is-report',
    title: `${e.host} scores ${e.grade}/100 · warOnSaaS Scanner`,
    description: `${e.host} scores ${e.grade} out of 100 for what AI assistants and search engines can read. ${e.verdict.label}.`, body });
}

export function comparePage({ origin }) {
  const field = (n, ph) => `<label class="cmp-f"><span>${n}</span><input name="urls" placeholder="${ph}" autocomplete="off" inputmode="url" spellcheck="false" autocapitalize="off"${n < 3 ? ' required' : ''}></label>`;
  const body = `${header()}
<main id="main" class="rp">
<section class="rp-top">
  <p class="kicker">Compare</p>
  <h1>Your site next to a competitor's.</h1>
  <p class="rp-mean">Put in two to five websites. Each one is scanned (or its scan from the last day is used) and you see the scores side by side, and the checks one passes and another fails.</p>
  <form class="cmp" data-compare-form>
    <div class="cmp-fields">${field(1, 'yoursite.com')}${field(2, 'competitor.com')}${field(3, 'optional')}</div>
    <div class="cmp-act"><label class="cmp-psi"><input type="checkbox" name="pagespeed"> Include Google PageSpeed (slower)</label><button class="btn" type="submit">Compare ${I.arrow}</button></div>
  </form>
</section>
<section class="rp-sec" data-compare-out hidden aria-live="polite"></section>
</main>
${footer()}`;
  return shell({ origin, canonical: '/compare', page: 'is-compare', title: 'Compare websites for AI assistants and search · warOnSaaS Scanner',
    description: 'Compare two to five websites: what AI assistants and search engines can read on each, scored out of 100, and where they differ.', body });
}

export function embedPage({ origin }) {
  return shell({ origin, canonical: '/', robots: 'noindex', og: false, page: 'is-embed', title: 'warOnSaaS Scanner, live preview',
    description: 'The warOnSaaS Scanner scanning a site, on a loop.', body: `<main>${consoleBox({ example: true, loop: true })}</main>` });
}

export function notFoundPage({ origin, slug = '' }) {
  const host = slug ? slug.replace(/-/g, '.') : '';
  return shell({ origin, canonical: '/', robots: 'noindex', page: 'is-report', title: 'Not found · warOnSaaS Scanner', description: 'Nothing here.',
    body: `${header()}<main id="main" class="rp"><section class="rp-top rp-empty">
    <p class="kicker">Not found</p><h1>${slug ? 'That site has not been scanned yet.' : 'Nothing here.'}</h1>
    <p class="rp-mean">${slug ? 'Put the address in and it takes about thirty seconds.' : 'Scan a website instead.'}</p>
    ${composer({ value: host })}</section></main>${footer()}` });
}

export function llmsTxt({ origin }) {
  return `# warOnSaaS Scanner

> A free, open-source scan of what AI assistants and search engines can read on a website's home page, scored out of 100, with the fix for every gap. No AI model is involved, so the same site gets the same score every time.

## What it checks

${AREAS.map(k => `- ${AREA_NAME[k]} (${Math.round(AREA_SHARE[k] * 100)}% of the score): ${AREA_ABOUT[k]}`).join('\n')}

## Key pages

- [Run a scan](${origin}/): put in a website address and watch the scan
- [Reports](${origin}/report/example-com): each scanned site has a shareable report at /report/<site-with-dashes>
- [Source code](${GITHUB}): Apache-2.0

## For agents

- MCP server (Streamable HTTP, no sign-in): ${origin}/mcp. Tools: scan_site, get_report, compare_sites, list_checks.
- JSON API: GET ${origin}/api/scan?url=example.com, GET ${origin}/api/report/example-com
- Live stream: GET ${origin}/api/scan/stream?url=example.com (server-sent events: step, area, done, fail)
`;
}
