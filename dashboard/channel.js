// Newest channel videos and shorts that are not in the knowledge base yet.
// One add downloads audio with yt-dlp, sends it to AssemblyAI, then posts the
// transcript to the ingest webhook. The transcript wait is a separate request
// so a hosted function does not have to stay open for the whole job.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const CHANNEL = 'UCKNwds5t-KBGMp6VzvfAr6A';
const TABS = {
  video: 'EgZ2aWRlb3PyBgQKAjoA',
  short: 'EgZzaG9ydHPyBgUKA5oBAA==',
};
const BATCH = 10;
const WORDS_PER_CHUNK = 350;
const STATE_BUCKET = 'desk-state';
const STATE_PATH = 'ingest.json';
const AAI = 'https://api.assemblyai.com/v2';
const tabCache = { at: 0, video: null, short: null };

function bad(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function emptyState() {
  return { failed: [], jobs: {}, added: [], rateLimitedUntil: '' };
}

async function readState(deps) {
  const text = await deps.storageGet(STATE_PATH);
  if (!text) return emptyState();
  try {
    const data = JSON.parse(text);
    return {
      failed: Array.isArray(data.failed) ? data.failed : [],
      jobs: data.jobs && typeof data.jobs === 'object' ? data.jobs : {},
      added: Array.isArray(data.added) ? data.added : [],
      rateLimitedUntil: data.rateLimitedUntil || '',
    };
  } catch {
    return emptyState();
  }
}

async function writeState(deps, state) {
  await deps.storagePut(STATE_PATH, JSON.stringify({ ...state, updatedAt: new Date().toISOString() }));
}

async function browse(type) {
  const response = await fetch('https://www.youtube.com/youtubei/v1/browse?prettyPrint=false', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    },
    body: JSON.stringify({
      browseId: CHANNEL,
      params: TABS[type],
      context: { client: { clientName: 'WEB', clientVersion: '2.20251101.00.00', hl: 'en', gl: 'US' } },
    }),
  });
  if (!response.ok) throw bad(502, 'YouTube did not return the channel list');
  return response.json();
}

function channelItems(data, type) {
  const tabs = data?.contents?.twoColumnBrowseResultsRenderer?.tabs || [];
  const selected = tabs.map((tab) => tab.tabRenderer).find((tab) => tab && tab.selected);
  const contents = selected?.content?.richGridRenderer?.contents || [];
  const rows = [];
  for (const item of contents) {
    const content = item.richItemRenderer?.content || {};
    if (type === 'video' && content.lockupViewModel) {
      const model = content.lockupViewModel;
      const id = (JSON.stringify(model.contentImage || {}).match(/\/vi\/([A-Za-z0-9_-]{11})\//) || [])[1] || '';
      const title = model.metadata?.lockupMetadataViewModel?.title?.content || '';
      if (id && title) rows.push({ id, title, type });
    }
    if (type === 'short' && content.shortsLockupViewModel) {
      const model = content.shortsLockupViewModel;
      const id = String(model.entityId || '').replace(/^shorts-shelf-item-/, '');
      const title = String(model.accessibilityText || '').split(',')[0].trim();
      if (/^[A-Za-z0-9_-]{11}$/.test(id) && title) rows.push({ id, title, type });
    }
  }
  return rows;
}

async function listTab(type) {
  if (tabCache[type] && Date.now() - tabCache.at < 60000) return tabCache[type];
  const rows = channelItems(await browse(type), type);
  tabCache[type] = rows;
  tabCache.at = Date.now();
  return rows;
}

function leadingNew(rows, known, failed, added) {
  const out = [];
  for (const row of rows) {
    if (known.has(row.id) || added.has(row.id)) break;
    if (failed.has(row.id)) continue;
    out.push(row);
    if (out.length >= BATCH) break;
  }
  return out;
}

async function newUploads(deps) {
  const state = await readState(deps);
  const known = await deps.knownIds();
  const addedIds = state.added.filter((item) => !known.has(item.id) && Date.now() - Date.parse(item.at) < 15 * 60 * 1000);
  if (addedIds.length !== state.added.length) {
    state.added = addedIds;
    await writeState(deps, state);
  }
  const added = new Set(addedIds.map((item) => item.id));
  const failed = new Set(state.failed);
  const [videos, shorts] = await Promise.all([listTab('video'), listTab('short')]);
  return {
    videos: leadingNew(videos, known, failed, added),
    shorts: leadingNew(shorts, known, failed, added),
    rateLimitedUntil: state.rateLimitedUntil && Date.parse(state.rateLimitedUntil) > Date.now() ? state.rateLimitedUntil : '',
  };
}

const IOS_CLIENT = {
  clientName: 'IOS',
  clientVersion: '20.10.4',
  deviceMake: 'Apple',
  deviceModel: 'iPhone16,2',
  osName: 'iOS',
  osVersion: '18.3.2.22D82',
};
const IOS_AGENT = 'com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)';

function localBinary() {
  const command = process.platform === 'win32' ? 'where.exe' : 'which';
  const found = spawnSync(command, ['yt-dlp'], { encoding: 'utf8' });
  const line = (found.stdout || '').split(/\r?\n/).map((item) => item.trim()).find(Boolean);
  return found.status === 0 && line ? line : '';
}

function downloadWithYtDlp(bin, id) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ahl-'));
  const pattern = path.join(dir, `${id}.%(ext)s`);
  const result = spawnSync(bin, [
    '-f', 'bestaudio[ext=m4a]/bestaudio/best',
    '--no-playlist',
    '--no-warnings',
    '--no-progress',
    '-o', pattern,
    `https://www.youtube.com/watch?v=${id}`,
  ], { encoding: 'utf8', timeout: 45000, maxBuffer: 8 * 1024 * 1024 });
  const log = `${result.stderr || ''}\n${result.stdout || ''}`;
  if (/HTTP Error 429|Too Many Requests/i.test(log)) {
    const err = bad(429, 'YouTube is limiting downloads. Wait about 30 minutes, then try again.');
    err.rateLimited = true;
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
    throw err;
  }
  if (result.error && result.error.code === 'ETIMEDOUT') {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
    throw bad(502, 'The audio download took too long. Try this upload again in a few minutes.');
  }
  const fileName = fs.existsSync(dir) && fs.readdirSync(dir).find((name) => name.startsWith(`${id}.`));
  if (!fileName) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
    const detail = log.trim().split(/\r?\n/).filter(Boolean).slice(-1)[0] || '';
    throw bad(502, detail ? `The audio download did not finish. ${detail.slice(0, 180)}` : 'The audio download did not finish. Try this upload again in a few minutes.');
  }
  return { dir, file: path.join(dir, fileName) };
}

