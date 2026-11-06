// Turns channel videos into knowledge-base text with AssemblyAI Universal-2.
// yt-dlp downloads the audio, ffmpeg makes a mono MP3 (one billable channel),
// AssemblyAI transcribes, then chunks are POSTed to the n8n webhook which embeds them into Supabase.
//
// Usage:  node ingest_local.js            -> up to LIMIT new videos (default 10)
//         node ingest_local.js --limit=1
//         node ingest_local.js --dry      -> list what would run, download nothing
//         node ingest_local.js --test     -> POST to /webhook-test/ while n8n is listening
//
// .env needs:  N8N_BASE_URL, N8N_WEBHOOK_KEY, ASSEMBLYAI_API_KEY
//              optional N8N_WEBHOOK_HEADER (default x-api-key)
const fs = require('fs'), path = require('path'), os = require('os');
const { spawnSync } = require('child_process');

const TABS = [
  { type: 'video', url: 'https://www.youtube.com/@AmericanHairline/videos' },
  { type: 'short', url: 'https://www.youtube.com/@AmericanHairline/shorts' },
];
const LIMIT = +((process.argv.find((a) => a.startsWith('--limit=')) || '--limit=10').slice(8));
const PAUSE_MS = 8000;
const WORDS_PER_CHUNK = 350;
const TRANSCRIPT_TAG = 'universal-2';
const AAI = 'https://api.assemblyai.com/v2';
const STATE = path.join(__dirname, 'ingested.json');

const envFile = ['.env', '.env.txt'].map((f) => path.join(__dirname, f)).find(fs.existsSync);
const env = {};
for (const l of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const DRY = process.argv.includes('--dry');
const TEST = process.argv.includes('--test');
const base = (env.N8N_BASE_URL || '').replace(/\/+$/, '');
const hook = `${base}/${TEST ? 'webhook-test' : 'webhook'}/ahl-ingest`;
if (!DRY && !env.N8N_WEBHOOK_KEY) { console.error('Add N8N_WEBHOOK_KEY to .env.txt'); process.exit(1); }
if (!DRY && !env.ASSEMBLYAI_API_KEY) { console.error('Add ASSEMBLYAI_API_KEY to .env.txt'); process.exit(1); }

const state = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : {};
state.done = state.done || [];
state.failed = state.failed || [];
state.captionIngested = state.captionIngested || [];
const save = () => fs.writeFileSync(STATE, JSON.stringify(state, null, 2));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function run(cmd, args) {
  return spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 });
}

function listVideos() {
  const all = [];
  for (const tab of TABS) {
    const r = run('yt-dlp', ['--flat-playlist', '--print', '%(id)s\t%(title)s', tab.url]);
    if (r.status !== 0) {
      console.error(r.stderr || r.stdout);
      throw new Error('yt-dlp could not list ' + tab.url);
    }
    for (const l of (r.stdout || '').split(/\r?\n/).filter(Boolean)) {
      const [id, ...t] = l.split('\t');
      if (!id || all.some((v) => v.id === id)) continue;
      all.push({ id, title: t.join('\t'), type: tab.type });
    }
  }
  return all;
}

let rateLimited = false;
let lastDownloadError = '';
function downloadMonoMp3(id, dir) {
  rateLimited = false;
  lastDownloadError = '';
  const pattern = path.join(dir, `${id}.%(ext)s`);
  const dl = run('yt-dlp', [
    '-f', 'bestaudio/best', '--no-playlist', '--no-warnings',
    '-o', pattern, `https://www.youtube.com/watch?v=${id}`,
  ]);
  const log = (dl.stderr || '') + (dl.stdout || '');
  const errorLine = log.trim().split(/\r?\n/).filter(Boolean).slice(-4).join(' | ');
  if (/HTTP Error 429|Too Many Requests/i.test(log)) {
    rateLimited = true;
    lastDownloadError = errorLine;
    return null;
  }
  const srcName = fs.readdirSync(dir).find((f) => f.startsWith(id + '.'));
  if (!srcName) {
    lastDownloadError = errorLine || log.slice(-500);
    console.error(lastDownloadError);
    return null;
  }
  const src = path.join(dir, srcName);
  const mp3 = path.join(dir, `${id}.mp3`);
  const ff = run('ffmpeg', ['-y', '-i', src, '-vn', '-ac', '1', '-c:a', 'libmp3lame', '-b:a', '64k', mp3]);
  if (src !== mp3) { try { fs.unlinkSync(src); } catch {} }
  if (ff.status !== 0 || !fs.existsSync(mp3)) {
    console.error((ff.stderr || '').slice(-500));
    return null;
  }
  return mp3;
}

async function aai(url, options = {}) {
  const r = await fetch(url, {
    ...options,
    headers: { authorization: env.ASSEMBLYAI_API_KEY, ...(options.headers || {}) },
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`AssemblyAI ${r.status}: ${text.slice(0, 240)}`);
  return text ? JSON.parse(text) : {};
}

async function transcribe(filePath) {
  console.log('  uploading to AssemblyAI...');
  const uploaded = await aai(`${AAI}/upload`, {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream' },
    body: fs.readFileSync(filePath),
  });
  if (!uploaded.upload_url) throw new Error('AssemblyAI upload returned no URL');
  const job = await aai(`${AAI}/transcript`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      audio_url: uploaded.upload_url,
      speech_models: [TRANSCRIPT_TAG],
      language_detection: true,
    }),
  });
  if (!job.id) throw new Error(job.error || 'AssemblyAI did not return a transcript id');
  const deadline = Date.now() + 30 * 60 * 1000;
  while (Date.now() < deadline) {
    await sleep(5000);
    const t = await aai(`${AAI}/transcript/${job.id}`);
    if (t.status === 'completed') return t;
    if (t.status === 'error') throw new Error(t.error || 'transcript error');
    console.log(`  AssemblyAI: ${t.status}`);
  }
  throw new Error('AssemblyAI timed out after 30 minutes');
}

