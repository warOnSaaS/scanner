/* Turning a scan into words a person can act on: the verdict, a short paragraph on what it
   means, every check with why it matters and how to fix it, and what each fix is worth.
   Used by the report page, the CLI, the API and the MCP tools, so they all say the same thing. */
import { CHECKS, AREA_SHARE, AREA_NAME, AREA_ABOUT, VERDICTS } from './checks.mjs';

export const AREAS = ['agents', 'search', 'performance', 'hygiene'];
const NAMES = { agents: 'what AI assistants can read', search: 'search basics', performance: 'speed', hygiene: 'security basics' };
const join = xs => xs.length > 1 ? xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1] : xs[0];
export const toneOf = n => n >= 80 ? 'good' : n >= 50 ? 'warn' : 'bad';

/* Each check's worth: its area's share of the grade, times its weight inside that area. */
export function areas(panels = {}) {
  return AREAS.filter(k => panels[k]?.items).map(k => {
    const pn = panels[k]; const tot = pn.items.reduce((a, i) => a + (i.weight || 1), 0);
    return { key: k, name: AREA_NAME[k], about: AREA_ABOUT[k], share: AREA_SHARE[k], score: pn.score, tone: toneOf(pn.score),
      checks: pn.items.map(i => ({ label: i.label, pass: i.pass, note: i.note, weight: i.weight || 1,
        points: Math.round(AREA_SHARE[k] * 100 * (i.weight || 1) / tot * 10) / 10,
        why: CHECKS[i.label]?.why || '', how: CHECKS[i.label]?.how || '' })) };
  });
}

/* The failed checks that would lift the score most, biggest first. */
export function fixes(panels, limit = 99) {
  return areas(panels).flatMap(a => a.checks.filter(c => !c.pass).map(c => ({ ...c, area: a.key, areaName: a.name })))
    .sort((x, y) => y.points - x.points).slice(0, limit);
}

export function verdictOf(v) {
  const [label, note, tone] = VERDICTS[v] || VERDICTS.none;
  return { key: v, label, note, tone };
}

/* What this means, in plain words, built from the scores. */
export function meaning(r) {
  const host = r.host || r.findings?.host;
  if (r.verdict === 'unreachable') { const st = r.findings?.home?.status; return `${host} ${st ? `answered with an error (${st})` : 'did not answer'}, so there was nothing to score. Check the address, or try again in a minute. If the site blocks automated visitors, the command line version run from your own computer may get through.`; }
  const list = areas(r.panels);
  if (!list.length) return '';
  const good = list.filter(a => a.score >= 80).map(a => `${NAMES[a.key]} (${a.score})`);
  const bad = list.filter(a => a.score < 50).map(a => `${NAMES[a.key]} (${a.score})`);
  const top = fixes(r.panels, 3);
  const lead = r.grade >= 80 ? `${host} is in good shape.` : r.grade >= 60 ? `${host} is in the middle of the pack.` : `${host} has real gaps.`;
  return [lead,
    good.length ? `It does well on ${join(good)}.` : '',
    bad.length ? `It is weakest on ${join(bad)}.` : '',
    top.length ? `The fixes that would lift the score most are: ${join(top.map(f => f.label.toLowerCase()))}.` : 'Nothing major failed.',
  ].filter(Boolean).join(' ');
}

/* The full, explained report: what the page, the API and the agents read. */
export function explain(r, { url = '' } = {}) {
  const f = r.findings || {};
  return {
    host: r.host || f.host, slug: r.slug, url, scannedAt: r.scannedAt || f.checkedAt,
    grade: r.grade, verdict: verdictOf(r.verdict), summary: meaning(r),
    areas: areas(r.panels), fixes: fixes(r.panels),
    pagespeed: f.psi ? { included: true, ...f.psi } : { included: false, reason: f.pagespeed?.reason || 'Google PageSpeed was not part of this scan.' },
    llms: r.llms || null,
  };
}

/* A short version for an agent's context: the grade, the verdict, the areas and what to fix. */
export function brief(r, { url = '' } = {}) {
  const e = explain(r, { url });
  return {
    host: e.host, grade: e.grade, verdict: e.verdict.label, summary: e.summary, scannedAt: e.scannedAt, report: url || undefined,
    areas: Object.fromEntries(e.areas.map(a => [a.key, a.score])),
    fixes: e.fixes.map(x => ({ check: x.label, area: x.areaName, points: x.points, found: x.note, how: x.how })),
    pagespeed: e.pagespeed.included ? { performance: e.pagespeed.perf, accessibility: e.pagespeed.a11y, seo: e.pagespeed.seo, largestPaint: e.pagespeed.lcp } : e.pagespeed.reason,
  };
}

/* Several sites side by side: overall grade, each area, and the checks one passes and another fails. */
export function compare(reports) {
  const rows = reports.map(r => ({ host: r.host || r.findings?.host, grade: r.grade, verdict: verdictOf(r.verdict).label,
    areas: Object.fromEntries(areas(r.panels).map(a => [a.key, a.score])) }));
  const ranked = [...rows].sort((a, b) => b.grade - a.grade);
  const pass = r => Object.fromEntries(areas(r.panels).flatMap(a => a.checks.map(c => [c.label, c.pass])));
  const all = reports.map(pass);
  const labels = [...new Set(all.flatMap(Object.keys))];
  const differences = labels.filter(l => new Set(all.map(p => p[l])).size > 1)
    .map(l => ({ check: l, passes: rows.filter((_, i) => all[i][l]).map(r => r.host), fails: rows.filter((_, i) => all[i][l] === false).map(r => r.host) }));
  const lead = ranked.length > 1 ? `${ranked[0].host} leads with ${ranked[0].grade}; ${ranked.slice(1).map(r => `${r.host} ${r.grade}`).join(', ')}.` : '';
  return { ranked, differences, summary: lead };
}

/* The report as plain text, for a terminal. */
export function toText(r, { url = '', color = false } = {}) {
  const e = explain(r, { url });
  const c = (code, s) => color ? `\x1b[${code}m${s}\x1b[0m` : s;
  const tone = n => n >= 80 ? 32 : n >= 50 ? 33 : 31;
  const out = [`${c(1, e.host)}  ${c(tone(e.grade), `${e.grade}/100`)}  ${e.verdict.label}`, '', e.summary, ''];
  for (const a of e.areas) {
    out.push(`${c(1, a.name)}  ${c(tone(a.score), a.score)}  (${Math.round(a.share * 100)}% of the score)`);
    for (const ch of a.checks) out.push(`  ${ch.pass ? c(32, 'pass') : c(31, 'fail')}  ${ch.label}: ${ch.note}${ch.pass ? '' : c(2, `  +${ch.points} pts`)}`);
    out.push('');
  }
  if (e.fixes.length) {
    out.push(c(1, 'Fix these first'));
    for (const x of e.fixes.slice(0, 5)) out.push(`  +${x.points} pts  ${x.label}. ${x.how}`);
    out.push('');
  }
  if (!e.pagespeed.included) out.push(c(2, e.pagespeed.reason));
  if (url) out.push(`Full report: ${url}`);
  return out.join('\n').trimEnd() + '\n';
}