async function playerAudioUrl(id) {
  const page = await fetch(`https://www.youtube.com/watch?v=${id}`, {
    headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'en-US,en;q=0.9' },
  });
  const html = await page.text();
  const key = (html.match(/"INNERTUBE_API_KEY":"([^"]+)"/) || [])[1] || 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';
  const response = await fetch(`https://www.youtube.com/youtubei/v1/player?prettyPrint=false&key=${key}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': IOS_AGENT },
    body: JSON.stringify({ videoId: id, context: { client: { ...IOS_CLIENT, hl: 'en', gl: 'US' } } }),
  });
  const data = await response.json();
  const playable = data.playabilityStatus || {};
  if (playable.status === 'LOGIN_REQUIRED') throw bad(502, 'YouTube blocks this download on the website. On your computer, run Start desk.bat and open http://127.0.0.1:4173, then click Add there.');
  const formats = [...(data.streamingData?.formats || []), ...(data.streamingData?.adaptiveFormats || [])];
  const audio = formats
    .filter((format) => format.url && /^audio\/mp4/i.test(format.mimeType || ''))
    .sort((a, b) => (a.bitrate || 0) - (b.bitrate || 0));
  const pick = audio.find((format) => (format.bitrate || 0) >= 48000) || audio[0];
  if (!pick) throw bad(502, playable.reason || 'YouTube did not provide an audio file for this video.');
  return pick.url;
}

async function downloadWithPlayer(id) {
  const url = await playerAudioUrl(id);
  const response = await fetch(url, { headers: { 'User-Agent': IOS_AGENT }, signal: AbortSignal.timeout(40000) });
  if (response.status === 429) {
    const err = bad(429, 'YouTube is limiting downloads. Wait about 30 minutes, then try again.');
    err.rateLimited = true;
    throw err;
  }
  if (!response.ok) throw bad(502, `The audio download did not finish (${response.status}). Try again in a few minutes.`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 1000) throw bad(502, 'The audio download did not finish. Try this upload again in a few minutes.');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ahl-'));
  const file = path.join(dir, `${id}.m4a`);
  fs.writeFileSync(file, bytes);
  return { dir, file };
}

async function downloadAudio(id) {
  const bin = localBinary();
  if (bin) return downloadWithYtDlp(bin, id);
  return downloadWithPlayer(id);
}

async function aai(env, pathname, options = {}) {
  if (!env.ASSEMBLYAI_API_KEY) throw bad(400, 'ASSEMBLYAI_API_KEY is missing from the deployment environment');
  const response = await fetch(`${AAI}${pathname}`, {
    ...options,
    headers: { authorization: env.ASSEMBLYAI_API_KEY, ...(options.headers || {}) },
  });
  const text = await response.text();
  if (!response.ok) throw bad(502, `AssemblyAI ${response.status}: ${text.slice(0, 180)}`);
  return text ? JSON.parse(text) : {};
}

function chunkWords(words, id, type) {
  const minWords = type === 'short' ? 8 : 40;
  const chunks = [];
  let batch = [];
  let start = 0;
  for (const word of words || []) {
    const text = String(word.text || '').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    if (!batch.length) start = Math.max(0, Math.floor((Number(word.start) || 0) / 1000));
    batch.push(text);
    if (batch.length >= WORDS_PER_CHUNK) {
      chunks.push({ text: batch.join(' '), start, url: `https://www.youtube.com/watch?v=${id}&t=${start}s` });
      batch = [];
    }
  }
  if (batch.length >= minWords) {
    chunks.push({ text: batch.join(' '), start, url: `https://www.youtube.com/watch?v=${id}&t=${start}s` });
  }
  return chunks;
}

