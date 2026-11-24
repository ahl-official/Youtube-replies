# YouTube reply desk — handoff

Last updated 2026-11-24. No secrets in this file. Keys live in `.env.txt` (never commit or paste it).

After every project change, update this file in the same turn. The rule is `.cursor/rules/update-project-notes.mdc`.

## What this is

A desk for two YouTube channels. Staff click **Review comments**. The workflow reads the last 48 hours, drafts a reply from that channel’s knowledge, and saves it. A person clicks **Post** or **Discard**. Nothing is posted automatically.

Live desk: https://youtube-replies-three.vercel.app  
GitHub: https://github.com/ahl-official/Youtube-replies (`main`)  
n8n: https://n8n.hairscalptradingco.com

| Channel | Key | Channel ID | Handle |
|---|---|---|---|
| American Hairline | `ahl` | `UCKNwds5t-KBGMp6VzvfAr6A` | `@americanhairline` |
| Alchemane Hair Extensions | `alchemane` | `UC-4qTtMQtEYL7xwjpgxfwBg` | `@AlchemaneHairExtensions` |

The header switch stores `desk-channel` in localStorage. American Hairline is black/red (`#ff381e`). Alchemane is dark teal (`#43b2a4`). Comments, knowledge, post, and discard stay on the channel that owns the video.

## Rules that must stay

- **Post Reply to YouTube** stays disabled. **Every 5 Minutes** stays disabled. Review is manual, webhook `ahl-post-reply` is not used for batch posting.
- Reply workflow `ZRwUFsLyDCsLNq2j` stays **active** (webhooks). Ingest workflow `Fm3jcGDMuKnYDo6G` stays active.
- Manual Post publishes only that card’s saved reply, as the matching channel.
- Discard asks “Are you sure?”, then hides the viewer comment with `comments.setModerationStatus?moderationStatus=rejected`. Do not use `comments.delete` for viewer comments. Empty 204 is success.
- Every public reply ends with: `If you have any questions or would like to know more, please feel free to connect with us at +91 92226 66111. We’ll be happy to help!` The model must not write the phone itself.
- Reply in the commenter’s language. Never quote prices, promise results, or give medical advice. Pricing questions get a short consultation reply and the footer.
- Do not add made-up transcripts. AssemblyAI “no spoken audio” is a failed video. No Whisper. `minConfidence` 0.75. Ingest model `universal-2`.
- Do not run `build_*.js --push`. Edit `build_workflow.js`, then `node build_workflow.js` and `node push_reply.js`. PUT replaces nodes; `push_reply.js` copies live credentials by node name.
- Do not commit `.env.txt`, client secrets, or the scratch files `list_ingest.js` and `probe-workflow-id.txt`.

## n8n

Reply workflow `ZRwUFsLyDCsLNq2j`, name `AHL - YouTube Comment Auto-Reply (RAG)`, active.  
Ingest workflow `Fm3jcGDMuKnYDo6G`, active.

Webhooks, header `x-api-key` (credential `AHL Ingest Webhook Key`, id `EBYqE8OYpGo83wMT`):

- `POST /webhook/ahl-reply-run` body `{ channelId }` — review
- `POST /webhook/ahl-post-reply` body `{ commentId, text, channelId }`
- `POST /webhook/ahl-delete-comment` body `{ commentId, channelId }`
- `POST /webhook/ahl-ingest`

Review path: `Review Comments` → `Active Channel` → `Config` → `Fetch Channel Comments` → `Filter New Comments` → video chunks for that video and channel → agent → `Parse Answer` → log as `drafted` or `needs_human` / `skipped`. The fetch node uses the **American Hairline** YouTube credential for both channels (`allThreadsRelatedToChannelId`). Post and discard do not.

Post and discard each have an IF on `body.channelId`. Alchemane (`UC-4qTtMQtEYL7xwjpgxfwBg`) uses the Alchemane HTTP nodes. Anything else uses the American Hairline nodes. A channel check calls `channels?mine=true` and refuses the action if the token is the wrong channel. A fake `commentId` of `not-a-real-comment` returns parent-not-found when the channel matches, and does not publish.

| Credential | id | Use |
|---|---|---|
| YouTube AHL channel | `ZZPnZYUSerWcHwVD` | American Hairline post, discard, and comment fetch for both channels |
| YouTube Alchemene | `Wfa8VQmQLzMrEbRS` | Alchemane post and discard. Verified as Alchemane Hair Extensions |
| YouTube account | `6ntUDu6hi5PadnVq` | Old token. Do not use |
| Youtube-replies | `ADDv0kmTTEnqvZhU` | Old. Do not use |

