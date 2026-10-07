import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { buildMcpServer } from '../server/mcp.mjs';
import { testService, testServer } from './helpers.mjs';

async function connect(service = testService()) {
  const server = buildMcpServer(service, { reportUrl: slug => `https://scanner.test/report/${slug}` });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '1' });
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}
const textOf = r => r.content.map(c => c.text).join('\n');

test('the tools an agent sees', async () => {
  const c = await connect();
  const { tools } = await c.listTools();
  assert.deepEqual(tools.map(t => t.name).sort(), ['compare_sites', 'get_report', 'get_scan_status', 'list_checks', 'list_recent_scans', 'scan_site']);
  for (const t of tools) { assert.ok(t.description.length > 40, t.name); assert.equal(t.annotations.readOnlyHint, true); }
});

test('scan_site: a score, the top fixes, a share link and progress as it goes', async () => {
  const c = await connect();
  const progress = [];
  const r = await c.callTool({ name: 'scan_site', arguments: { url: 'empty.test' } }, undefined, { onprogress: p => progress.push(p) });
  assert.ok(!r.isError);
  assert.match(textOf(r), /empty\.test: \d+\/100/);
  assert.match(textOf(r), /Top fixes:/);
  assert.match(textOf(r), /Share this report: https:\/\/scanner.test\/report\/empty-test/);
  assert.equal(r.structuredContent.scan.host, 'empty.test');
  assert.ok(progress.length >= 5, `got ${progress.length} progress notes`);
  assert.ok(progress.some(p => /llms\.txt/.test(p.message)));
});

test('scan_site with rescan, get_report summary and full, get_scan_status', async () => {
  const c = await connect();
  await c.callTool({ name: 'scan_site', arguments: { url: 'good.test' } });
  const again = await c.callTool({ name: 'scan_site', arguments: { url: 'good.test', rescan: true } });
  assert.equal(again.structuredContent.cached, true, 'a re-scan within a quarter of an hour is answered from the scan just made');
  const sum = await c.callTool({ name: 'get_report', arguments: { url: 'https://good.test' } });
  assert.match(textOf(sum), /good\.test: 100\/100/);
  const full = await c.callTool({ name: 'get_report', arguments: { url: 'good.test', detail: 'full' } });
  assert.match(textOf(full), /PASS Title tag/);
  assert.match(textOf(full), /llms\.txt/);
  const st = await c.callTool({ name: 'get_scan_status', arguments: { url: 'good.test' } });
  assert.equal(st.structuredContent.state, 'done');
  const missing = await c.callTool({ name: 'get_report', arguments: { url: 'nobody.test' } });
  assert.equal(missing.isError, true);
  assert.match(textOf(missing), /Scan it first/);
});

test('compare_sites, list_recent_scans and list_checks', async () => {
  const c = await connect();
  const cmp = await c.callTool({ name: 'compare_sites', arguments: { urls: ['good.test', 'empty.test', 'blocked.test'] } });
  assert.match(textOf(cmp), /good\.test leads with 100/);
  assert.match(textOf(cmp), /Where they differ:/);
  assert.equal(cmp.structuredContent.sites.length, 3);
  const one = await c.callTool({ name: 'compare_sites', arguments: { urls: ['good.test', 'www.good.test'] } });
  assert.equal(one.isError, true);
  const recent = await c.callTool({ name: 'list_recent_scans', arguments: { limit: 2 } });
  assert.equal(recent.structuredContent.scans.length, 2);
  const checks = await c.callTool({ name: 'list_checks', arguments: {} });
  assert.match(textOf(checks), /Structured data that parses\. Why:/);
});

test('errors come back as plain words, not crashes', async () => {
  const c = await connect();
  const r = await c.callTool({ name: 'scan_site', arguments: { url: 'internal.test' } });
  assert.equal(r.isError, true);
  assert.match(textOf(r), /public website/);
});

test('the hosted endpoint: POST /mcp over Streamable HTTP', async () => {
  const s = await testServer();
  try {
    const client = new Client({ name: 'http-test', version: '1' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${s.base}/mcp`)));
    const r = await client.callTool({ name: 'scan_site', arguments: { url: 'good.test', include_pagespeed: false } });
    assert.match(textOf(r), /good\.test: 100\/100/);
    assert.match(textOf(r), /http:\/\/scanner.test\/report\/good-test/);
    await client.close();
    assert.equal((await fetch(`${s.base}/mcp`)).status, 405);
  } finally { await s.close(); }
});
