# American Hairline - YouTube Comment Auto-Reply Bot (project notes)

Handoff document: everything a new coding agent (or you) needs to continue. Last updated 2026-11-03.
**No secrets are stored here.** API keys live in `.env.txt` (never commit or paste it).

## 1. Goal
Automatically reply to comments on the YouTube channel **@AmericanHairline** (channel ID `UCKNwds5t-KBGMp6VzvfAr6A`; educational content about hair patches / hair systems / wigs), like Instagram auto-replies, but answering from our own knowledge base (video transcripts + extra documents).

Business rules the owner decided:
- **No approval step.** Reply to everything the bot can answer; post automatically.
- If a comment relates to another video, **suggest that video with its link**.
- If the AI really doesn't know, **don't reply publicly; save it to a human-review queue** (later: a dashboard).
- **Every posted reply ends with a fixed message** (form in the video description / channel bio). Footer text lives in the `Config` node, field `footer`.
- Reply in the commenter's language (English / Hindi / Hinglish).
- Never quote prices, promise results, or give medical advice. Pricing / booking / "suits my case" questions get a short "needs a consultation" reply (no numbers) plus the footer.

## 2. Architecture
```
YouTube videos + Shorts --(yt-dlp + ffmpeg on this PC)--> mono mp3 --(AssemblyAI Universal-2)--> text chunks -- n8n webhook --embed--> Supabase pgvector (table: documents)

Every 5 min:  YouTube comments -> filter -> AI agent (searches documents) -> decide
                -> reply   : post to YouTube -> log to comment_log (status replied / error)
                -> human   : log to comment_log (status needs_human)
                -> spam    : log to comment_log (status skipped)
```
Stack: **n8n** (self-hosted at https://n8n.hairscalptradingco.com), **Supabase** (Postgres + pgvector), **OpenRouter** (chat model `google/gemini-2.5-flash`, embeddings `openai/text-embedding-3-small`, 1536 dims), **AssemblyAI Universal-2** for transcripts, **yt-dlp** + Node 22 scripts on the owner's Windows PC.

## 3. n8n workflows (both created through the n8n public API)
| Workflow | ID | State |
|---|---|---|
| AHL - YouTube Comment Auto-Reply (RAG) | `ZRwUFsLyDCsLNq2j` | Built, **inactive** (activate only after a supervised test, see section 7) |
| AHL - Knowledge Base Ingestion (Videos + Docs) | `Fm3jcGDMuKnYDo6G` | Built, works via webhook; must be **active** for the production webhook |

### Reply workflow nodes
`Every 5 Minutes -> Config -> Fetch Channel Comments (YouTube commentThreads) -> Filter New Comments -> Answer From Knowledge Base (AI Agent + Chat Model (OpenRouter) + Knowledge Base (Supabase vector tool) + Embeddings) -> Parse Answer -> Auto Reply? -> [true] Post Reply to YouTube -> Log: Replied | [false] Log: Needs Human / Skipped`

- `Config`: `channelId`, `minConfidence` (0.75), `maxPerRun` (5 comments per run, controls token spend), `footer`.
- `Filter New Comments`: skips own comments, comments that already have replies, comments with links (spam), text under 8 chars, and already-seen IDs (kept in workflow static data, **which only persists while the workflow is ACTIVE**; manual test runs re-process the same comments).
- `Parse Answer`: extracts the JSON object from the model output, decides `action` = `reply` | `human` | `ignore`, and appends the footer to replies. Returns one item per comment.
- `Post Reply to YouTube`: `POST /youtube/v3/comments?part=snippet`, one reply every 20 s (batching), `onError: continueRegularOutput` so failures get logged as `error`. **Currently DISABLED at the owner's request** (`disabled: true` in `build_workflow.js`). While disabled, items pass through and `Log: Replied` stores them as status `drafted` (reply text saved, nothing posted). To go live, enable the node in n8n (or remove `disabled: true` and run `push_reply.js`). Do not enable it without the owner's explicit say-so.
- Prompt (system message) is in `build_workflow.js` (`systemPrompt`). Categories: question, praise, video_request, pricing, complaint, spam, unknown, other.

### Ingestion workflow nodes
`Add External Knowledge (Webhook) -> Chunk External Text -> Save to Knowledge Base (Supabase vector store, insert) <- Document Loader <- Text Splitter (4000 chars, no overlap) ; Embeddings`
- Webhook `POST {N8N_BASE_URL}/webhook/ahl-ingest` with header `x-api-key: <N8N_WEBHOOK_KEY>`.
- Accepts either pre-chunked transcripts `{title, videoId, type, chunks:[{text,start,url}]}` (used by `ingest_local.js`) or plain documents `{title, text, source?}` (chunked into ~350 words, `type: document`).
- Each stored row has metadata: `source`, `type` (`video` | `short` | `document`), `videoId`, `title`, `start`, `url`, `transcript` (`universal-2` for videos), `language`.
- YouTube auto-captions are not used. They were inaccurate, and `captions.download` also returns 403 for auto-generated captions. Transcripts come from AssemblyAI Universal-2.

## 4. Files in this folder
| File | Purpose |
|---|---|
| `.env.txt` | `N8N_BASE_URL`, `N8N_API_KEY`, `N8N_WEBHOOK_KEY`, `N8N_WEBHOOK_HEADER`, `ASSEMBLYAI_API_KEY`. Secrets. (Windows saved it as `.env.txt`; scripts read `.env` or `.env.txt`.) |
| `schema.sql` | Supabase SQL: `documents` table + `match_documents` function + `comment_log` table. Run in the Supabase SQL editor. |
| `build_workflow.js` | **Source of truth** for the reply workflow (nodes, prompt, code). Writes `workflow.json`. |
| `push_reply.js` | Pushes `workflow.json` to the live reply workflow **keeping the credentials already attached in n8n**. Run `node build_workflow.js && node push_reply.js`. |
| `build_ingest.js` | Source of truth for the ingestion workflow. Writes `ingest_workflow.json`. |
| `patch_*.js`, `fix_embeddings.js`, `setup_webhook_key.js` | One-off patches already applied (history). They GET the live workflow, change one thing, PUT it back. |
| `ingest_local.js` | Lists the channel, downloads audio with yt-dlp, converts to mono MP3, transcribes with AssemblyAI Universal-2, chunks, POSTs to the webhook. State in `ingested.json`. |
| `ingested.json` | `done` = ingested with Universal-2. `captionIngested` = the early videos stored from YouTube captions; they are transcribed again. `failed` = no spoken audio or an empty transcript; not downloaded again. |
| `dashboard/` | Local web app. `npm start` in that folder opens http://127.0.0.1:4173 . Review queue, knowledge list, add/edit/delete. Needs `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in `.env.txt` (the setup screen writes them). |

Do NOT run `build_*.js --push` against the live workflows: it would wipe the credentials attached in the n8n UI. Use `push_reply.js` (reply) or a patch script (ingest).

## 5. Credentials (created in the n8n UI; IDs not needed)
YouTube OAuth2 (channel owner, Google Cloud project with YouTube Data API v3), Supabase (service_role), OpenAI-type credential pointed at OpenRouter (`https://openrouter.ai/api/v1`, used by the Embeddings nodes), OpenRouter (chat model), Header Auth "AHL Ingest Webhook Key" (`x-api-key`). n8n shows secrets as `__n8n_BLANK_VALUE_...`; that is a placeholder, not the value. Never press Save in a credential dialog showing it.

## 6. Decisions and gotchas learned
- YouTube has no comment webhook, so the bot **polls** every 5 min. Default quota 10,000 units/day: listing ~1 unit, posting a reply ~50 units, so about 200 replies per day max.
- YouTube auto-captions were inaccurate, and the captions API returns 403 for them. Audio is downloaded with `yt-dlp`, converted by `ffmpeg` to **mono** MP3, and transcribed by AssemblyAI `universal-2` (`speech_models`, language detection on). Mono matters: AssemblyAI bills each channel, so a stereo file would cost double. About $0.15 per hour of audio. YouTube still rate-limits downloads (HTTP 429); the script stops and the next run retries.
- Embeddings node: n8n's model dropdown rejects `openai/text-embedding-3-small`; it is set as an expression `={{ 'openai/text-embedding-3-small' }}` to bypass validation.
- Document Loader needs a Text Splitter sub-node (added; 4000 chars so pre-made chunks stay whole).
- One table for videos, Shorts and documents (tag `type`), not separate databases. Delete Shorts later with `delete from documents where metadata->>'type'='short';`.
- Same embedding model must be used for ingestion and search (changing it needs a table rebuild and re-ingest).
- Model returns reasoning text before JSON sometimes; parser takes the outermost `{...}`.
- Updating a workflow with `PUT` replaces nodes: always GET first and preserve `credentials`.
- Reply count in a run = `maxPerRun`; token cost is about 2 model calls per comment.

## 7. Current status (2026-11-02)
Done:
- Both workflows built; prompt tuned on real comments (video requests, Hinglish, vague comments skipped, praise varied).
- Ingestion webhook works. Three videos were ingested from YouTube captions (`captionIngested` in `ingested.json`). They are not in `done`, so the next `node ingest_local.js` run transcribes them with AssemblyAI. After that, delete the old rows (see section 7). Local Whisper was removed; it is not part of this pipeline.
- Related-video links, footer, human-review logging implemented in the reply workflow (just pushed; **not yet executed**). The posting node is **disabled** by the owner, so replies are saved as `drafted` in `comment_log` instead of being posted.

To do, in order:
1. **Run the `comment_log` SQL** (bottom of `schema.sql`) in Supabase. Until then the Log nodes error.
2. If the 3 early videos have no tag, run: `update documents set metadata = metadata || '{"type":"video"}' where metadata->>'type' is null;`
3. **Add `ASSEMBLYAI_API_KEY` to `.env.txt`, then ingest:** `node ingest_local.js` (default 10 videos per run). Optional `--limit=1`. Needs the ingestion workflow active. After the three caption-era videos are redone, run in Supabase: `delete from documents where metadata->>'videoId' in ('CVclkyXNqfQ','EHYUhjOhtII','KHCiG_KpuuI') and coalesce(metadata->>'transcript','') <> 'universal-2';`
4. Open the reply workflow in n8n, check Config (`footer` wording, `maxPerRun`) and that the Post / Log nodes show credentials.
5. **Supervised first run:** set `maxPerRun` to 1, execute manually once, check the YouTube reply, the `comment_log` row, and the footer. Then activate (so the seen-memory works) and raise `maxPerRun`.
6. **Dashboard:** `cd dashboard` then `npm start`, open http://127.0.0.1:4173 . First screen asks for the Supabase URL and service role key. Review queue reads `comment_log`. Knowledge edits go through the ingest webhook so embeddings stay in sync.
7. Optional: periodic re-ingest of new uploads (run `ingest_local.js` on a schedule via Windows Task Scheduler); a daily cap on replies to protect YouTube quota; a "holding reply + footer" for unknown questions if the owner wants more replies.

## 8. How to resume in another agent
1. Read this file, `build_workflow.js`, and `ingest_local.js`.
2. `.env.txt` already holds the n8n URL/API key. API base: `{N8N_BASE_URL}/api/v1`, header `X-N8N-API-KEY`.
3. Change the reply workflow by editing `build_workflow.js`, then `node build_workflow.js && node push_reply.js`. Verify by reading executions: `GET /api/v1/executions?workflowId=ZRwUFsLyDCsLNq2j&includeData=true`.
4. Public posting happens as soon as the reply workflow is active, so test with `maxPerRun = 1` first.
