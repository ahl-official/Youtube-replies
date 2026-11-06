// Patches the LIVE ingestion workflow (keeps your credentials): new webhook chunk code + daily trigger off.
const fs = require('fs'), path = require('path');
const envFile = ['.env', '.env.txt'].map((f) => path.join(__dirname, f)).find(fs.existsSync);
const env = {};
for (const l of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const base = env.N8N_BASE_URL.replace(/\/+$/, '');
const H = { 'X-N8N-API-KEY': env.N8N_API_KEY, 'Content-Type': 'application/json' };
const ID = 'Fm3jcGDMuKnYDo6G';
const fresh = JSON.parse(fs.readFileSync(path.join(__dirname, 'ingest_workflow.json'), 'utf8'));
const newCode = fresh.nodes.find((n) => n.name === 'Chunk External Text').parameters.jsCode;
(async () => {
  const wf = await (await fetch(`${base}/api/v1/workflows/${ID}`, { headers: H })).json();
  for (const n of wf.nodes) {
    if (n.name === 'Chunk External Text') n.parameters.jsCode = newCode;
    if (n.name === 'Daily at 3 AM') n.disabled = true;
  }
  const r = await fetch(`${base}/api/v1/workflows/${ID}`, {
    method: 'PUT', headers: H,
    body: JSON.stringify({ name: wf.name, nodes: wf.nodes, connections: wf.connections, settings: { executionOrder: wf.settings?.executionOrder || 'v1' } }),
  });
  console.log('patched ingestion workflow, status', r.status);
})();
