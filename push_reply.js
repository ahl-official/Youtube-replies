// Rebuilds workflow.json (run `node build_workflow.js` first) and pushes it to the LIVE reply workflow,
// keeping the credentials already attached in n8n. New nodes borrow credentials from existing ones.
const fs = require('fs'), path = require('path');
const envFile = ['.env', '.env.txt'].map((f) => path.join(__dirname, f)).find(fs.existsSync);
const env = {};
for (const l of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, ''); }
const base = env.N8N_BASE_URL.replace(/\/+$/, '');
const H = { 'X-N8N-API-KEY': env.N8N_API_KEY, 'Content-Type': 'application/json' };
const ID = 'ZRwUFsLyDCsLNq2j';
const fresh = JSON.parse(fs.readFileSync(path.join(__dirname, 'workflow.json'), 'utf8'));
(async () => {
  const wf = await (await fetch(`${base}/api/v1/workflows/${ID}`, { headers: H })).json();
  const liveCred = (name) => (wf.nodes.find((n) => n.name === name) || {}).credentials;
  const borrow = {
    'Post Reply to YouTube': 'Fetch Channel Comments',
    'Posting Channel': 'Fetch Channel Comments',
    'Post One Reply': 'Fetch Channel Comments',
    'Log: Replied': 'Knowledge Base (Supabase)',
    'Log: Needs Human / Skipped': 'Knowledge Base (Supabase)',
    'Video Chunks': 'Knowledge Base (Supabase)',
  };
  for (const n of fresh.nodes) {
    const c = liveCred(n.name) || (borrow[n.name] && liveCred(borrow[n.name]));
    if (c) n.credentials = c;
    else if (/Supabase|YouTube|Fetch|Chat Model|Embeddings|Log:/.test(n.name)) console.log('! no credential found for', n.name);
  }
  const r = await fetch(`${base}/api/v1/workflows/${ID}`, { method: 'PUT', headers: H,
    body: JSON.stringify({ name: fresh.name, nodes: fresh.nodes, connections: fresh.connections, settings: { executionOrder: 'v1' } }) });
  const body = await r.json().catch(() => ({}));
  console.log('status', r.status, r.ok ? '' : JSON.stringify(body).slice(0, 500));
})();
