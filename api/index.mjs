// The one Vercel function: every page, API route and the MCP endpoint go through server/app.mjs.
// Reports live in Vercel Blob when BLOB_READ_WRITE_TOKEN is set; PAGESPEED_KEY stays on the server.
// Sign-in: with WOS_ACCOUNT_CLIENT_ID and AUTH_PROVIDER=waronsaas, scans need a warOnSaaS account and are
// counted per account; the per-visitor limits then only stand as a backstop. Without them the scanner runs open.
import { createApp } from '../server/app.mjs';
import { createService } from '../server/service.mjs';
import { storeFromEnv, memoryStore } from '../server/store.mjs';
import { limiter } from '../server/limits.mjs';
import { createAuth } from '../server/auth.mjs';

const auth = createAuth();
const service = createService({
  store: process.env.BLOB_READ_WRITE_TOKEN ? storeFromEnv() : memoryStore(),
  gate: auth.gate,
  ...(auth.mode === 'waronsaas' && { limiter: limiter({ perTenMin: 20, perDay: 200 }) }),
});
const handle = createApp({ service, auth });

export const config = { maxDuration: 120 };
export default function handler(req, res) { return handle(req, res); }
