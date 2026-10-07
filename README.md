# warOnSaaS Scanner

Can AI assistants read your website? Put in an address and in about thirty seconds you see what ChatGPT, Claude and Google can read on its home page, a score out of 100, and the fix for every gap.

- **A web page** where anyone enters a website and watches the scan happen, request by request, with a report page you can share.
- **An MCP server**, so Claude, ChatGPT, Claude Code and Codex can run scans, follow them, read reports and compare sites from their own agents.
- **An HTTP API**, JSON or a live stream.
- **A command line tool** and **a library** for Node.

No AI model is involved, so the same site gets the same score every time and a scan costs nothing to run. Apache-2.0.

## Everything a person can do, an agent can do

Every capability is one operation in `server/ops.mjs`. The MCP tools and the API routes are both generated from that list, and the web pages call those API routes, so a person and an agent go through the same functions. `test/parity.test.mjs` fails if that ever stops being true.

| What | Page | API | MCP tool |
|---|---|---|---|
| Scan a site | `/` | `GET\|POST /api/scan`, live: `GET /api/scan/stream` | `scan_site` |
| Re-scan it | Scan again on a report | `rescan=1` on the above | `scan_site` with `rescan: true` |
| Follow a scan in progress | the live console | `GET /api/scan/status?url=` | `get_scan_status` (and progress notifications during `scan_site`) |
| Read and share a report | `/report/<site>` | `GET /api/report/<site>` | `get_report` |
| Compare two to five sites | `/compare` | `GET\|POST /api/compare?urls=a.com,b.com` | `compare_sites` |
| List past scans | Recently scanned, on `/` | `GET /api/scans` | `list_recent_scans` |
| See what is checked | What it checks, on `/` | `GET /api/checks` | `list_checks` |

`GET /api` returns this table as JSON.

## Use it from your agent

The hosted scanner's MCP address is `https://waronsaas-scanner.vercel.app/mcp` (Streamable HTTP, no sign-in).

- **Claude** (web, desktop, phone): Settings, Connectors, Add custom connector, paste the address.
- **ChatGPT** (developer mode): Settings, Apps and Connectors, Create, paste the address.
- **Claude Code**: `claude mcp add --transport http scanner https://waronsaas-scanner.vercel.app/mcp`
- **Codex**: `codex mcp add scanner --url https://waronsaas-scanner.vercel.app/mcp`
- **Scanning from your own machine instead**: `claude mcp add scanner -- npx -y github:warOnSaaS/scanner mcp` (or the same command after `codex mcp add scanner --`). Reports are kept in `~/.cache/wos-scanner`.

Then ask: "Scan mysite.com and tell me the three fixes worth the most", or "Compare mysite.com with competitor.com".

## Command line

```
npx github:warOnSaaS/scanner example.com            # the report, in plain words
npx github:warOnSaaS/scanner example.com --json     # every finding as JSON
npx github:warOnSaaS/scanner compare a.com b.com    # side by side
npx github:warOnSaaS/scanner batch sites.txt --out results.jsonl   # many sites, resumable, one at a time
npx github:warOnSaaS/scanner checks                 # every check, why it matters, how to fix it
```

Google PageSpeed runs when `PAGESPEED_KEY` is set (or with `--pagespeed`); `--no-pagespeed` skips it.

## Library

```js
import { scan, explain, toText } from '@waronsaas/scanner';
const r = await scan('example.com', { onStep: s => console.log(s.label, s.state), pagespeed: false });
console.log(r.grade, explain(r).fixes[0]);
```

`src/scan.mjs` is the scan, `src/checks.mjs` holds every check's plain-English "why it matters" and "how to fix it", and `src/report.mjs` turns a scan into a summary, a list of fixes with their worth in points, a comparison or plain text.

## How the score works

Four areas, each scored out of 100 from weighted checks, then combined: what AI assistants can read 40%, search basics 25%, speed 25%, security basics 10%. The scan requests the home page and a handful of public files (llms.txt, llms-full.txt, ai.txt, .well-known/ucp, robots.txt, sitemap.xml), the way any crawler does, plus Google PageSpeed on a phone when a key is set. Without PageSpeed, the speed and security areas are scored from the remaining checks.

It only scans public websites: a name that resolves to a private or internal address is refused, and so is any redirect that leads to one.

## Run your own

```
npm install
npm run sync-kit          # copies the UI kit (warOnSaaS/ui-design, its main branch) into public/ui
npm run dev               # http://localhost:8787, reports kept in ./reports
npm test                  # the checks, the API, the MCP tools and the agent parity test
npm run shots             # screenshots at 1440 and 390 wide into .shots/
```

`public/ui` is git-ignored: it is a copy of ui-design made by `scripts/sync-kit.mjs`, which reads the kit's `main` branch through git so unfinished work on another branch never ships. `.vercelignore` still uploads it.

### Environment

| Variable | What it does |
|---|---|
| `PAGESPEED_KEY` | Optional. Google PageSpeed API key. Server-side only; never sent to the browser. Without it the scan leaves PageSpeed out and says so. |
| `BLOB_READ_WRITE_TOKEN` | Optional. Keeps reports in Vercel Blob so share links last. Without it, reports live in memory (or `./reports` locally). |
| `SITE_URL` | Optional. The public address used in share links. Defaults to the request's own host. |

Locally, put them in `.env.local` (git-ignored).

### Limits

A fresh scan fetches someone else's website and, with a key, spends a shared Google quota, so:

- a site scanned in the last day is served from that scan (re-scans wait a quarter of an hour);
- each visitor gets 6 fresh scans per ten minutes and 30 a day;
- the server stops at 2,000 fresh scans and 1,500 PageSpeed runs a day.

The counts live in each server instance's memory, so they are a floor. For a busy deployment add a rate-limit rule in the Vercel firewall on `/api/scan`, `/api/compare` and `/mcp`.

### Deploy on Vercel

```
npm run sync-kit
vercel link
vercel blob store add scanner-reports      # then connect it to the project, which sets BLOB_READ_WRITE_TOKEN
printf '%s' "$KEY" | vercel env add PAGESPEED_KEY production
vercel deploy --prod
```

One function (`api/index.mjs`) serves the pages, the API and `/mcp`; `public/` is served as files.

## License

Apache-2.0. The web page uses warOnSaaS ui-design (Apache-2.0) and its fonts (SIL Open Font License 1.1). See NOTICE.
