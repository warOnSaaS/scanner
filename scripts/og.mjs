// Draws public/og.png, the picture a shared link shows, from the kit's own fonts and theme.
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
const ui = p => 'file://' + path.resolve('public/ui', p);
const tank = fs.readFileSync('public/ui/logo.svg', 'utf8').replace(/<!--[\s\S]*?-->/, '').replace(/ width="\d+" height="\d+"/, ' width="96"');
const html = `<!doctype html><html><head><link rel="stylesheet" href="${ui('src/ui.css')}"><link rel="stylesheet" href="${ui('themes/midnight.css')}"><style>
body{margin:0;width:1200px;height:630px;display:flex;flex-direction:column;justify-content:center;padding:0 90px;box-sizing:border-box;
background:radial-gradient(900px 500px at 70% 0%,rgba(125,211,252,.16),transparent 70%),#09090b}
.k{font:22px var(--ui-numeric);letter-spacing:.08em;text-transform:uppercase;color:var(--ui-accent);margin:34px 0 18px}
h1{font:600 78px/1.02 var(--ui-display);letter-spacing:-.05em;margin:0;max-width:15ch;background:linear-gradient(180deg,#fff 35%,#a1a1aa);-webkit-background-clip:text;color:transparent}
p{font:26px var(--ui-font);color:var(--ui-ink-2);margin:26px 0 0}
.g{position:absolute;right:90px;bottom:80px;font:400 150px/1 var(--ui-numeric);color:#22c55e}.g small{font-size:30px;color:var(--ui-ink-3)}
svg{image-rendering:pixelated;shape-rendering:crispEdges}</style></head><body>
${tank}<div class="k">warOnSaaS Scanner</div><h1>Can AI assistants read your website?</h1><p>Free scan, score out of 100, the fix for every gap.</p><div class="g">92<small>/100</small></div></body></html>`;
fs.writeFileSync('.shots/og.html', html);
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1200, height: 630 } });
await p.goto('file://' + path.resolve('.shots/og.html')); await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(200);
await p.screenshot({ path: 'public/og.png' }); await b.close(); console.log('wrote public/og.png');
