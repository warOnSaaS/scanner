// Runs the scanner locally: node dev.mjs [port]   (default 8787)
// Reads .env.local if there is one (PAGESPEED_KEY, BLOB_READ_WRITE_TOKEN), keeps reports in ./reports.
import http from 'node:http';
import fs from 'node:fs';
import { createApp } from './server/app.mjs';
import { createService } from './server/service.mjs';
import { storeFromEnv } from './server/store.mjs';
import { limiter } from './server/limits.mjs';
import { createAuth } from './server/auth.mjs';

if (fs.existsSync('.env.local')) process.loadEnvFile?.('.env.local');

export function serve({ port = 0, service, auth } = {}) {
  auth ||= createAuth({ siteUrl: process.env.SITE_URL || `http://localhost:${port || 8787}` });
  service ||= createService({ store: storeFromEnv(process.env, 'reports'), limiter: limiter({ perTenMin: 60, perDay: 500 }), gate: auth.gate });
  const handle = createApp({ service, auth, serveStatic: true });
  const srv = http.createServer((req, res) => handle(req, res));
  return new Promise(ok => srv.listen(port, () => ok(srv)));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const srv = await serve({ port: Number(process.argv[2]) || 8787 });
  console.log(`scanner on http://localhost:${srv.address().port}  (PageSpeed ${process.env.PAGESPEED_KEY ? 'on' : 'off'}, sign-in ${process.env.WOS_ACCOUNT_CLIENT_ID ? 'warOnSaaS account' : 'off'})`);
}
