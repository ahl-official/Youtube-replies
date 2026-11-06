// Removes the dead YouTube-API nodes from the LIVE ingestion workflow (keeps credentials on the rest).
const fs = require('fs'), path = require('path');
const envFile = ['.env', '.env.txt'].map((f) => path.join(__dirname, f)).find(fs.existsSync);
const env = {};
for (const l of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, ''); }
const base = env.N8N_BASE_URL.replace(/\/+$/, '');
const H = { 'X-N8N-API-KEY': env.N8N_API_KEY, 'Content-Type': 'application/json' };
const ID = 'Fm3jcGDMuKnYDo6G';
const keep = new Set(JSON.parse(fs.readFileSync(path.join(__dirname, 'ingest_workflow.json'), 'utf8')).nodes.map((n) => n.name));
(async () => {
  const wf = await (await fetch(`${base}/api/v1/workflows/${ID}`, { headers: H })).json();
  wf.nodes = wf.nodes.filter((n) => keep.has(n.name));
  for (const k of Object.keys(wf.connections)) {
    if (!keep.has(k)) { delete wf.connections[k]; continue; }
    for (const t of Object.keys(wf.connections[k])) wf.connections[k][t] = wf.connections[k][t].map((g) => g.filter((c) => keep.has(c.node)));
  }
  const r = await fetch(`${base}/api/v1/workflows/${ID}`, { method: 'PUT', headers: H,
    body: JSON.stringify({ name: wf.name, nodes: wf.nodes, connections: wf.connections, settings: { executionOrder: wf.settings?.executionOrder || 'v1' } }) });
  console.log('status', r.status, '| nodes now:', wf.nodes.map((n) => n.name).join(', '));
})();
