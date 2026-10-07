// Records a real scan, as it streamed, into public/app/example.json: the scan the page replays
// until someone runs their own, and the one the hub's preview card loops.
//   node scripts/record-example.mjs [site] [server]   (defaults: waronsaas.com, http://localhost:8787)
import fs from 'node:fs';

const site = process.argv[2] || 'waronsaas.com';
const base = process.argv[3] || 'http://localhost:8787';
const r = await fetch(`${base}/api/scan/stream?url=${encodeURIComponent(site)}&rescan=1`);
const t0 = Date.now(), events = [];
let buf = '';
for await (const chunk of r.body) {
  buf += Buffer.from(chunk).toString();
  let i;
  while ((i = buf.indexOf('\n\n')) >= 0) {
    const block = buf.slice(0, i); buf = buf.slice(i + 2);
    const e = (block.match(/^event: (.*)$/m) || [])[1], d = JSON.parse((block.match(/^data: (.*)$/m) || [])[1] || '{}');
    if (e === 'fail') throw new Error(d.error);
    if (e === 'done') events.push({ t: Date.now() - t0, e, d: { slug: d.slug, report: { grade: d.report.grade, verdict: d.report.verdict, summary: d.report.summary } } });
    else if (e === 'area') events.push({ t: Date.now() - t0, e, d: { key: d.key, name: d.name, score: d.score, tone: d.tone, checks: d.checks.map(({ label, pass, note, points }) => ({ label, pass, note, points })) } });
    else if (e === 'step') events.push({ t: Date.now() - t0, e, d });
  }
}
fs.writeFileSync('public/app/example.json', JSON.stringify({ host: site, recordedAt: new Date().toISOString(), events }));
console.log(`recorded ${events.length} events from a scan of ${site} in ${Math.round((Date.now() - t0) / 1000)}s`);
