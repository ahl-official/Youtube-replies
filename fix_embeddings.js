// Sets the Embeddings model to an expression so n8n skips its fixed-list validation.
// Reads the LIVE workflow, changes only that parameter, writes it back (credentials preserved).
const fs = require('fs'), path = require('path');
const envFile = ['.env', '.env.txt'].map(f => path.join(__dirname, f)).find(fs.existsSync);
const env = {};
for (const l of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const base = env.N8N_BASE_URL.replace(/\/+$/, '');
const H = { 'X-N8N-API-KEY': env.N8N_API_KEY, 'Content-Type': 'application/json' };
(async () => {
  for (const id of ['ZRwUFsLyDCsLNq2j', 'Fm3jcGDMuKnYDo6G']) {
    const wf = await (await fetch(`${base}/api/v1/workflows/${id}`, { headers: H })).json();
    let n = 0;
    for (const node of wf.nodes) {
      if (node.type === '@n8n/n8n-nodes-langchain.embeddingsOpenAi') {
        node.parameters.model = "={{ 'openai/text-embedding-3-small' }}"; n++;
      }
    }
    const body = { name: wf.name, nodes: wf.nodes, connections: wf.connections, settings: { executionOrder: wf.settings?.executionOrder || 'v1' } };
    const r = await fetch(`${base}/api/v1/workflows/${id}`, { method: 'PUT', headers: H, body: JSON.stringify(body) });
    console.log(wf.name, '| embeddings nodes changed:', n, '| status', r.status,
      '| credentials kept on embeddings:', wf.nodes.filter(x => x.type.includes('embeddingsOpenAi')).every(x => x.credentials));
  }
})();
