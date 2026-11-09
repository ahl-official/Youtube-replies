// Builds the knowledge-base INGESTION workflow and (optionally) pushes it to n8n.
// Usage: node build_ingest.js            -> writes ingest_workflow.json only
//        node build_ingest.js --push     -> also creates it in n8n (reads .env.txt / .env)
const fs = require('fs');
const path = require('path');

const CHANNEL_ID = 'UCKNwds5t-KBGMp6VzvfAr6A'; // @AmericanHairline

const listVideosCode = `// Flatten the uploads playlist and keep only videos not ingested yet
const store = $getWorkflowStaticData('global');
store.ingested = store.ingested || [];
const batchSize = $('Config').first().json.videosPerRun;
const videos = [];
for (const page of $input.all()) {
  for (const it of (page.json.items || [])) {
    const id = it.contentDetails.videoId;
    if (store.ingested.includes(id)) continue;
    videos.push({ json: {
      videoId: id,
      title: it.snippet.title,
      publishedAt: it.contentDetails.videoPublishedAt || it.snippet.publishedAt,
    }});
  }
}
return videos.slice(0, batchSize);`;

const pickTrackCode = `// Choose the best caption track: manual > auto, English/Hindi preferred
const video = $('Loop Videos').item.json;
const tracks = ($json.items || []);
if (!tracks.length) return [{ json: { ...video, captionId: null } }];
const score = (t) => {
  const s = t.snippet;
  let n = 0;
  if (s.trackKind === 'standard') n += 10;
  if (/^(en|hi)/i.test(s.language)) n += 5;
  if (s.isDraft) n -= 20;
  return n;
};
tracks.sort((a, b) => score(b) - score(a));
return [{ json: { ...video, captionId: tracks[0].id, language: tracks[0].snippet.language } }];`;

const chunkCode = `// Turn an SRT transcript into ~350-word chunks that keep the start timestamp
const video = $('Pick Caption Track').item.json;
const srt = String($json.data || $json.body || '');
const toSec = (t) => {
  const [h, m, rest] = t.split(':');
  const [s] = rest.split(',');
  return (+h) * 3600 + (+m) * 60 + (+s);
};
const blocks = srt.replace(/\\r/g, '').split(/\\n\\n+/);
const chunks = [];
let words = [], start = 0;
const TARGET = 350;
for (const b of blocks) {
  const lines = b.split('\\n');
  const tIdx = lines.findIndex((l) => l.includes('-->'));
  if (tIdx === -1) continue;
  const text = lines.slice(tIdx + 1).join(' ').replace(/<[^>]+>/g, '').trim();
  if (!text) continue;
  if (!words.length) start = toSec(lines[tIdx].split('-->')[0].trim());
  words.push(...text.split(/\\s+/));
  if (words.length >= TARGET) {
    chunks.push({ text: words.join(' '), start });
    words = [];
  }
}
if (words.length > 40) chunks.push({ text: words.join(' '), start });
return chunks.map((c) => ({ json: {
  text: c.text,
  source: 'youtube',
  videoId: video.videoId,
  title: video.title,
  start: c.start,
  url: 'https://www.youtube.com/watch?v=' + video.videoId + '&t=' + c.start + 's',
}}));`;

const markDoneCode = `// Remember this video so it is not ingested twice, then hand one item back to the loop
const store = $getWorkflowStaticData('global');
store.ingested = store.ingested || [];
const id = $('Pick Caption Track').item.json.videoId;
if (!store.ingested.includes(id)) store.ingested.push(id);
return [{ json: { videoId: id, status: 'ingested' } }];`;

const skipNoCaptionCode = `// No captions available: remember it so we do not retry forever
const store = $getWorkflowStaticData('global');
store.ingested = store.ingested || [];
store.noCaptions = store.noCaptions || [];
const id = $json.videoId;
if (!store.ingested.includes(id)) store.ingested.push(id);
if (!store.noCaptions.includes(id)) store.noCaptions.push(id);
return [{ json: { videoId: id, status: 'no captions - needs Whisper or manual upload' } }];`;