async function beginUpload(deps, body) {
  const id = String(body.id || '');
  const type = body.type === 'short' || body.type === 'video' ? body.type : '';
  if (!/^[A-Za-z0-9_-]{11}$/.test(id) || !type) throw bad(400, 'Choose a video from the channel list');
  const state = await readState(deps);
  const job = state.jobs[id];
  if (job?.transcriptId) return { phase: 'transcribing', id, transcriptId: job.transcriptId };
  const fresh = await newUploads(deps);
  const row = [...fresh.videos, ...fresh.shorts].find((item) => item.id === id && item.type === type);
  if (!row) throw bad(400, 'That upload is already in the knowledge base or is no longer the newest one');
  if (fresh.rateLimitedUntil) throw bad(429, `YouTube is limiting downloads until ${new Date(fresh.rateLimitedUntil).toLocaleString()}.`);
  let downloaded;
  try {
    downloaded = await downloadAudio(id);
    const uploaded = await aai(deps.env(), '/upload', {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: fs.readFileSync(downloaded.file),
    });
    if (!uploaded.upload_url) throw bad(502, 'AssemblyAI did not accept the audio');
    const transcript = await aai(deps.env(), '/transcript', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        audio_url: uploaded.upload_url,
        speech_models: ['universal-2'],
        language_detection: true,
      }),
    });
    if (!transcript.id) throw bad(502, 'AssemblyAI did not start a transcript');
    const next = await readState(deps);
    next.jobs[id] = { transcriptId: transcript.id, title: row.title, type, startedAt: new Date().toISOString() };
    next.rateLimitedUntil = '';
    await writeState(deps, next);
    return { phase: 'transcribing', id };
  } catch (err) {
    if (err.rateLimited) {
      const next = await readState(deps);
      next.rateLimitedUntil = new Date(Date.now() + 30 * 60 * 1000).toISOString();
      await writeState(deps, next);
    }
    throw err;
  } finally {
    if (downloaded) { try { fs.rmSync(downloaded.dir, { recursive: true, force: true }); } catch {} }
  }
}

async function uploadStatus(deps, id) {
  if (!/^[A-Za-z0-9_-]{11}$/.test(id)) throw bad(400, 'Missing video id');
  const state = await readState(deps);
  const job = state.jobs[id];
  if (!job) {
    const known = await deps.knownIds();
    if (known.has(id)) return { phase: 'done', id };
    if (state.failed.includes(id)) return { phase: 'skipped', id, detail: 'No spoken audio, so it was not added.' };
    throw bad(404, 'That upload is not being added');
  }
  const transcript = await aai(deps.env(), `/transcript/${job.transcriptId}`);
  if (transcript.status === 'queued' || transcript.status === 'processing') {
    return { phase: 'transcribing', id, detail: transcript.status };
  }
  if (transcript.status === 'error') {
    const next = await readState(deps);
    delete next.jobs[id];
    const silent = /no spoken audio/i.test(transcript.error || '');
    if (silent && !next.failed.includes(id)) next.failed.push(id);
    await writeState(deps, next);
    if (silent) return { phase: 'skipped', id, detail: 'No spoken audio, so it was not added.' };
    throw bad(502, transcript.error || 'AssemblyAI could not transcribe that audio');
  }
  if (transcript.status !== 'completed') return { phase: 'transcribing', id };
  const chunks = chunkWords(transcript.words, id, job.type);
  const next = await readState(deps);
  delete next.jobs[id];
  if (!chunks.length) {
    if (!next.failed.includes(id)) next.failed.push(id);
    await writeState(deps, next);
    return { phase: 'skipped', id, detail: 'The transcript was empty, so it was not added.' };
  }
  await deps.ingest({
    title: job.title,
    videoId: id,
    type: job.type,
    transcript: 'universal-2',
    language: transcript.language_code || '',
    chunks,
  });
  next.added = (next.added || []).filter((item) => item.id !== id);
  next.added.push({ id, at: new Date().toISOString() });
  await writeState(deps, next);
  return { phase: 'done', id, title: job.title, type: job.type };
}

module.exports = { newUploads, beginUpload, uploadStatus, STATE_BUCKET };
