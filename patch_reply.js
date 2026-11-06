// Patches the LIVE reply workflow (credentials kept) from the freshly built workflow.json:
// robust JSON parsing, per-run comment cap, stricter output rule, cheaper model.
const fs = require('fs'), path = require('path');
const envFile = ['.env', '.env.txt'].map((f) => path.join(__dirname, f)).find(fs.existsSync);
const env = {};
for (const l of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, ''); }
const base = env.N8N_BASE_URL.replace(/\/+$/, '');
const H = { 'X-N8N-API-KEY': env.N8N_API_KEY, 'Content-Type': 'application/json' };
const ID = 'ZRwUFsLyDCsLNq2j';
const fresh = JSON.parse(fs.readFileSync(path.join(__dirname, 'workflow.json'), 'utf8'));
const f = (name) => fresh.nodes.find((n) => n.name === name);
(async () => {
  const wf = await (await fetch(`${base}/api/v1/workflows/${ID}`, { headers: H })).json();
  const live = (name) => wf.nodes.find((n) => n.name === name);
  live('Parse Answer').parameters.jsCode = f('Parse Answer').parameters.jsCode;
  live('Filter New Comments').parameters.jsCode = f('Filter New Comments').parameters.jsCode;
  live('Config').parameters = f('Config').parameters;
  live('Answer From Knowledge Base').parameters.options.systemMessage = f('Answer From Knowledge Base').parameters.options.systemMessage;
  live('Chat Model (OpenRouter)').parameters.model = f('Chat Model (OpenRouter)').parameters.model;
  const r = await fetch(`${base}/api/v1/workflows/${ID}`, { method: 'PUT', headers: H,
    body: JSON.stringify({ name: wf.name, nodes: wf.nodes, connections: wf.connections, settings: { executionOrder: wf.settings?.executionOrder || 'v1' } }) });
  console.log('status', r.status);
})();
