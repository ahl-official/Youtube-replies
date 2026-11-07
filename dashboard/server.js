// Local desk. Serves the UI and talks to Supabase + the n8n ingest webhook.
// The service role key stays on this machine; the browser never receives it.
const http = require('http');
const fs = require('fs');
const path = require('path');
const channel = require('./channel');

const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(__dirname, 'public');
const PORT = Number(process.env.PORT) || 4173;
const ENV_PATH = ['.env', '.env.txt'].map((f) => path.join(ROOT, f)).find((f) => fs.existsSync(f));

function loadEnv() {
  const env = {};
  if (ENV_PATH && fs.existsSync(ENV_PATH)) {
    for (const line of fs.readFileSync(ENV_PATH, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
  for (const [key, value] of Object.entries(process.env)) {
    if (/^[A-Z0-9_]+$/.test(key) && value) env[key] = value;
  }
  return env;
}

function saveEnv(updates) {
  if (!ENV_PATH) throw new Error('This host has no .env.txt. Set the Supabase keys in the deployment environment.');
  let text = fs.readFileSync(ENV_PATH, 'utf8');
  for (const [key, value] of Object.entries(updates)) {
    if (/[\r\n]/.test(value)) throw new Error('Invalid value');
    const line = `${key}=${value}`;
    const re = new RegExp(`^${key}=.*$`, 'm');
    text = re.test(text) ? text.replace(re, line) : text.replace(/\s*$/, '') + '\n' + line + '\n';
  }
  fs.writeFileSync(ENV_PATH, text);
}

function supabaseConfig() {
  const env = loadEnv();
  const url = (env.SUPABASE_URL || '').replace(/\/+$/, '').replace(/\/rest\/v1$/, '');
  const key = env.SUPABASE_SERVICE_ROLE_KEY || '';
  return { env, url, key };
}

function supabaseHeaders(extra) {
  const { url, key } = supabaseConfig();
  if (!url || !key) {
    const err = new Error('Add the Supabase URL and service role key first');
    err.status = 400;
    throw err;
  }
  return { url, headers: { apikey: key, Authorization: `Bearer ${key}`, ...(extra || {}) } };
}

async function sb(pathname, options = {}) {
  const { url, headers } = supabaseHeaders(options.headers);
  if (options.body) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${url}/rest/v1${pathname}`, { ...options, headers });
  const text = await response.text();
  if (!response.ok) {
    const err = new Error(text.slice(0, 400) || `Supabase ${response.status}`);
    err.status = response.status;
    throw err;
  }
  return text ? JSON.parse(text) : null;
}

async function sbCount(pathname) {
  const { url, headers } = supabaseHeaders({ Prefer: 'count=exact', Range: '0-0' });
  const response = await fetch(`${url}/rest/v1${pathname}`, { method: 'HEAD', headers });
  if (!response.ok) {
    const err = new Error(`Supabase ${response.status}`);
    err.status = response.status;
    throw err;
  }
  const total = Number((response.headers.get('content-range') || '').split('/')[1]);
  return Number.isFinite(total) ? total : 0;
}

const docCache = { at: 0, rows: null };
function invalidateDocs() {
  docCache.at = 0;
  docCache.rows = null;
  idCache.at = 0;
  idCache.ids = null;
}

const idCache = { at: 0, ids: null };
async function knownVideoIds() {
  if (idCache.ids && Date.now() - idCache.at < 30000) return idCache.ids;
  const ids = new Set();
  for (let from = 0; from < 20000; from += 1000) {
    const page = await sb('/documents?select=metadata&order=id.asc', {
      headers: { Range: `${from}-${from + 999}` },
    });
    for (const row of page || []) {
      const id = row.metadata && row.metadata.videoId;
      if (id) ids.add(id);
    }
    if (!page || page.length < 1000) break;
  }
  idCache.at = Date.now();
  idCache.ids = ids;
  return ids;
}

function channelDeps() {
  const { env, url, key } = supabaseConfig();
  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  return {
    env: () => env,
    knownIds: knownVideoIds,
    ingest,
    async storageGet(name) {
      const response = await fetch(`${url}/storage/v1/object/${channel.STATE_BUCKET}/${name}`, { headers });
      if (response.status === 404) return '';
      if (!response.ok) throw new Error(`Could not read ingest state (${response.status})`);
      return response.text();
    },
    async storagePut(name, body) {
      const response = await fetch(`${url}/storage/v1/object/${channel.STATE_BUCKET}/${name}`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json', 'x-upsert': 'true' },
        body,
      });
      if (!response.ok) throw new Error(`Could not save ingest state (${response.status})`);
    },
  };
}

async function allDocuments(options = {}) {
  if (!options.fresh && docCache.rows && Date.now() - docCache.at < 30000) return docCache.rows;
  const rows = [];
  for (let from = 0; from < 20000; from += 1000) {
    const page = await sb(`/documents?select=id,content,metadata&order=id.asc`, {
      headers: { Range: `${from}-${from + 999}` },
    });
    rows.push(...(page || []));
    if (!page || page.length < 1000) break;
  }
  docCache.at = Date.now();
  docCache.rows = rows;
  return rows;
}

function groupKey(metadata) {
  const type = metadata.type || (metadata.videoId ? 'video' : 'document');
  if (metadata.videoId) return `video:${metadata.videoId}`;
  return `doc:${type}:${metadata.title || 'Untitled'}`;
}

function groupRows(rows) {
  const map = new Map();
  for (const row of rows) {
    const metadata = row.metadata || {};
    const key = groupKey(metadata);
    if (!map.has(key)) {
      map.set(key, {
        key,
        type: metadata.type || (metadata.videoId ? 'video' : 'document'),
        title: metadata.title || metadata.videoId || 'Untitled',
        videoId: metadata.videoId || '',
        language: metadata.language || '',
        transcript: metadata.transcript || '',
        source: metadata.source || '',
        url: '',
        chunks: [],
        maxId: 0,
      });
    }
    const group = map.get(key);
    group.chunks.push({
      id: row.id,
      text: row.content || '',
      start: Number(metadata.start) || 0,
      url: metadata.url || '',
    });
    group.maxId = Math.max(group.maxId, row.id);
    if (metadata.language) group.language = metadata.language;
    if (metadata.transcript) group.transcript = metadata.transcript;
    if (metadata.url && !group.url) group.url = metadata.url;
  }
  for (const group of map.values()) {
    group.chunks.sort((a, b) => a.start - b.start || a.id - b.id);
    group.chunkCount = group.chunks.length;
    group.preview = (group.chunks[0]?.text || '').slice(0, 180);
    group.watchUrl = group.videoId ? `https://www.youtube.com/watch?v=${group.videoId}` : (group.url || '');
  }
  return [...map.values()].sort((a, b) => b.maxId - a.maxId);
}

function findGroup(rows, key) {
  return groupRows(rows).find((group) => group.key === key) || null;
}

async function postYouTubeReply(commentId, text) {
  const env = loadEnv();
  const base = (env.N8N_BASE_URL || '').replace(/\/+$/, '');
  const webhookKey = env.N8N_WEBHOOK_KEY;
  if (!base || !webhookKey) {
    const err = new Error('N8N_BASE_URL and N8N_WEBHOOK_KEY are missing from the environment');
    err.status = 400;
    throw err;
  }
  const header = env.N8N_WEBHOOK_HEADER || 'x-api-key';
  const response = await fetch(`${base}/webhook/ahl-post-reply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', [header]: webhookKey },
    body: JSON.stringify({ commentId, text }),
  });
  const raw = await response.text();
  let data = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = null; }
  const payload = Array.isArray(data) ? data[0] : data;
  const body = payload && payload.json ? payload.json : payload;
  if (!response.ok || !body || body.ok === false || !body.id) {
    const rawMessage = body && (body.error || body.message);
    const message = typeof rawMessage === 'string' ? rawMessage : 'YouTube did not accept the reply';
    const err = new Error(message.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300));
    err.status = 502;
    throw err;
  }
  return body.id;
}

async function deleteYouTubeComment(commentId) {
  const env = loadEnv();
  const base = (env.N8N_BASE_URL || '').replace(/\/+$/, '');
  const webhookKey = env.N8N_WEBHOOK_KEY;
  if (!base || !webhookKey) {
    const err = new Error('N8N_BASE_URL and N8N_WEBHOOK_KEY are missing from the environment');
    err.status = 400;
    throw err;
  }
  const header = env.N8N_WEBHOOK_HEADER || 'x-api-key';
  const response = await fetch(`${base}/webhook/ahl-delete-comment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', [header]: webhookKey },
    body: JSON.stringify({ commentId }),
  });
  const raw = await response.text();
  let data = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = null; }
  const payload = Array.isArray(data) ? data[0] : data;
  const body = payload && payload.json ? payload.json : payload;
  if (!response.ok || !body || body.ok !== true) {
    const rawMessage = body && (body.error || body.message);
    const message = typeof rawMessage === 'string' ? rawMessage : 'YouTube did not delete the comment';
    const err = new Error(message.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300));
    err.status = 502;
    throw err;
  }
}

