// "The entire thing can be driven by an agent": everything the pages can do must also be an MCP
// tool and an API call, through the same functions. This test fails if that ever stops being true.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { OPERATIONS } from '../server/ops.mjs';
import { buildMcpServer } from '../server/mcp.mjs';
import { testServer } from './helpers.mjs';

// What a person can do on the pages, and the operation that does it.
const PAGE_CAPABILITIES = {
  'scan a site': 'scan',
  'watch a scan in progress': 'scan_status',
  're-scan a site': 'scan',
  'read a report': 'report',
  'share a report': 'report',
  'compare sites': 'compare',
  'list past scans': 'recent',
  'see what is checked': 'checks',
};

const argsFor = { scan: { url: 'good.test' }, scan_status: { url: 'good.test' }, report: { url: 'good.test' }, compare: { urls: 'good.test,empty.test' }, recent: {}, checks: {} };

test('every page capability is an operation with an MCP tool and an API route', () => {
  for (const [what, id] of Object.entries(PAGE_CAPABILITIES)) {
    const op = OPERATIONS.find(o => o.id === id);
    assert.ok(op, `${what}: no operation`);
    assert.ok(op.tool, `${what}: no MCP tool`);
    assert.ok(op.api.length, `${what}: no API route`);
  }
  assert.ok(OPERATIONS.find(o => o.id === 'scan').input.rescan, 're-scan is an input of scan');
});

test('the browser script only calls API routes that are operations', () => {
  const js = fs.readFileSync('public/app/scan.js', 'utf8');
  const called = [...js.matchAll(/['"](\/api\/[a-z/-]+)/g)].map(m => m[1]);
  assert.ok(called.length >= 3);
  const routes = OPERATIONS.flatMap(o => [...o.api.map(([, p]) => p), o.stream].filter(Boolean));
  for (const c of called) assert.ok(routes.some(r => r === c || r.startsWith(c)), `the page calls ${c}, which is not an operation's route`);
});

test('the same call through MCP and through the API gives the same answer', async () => {
  const s = await testServer();
  try {
    const server = buildMcpServer(s.service, { reportUrl: slug => `http://scanner.test/report/${slug}` });
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'parity', version: '1' });
    await Promise.all([server.connect(a), client.connect(b)]);
    const { tools } = await client.listTools();
    const manifest = await (await fetch(`${s.base}/api`)).json();
    await fetch(`${s.base}/api/scan?url=empty.test`);

    for (const op of OPERATIONS) {
      assert.ok(tools.some(t => t.name === op.tool), `MCP is missing ${op.tool}`);
      const m = manifest.operations.find(x => x.id === op.id);
      assert.equal(m.mcpTool, op.tool);

      const [method, route] = op.api[0];
      const args = argsFor[op.id];
      const url = new URL(s.base + route.replace(':slug', 'good-test'));
      if (!route.includes(':slug')) for (const [k, v] of Object.entries(args)) url.searchParams.set(k, v);
      const api = await (await fetch(url, { method })).json();
      assert.equal(api.ok, true, `${method} ${route}: ${api.error}`);

      const mcpArgs = op.id === 'compare' ? { urls: args.urls.split(',') } : args;
      const viaMcp = await client.callTool({ name: op.tool, arguments: mcpArgs });
      assert.ok(!viaMcp.isError, `${op.tool}: ${viaMcp.content?.[0]?.text}`);
      const { ok, ...rest } = api;
      const strip = o => JSON.parse(JSON.stringify(o, (k, v) => (k === 'cached' ? undefined : v)));
      assert.deepEqual(strip(viaMcp.structuredContent), strip(rest), `${op.id}: MCP and API differ`);
    }
  } finally { await s.close(); }
});
