// Patches the LIVE ingestion workflow (credentials kept): adds a text splitter to the Document Loader.
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
(async () => {
  const wf = await (await fetch(`${base}/api/v1/workflows/${ID}`, { headers: H })).json();
  const loaderNew = fresh.nodes.find((n) => n.name === 'Document Loader');
  const splitter = fresh.nodes.find((n) => n.name === 'Text Splitter (keep chunks whole)');
  const loader = wf.nodes.find((n) => n.name === 'Document Loader');
  loader.typeVersion = loaderNew.typeVersion;
  loader.parameters = loaderNew.parameters;
  if (!wf.nodes.find((n) => n.name === splitter.name)) wf.nodes.push(splitter);
  wf.connections[splitter.name] = fresh.connections[splitter.name];
  const r = await fetch(`${base}/api/v1/workflows/${ID}`, {
    method: 'PUT', headers: H,
    body: JSON.stringify({ name: wf.name, nodes: wf.nodes, connections: wf.connections, settings: { executionOrder: wf.settings?.executionOrder || 'v1' } }),
  });
  console.log('patched, status', r.status);
})();
