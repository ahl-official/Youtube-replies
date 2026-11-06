// Adds the video-request rule to the LIVE reply workflow's agent prompt (credentials kept).
const fs = require('fs'), path = require('path');
const envFile = ['.env', '.env.txt'].map((f) => path.join(__dirname, f)).find(fs.existsSync);
const env = {};
for (const l of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, ''); }
const base = env.N8N_BASE_URL.replace(/\/+$/, '');
const H = { 'X-N8N-API-KEY': env.N8N_API_KEY, 'Content-Type': 'application/json' };
const ID = 'ZRwUFsLyDCsLNq2j';
const anchor = '- Praise and thanks: a short, warm one-line reply is fine (confidence 0.9).';
const rule = '\n- Video or topic requests (e.g. "please make a video on X"): set should_reply true, category "video_request", confidence 0.9. Reply with a short thank-you saying we have noted the suggestion, in the commenter\'s language. Do not promise a date or that the video will be made, and do not answer the topic from memory.';
(async () => {
  const wf = await (await fetch(`${base}/api/v1/workflows/${ID}`, { headers: H })).json();
  const agent = wf.nodes.find((n) => n.type === '@n8n/n8n-nodes-langchain.agent');
  const msg = agent.parameters.options.systemMessage;
  if (msg.includes('video_request')) return console.log('rule already present');
  if (!msg.includes(anchor)) return console.log('anchor not found - prompt was edited; not changed');
  agent.parameters.options.systemMessage = msg.replace(anchor, anchor + rule);
  const r = await fetch(`${base}/api/v1/workflows/${ID}`, { method: 'PUT', headers: H,
    body: JSON.stringify({ name: wf.name, nodes: wf.nodes, connections: wf.connections, settings: { executionOrder: wf.settings?.executionOrder || 'v1' } }) });
  console.log('prompt updated, status', r.status);
})();
