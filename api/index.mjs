// The one Vercel function: every page, API route and the MCP endpoint go through server/app.mjs.
// Reports live in Vercel Blob when BLOB_READ_WRITE_TOKEN is set; PAGESPEED_KEY stays on the server.
import { createApp } from '../server/app.mjs';
import { createService } from '../server/service.mjs';
import { storeFromEnv, memoryStore } from '../server/store.mjs';

const service = createService({ store: process.env.BLOB_READ_WRITE_TOKEN ? storeFromEnv() : memoryStore() });
const handle = createApp({ service });

export const config = { maxDuration: 120 };
export default function handler(req, res) { return handle(req, res); }