const webhookChunkCode = `// External knowledge: POST {title, text, source?} -> chunks of ~350 words
// Or pre-chunked AssemblyAI transcripts: {title, videoId, type, transcript, language, chunks:[{text,start,url}]}
const body = $json.body || $json;
if (Array.isArray(body.chunks)) {
  return body.chunks.filter((c) => c && c.text).map((c) => ({ json: {
    text: String(c.text),
    source: 'youtube',
    videoId: body.videoId || '',
    type: body.type || 'video',
    title: body.title || 'Video',
    start: c.start || 0,
    url: c.url || '',
    transcript: body.transcript || 'universal-2',
    language: body.language || '',
    channel: body.channel || 'ahl',
  }}));
}
const title = body.title || 'External document';
const source = body.source || 'external';
const text = String(body.text || '').replace(/\\s+/g, ' ').trim();
if (!text) throw new Error('Body needs a "text" field');
const w = text.split(' ');
const out = [];
for (let i = 0; i < w.length; i += 350) {
  out.push({ json: {
    text: w.slice(i, i + 350).join(' '),
    source: 'external',
    type: 'document',
    videoId: '',
    title,
    start: 0,
    url: /^https?:/.test(source) ? source : '',
    transcript: '',
    language: '',
    channel: body.channel || 'ahl',
  }});
}
return out;`;