function chunkWords(words, id, type) {
  const minWords = type === 'short' ? 8 : 40;
  const chunks = [];
  let batch = [];
  let start = 0;
  for (const w of words || []) {
    const text = String(w.text || '').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    if (!batch.length) start = Math.max(0, Math.floor((Number(w.start) || 0) / 1000));
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

(async () => {
  if (state.captionIngested.length) {
    console.log('These videos were stored from YouTube captions and will be transcribed again with AssemblyAI.');
    console.log('After this run finishes, delete the old caption rows in the Supabase SQL editor:');
    console.log(`delete from documents where metadata->>'videoId' in (${state.captionIngested.map((id) => `'${id}'`).join(', ')}) and coalesce(metadata->>'transcript','') <> '${TRANSCRIPT_TAG}';`);
  }
  if (!DRY && state.rateLimitedUntil && Date.parse(state.rateLimitedUntil) > Date.now()) {
    console.log(`YouTube is still limiting downloads. Wait until ${new Date(state.rateLimitedUntil).toLocaleString()}, then run this again.`);
    console.log('Running it again now repeats the same block and makes the wait longer.');
    console.log(`Ingested: ${state.done.length}. Skipped, no spoken audio: ${state.failed.length}.`);
    return;
  }
  const videos = listVideos();
  state.later = state.later || [];
  const pending = videos.filter((v) => !state.done.includes(v.id) && !state.failed.includes(v.id));
  const later = new Set(state.later);
  const ordered = [...pending.filter((v) => !later.has(v.id)), ...pending.filter((v) => later.has(v.id))];
  console.log(`Channel has ${videos.length} videos. Ingested: ${state.done.length}. Skipped, no spoken audio: ${state.failed.length}. Still to do: ${pending.length}. Model: ${TRANSCRIPT_TAG}.`);
  const todo = ordered.slice(0, LIMIT);
  if (!todo.length) { console.log('Nothing new to transcribe.'); return; }
  if (DRY) {
    for (const v of todo) console.log(`- would transcribe [${v.type}] ${v.id}  ${v.title}`);
    console.log('Dry run finished (nothing downloaded).');
    return;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ahl-aai-'));
  let rateStrikes = 0;
  for (const v of todo) {
    console.log(`\nDownloading audio: ${v.id}  ${v.title}`);
    const mp3 = downloadMonoMp3(v.id, dir);
    if (!mp3) {
      if (rateLimited) {
        rateStrikes += 1;
        if (!state.later.includes(v.id)) state.later.push(v.id);
        save();
        console.log(`YouTube rate-limited ${v.id}. It will be tried after the other remaining videos.`);
        if (lastDownloadError) console.log(lastDownloadError);
        if (rateStrikes >= 2) {
          state.rateLimitedUntil = new Date(Date.now() + 30 * 60 * 1000).toISOString();
          save();
          console.log(`Two downloads were blocked in a row. Wait until ${new Date(state.rateLimitedUntil).toLocaleString()} before running this again.`);
          break;
        }
        await sleep(PAUSE_MS);
        continue;
      }
      console.log(`- download failed, will retry next run: ${v.title}`);
      if (lastDownloadError) console.log(lastDownloadError);
      await sleep(PAUSE_MS);
      continue;
    }
    rateStrikes = 0;
    state.rateLimitedUntil = '';
    state.later = state.later.filter((id) => id !== v.id);
    let result;
    try {
      result = await transcribe(mp3);
    } catch (err) {
      try { fs.unlinkSync(mp3); } catch {}
      if (/no spoken audio/i.test(err.message)) {
        console.error(`- no spoken audio, will not download again: ${v.title}`);
        if (!state.failed.includes(v.id)) state.failed.push(v.id);
        save();
      } else {
        console.error(`- AssemblyAI failed, will retry next run: ${err.message}`);
      }
      await sleep(PAUSE_MS);
      continue;
    }
    try { fs.unlinkSync(mp3); } catch {}
    const chunks = chunkWords(result.words, v.id, v.type);
    const language = result.language_code || '';
    console.log(`- [${v.type}] ${v.title}: ${chunks.length} chunks, language ${language || '?'}`);
    if (!chunks.length) {
      console.log('  empty transcript, marked failed so it is not retried forever');
      state.failed.push(v.id);
      save();
      continue;
    }
    const r = await fetch(hook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', [env.N8N_WEBHOOK_HEADER || 'x-api-key']: env.N8N_WEBHOOK_KEY },
      body: JSON.stringify({
        title: v.title,
        videoId: v.id,
        type: v.type,
        transcript: TRANSCRIPT_TAG,
        language,
        chunks,
      }),
    });
    if (!r.ok) { console.error(`  webhook failed: ${r.status} ${(await r.text()).slice(0, 200)}`); process.exit(1); }
    state.done.push(v.id);
    state.captionIngested = state.captionIngested.filter((id) => id !== v.id);
    save();
    await sleep(PAUSE_MS);
  }
  try { fs.rmdirSync(dir); } catch {}
  console.log('\nDone. Run again for the next batch.');
})().catch((err) => { console.error(err); process.exit(1); });
