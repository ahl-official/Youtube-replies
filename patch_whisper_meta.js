// Patches the LIVE ingestion workflow (credentials kept):
// chunk code + document metadata store transcript (universal-2) and language.
// A workflow PUT can turn the webhook off, so this turns it back on.
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
const fromFresh = (name) => fresh.nodes.find((n) => n.name === name);

(async () => {
  const wf = await (await fetch(`${base}/api/v1/workflows/${ID}`, { headers: H })).json();
  if (!wf.nodes) { console.error(JSON.stringify(wf).slice(0, 400)); process.exit(1); }
  const live = (name) => wf.nodes.find((n) => n.name === name);
  const chunk = live('Chunk External Text');
  const loader = live('Document Loader');
  if (!chunk || !loader) { console.error('missing nodes'); process.exit(1); }
  chunk.parameters.jsCode = fromFresh('Chunk External Text').parameters.jsCode;
  loader.parameters = fromFresh('Document Loader').parameters;
  const r = await fetch(`${base}/api/v1/workflows/${ID}`, {
    method: 'PUT', headers: H,
    body: JSON.stringify({
      name: wf.name,
      nodes: wf.nodes,
      connections: wf.connections,
      settings: { executionOrder: wf.settings?.executionOrder || 'v1' },
    }),
  });
  const body = await r.json().catch(() => ({}));
  const saved = (body.nodes || []).find((n) => n.name === 'Document Loader');
  const names = saved?.parameters?.options?.metadata?.metadataValues?.map((m) => m.name) || [];
  console.log('status', r.status, 'active', body.active, 'metadata', names.join(', '));
  if (!r.ok) process.exit(1);
  if (!body.active) {
    const on = await fetch(`${base}/api/v1/workflows/${ID}/activate`, { method: 'POST', headers: H });
    const turned = await on.json().catch(() => ({}));
    console.log('activate', on.status, 'active', turned.active);
    if (!on.ok) process.exit(1);
  }
})();