const nodes = [
  { parameters: {}, id: 'i1', name: 'Run Manually', type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, position: [0, 200] },
  {
    parameters: { rule: { interval: [{ field: 'days', daysInterval: 1, triggerAtHour: 3 }] } },
    id: 'i2', name: 'Daily at 3 AM', type: 'n8n-nodes-base.scheduleTrigger', typeVersion: 1.2, position: [0, 400],
    disabled: true, // YouTube API cannot download auto-captions (403); use ingest_local.js instead
  },
  {
    parameters: {
      assignments: { assignments: [
        { id: 'a1', name: 'channelId', value: CHANNEL_ID, type: 'string' },
        { id: 'a2', name: 'uploadsPlaylistId', value: '=UU' + CHANNEL_ID.slice(2), type: 'string' },
        { id: 'a3', name: 'videosPerRun', value: 10, type: 'number' },
      ]},
      options: {},
    },
    id: 'i3', name: 'Config', type: 'n8n-nodes-base.set', typeVersion: 3.4, position: [220, 300],
  },
  {
    parameters: {
      url: 'https://www.googleapis.com/youtube/v3/playlistItems',
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'youTubeOAuth2Api',
      sendQuery: true,
      queryParameters: { parameters: [
        { name: 'part', value: 'snippet,contentDetails' },
        { name: 'playlistId', value: '={{ $json.uploadsPlaylistId }}' },
        { name: 'maxResults', value: '50' },
      ]},
      options: {
        pagination: { pagination: {
          paginationMode: 'updateAParameterInEachRequest',
          parameters: { parameters: [{ type: 'qs', name: 'pageToken', value: '={{ $response.body.nextPageToken }}' }] },
          paginationCompleteWhen: 'other',
          completeExpression: '={{ !$response.body.nextPageToken }}',
          limitPagesFetched: true,
          maxRequests: 10,
        }},
      },
    },
    id: 'i4', name: 'List Channel Videos', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [440, 300],
  },
  { parameters: { jsCode: listVideosCode }, id: 'i5', name: 'New Videos Only', type: 'n8n-nodes-base.code', typeVersion: 2, position: [660, 300] },
  { parameters: { batchSize: 1, options: {} }, id: 'i6', name: 'Loop Videos', type: 'n8n-nodes-base.splitInBatches', typeVersion: 3, position: [880, 300] },
  {
    parameters: {
      url: 'https://www.googleapis.com/youtube/v3/captions',
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'youTubeOAuth2Api',
      sendQuery: true,
      queryParameters: { parameters: [
        { name: 'part', value: 'snippet' },
        { name: 'videoId', value: '={{ $json.videoId }}' },
      ]},
      options: {},
    },
    id: 'i7', name: 'List Captions', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [1100, 300],
  },
  { parameters: { jsCode: pickTrackCode }, id: 'i8', name: 'Pick Caption Track', type: 'n8n-nodes-base.code', typeVersion: 2, position: [1320, 300] },
  {
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' },
        conditions: [{ id: 'c1', leftValue: '={{ $json.captionId }}', rightValue: '', operator: { type: 'string', operation: 'notEmpty', singleValue: true } }],
        combinator: 'and',
      },
      options: {},
    },
    id: 'i9', name: 'Has Captions?', type: 'n8n-nodes-base.if', typeVersion: 2.2, position: [1540, 300],
  },
  {
    parameters: {
      url: '=https://www.googleapis.com/youtube/v3/captions/{{ $json.captionId }}',
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'youTubeOAuth2Api',
      sendQuery: true,
      queryParameters: { parameters: [{ name: 'tfmt', value: 'srt' }] },
      options: { response: { response: { responseFormat: 'text', outputPropertyName: 'data' } } },
    },
    id: 'i10', name: 'Download Transcript', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [1760, 200],
  },
  { parameters: { jsCode: chunkCode }, id: 'i11', name: 'Chunk Transcript', type: 'n8n-nodes-base.code', typeVersion: 2, position: [1980, 200] },
  {
    parameters: {
      mode: 'insert',
      tableName: 'documents',
      options: { queryName: 'match_documents' },
    },
    id: 'i12', name: 'Save to Knowledge Base', type: '@n8n/n8n-nodes-langchain.vectorStoreSupabase', typeVersion: 1.1, position: [2200, 200],
  },
  {
    parameters: {
      jsonMode: 'expressionData',
      textSplittingMode: 'custom',
      jsonData: '={{ $json.text }}',
      options: { metadata: { metadataValues: [
        { name: 'source', value: '={{ $json.source }}' },
        { name: 'type', value: '={{ $json.type }}' },
        { name: 'videoId', value: '={{ $json.videoId }}' },
        { name: 'title', value: '={{ $json.title }}' },
        { name: 'start', value: '={{ $json.start }}' },
        { name: 'url', value: '={{ $json.url }}' },
        { name: 'transcript', value: '={{ $json.transcript }}' },
        { name: 'language', value: '={{ $json.language }}' },
        { name: 'channel', value: '={{ $json.channel }}' },
      ]}},
    },
    id: 'i13', name: 'Document Loader', type: '@n8n/n8n-nodes-langchain.documentDefaultDataLoader', typeVersion: 1.1, position: [2120, 440],
  },
  {
    // chunks are already ~350 words (~2,000 chars); a big size keeps them whole
    parameters: { chunkSize: 4000, chunkOverlap: 0, options: {} },
    id: 'i17', name: 'Text Splitter (keep chunks whole)', type: '@n8n/n8n-nodes-langchain.textSplitterRecursiveCharacterTextSplitter',
    typeVersion: 1, position: [2120, 640],
  },
  {
    parameters: { model: 'openai/text-embedding-3-small', options: {} },
    id: 'i14', name: 'Embeddings', type: '@n8n/n8n-nodes-langchain.embeddingsOpenAi', typeVersion: 1.2, position: [2300, 440],
  },
  { parameters: { jsCode: markDoneCode }, id: 'i15', name: 'Mark Ingested', type: 'n8n-nodes-base.code', typeVersion: 2, position: [2420, 200] },
  { parameters: { jsCode: skipNoCaptionCode }, id: 'i16', name: 'Mark No Captions', type: 'n8n-nodes-base.code', typeVersion: 2, position: [1760, 420] },

  // ---- External knowledge entry point (docs, FAQs, pasted text) ----
  {
    parameters: { httpMethod: 'POST', path: 'ahl-ingest', authentication: 'headerAuth', responseMode: 'onReceived', options: {} },
    id: 'w1', name: 'Add External Knowledge (Webhook)', type: 'n8n-nodes-base.webhook', typeVersion: 2, position: [0, 760],
    webhookId: 'ahl-ingest-knowledge',
  },
  { parameters: { jsCode: webhookChunkCode }, id: 'w2', name: 'Chunk External Text', type: 'n8n-nodes-base.code', typeVersion: 2, position: [2000, 760] },
];

