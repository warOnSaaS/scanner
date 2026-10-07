/* The scan. Plain HTTP requests and parsing, plus Google's own PageSpeed number when
   a key is set. No AI model is involved, so the same site gets the same grade every time
   and a scan costs nothing to run.

   Four areas, each scored out of 100: what an assistant can read, what search can see,
   what the page costs to load, and basic security. Every request is polite: a named user
   agent, a short timeout, a handful of requests per site. */
import { hostOf, slugOf, publicHost, makeGet } from './net.mjs';
export { hostOf, slugOf, publicHost };

/* A file is only real if it is text and is not the site's HTML shell. Serving a
   404 page with a 200 status is the commonest failure of all. */
const isHtml = s => /<(!doctype|html|head|body|script|div)\b/i.test(s.slice(0, 2000));
const classify = r => !r.ok || r.status >= 400 ? { state: 'missing', status: r.status }
  : !(r.body || '').trim() ? { state: 'empty', status: r.status }
  : (/html/i.test(r.type) || isHtml(r.body)) ? { state: 'html', status: r.status }
  : { state: 'real', status: r.status, bytes: r.body.length };

const BOTS = ['GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-User', 'anthropic-ai',
  'PerplexityBot', 'Google-Extended', 'Applebot-Extended', 'CCBot', 'Bytespider', 'Meta-ExternalAgent', 'Amazonbot'];

export function readRobots(txt) {
  if (!txt) return { found: false, named: [], blocked: [], sitemaps: [] };
  const named = [], blocked = [], sitemaps = []; let agents = [];
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim(); if (!line) continue;
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i); if (!m) continue;
    const k = m[1].toLowerCase(), v = m[2].trim();
    if (k === 'sitemap') { sitemaps.push(v); continue; }
    if (k === 'user-agent') { const hit = BOTS.find(b => b.toLowerCase() === v.toLowerCase());
      if (hit) { if (!named.includes(hit)) named.push(hit); agents = [hit]; } else agents = []; continue; }
    if (k === 'disallow' && agents.length && v === '/') for (const a of agents) if (!blocked.includes(a)) blocked.push(a);
  }
  return { found: true, named, blocked, sitemaps: sitemaps.slice(0, 5) };
}

