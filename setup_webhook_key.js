// Creates a fresh Header Auth credential in n8n with a random key, attaches it to the ingestion webhook,
// and saves the same key to .env.txt as N8N_WEBHOOK_KEY. The key is never printed.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const envPath = ['.env', '.env.txt'].map((f) => path.join(__dirname, f)).find(fs.existsSync);
let envText = fs.readFileSync(envPath, 'utf8');
const env = {};
for (const l of envText.split(/\r?\n/)) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, ''); }
const base = env.N8N_BASE_URL.replace(/\/+$/, '');
const H = { 'X-N8N-API-KEY': env.N8N_API_KEY, 'Content-Type': 'application/json' };
const ID = 'Fm3jcGDMuKnYDo6G';
(async () => {
  const key = crypto.randomBytes(24).toString('hex');
  const c = await fetch(`${base}/api/v1/credentials`, { method: 'POST', headers: H,
    body: JSON.stringify({ name: 'AHL Ingest Webhook Key', type: 'httpHeaderAuth', data: { name: 'x-api-key', value: key, allowedDomains: '' } }) });
  const cred = await c.json();
  console.log('credential create status', c.status, cred.id ? '' : JSON.stringify(cred).slice(0, 300));
  if (!cred.id) process.exit(1);
  const wf = await (await fetch(`${base}/api/v1/workflows/${ID}`, { headers: H })).json();
  for (const n of wf.nodes) if (n.type === 'n8n-nodes-base.webhook') n.credentials = { httpHeaderAuth: { id: cred.id, name: cred.name } };
  const r = await fetch(`${base}/api/v1/workflows/${ID}`, { method: 'PUT', headers: H,
    body: JSON.stringify({ name: wf.name, nodes: wf.nodes, connections: wf.connections, settings: { executionOrder: wf.settings?.executionOrder || 'v1' } }) });
  console.log('webhook node updated, status', r.status);
  envText = envText.replace(/^\s*N8N_WEBHOOK_(KEY|HEADER)\s*=.*\r?\n?/gm, '');
  if (!envText.endsWith('\n')) envText += '\r\n';
  fs.writeFileSync(envPath, envText + `N8N_WEBHOOK_KEY=${key}\r\nN8N_WEBHOOK_HEADER=x-api-key\r\n`);
  console.log('saved N8N_WEBHOOK_KEY to', path.basename(envPath));
})();