const m = (node) => ({ node, type: 'main', index: 0 });
const connections = {
  'Run Manually': { main: [[m('Config')]] },
  'Daily at 3 AM': { main: [[m('Config')]] },
  'Config': { main: [[m('List Channel Videos')]] },
  'List Channel Videos': { main: [[m('New Videos Only')]] },
  'New Videos Only': { main: [[m('Loop Videos')]] },
  'Loop Videos': { main: [[], [m('List Captions')]] }, // output 1 = each item, output 0 = done
  'List Captions': { main: [[m('Pick Caption Track')]] },
  'Pick Caption Track': { main: [[m('Has Captions?')]] },
  'Has Captions?': { main: [[m('Download Transcript')], [m('Mark No Captions')]] },
  'Download Transcript': { main: [[m('Chunk Transcript')]] },
  'Chunk Transcript': { main: [[m('Save to Knowledge Base')]] },
  'Save to Knowledge Base': { main: [[m('Mark Ingested')]] },
  'Mark Ingested': { main: [[m('Loop Videos')]] },
  'Mark No Captions': { main: [[m('Loop Videos')]] },
  'Document Loader': { ai_document: [[{ node: 'Save to Knowledge Base', type: 'ai_document', index: 0 }]] },
  'Text Splitter (keep chunks whole)': { ai_textSplitter: [[{ node: 'Document Loader', type: 'ai_textSplitter', index: 0 }]] },
  'Embeddings': { ai_embedding: [[{ node: 'Save to Knowledge Base', type: 'ai_embedding', index: 0 }]] },
  'Add External Knowledge (Webhook)': { main: [[m('Chunk External Text')]] },
  'Chunk External Text': { main: [[m('Save to Knowledge Base')]] },
};

const workflow = {
  name: 'AHL - Knowledge Base Ingestion (Videos + Docs)',
  nodes, connections,
  settings: { executionOrder: 'v1' },
};

// The YouTube-API caption path is dead (403 on auto-captions); transcripts come in via the webhook.
const DEAD = ['Run Manually', 'Daily at 3 AM', 'Config', 'List Channel Videos', 'New Videos Only', 'Loop Videos',
  'List Captions', 'Pick Caption Track', 'Has Captions?', 'Download Transcript', 'Chunk Transcript', 'Mark Ingested', 'Mark No Captions'];
workflow.nodes = workflow.nodes.filter((n) => !DEAD.includes(n.name));
for (const k of Object.keys(workflow.connections)) {
  if (DEAD.includes(k)) { delete workflow.connections[k]; continue; }
  for (const t of Object.keys(workflow.connections[k])) {
    workflow.connections[k][t] = workflow.connections[k][t].map((g) => g.filter((c) => !DEAD.includes(c.node)));
  }
}
workflow.name = 'AHL - Knowledge Base Ingestion (Videos + Docs)';

fs.writeFileSync(path.join(__dirname, 'ingest_workflow.json'), JSON.stringify(workflow, null, 2));
console.log('ingest_workflow.json written');

if (process.argv.includes('--push')) {
  const envFile = ['.env', '.env.txt'].map((f) => path.join(__dirname, f)).find(fs.existsSync);
  const env = {};
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const mm = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (mm) env[mm[1]] = mm[2].replace(/^["']|["']$/g, '');
  }
  const base = env.N8N_BASE_URL.replace(/\/+$/, '');
  const upd = (process.argv.find((x) => x.startsWith('--update=')) || '').slice(9);
  fetch(`${base}/api/v1/workflows${upd ? '/' + upd : ''}`, {
    method: upd ? 'PUT' : 'POST',
    headers: { 'X-N8N-API-KEY': env.N8N_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(workflow),
  }).then(async (r) => {
    const body = await r.json().catch(() => ({}));
    console.log('status', r.status);
    console.log(r.ok ? `created id=${body.id} name=${body.name}` : JSON.stringify(body).slice(0, 800));
  });
}