`Config` fields: `channelId`, `channelKey` (`ahl` or `alchemane`), `channelName`, `topic`, `minConfidence` 0.75, `maxPerRun` 10, `maxAgeHours` 48, `footer`.

Knowledge tool `match_documents` is filtered with metadata `channel` = `channelKey`. Video chunk lookup also requires `metadata.channel`. The SQL function already supports `filter jsonb` (`metadata @> filter`).

Filter (as of 2026-11-24, live in n8n, **not committed**): skip empty text, comments that already have a reply, the channel’s own comments, comments with links, and ids in workflow static `seen`. Short comments such as `Price` are kept. The old `length < 8` rule was dropping them.

## Knowledge

Supabase table `documents`. `metadata.channel` is `ahl` or `alchemane`.

- American Hairline: 223 videos, 521 chunks, tagged `ahl` (older rows were backfilled).
- Alchemane: 273 transcribed videos, 409 chunks, tagged `alchemane`. 83 videos failed with no spoken audio and are not retried. State file `ingested-alchemane.json`.
- Ingest command: `node ingest_local.js --channel=alchemane --limit=500` (or `ahl`). Default limit 10. Pause 8 seconds. Do not hammer YouTube.

`comment_log` has no `channel` column. The desk maps `comment_id` → `ahl|alchemane` in Supabase Storage `desk-state/comment-channels.json`, and `videoId` → YouTube channel id in `desk-state/video-channels.json`. A comment with no resolvable channel is hidden, not dumped onto American Hairline. New reviews write the map from the selected channel.

## Desk and hosting

`dashboard/` is the app. Vercel project root is `dashboard`.

New account (the live one): Vercel user `ahairlines61-7567`, team **AHL** (`ahl8`), project `youtube-replies`, URL https://youtube-replies-three.vercel.app. Root directory `dashboard`. Env set for Production, Preview, and Development: `N8N_BASE_URL`, `N8N_API_KEY`, `N8N_WEBHOOK_KEY`, `N8N_WEBHOOK_HEADER`, `ASSEMBLYAI_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`. `/api/status` on 2026-11-20 returned configured, webhook, documents, and comment log all true.

Old account `ai-americanhairs-projects` / https://youtube-replies.vercel.app was paused for CPU / Fluid usage. Do not deploy there.

Local add-video buttons only show on `localhost` or `127.0.0.1`. `Start desk.bat` → http://127.0.0.1:4173.

PWA: `manifest.webmanifest`, `sw.js` cache `ahl-desk-v12`, `app.js?v=11`, `styles.css?v=9`. Privacy and terms: `/privacy` and `/terms`.

## Google OAuth

Cloud project `youtube-agent-analytics`. While the consent screen is **Testing**, refresh tokens die after 7 days. That happened on 2026-11-16 (`invalid_grant` on **YouTube AHL channel**). Reviews worked again on 2026-11-24, so that login is valid for now.

To stop the 7-day cutoff: Google Auth platform → Audience → **Publish app**. The button stays grey until Branding has an authorized domain plus home, privacy, and terms links. Use the live desk:

- Authorized domain: `youtube-replies-three.vercel.app`
- Home: `https://youtube-replies-three.vercel.app`
- Privacy: `https://youtube-replies-three.vercel.app/privacy`
- Terms: `https://youtube-replies-three.vercel.app/terms`
- App name: `YouTube reply desk`. Leave the logo empty.

After publishing, sign in again in n8n on **YouTube AHL channel** and **YouTube Alchemene**.

## Latest review (2026-11-24)

These were ignored by the 8-character rule, then reviewed after the filter change. They are drafts, not posted:

- American Hairline Drafts: `Price` from @sushantnigadi05 and @a-20shreyasdevlekar85 (`comment_log` 53 and 54).
- Alchemane Drafts: `Price` from @a-20shreyasdevlekar85 (`comment_log` 52).
- American Hairline Needs a person: `40` from @siddharthaguha8583 (`comment_log` 55).

Do not post old bad drafts (ids 1 and 8) unless a person clicks Post. Comment 9 was discarded. Do not re-post it.

## How to resume

1. Read this file, `build_workflow.js`, `dashboard/server.js`, and `dashboard/channels.js`.
2. Reply workflow changes: `node build_workflow.js` then `node push_reply.js`. Confirm the workflow is still active and **Post Reply to YouTube** is still disabled.
3. Executions: `GET /api/v1/executions?workflowId=ZRwUFsLyDCsLNq2j&limit=5` with header `X-N8N-API-KEY`.
4. The short-comment filter (`text.length < 8` removed) is in `build_workflow.js` and live in n8n.
5. Vercel CLI on this PC is logged in as `ahairlines61-7567`, scope `ahl8`.
