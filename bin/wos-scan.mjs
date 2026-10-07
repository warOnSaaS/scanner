#!/usr/bin/env node
/* wos-scan: the warOnSaaS Scanner from a terminal.

     wos-scan example.com                 print the report
     wos-scan example.com --json          the full report as JSON
     wos-scan compare a.com b.com         two to five sites side by side
     wos-scan batch sites.txt             many sites, one per line, into results.jsonl (resumable)
     wos-scan checks                      every check, why it matters, how to fix it
     wos-scan mcp                         run as an MCP server over stdio, for Claude Code, Codex and others

   Options: --pagespeed (also run Google PageSpeed; set PAGESPEED_KEY for a real quota),
            --no-pagespeed, --out <file>, --concurrency <n> */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scan, draftLlms, hostOf, slugOf } from '../src/scan.mjs';
import { explain, toText, compare } from '../src/report.mjs';
import { CHECKS, AREA_NAME } from '../src/checks.mjs';

const argv = process.argv.slice(2);
const flag = n => argv.includes(`--${n}`);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const words = argv.filter((a, i) => !a.startsWith('--') && !['--out', '--concurrency'].includes(argv[i - 1]));
const psi = flag('no-pagespeed') ? false : flag('pagespeed') ? true : 'auto';
const color = process.stdout.isTTY && !process.env.NO_COLOR;
const say = s => process.stderr.write(s);

async function one(input, { quiet = false } = {}) {
  const host = hostOf(input);
  if (!host) throw new Error(`"${input}" does not look like a web address. Try example.com.`);
  const r = await scan(host, { pagespeed: psi, onStep: s => { if (!quiet && s.state !== 'run' && process.stderr.isTTY) say(`  ${s.state === 'ok' ? '+' : s.state === 'skip' ? '.' : '-'} ${s.label}${s.note ? `  ${s.note}` : ''}\n`); } });
  return { slug: slugOf(host), host, scannedAt: r.findings.checkedAt, ...r, llms: r.verdict === 'unreachable' ? null : draftLlms(host, r.findings) };
}

async function main() {
  const cmd = words[0];
  if (!cmd || flag('help') || cmd === 'help') {
    console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').match(/\/\* ([\s\S]*?)\*\//)[1].replace(/^ {3}/gm, ''));
    return;
  }
  if (cmd === 'mcp') {
    const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js');
    const { buildMcpServer } = await import('../server/mcp.mjs');
    const { createService } = await import('../server/service.mjs');
    const { fileStore } = await import('../server/store.mjs');
    const { limiter } = await import('../server/limits.mjs');
    const dir = process.env.WOS_SCAN_DIR || path.join(os.homedir(), '.cache', 'wos-scanner');
    const service = createService({ store: fileStore(dir), limiter: limiter({ perTenMin: 100, perDay: 2000 }) });
    const server = buildMcpServer(service, { reportUrl: slug => `file://${path.join(dir, slug + '.json')}` });
    await server.connect(new StdioServerTransport());
    return;
  }
  if (cmd === 'checks') {
    for (const [l, c] of Object.entries(CHECKS)) console.log(`${l}\n  Why: ${c.why}\n  Fix: ${c.how}\n`);
    return;
  }
  if (cmd === 'compare') {
    const sites = words.slice(1);
    if (sites.length < 2) throw new Error('Give two to five sites: wos-scan compare mysite.com competitor.com');
    const reports = await Promise.all(sites.slice(0, 5).map(s => one(s, { quiet: true })));
    const c = compare(reports);
    if (flag('json')) return console.log(JSON.stringify(c, null, 2));
    console.log(c.summary + '\n');
    for (const r of c.ranked) console.log(`${r.host}  ${r.grade}/100  ${r.verdict}\n  ${Object.entries(r.areas).map(([k, v]) => `${AREA_NAME[k]} ${v}`).join(', ')}`);
    if (c.differences.length) { console.log('\nWhere they differ:'); for (const d of c.differences) console.log(`  ${d.check}: passes on ${d.passes.join(', ') || 'none'}; fails on ${d.fails.join(', ') || 'none'}`); }
    return;
  }
  if (cmd === 'batch') {
    /* Polite: one site at a time by default. Resumable: results are appended per site and sites
       already in the output file are skipped. A failure in under a second is our own connection,
       so it is retried, and if it never connects nothing is written. */
    const list = fs.readFileSync(words[1], 'utf8').split(/\r?\n/).map(s => s.trim()).filter(s => s && !s.startsWith('#'));
    const out = opt('out', 'results.jsonl');
    const done = new Set(fs.existsSync(out) ? fs.readFileSync(out, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l).host) : []);
    const todo = list.map(hostOf).filter(h => h && !done.has(h));
    say(`${list.length} sites, ${done.size} already scanned, ${todo.length} to go; PageSpeed ${psi === false ? 'off' : process.env.PAGESPEED_KEY || psi === true ? 'on' : 'off'}\n`);
    let n = 0;
    const work = async () => { while (todo.length) {
      const host = todo.shift(); let rec = null;
      for (let attempt = 0; attempt < 4; attempt++) {
        try { rec = await one(host, { quiet: true }); } catch (e) { rec = { host, verdict: 'error', error: e.message }; }
        const ours = /fetch failed/.test(rec.error || rec.findings?.home?.error || '');
        if (!ours) break;
        if (attempt === 3) { rec = null; say(`skipped for now (no connection): ${host}\n`); break; }
        await new Promise(ok => setTimeout(ok, [5000, 15000, 40000][attempt]));
      }
      if (rec) fs.appendFileSync(out, JSON.stringify(rec) + '\n');
      if (++n % 10 === 0 || !todo.length) say(`${n} done\n`);
    } };
    await Promise.all(Array.from({ length: Math.max(1, Number(opt('concurrency', 1))) }, work));
    return;
  }
  const r = await one(cmd);
  if (flag('json')) console.log(JSON.stringify({ ...explain(r), raw: r }, null, 2));
  else process.stdout.write(toText(r, { color }));
  process.exitCode = r.verdict === 'unreachable' ? 2 : 0;
}

main().catch(e => { say(`${e.message}\n`); process.exit(1); });