async function ingest(payload) {
  const env = loadEnv();
  const base = (env.N8N_BASE_URL || '').replace(/\/+$/, '');
  const webhookKey = env.N8N_WEBHOOK_KEY;
  if (!base || !webhookKey) throw new Error('N8N_BASE_URL and N8N_WEBHOOK_KEY are missing from .env.txt');
  const header = env.N8N_WEBHOOK_HEADER || 'x-api-key';
  const response = await fetch(`${base}/webhook/ahl-ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', [header]: webhookKey },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(`Ingest webhook failed: ${response.status} ${(await response.text()).slice(0, 200)}`);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForInsert(match, previousMaxId) {
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    await sleep(2000);
    const rows = (await allDocuments({ fresh: true })).filter(match);
    if (rows.some((row) => row.id > previousMaxId)) return;
  }
  const err = new Error('The ingest webhook accepted the text, but Supabase has no new rows yet. Leave the ingestion workflow active and try again. Existing rows were kept.');
  err.status = 504;
  throw err;
}

async function removeIds(ids) {
  if (!ids.length) return;
  const list = ids.join(',');
  await sb(`/documents?id=in.(${list})`, { method: 'DELETE' });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function send(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(json);
}

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };

let statusCache = { at: 0, value: null };

async function status() {
  if (statusCache.value && Date.now() - statusCache.at < 20000) return statusCache.value;
  const { env, url, key } = supabaseConfig();
  const configured = Boolean(url && key);
  const result = {
    configured,
    webhook: Boolean(env.N8N_BASE_URL && env.N8N_WEBHOOK_KEY),
    documents: false,
    commentLog: false,
  };
  if (!configured) return result;
  const [documents, commentLog] = await Promise.allSettled([
    sb('/documents?select=id&limit=1'),
    sb('/comment_log?select=id&limit=1'),
  ]);
  if (documents.status === 'fulfilled') result.documents = true;
  else result.documentsError = documents.reason && documents.reason.message;
  if (commentLog.status === 'fulfilled') result.commentLog = true;
  else result.commentLogError = commentLog.reason && commentLog.reason.message;
  statusCache = { at: Date.now(), value: result };
  return result;
}

const COMMENT_STATUSES = ['needs_human', 'drafted', 'replied', 'skipped', 'error', 'discarded'];
const REPLY_WORKFLOW_ID = 'ZRwUFsLyDCsLNq2j';

function n8nConfig() {
  const env = loadEnv();
  const base = (env.N8N_BASE_URL || '').replace(/\/+$/, '');
  const apiKey = env.N8N_API_KEY || '';
  if (!base || !apiKey) {
    const err = new Error('N8N_BASE_URL and N8N_API_KEY are missing from .env.txt');
    err.status = 400;
    throw err;
  }
  return {
    env,
    base,
    headers: { 'X-N8N-API-KEY': apiKey, 'Content-Type': 'application/json' },
  };
}

async function n8n(pathname, options = {}) {
  const { base, headers } = n8nConfig();
  const response = await fetch(`${base}${pathname}`, { ...options, headers: { ...headers, ...(options.headers || {}) } });
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text.slice(0, 300) }; }
  if (!response.ok) {
    const err = new Error((body && body.message) || text.slice(0, 240) || `n8n ${response.status}`);
    err.status = response.status;
    throw err;
  }
  return body;
}

async function startReplyRun() {
  const { env, base } = n8nConfig();
  const header = env.N8N_WEBHOOK_HEADER || 'x-api-key';
  const key = env.N8N_WEBHOOK_KEY;
  if (!key) {
    const err = new Error('N8N_WEBHOOK_KEY is missing from the environment');
    err.status = 400;
    throw err;
  }
  const startedAt = new Date(Date.now() - 2000).toISOString();
  let lastError = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const response = await fetch(`${base}/webhook/ahl-reply-run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', [header]: key },
        body: '{}',
      });
      if (response.ok) return { startedAt };
      lastError = new Error(`Review webhook returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(1500);
  }
  throw lastError || new Error('The review webhook did not start');
}

function reviewedCount(execution) {
  const runs = (((execution.data || {}).resultData || {}).runData || {})['Filter New Comments'] || [];
  const last = runs[runs.length - 1];
  const items = last && last.data && last.data.main && last.data.main[0];
  return Array.isArray(items) ? items.length : 0;
}

async function replyRunStatus(startedAt) {
  if (!startedAt) {
    const err = new Error('Missing start time');
    err.status = 400;
    throw err;
  }
  const list = await n8n(`/api/v1/executions?workflowId=${REPLY_WORKFLOW_ID}&limit=8`);
  const row = (list.data || []).find((item) => item.startedAt && item.startedAt >= startedAt);
  if (!row || ['running', 'waiting', 'new'].includes(row.status)) return { done: false };
  const full = await n8n(`/api/v1/executions/${row.id}?includeData=true`);
  return { done: true, status: row.status, reviewed: reviewedCount(full), summary: await commentSummary() };
}

async function commentSummary() {
  const counts = await Promise.all(COMMENT_STATUSES.map((name) => sbCount(`/comment_log?select=id&status=eq.${name}`)));
  const summary = { open: await sbCount('/comment_log?select=id&status=eq.needs_human&handled=eq.false') };
  COMMENT_STATUSES.forEach((name, index) => { summary[name] = counts[index]; });
  summary.all = summary.needs_human + summary.drafted + summary.replied + summary.skipped + summary.error;
  return summary;
}

async function handleApi(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/status') {
    return send(res, 200, await status());
  }

  if (req.method === 'POST' && url.pathname === '/api/setup') {
    const body = await readBody(req);
    let supabaseUrl = String(body.supabaseUrl || '').trim().replace(/\/+$/, '').replace(/\/rest\/v1$/, '');
    const serviceRoleKey = String(body.serviceRoleKey || '').trim();
    if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(supabaseUrl)) {
      return send(res, 400, { error: 'Supabase URL should look like https://your-project.supabase.co' });
    }
    if (serviceRoleKey.length < 20) return send(res, 400, { error: 'Paste the service_role key, not the anon key' });
    let probe;
    try {
      probe = await fetch(`${supabaseUrl}/rest/v1/documents?select=id&limit=1`, {
        headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` },
      });
    } catch {
      return send(res, 400, { error: 'Could not reach that Supabase URL. Check the project URL and your connection.' });
    }
    if (!probe.ok) {
      return send(res, 400, { error: `Supabase refused that key (${probe.status}). Use the service_role secret from Project Settings → API.` });
    }
    saveEnv({ SUPABASE_URL: supabaseUrl, SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey });
    statusCache = { at: 0, value: null };
    return send(res, 200, { ok: true });
  }

  if (req.method === 'POST' && url.pathname === '/api/reply/run') {
    return send(res, 200, await startReplyRun());
  }

  if (req.method === 'GET' && url.pathname === '/api/reply/status') {
    return send(res, 200, await replyRunStatus(url.searchParams.get('since')));
  }

  if (req.method === 'GET' && url.pathname === '/api/comments') {
    const allowed = new Set([...COMMENT_STATUSES, 'all']);
    const statusFilter = allowed.has(url.searchParams.get('status')) ? url.searchParams.get('status') : 'needs_human';
    const handled = url.searchParams.get('handled');
    let query = '/comment_log?select=id,video_id,author,comment,category,reason,reply,status,error_message,handled,created_at&order=created_at.desc&limit=200';
    if (statusFilter === 'all') query += '&status=neq.discarded';
    else query += `&status=eq.${statusFilter}`;
    if (handled === 'false' || handled === 'true') query += `&handled=eq.${handled}`;
    const [rows, summary] = await Promise.all([sb(query), commentSummary()]);
    return send(res, 200, { rows, summary });
  }

  const handledMatch = url.pathname.match(/^\/api\/comments\/(\d+)\/handled$/);
  if (req.method === 'POST' && handledMatch) {
    const body = await readBody(req);
    const rows = await sb(`/comment_log?id=eq.${handledMatch[1]}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ handled: body.handled !== false }),
    });
    return send(res, 200, { row: rows && rows[0] });
  }

  const replyMatch = url.pathname.match(/^\/api\/comments\/(\d+)\/reply$/);
  if (req.method === 'POST' && replyMatch) {
    const body = await readBody(req);
    const reply = String(body.reply == null ? '' : body.reply).replace(/\r\n/g, '\n');
    if (reply.length > 10000) return send(res, 400, { error: 'A YouTube reply cannot be longer than 10,000 characters' });
    const rows = await sb(`/comment_log?id=eq.${replyMatch[1]}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ reply }),
    });
    if (!rows || !rows[0]) return send(res, 404, { error: 'That comment is no longer in the log' });
    return send(res, 200, { row: rows[0] });
  }

  const postMatch = url.pathname.match(/^\/api\/comments\/(\d+)\/post$/);
  if (req.method === 'POST' && postMatch) {
    const rows = await sb(`/comment_log?id=eq.${postMatch[1]}&select=id,comment_id,reply,status,youtube_reply_id`);
    const row = rows && rows[0];
    if (!row) return send(res, 404, { error: 'That comment is no longer in the log' });
    if (row.status === 'discarded') return send(res, 400, { error: 'Discarded comments are not posted' });
    if (row.status === 'replied' || row.youtube_reply_id) return send(res, 400, { error: 'This reply is already on YouTube' });
    const text = String(row.reply || '').trim();
    if (!text) return send(res, 400, { error: 'Write a reply before posting it' });
    if (!row.comment_id) return send(res, 400, { error: 'This comment has no YouTube id' });
    const youtubeId = await postYouTubeReply(row.comment_id, text);
    const updated = await sb(`/comment_log?id=eq.${row.id}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ status: 'replied', youtube_reply_id: youtubeId, error_message: '' }),
    });
    return send(res, 200, { row: updated && updated[0] });
  }

  const discardMatch = url.pathname.match(/^\/api\/comments\/(\d+)\/discard$/);
  if (req.method === 'POST' && discardMatch) {
    const rows = await sb(`/comment_log?id=eq.${discardMatch[1]}&select=id,comment_id,status`);
    const row = rows && rows[0];
    if (!row) return send(res, 404, { error: 'That comment is no longer in the log' });
    if (row.status === 'discarded') return send(res, 400, { error: 'This comment is already discarded' });
    if (!row.comment_id) return send(res, 400, { error: 'This comment has no YouTube id' });
    await deleteYouTubeComment(row.comment_id);
    const updated = await sb(`/comment_log?id=eq.${row.id}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ status: 'discarded', handled: true, error_message: '' }),
    });
    return send(res, 200, { row: updated && updated[0] });
  }

  if (req.method === 'GET' && url.pathname === '/api/knowledge/uploads') {
    const id = url.searchParams.get('id') || '';
    if (id) {
      const result = await channel.uploadStatus(channelDeps(), id);
      if (result.phase === 'done') invalidateDocs();
      return send(res, 200, result);
    }
    return send(res, 200, await channel.newUploads(channelDeps()));
  }

  if (req.method === 'POST' && url.pathname === '/api/knowledge/uploads') {
    const body = await readBody(req);
    const result = await channel.beginUpload(channelDeps(), body);
    return send(res, 202, result);
  }

  if (req.method === 'GET' && url.pathname === '/api/knowledge') {
    const groups = groupRows(await allDocuments());
    const key = url.searchParams.get('key');
    if (key) {
      const group = groups.find((item) => item.key === key);
      if (!group) return send(res, 404, { error: 'That entry is not in the knowledge base' });
      return send(res, 200, { group });
    }
    const q = (url.searchParams.get('q') || '').trim().toLowerCase();
    const list = groups
      .filter((group) => !q || `${group.title} ${group.preview} ${group.videoId}`.toLowerCase().includes(q))
      .map(({ chunks, ...summary }) => summary);
    return send(res, 200, { groups: list });
  }

  if (req.method === 'POST' && url.pathname === '/api/knowledge') {
    const body = await readBody(req);
    const title = String(body.title || '').trim();
    const text = String(body.text || '').trim();
    if (!title || !text) return send(res, 400, { error: 'Title and text are both required' });
    await ingest({ title, text, source: String(body.source || 'dashboard').trim() || 'dashboard' });
    invalidateDocs();
    return send(res, 200, { ok: true });
  }

  if (req.method === 'PUT' && url.pathname === '/api/knowledge') {
    const body = await readBody(req);
    const key = String(body.key || '');
    const chunks = (body.chunks || [])
      .map((chunk) => ({
        text: String(chunk.text || '').replace(/\s+/g, ' ').trim(),
        start: Number(chunk.start) || 0,
        url: chunk.url || '',
      }))
      .filter((chunk) => chunk.text);
    if (!key || !chunks.length) return send(res, 400, { error: 'Add some text before saving' });
    const rows = await allDocuments();
    const current = findGroup(rows, key);
    if (!current) return send(res, 404, { error: 'That entry is gone' });
    const previousMaxId = rows.reduce((max, row) => Math.max(max, row.id), 0);
    const oldIds = current.chunks.map((chunk) => chunk.id);
    if (current.videoId) {
      await ingest({
        title: current.title,
        videoId: current.videoId,
        type: current.type || 'video',
        transcript: current.transcript || 'dashboard',
        language: current.language || '',
        chunks,
      });
      await waitForInsert((row) => (row.metadata || {}).videoId === current.videoId, previousMaxId);
    } else {
      await ingest({ title: current.title, text: chunks.map((chunk) => chunk.text).join('\n\n'), source: 'dashboard' });
      await waitForInsert((row) => {
        const metadata = row.metadata || {};
        return !metadata.videoId && metadata.title === current.title;
      }, previousMaxId);
    }
    await removeIds(oldIds);
    invalidateDocs();
    return send(res, 200, { ok: true });
  }

  if (req.method === 'DELETE' && url.pathname === '/api/knowledge') {
    const key = url.searchParams.get('key') || '';
    const current = findGroup(await allDocuments(), key);
    if (!current) return send(res, 404, { error: 'That entry is already gone' });
    await removeIds(current.chunks.map((chunk) => chunk.id));
    invalidateDocs();
    return send(res, 200, { ok: true });
  }

  send(res, 404, { error: 'Not found' });
}

