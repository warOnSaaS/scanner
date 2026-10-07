/* The scanner as MCP tools, so Claude, ChatGPT, Claude Code and Codex can run scans and read
   reports from their own agents. The tools are generated from ops.mjs, the same list the API
   routes come from. The same server runs two ways:
     hosted   POST /mcp on the web app (Streamable HTTP, no sign-in)
     local    `wos-scan mcp` over stdio, scanning from your own machine */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { OPERATIONS, runOperation } from './ops.mjs';

export const INSTRUCTIONS = `This server scans websites for what AI assistants and search engines can read on the home page, and scores them out of 100 with the fix for every gap.
Tools: scan_site (one site; rescan: true to scan again), get_scan_status (follow a scan in progress), get_report (a site's last report and share link), compare_sites (two to five sites), list_recent_scans, list_checks.
A scan takes about 10 to 40 seconds and reports progress as it goes. Sites scanned in the last day come back from that scan instantly. Explain results in plain words: lead with the score and the top fixes, and give the share link.`;

/* service: from service.mjs. reportUrl(slug): the shareable report page. */
export function buildMcpServer(service, { reportUrl = slug => `/report/${slug}`, ip = '' } = {}) {
  const server = new McpServer({ name: 'waronsaas-scanner', version: '0.1.0' }, { instructions: INSTRUCTIONS });
  for (const op of OPERATIONS) {
    server.registerTool(op.tool, { title: op.title, description: op.description, inputSchema: op.input, annotations: { ...op.annotations, idempotentHint: true } },
      async (args, extra) => {
        // Progress, the way the web page shows it: each request as it finishes, as MCP progress notifications.
        const token = extra?._meta?.progressToken;
        let n = 0;
        const onStep = token === undefined ? undefined : s => {
          if (s.state === 'run') return;
          extra.sendNotification({ method: 'notifications/progress', params: { progressToken: token, progress: ++n, total: 12, message: `${s.label}: ${s.note || s.state}` } }).catch(() => {});
        };
        try {
          const { data, text } = await runOperation(op.id, args, { service, ip, reportUrl, onStep });
          return { content: [{ type: 'text', text }], structuredContent: data };
        } catch (e) {
          return { isError: true, content: [{ type: 'text', text: e.status ? e.message : `That did not finish: ${e.message}` }] };
        }
      });
  }
  return server;
}