const STOP = new Set(('a an the and or but if of to in on at for with from by as is are was were be been being this that these those it its we you your our us they their he she his her i me my not no all any can will just how what when where who why your yours more most other some such only own same so than too very s t don now d ll m o re ve y about into over after before between out up down off again further then once here there both each few nor own too s').split(' '));
/* "sites" and "site" are the same subject: a simple plural fold, so a title is not marked down for grammar. */
const fold = w => w.length > 4 && w.endsWith('ies') ? w.slice(0, -3) + 'y' : w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w;
const words = s => (String(s || '').toLowerCase().match(/[a-z][a-z'-]{2,}/g) || []).filter(w => !STOP.has(w)).map(fold);

export function readPage(html, url) {
  const one = re => (html.match(re) || [])[1]?.replace(/\s+/g, ' ').trim() || null;
  const all = re => [...html.matchAll(re)].map(m => m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean);
  const strip = h => h.replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;|&#x?[0-9a-f]+;/gi, ' ');   // entities are not words

  const title = one(/<title[^>]*>([\s\S]{0,400}?)<\/title>/i);
  const desc = one(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']{0,400})["']/i)
            || one(/<meta[^>]+content=["']([^"']{0,400})["'][^>]+name=["']description["']/i);
  const canonical = one(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i);
  const ogTitle = one(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
  const ogImage = one(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
  const twitter = /name=["']twitter:card["']/i.test(html);
  const lang = one(/<html[^>]+lang=["']([a-z-]+)["']/i);
  const h1s = all(/<h1[^>]*>([\s\S]{0,300}?)<\/h1>/gi);
  const h2s = all(/<h2[^>]*>([\s\S]{0,300}?)<\/h2>/gi);
  const viewport = /name=["']viewport["']/i.test(html);

  const blocks = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  const types = new Set(); let broken = 0;
  for (const b of blocks) { try { const j = JSON.parse(b[1].trim());
      for (const n of [].concat(j['@graph'] || j)) if (n && n['@type']) [].concat(n['@type']).forEach(t => types.add(t));
    } catch { broken++; } }

  const imgs = [...html.matchAll(/<img\b[^>]*>/gi)].map(m => m[0]);
  const noAlt = imgs.filter(t => !/\balt\s*=/i.test(t)).length;
  const lazy = imgs.filter(t => /loading=["']lazy["']/i.test(t)).length;
  const modern = (html.match(/\.(webp|avif)\b/gi) || []).length;
  const raster = imgs.filter(t => !/\.svg\b/i.test(t)).length;

  let self = ''; try { self = new URL(url).hostname.replace(/^www\./, ''); } catch {}
  const hosts = new Set();
  for (const m of html.matchAll(/<script[^>]+src=["']https?:\/\/([^"'\/]+)/gi)) hosts.add(m[1]);
  for (const m of html.matchAll(/<link[^>]+href=["']https?:\/\/([^"'\/]+)/gi)) hosts.add(m[1]);
  for (const m of html.matchAll(/<iframe[^>]+src=["']https?:\/\/([^"'\/]+)/gi)) hosts.add(m[1]);
  const third = [...hosts].filter(h => !h.replace(/^www\./, '').endsWith(self));

  const scripts = (html.match(/<script\b/gi) || []).length;
  const blocking = [...html.matchAll(/<script\b(?![^>]*\b(async|defer|type=["']application\/ld)\b)[^>]*\bsrc=/gi)].length;
  const links = [...html.matchAll(/<a\b[^>]+href=["']([^"'#]+)["']/gi)].map(m => m[1]);
  const internal = links.filter(h => h.startsWith('/') || h.includes(self)).length;
  /* For the llms.txt draft: the site's own name, its section headings, its main internal links with their
     link text, and any contact details it publishes. Taken as written, never invented. */
  const dec = t => String(t || '').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;|&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  const siteName = one(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i);
  const ogDesc = one(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']{0,400})["']/i);
  const SKIP = /^(shop now|shop all|buy now|explore|discover|get started|click here|here|details|learn|watch|play|log ?in|sign ?in|sign ?up|register|cart|bag|basket|checkout|account|my account|search|menu|close|skip to|privacy|terms|cookie|accessibility|sitemap|back to top|more|learn more|read more|see all|view all|open|toggle)/i;
  const seen = new Set(), keyLinks = [];
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]{0,300}?)<\/a>/gi)) {
    let href = m[1].trim(); const t = dec(m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()).replace(/\s*[→›»>]+\s*$/, '');
    if (!t || t.length < 3 || t.length > 40 || SKIP.test(t) || /^(mailto|tel|javascript):/i.test(href)) continue;
    let abs; try { abs = new URL(href, url); } catch { continue; }
    if (!abs.hostname.replace(/^www\./, '').endsWith(self) || abs.pathname === '/' ) continue;
    if (/\/(account|orders?|my-|login|signin|sign-in|cart|basket|checkout|wishlist|lists?|registr|privacy|cookie|terms|legal|transparency)/i.test(abs.pathname)) continue;
    const key = abs.pathname.replace(/\/$/, '').toLowerCase(); if (seen.has(key)) continue; seen.add(key);
    keyLinks.push({ t, h: abs.origin + abs.pathname });
    if (keyLinks.length >= 120) break;
  }
  const emails = [...new Set([...html.matchAll(/mailto:([^"'?\s>]+@[^"'?\s>]+)/gi)].map(m => m[1].toLowerCase()))].slice(0, 3);
  const phones = [...new Set([...html.matchAll(/tel:([+\d][\d\-\s().]{6,20})/gi)].map(m => m[1].trim()))].slice(0, 2);

  // keyword agreement: is the page clearly about one thing?
  const text = strip(html).slice(0, 220_000);
  /* what the page is about comes from its own content: menus, headers and footers repeat site-wide links */
  const body = strip(html.replace(/<(nav|header|footer)\b[\s\S]*?<\/\1>/gi, ' ')).slice(0, 220_000);
  const freq = new Map();
  for (const w of words(body.trim() ? body : text)) freq.set(w, (freq.get(w) || 0) + 1);
  const top = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([w, n]) => ({ w, n }));
  const tw = new Set(words(title)), hw = new Set(words(h1s[0]));
  const topSet = top.slice(0, 5).map(t => t.w);
  const inTitle = topSet.filter(w => tw.has(w));
  const inH1 = topSet.filter(w => hw.has(w));
  const titleH1 = [...tw].filter(w => hw.has(w));

  const visible = words(text).length;
  const jsOnly = visible < 120 && (html.match(/<script\b/gi) || []).length > 3;

  return { title: dec(title), desc: dec(desc), canonical, ogTitle, ogImage, twitter, lang, viewport, jsOnly,
    siteName: dec(siteName), ogDesc: dec(ogDesc), h2s: h2s.slice(0, 10).map(dec), keyLinks, emails, phones,
    h1s: h1s.slice(0, 3), h1count: h1s.length, h2count: h2s.length,
    jsonld: { blocks: blocks.length, types: [...types].slice(0, 12), broken },
    images: { total: imgs.length, raster, noAlt, lazy, modern },
    thirdParty: third.slice(0, 24), thirdPartyCount: third.length,
    scripts, blocking, internalLinks: internal, bytes: html.length,
    keywords: { top, inTitle, inH1, titleH1, wordCount: words(text).length } };
}

/* Google's own number, when it answers. Free; a key only raises the rate limit. */
/* Google's own number, when it answers. The key raises Google's rate limit; without one the
   scan skips PageSpeed unless asked (pagespeed: true), and every other check still runs.
   Returns { psi, status, reason }: status is ok, skipped or failed. */
export async function pagespeed(url, { key = '', fetchImpl = fetch, timeout = 26000 } = {}) {
  const k = key ? `&key=${encodeURIComponent(key)}` : '';
  const api = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}&strategy=mobile&category=performance&category=seo&category=accessibility&category=best-practices${k}`;
  const c = new AbortController(); const t = setTimeout(() => c.abort(), timeout);
  try {
    const r = await fetchImpl(api, { signal: c.signal });
    if (!r.ok) return { psi: null, status: 'failed', reason: r.status === 429 ? 'Google\'s PageSpeed quota is used up for now.' : `Google PageSpeed answered ${r.status}.` };
    const j = await r.json(); const cat = j.lighthouseResult?.categories; const a = j.lighthouseResult?.audits;
    if (!cat) return { psi: null, status: 'failed', reason: 'Google PageSpeed could not test this page.' };
    const n = x => x == null ? null : Math.round(x * 100);
    return { status: 'ok', reason: '', psi: { perf: n(cat.performance?.score), seo: n(cat.seo?.score), a11y: n(cat.accessibility?.score), bp: n(cat['best-practices']?.score),
      lcp: a?.['largest-contentful-paint']?.displayValue ?? null, cls: a?.['cumulative-layout-shift']?.displayValue ?? null,
      tbt: a?.['total-blocking-time']?.displayValue ?? null,
      weightKb: Math.round((a?.['total-byte-weight']?.numericValue || 0) / 1024) || null } };
  } catch (e) { return { psi: null, status: 'failed', reason: e.name === 'AbortError' ? 'Google PageSpeed took too long to answer.' : 'Google PageSpeed could not be reached.' }; }
  finally { clearTimeout(t); }
}

const pct = (got, max) => Math.max(0, Math.min(100, Math.round(got / max * 100)));

/* scan('example.com', { onStep, pagespeed, pagespeedKey }) resolves to
   { verdict, grade, panels, findings }. onStep receives { k, label, state, note } as each request
   starts and finishes, which is what the web page streams.
     pagespeed: 'auto' runs Google PageSpeed only when a key is set, true always tries, false skips.
     fetchImpl, lookup: injectable, so tests never touch the network. */
export async function scan(input, opts = {}) {
  if (typeof opts === 'function') opts = { onStep: opts };
  const { onStep = () => {}, fetchImpl = fetch, lookup, userAgent, timeout,
    pagespeedKey = process.env.PAGESPEED_KEY || '', pagespeed: wantPsi = 'auto' } = opts;
  const host = hostOf(input);
  if (!host) throw new Error('That does not look like a web address. Try example.com.');
  const get = makeGet({ fetchImpl, ...(lookup && { lookup }), ...(userAgent && { userAgent }), ...(timeout && { timeout }) });
  const runPsi = wantPsi === true || (wantPsi === 'auto' && !!pagespeedKey);
  const started = Date.now();
  const base = `https://${host}`;
  const step = (k, label, state, note) => { try { onStep({ k, label, state, note }); } catch {} };
  step('home', `GET ${host}/`, 'run');
  let home = await get(base);
  if (!home.ok) { const alt = await get(`https://www.${host}`); if (alt.ok) home = alt; }
  step('home', `GET ${host}/`, home.ok ? 'ok' : 'bad', home.ok ? `${home.status} · ${Math.round(home.bytes / 1024)} KB · ${home.ms} ms` : (home.error || home.status));
  if (!home.ok) return { verdict: 'unreachable', grade: 0, panels: {}, findings: { host, checkedAt: new Date().toISOString(), elapsedMs: Date.now() - started, home: { status: home.status, error: home.error } } };

  for (const f of ['llms.txt', 'llms-full.txt', 'ai.txt', '.well-known/ucp', 'robots.txt', 'sitemap.xml']) step(f, `GET ${host}/${f}`, 'run');
  step('parse', 'Reading the page', 'run');
  if (runPsi) step('psi', 'Google PageSpeed, phone', 'run', 'about 20 seconds');

  const one = async (name, promise, say) => { const r = await promise; step(name, `GET ${host}/${name}`, ...say(r)); return r; };
  const fileSay = r => { const c = classify(r); return c.state === 'real' ? ['ok', `${c.status} · ${c.bytes} bytes`]
    : c.state === 'html' ? ['warn', `${c.status} but it is a web page, not an answer`] : ['bad', c.status ? `${c.status}` : 'not found']; };

  const [llms, llmsFull, aiTxt, ucp, robots, sitemap, psiRun] = await Promise.all([
    one('llms.txt', get(`${base}/llms.txt`), fileSay),
    one('llms-full.txt', get(`${base}/llms-full.txt`), fileSay),
    one('ai.txt', get(`${base}/ai.txt`), fileSay),
    one('.well-known/ucp', get(`${base}/.well-known/ucp`), fileSay),
    get(`${base}/robots.txt`), get(`${base}/sitemap.xml`, { method: 'HEAD' }),
    runPsi ? pagespeed(home.url, { key: pagespeedKey, fetchImpl })
      : { psi: null, status: 'skipped', reason: wantPsi === false ? 'Google PageSpeed was turned off for this scan.' : 'No PageSpeed key is set, so Google\'s speed test was left out.' },
  ]);
  const psi = psiRun.psi;

  const files = { 'llms.txt': classify(llms), 'llms-full.txt': classify(llmsFull), 'ai.txt': classify(aiTxt), '.well-known/ucp': classify(ucp) };
  const rob = readRobots(robots.ok ? robots.body : '');
  step('robots.txt', `GET ${host}/robots.txt`, rob.found ? (rob.blocked.length ? 'warn' : 'ok') : 'bad',
    !rob.found ? 'not found' : rob.blocked.length ? `blocks ${rob.blocked.length} assistants by name` : rob.named.length ? `names ${rob.named.length} assistants, allows them` : 'no assistant rules');
  step('sitemap.xml', `GET ${host}/sitemap.xml`, (sitemap.ok || rob.sitemaps.length) ? 'ok' : 'bad', (sitemap.ok || rob.sitemaps.length) ? 'found' : 'not found');
  const p = readPage(home.body, home.url);
  step('parse', 'Reading the page', p.jsonld.blocks && !p.jsonld.broken ? 'ok' : 'warn',
    p.jsonld.blocks ? `${p.jsonld.blocks} structured-data block(s)${p.jsonld.broken ? `, ${p.jsonld.broken} broken` : ''} · ${p.thirdPartyCount} third-party domains`
      : `no structured data · ${p.thirdPartyCount} third-party domains`);
  if (psi) step('psi', 'Google PageSpeed, phone', psi.perf >= 90 ? 'ok' : 'warn', `${psi.perf}/100 mobile${psi.lcp ? ` · ${psi.lcp}` : ''}`);
  else if (runPsi) step('psi', 'Google PageSpeed, phone', 'skip', psiRun.reason);
  const h = home.headers;
  const hdr = n => h?.get ? h.get(n) : null;

  const real = Object.values(files).some(f => f.state === 'real');
  const fake = Object.values(files).some(f => f.state === 'html');
  const blockedAll = rob.blocked.length >= 3;
  // "blocked" is the only verdict that means an assistant genuinely cannot read the
  // site. The others are degrees of legibility, and the wording says so.
  const verdict = blockedAll ? 'blocked' : p.jsOnly ? 'unreadable' : real ? 'yes' : fake ? 'fake' : 'none';

  const ok = (pass, label, note, weight = 1) => ({ pass: !!pass, label, note, weight });

  /* ---- panel: agents ---- */
  const agents = [
    ok(real, 'A file assistants can read', real ? 'Found and it returns real content.' : 'No llms.txt, ai.txt or well-known file returns usable content.', 4),
    ok(!fake, 'Nothing pretending to be an answer', fake ? 'A file exists at the right address but returns a web page, an assistant cannot use it.' : 'No false positives.', 1),
    ok(!blockedAll, 'Assistants are allowed in', blockedAll ? `robots.txt blocks ${rob.blocked.length} assistants by name: ${rob.blocked.slice(0, 4).join(', ')}.` : rob.named.length ? `robots.txt names ${rob.named.length} assistant crawlers and lets them through.` : 'No assistant is blocked.', 2),
    ok(p.jsonld.blocks && !p.jsonld.broken, 'Structured data that parses', p.jsonld.broken ? `${p.jsonld.broken} of ${p.jsonld.blocks} structured-data blocks fail to parse.` : p.jsonld.blocks ? `${p.jsonld.blocks} block(s): ${p.jsonld.types.slice(0, 5).join(', ') || 'untyped'}.` : 'No JSON-LD on the home page, so there is nothing for an assistant to quote precisely.', 3),
    ok(!p.jsOnly, 'The words are in the page', p.jsOnly
      ? `Only ${p.keywords.wordCount} words are in the HTML, the rest is assembled by JavaScript, which most crawlers will not run. This is the one failure that genuinely means an assistant cannot read you.`
      : `${p.keywords.wordCount} words served in the HTML, readable without running anything.`, 4),
    ok(rob.sitemaps.length || sitemap.ok, 'A sitemap to crawl', rob.sitemaps.length ? 'Declared in robots.txt.' : sitemap.ok ? 'Found at /sitemap.xml.' : 'None found, so an assistant has to guess at your pages.', 1),
  ];

  /* ---- panel: search ---- */
  const tLen = (p.title || '').length, dLen = (p.desc || '').length;
  const search = [
    ok(p.title && tLen >= 20 && tLen <= 65, 'Title tag', !p.title ? 'Missing.' : `${tLen} characters${tLen > 65 ? ', it will be cut off in results' : tLen < 20 ? ', too short to say much' : ''}.`, 3),
    ok(p.desc && dLen >= 70 && dLen <= 165, 'Meta description', !p.desc ? 'Missing, so search writes its own.' : `${dLen} characters${dLen > 165 ? ', it will be truncated' : dLen < 70 ? ', short enough to waste the space' : ''}.`, 2),
    ok(p.h1count === 1, 'One H1', p.h1count === 0 ? 'No H1 on the page.' : p.h1count === 1 ? `“${(p.h1s[0] || '').slice(0, 70)}”` : `${p.h1count} H1s, nothing is the main heading.`, 2),
    ok(p.keywords.titleH1.length > 0, 'Title and H1 agree', p.keywords.titleH1.length ? `They share: ${p.keywords.titleH1.slice(0, 4).join(', ')}.` : 'The title and the H1 have no words in common, so the page does not say what it is about twice.', 2),
    ok(p.keywords.inTitle.length >= 2, 'Title matches the page', p.keywords.inTitle.length >= 2 ? `The title uses ${p.keywords.inTitle.join(', ')}, the page's own top terms.` : (p.keywords.top.length ? `The page is mostly about ${p.keywords.top.slice(0, 3).map(t => t.w).join(', ')}, and the title mentions ${p.keywords.inTitle.length ? p.keywords.inTitle.join(', ') : 'none of them'}.` : 'There is no readable text on the page to compare the title against.'), 3),
    ok(p.canonical, 'Canonical URL', p.canonical ? 'Declared.' : 'Missing, which invites duplicate-content splits.', 2),
    ok(p.ogImage && p.ogTitle, 'Social card', p.ogImage && p.ogTitle ? 'Open Graph title and image are set.' : 'Shared links will render without a preview.', 1),
    ok(p.keywords.wordCount >= 250, 'Enough text to rank on', `${p.keywords.wordCount} indexable words on the home page.`, 1),
    ok(p.internalLinks >= 10, 'Internal links', `${p.internalLinks} links into the rest of the site.`, 1),
    ok(p.images.total === 0 || p.images.noAlt / p.images.total < 0.2, 'Images described', p.images.total ? `${p.images.noAlt} of ${p.images.total} images have no alt text.` : 'No images on the page.', 1),
  ];

  /* ---- panel: performance ---- */
  const kb = Math.round(p.bytes / 1024);
  const perf = [
    ok(home.ms < 800, 'Server response', `${home.ms} ms to the first byte of HTML.`, 2),
    ok(kb < 150, 'HTML weight', `${kb} KB of HTML before a single image or script.`, 2),
    ok(p.thirdPartyCount <= 8, 'Third-party code', p.thirdPartyCount ? `${p.thirdPartyCount} outside domains load on this page${p.thirdPartyCount > 8 ? ', usually where the seconds go' : ''}: ${p.thirdParty.slice(0, 5).join(', ')}${p.thirdPartyCount > 5 ? '…' : ''}` : 'Nothing loads from a third party.', 4),
    ok(p.blocking <= 2, 'Render-blocking scripts', `${p.blocking} script(s) block the first paint.`, 2),
    ok(p.images.raster === 0 || p.images.modern > 0, 'Modern image formats', p.images.modern ? 'WebP or AVIF in use.' : p.images.raster ? 'No WebP or AVIF, images are heavier than they need to be.' : p.images.total ? 'Vector images only (SVG), as light as an image gets.' : 'No images.', 1),
    ...(psi?.perf != null ? [ok(psi.perf >= 90, 'Google PageSpeed, mobile', `${psi.perf} out of 100${psi.lcp ? ` · largest paint ${psi.lcp}` : ''}${psi.weightKb ? ` · ${psi.weightKb} KB total` : ''}.`, 4)] : []),
  ];

  /* ---- panel: hygiene ---- */
  const hyg = [
    ok(home.url.startsWith('https://'), 'HTTPS', home.url.startsWith('https://') ? 'Served over HTTPS.' : 'Not served over HTTPS.', 3),
    ok(hdr('strict-transport-security'), 'HSTS', hdr('strict-transport-security') ? 'Declared.' : 'No Strict-Transport-Security header.', 1),
    ok(hdr('x-content-type-options'), 'MIME sniffing off', hdr('x-content-type-options') ? 'Declared.' : 'No X-Content-Type-Options header.', 1),
    ok(hdr('content-security-policy'), 'Content Security Policy', hdr('content-security-policy') ? 'Declared.' : 'None, worth having once the third-party list is under control.', 1),
    ok(p.lang, 'Language declared', p.lang ? `lang="${p.lang}"` : 'The html element has no lang attribute.', 1),
    ok(p.viewport, 'Mobile viewport', p.viewport ? 'Declared.' : 'No viewport meta, the page will render desktop-wide on a phone.', 2),
    ...(psi?.a11y != null ? [ok(psi.a11y >= 90, 'Accessibility', `${psi.a11y} out of 100 on Google's test.`, 2)] : []),
  ];

  const score = list => { const m = list.reduce((n, i) => n + i.weight, 0); return pct(list.reduce((n, i) => n + (i.pass ? i.weight : 0), 0), m || 1); };
  const panels = {
    agents: { label: 'Agents', score: score(agents), items: agents },
    search: { label: 'Search', score: score(search), items: search },
    performance: { label: 'Performance', score: score(perf), items: perf },
    hygiene: { label: 'Hygiene', score: score(hyg), items: hyg },
  };
  const grade = Math.round(panels.agents.score * 0.4 + panels.search.score * 0.25 + panels.performance.score * 0.25 + panels.hygiene.score * 0.1);

  return { verdict, grade, panels,
    findings: { host, checkedAt: new Date().toISOString(), home: { status: home.status, ms: home.ms, url: home.url, kb },
      files, robots: rob, page: p, psi, pagespeed: { status: psiRun.status, reason: psiRun.reason },
      sitemap: { ok: !!(sitemap.ok || rob.sitemaps.length) }, elapsedMs: Date.now() - started } };
}

/* A starting point for their llms.txt, built only from what the scan found. */
export function draftLlms(host, f) {
  /* A starting draft from what the home page itself publishes. Anything we could not find is left as a
     clearly marked [fill in] line, never guessed. */
  const p = f.page || {};
  const name = (p.siteName || (p.ogTitle || p.title || host).split(/\s[|\u2013\u2014·-]\s|[|\u2013\u2014·]/)[0]).trim().slice(0, 60) || host;
  const summary = p.desc || p.ogDesc || '';
  const PRIORITY = /product|service|solution|shop|pricing|price|plans?|catalog|menu|industr|about|company|location|store|support|help|contact|careers?|investor|news/i;
  /* top-level sections first (fewest path segments), then the ones that sound like what a buyer needs, then page order */
  const depth = h => { try { return new URL(h).pathname.split('/').filter(Boolean).length; } catch { return 9; } };
  const sameHost = h => { try { return new URL(h).hostname.replace(/^www\./, '') === host.replace(/^www\./, '') ? 0 : 1; } catch { return 1; } };
  const links = (p.keyLinks || []).map((l, i) => ({ ...l, i })).sort((a, b) => sameHost(a.h) - sameHost(b.h) || depth(a.h) - depth(b.h) || (PRIORITY.test(b.t + b.h) ? 1 : 0) - (PRIORITY.test(a.t + a.h) ? 1 : 0) || a.i - b.i).slice(0, 10);
  const contactLink = (p.keyLinks || []).find(l => /contact/i.test(l.t + l.h));
  const sections = (p.h2s || []).filter(h => h && h.length > 3 && h.length < 80).slice(0, 5);
  return [
    `# ${name}`, '',
    `> ${summary || '[fill in] One sentence on what this company does and who it is for.'}`, '',
    ...(sections.length ? ['## What the home page covers', '', ...sections.map(h => `- ${h}`), ''] : ['## What we do', '', '- [fill in] What you sell, who for, and where you operate.', '']),
    '## Key pages', '',
    `- [Home](https://${host}/)`,
    ...links.map(l => `- [${l.t}](${l.h})`),
    f.robots?.sitemaps?.length ? `- [Sitemap](${f.robots.sitemaps[0]}): every page we publish` : `- [fill in] A sitemap at https://${host}/sitemap.xml, if you publish one`, '',
    '## Contact', '',
    ...(p.emails?.length || p.phones?.length || contactLink ? [...(p.emails || []).map(e => `- Email: ${e}`), ...(p.phones || []).map(t => `- Phone: ${t}`), ...(contactLink ? [`- [${contactLink.t}](${contactLink.h})`] : [])] : ['- [fill in] Where an assistant should send someone who wants to reach you.']), '',
    '## Notes for assistants', '',
    '- Quote prices, terms and availability only from the pages linked above.',
    '- Do not infer policies that are not written on this site.',
  ].join('\n');
}