function requestUrl(req) {
  const host = req.headers['x-forwarded-host'] || req.headers.host || '127.0.0.1';
  const incoming = req.url || '/';
  if (incoming.startsWith('/api/')) return new URL(incoming, `http://${host}`);
  const forwarded = req.headers['x-forwarded-uri'] || req.headers['x-vercel-original-url'] || '';
  if (String(forwarded).includes('/api/')) return new URL(forwarded, `http://${host}`);
  const invoke = req.headers['x-invoke-path'] || '';
  if (String(invoke).startsWith('/api/')) {
    const query = incoming.includes('?') ? incoming.slice(incoming.indexOf('?')) : '';
    return new URL(`${invoke}${String(invoke).includes('?') ? '' : query}`, `http://${host}`);
  }
  return new URL(incoming, `http://${host}`);
}

async function handleRequest(req, res) {
  try {
    const url = requestUrl(req);
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    const rel = decodeURIComponent(url.pathname === '/' ? 'index.html' : url.pathname).replace(/^[/\\]+/, '');
    const root = path.resolve(PUBLIC);
    const filePath = path.resolve(PUBLIC, rel);
    if (filePath !== root && !filePath.startsWith(root + path.sep)) return send(res, 403, { error: 'Forbidden' });
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(filePath).pipe(res);
  } catch (error) {
    send(res, error.status || 500, { error: error.message || 'Server error' });
  }
}

if (require.main === module) {
  http.createServer(handleRequest).listen(PORT, '127.0.0.1', () => {
    console.log(`American Hairline desk  http://127.0.0.1:${PORT}`);
  });
}

module.exports = handleRequest;
