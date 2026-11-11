// Builds the n8n workflow JSON and (optionally) pushes it to n8n via the public API.
// Usage: node build_workflow.js            -> writes workflow.json only
//        node build_workflow.js --push     -> also creates it in n8n (reads .env.txt / .env)
const fs = require('fs');
const path = require('path');

const AHL_ID = 'UCKNwds5t-KBGMp6VzvfAr6A';
const ALC_ID = 'UC-4qTtMQtEYL7xwjpgxfwBg';
const CHANNEL_ID = AHL_ID; // default when a review is started without a channel
const CHANNEL_NAMES = JSON.stringify({
  [AHL_ID]: 'American Hairline',
  [ALC_ID]: 'Alchemane',
});
const CHANNEL_TOPICS = JSON.stringify({
  [AHL_ID]: 'hair patches, hair systems and wigs',
  [ALC_ID]: "women's hair extensions and wigs",
});

const activeChannelCode = `let channelId = '${AHL_ID}';
try {
  const body = $('Review Comments').first().json.body || {};
  if (body.channelId) channelId = String(body.channelId);
} catch (e) {}
const names = ${CHANNEL_NAMES};
const topics = ${CHANNEL_TOPICS};
if (!names[channelId]) channelId = '${AHL_ID}';
return [{ json: { channelId, channelName: names[channelId], topic: topics[channelId] } }];`;

const filterCode = `// Keep only fresh, unanswered, top-level comments from other people.
// A comment stays eligible for 48 hours, so a miss on the 5-minute poll can still be picked up.
const OWN_CHANNEL = $('Config').first().json.channelId;
const cutoff = Date.now() - Number($('Config').first().json.maxAgeHours || 48) * 60 * 60 * 1000;
const store = $getWorkflowStaticData('global');
store.seen = store.seen || [];
const out = [];
for (const item of $input.all()) {
  let olderThanWindow = false;
  for (const t of (item.json.items || [])) {
    const top = t.snippet.topLevelComment;
    const s = top.snippet;
    const published = Date.parse(s.publishedAt || '');
    if (!published || published < cutoff) { olderThanWindow = true; break; }
    const text = (s.textOriginal || '').trim();
    if (!text || text.length < 8) continue;
    if (t.snippet.totalReplyCount > 0) continue;
    if (s.authorChannelId && s.authorChannelId.value === OWN_CHANNEL) continue;
    if (/https?:\\/\\//i.test(text)) continue;          // links = likely spam
    if (store.seen.includes(top.id)) continue;
    out.push({ json: {
      commentId: top.id,
      videoId: s.videoId,
      author: s.authorDisplayName,
      comment: text,
      publishedAt: s.publishedAt,
    }});
  }
  if (olderThanWindow) break;
}
// cap tokens per run; only the comments we actually take are marked as seen
const batch = out.slice(0, $('Config').first().json.maxPerRun);
for (const b of batch) store.seen.push(b.json.commentId);
store.seen = store.seen.slice(-2000);
return batch;`;

const parseCode = `// Parse the agent's JSON answer and decide what to do: reply | human | ignore
const cfg = $('Config').first().json;
const sources = $('Filter New Comments').all();
return $input.all().map((item, i) => {
  const raw = String(item.json.output || '');
  let data;
  try {
    // the model sometimes writes reasoning before the JSON: take the outermost {...}
    const a = raw.indexOf('{'), b = raw.lastIndexOf('}');
    data = JSON.parse(raw.slice(a, b + 1));
  } catch (e) {
    data = { should_reply: false, reply: '', confidence: 0, category: 'unknown', reason: 'unparseable: ' + raw.slice(0, 200) };
  }
  const reply = String(data.reply || '').trim();
  let action = 'human';                                   // default: a person looks at it
  if (data.category === 'spam') action = 'ignore';
  else if (data.should_reply === true && reply && Number(data.confidence) >= cfg.minConfidence) action = 'reply';
  // every posted reply ends with the fixed closing line
  const finalReply = action === 'reply' ? reply + '\\n\\n' + cfg.footer : '';
  return { json: { ...sources[i].json, ...data, action, reply: finalReply } };
});`;

const systemPrompt = `You answer viewer comments using ONLY the information returned by the knowledge_base tool (transcripts of our videos and approved documents). Always call the tool before answering a question.

Our goal is to reply to as many comments as we safely can. A fixed closing line with our phone number is added automatically after your reply, so NEVER write that yourself, never include a phone number, and never mention forms or links to the description.

Rules:
- If the knowledge base does not clearly answer a real question, set should_reply false and category "unknown". A human will handle it. Never guess.
- Related videos: when the answer, or a closely related topic, is covered in a video, point the viewer to it and include its link, copied exactly from the "url" metadata returned by the tool. Never invent or alter a link. If several match, prefer long videos over Shorts.
- Never quote prices or numbers that are not in the knowledge base, never promise results, never give medical advice.
- Pricing, cost, booking, location or "will this suit my case" questions: set should_reply true, category "pricing", confidence 0.9, and say briefly that it depends on the person's case and needs a proper consultation. Give no figures.
- Complaints, refund or legal threats, abuse or angry comments: should_reply false and category "complaint" (a human handles these).
- Spam, scams, promotions or gibberish: should_reply false and category "spam".
- You are given the title and opening of the video the comment is posted on. Read the comment as a reaction to THAT video.
- Praise means the viewer is thanking or complimenting this channel, the host, or their own result. A joke or opinion about a person shown in the video is not praise. On a video about an actor wearing a hair patch or extensions, "it's his profession, he has to look good on screen" is teasing that actor, not saying our customers feel confident. Never reply as if the commenter is a happy client unless they clearly are.
- For a joke or reaction about the person in the video, reply in that same light tone, in the commenter's language, about that person. Do not invent a customer story. If the video context does not make the joke clear, set should_reply false and category "other".
- Praise and thanks aimed at this channel: a short, warm one-line reply is fine (confidence 0.9).
- Video or topic requests (e.g. "please make a video on X"): set should_reply true, category "video_request", confidence 0.9. Reply with a short thank-you saying we have noted the suggestion, in the commenter's language. Do not promise a date or that the video will be made, and do not answer the topic from memory.
- Only answer clear questions. If the comment is a single word or too vague to tell what is being asked (for example just "Transplant"), set should_reply false and category "other". Never guess what the viewer meant.
- Reply in the SAME language and script as the comment. A Hinglish comment (Hindi written in English letters) gets a Hinglish reply, not English. Keep it friendly, under 60 words, no hashtags, at most one emoji.
- For praise, vary the wording each time; never reuse the same sentence.
- When the answer comes from a specific video, mention it naturally (e.g. "we cover this in our video on X").
- Answer only for the channel named above. Ignore knowledge about the other brand.

Respond with ONLY a JSON object. No explanation, no reasoning and no markdown before or after it:
{"should_reply": true|false, "reply": "text", "confidence": 0.0-1.0, "category": "question|praise|video_request|pricing|complaint|spam|unknown|other", "reason": "short"}`;

const systemMessage = `={{ 'You are the community manager for the YouTube channel "' + $('Config').first().json.channelName + '", which posts educational content about ' + $('Config').first().json.topic + '.\\n\\n' + ${JSON.stringify(systemPrompt)} }}`;

function channelSwitch(id, name, position, hookName) {
  return {
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' },
        conditions: [{
          id: id + 'c',
          leftValue: `={{ $('${hookName}').first().json.body.channelId }}`,
          rightValue: ALC_ID,
          operator: { type: 'string', operation: 'equals' },
        }],
        combinator: 'and',
      },
      options: {},
    },
    id, name, type: 'n8n-nodes-base.if', typeVersion: 2.2, position,
  };
}

function youtubeMine(id, name, position) {
  return {
    parameters: {
      url: 'https://www.googleapis.com/youtube/v3/channels',
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'youTubeOAuth2Api',
      sendQuery: true,
      queryParameters: { parameters: [
        { name: 'part', value: 'snippet' },
        { name: 'mine', value: 'true' },
      ]},
      options: {},
    },
    id, name, type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2, position, onError: 'continueRegularOutput',
  };
}

function youtubeInsert(id, name, position) {
  return {
    parameters: {
      method: 'POST',
      url: 'https://www.googleapis.com/youtube/v3/comments',
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'youTubeOAuth2Api',
      sendQuery: true,
      queryParameters: { parameters: [{ name: 'part', value: 'snippet' }] },
      sendBody: true,
      specifyBody: 'json',
      jsonBody: '={{ JSON.stringify({ snippet: { parentId: $json.commentId, textOriginal: $json.text } }) }}',
      options: {},
    },
    id, name, type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2, position, onError: 'continueRegularOutput',
  };
}

function youtubeReject(id, name, position) {
  return {
    parameters: {
      method: 'POST',
      url: 'https://www.googleapis.com/youtube/v3/comments/setModerationStatus',
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'youTubeOAuth2Api',
      sendQuery: true,
      queryParameters: { parameters: [
        { name: 'id', value: '={{ $json.commentId }}' },
        { name: 'moderationStatus', value: 'rejected' },
      ]},
      options: { response: { response: { responseFormat: 'text' } } },
    },
    id, name, type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2, position, onError: 'continueRegularOutput',
  };
}

const nodes = [
  {
    parameters: { rule: { interval: [{ field: 'minutes', minutesInterval: 5 }] } },
    id: 'n1', name: 'Every 5 Minutes', type: 'n8n-nodes-base.scheduleTrigger',
    typeVersion: 1.2, position: [0, 300],
    disabled: true,
  },
  {
    parameters: {
      httpMethod: 'POST',
      path: 'ahl-reply-run',
      authentication: 'headerAuth',
      responseMode: 'onReceived',
      options: {},
    },
    id: 'n1b', name: 'Review Comments', type: 'n8n-nodes-base.webhook', typeVersion: 2,
    position: [0, 480], webhookId: 'ahl-reply-run',
    credentials: { httpHeaderAuth: { id: 'EBYqE8OYpGo83wMT', name: 'AHL Ingest Webhook Key' } },
  },
  {
    parameters: { jsCode: activeChannelCode },
    id: 'n1a', name: 'Active Channel', type: 'n8n-nodes-base.code', typeVersion: 2, position: [220, 160],
  },
  {
    parameters: {
      httpMethod: 'POST',
      path: 'ahl-post-reply',
      authentication: 'headerAuth',
      responseMode: 'lastNode',
      options: {},
    },
    id: 'n1c', name: 'Post One Reply Hook', type: 'n8n-nodes-base.webhook', typeVersion: 2,
    position: [0, 720], webhookId: 'ahl-post-reply',
    credentials: { httpHeaderAuth: { id: 'EBYqE8OYpGo83wMT', name: 'AHL Ingest Webhook Key' } },
  },
  channelSwitch('n1c1', 'Post Account?', [220, 720], 'Post One Reply Hook'),
  youtubeMine('n1d', 'Posting Channel', [440, 640]),
  youtubeMine('n1d2', 'Posting Channel Alchemane', [440, 820]),
  {
    parameters: {
      jsCode: `const raw = $input.first().json;
const hook = $('Post One Reply Hook').first().json.body || {};
if (raw.error) {
  const message = raw.error.description || raw.error.message || 'Could not check which YouTube channel is connected';
  return [{ json: { ok: false, blocked: true, error: String(message).replace(/<[^>]+>/g, ' ').replace(/\\s+/g, ' ').trim().slice(0, 300) } }];
}
const mine = (raw.items || [])[0] || {};
const names = ${CHANNEL_NAMES};
const handle = (mine.snippet && (mine.snippet.customUrl || mine.snippet.title)) || 'another channel';
const expected = hook.channelId || '${AHL_ID}';
const expectedName = names[expected] || 'the selected channel';
if (mine.id !== expected) {
  return [{ json: { ok: false, blocked: true, error: 'YouTube is connected as ' + handle + ', not ' + expectedName + '. Connect that YouTube channel in n8n, then try again.' } }];
}
return [{ json: { blocked: false, commentId: hook.commentId, text: hook.text } }];`,
    },
    id: 'n1e', name: 'Channel Check', type: 'n8n-nodes-base.code', typeVersion: 2, position: [660, 720],
  },
  {
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' },
        conditions: [
          { id: 'ch1', leftValue: '={{ $json.blocked }}', rightValue: false, operator: { type: 'boolean', operation: 'false', singleValue: true } },
        ],
        combinator: 'and',
      },
      options: {},
    },
    id: 'n1f', name: 'Right Channel?', type: 'n8n-nodes-base.if', typeVersion: 2.2, position: [880, 720],
  },
  channelSwitch('n1f2', 'Post With?', [1100, 640], 'Post One Reply Hook'),
  youtubeInsert('n12b', 'Post One Reply', [1320, 560]),
  youtubeInsert('n12b2', 'Post One Reply Alchemane', [1320, 760]),
  {
    parameters: {
      jsCode: `const item = $input.first().json;
if (item.ok === false) return [{ json: { ok: false, error: item.error || 'YouTube did not accept the reply' } }];
if (item.error) {
  const raw = item.error.description || item.error.message || 'YouTube did not accept the reply';
  const error = String(raw).replace(/<[^>]+>/g, ' ').replace(/\\s+/g, ' ').trim().slice(0, 300);
  return [{ json: { ok: false, error } }];
}
const author = item.snippet && item.snippet.authorChannelId && item.snippet.authorChannelId.value;
const expected = $('Post One Reply Hook').first().json.body.channelId || '${AHL_ID}';
const names = ${CHANNEL_NAMES};
if (author && author !== expected) {
  const name = (item.snippet && item.snippet.authorDisplayName) || 'another channel';
  return [{ json: { ok: false, error: 'YouTube saved that reply as ' + name + ', not ' + (names[expected] || 'the selected channel') + ', so it will not show on the video.' } }];
}
if (!item.id) return [{ json: { ok: false, error: 'YouTube did not return a reply id' } }];
return [{ json: { ok: true, id: item.id } }];`,
    },
    id: 'n12c', name: 'Post One Reply Result', type: 'n8n-nodes-base.code', typeVersion: 2, position: [1540, 720],
  },
  {
    parameters: {
      httpMethod: 'POST',
      path: 'ahl-delete-comment',
      authentication: 'headerAuth',
      responseMode: 'lastNode',
      options: {},
    },
    id: 'n1g', name: 'Delete Comment Hook', type: 'n8n-nodes-base.webhook', typeVersion: 2,
    position: [0, 1080], webhookId: 'ahl-delete-comment',
    credentials: { httpHeaderAuth: { id: 'EBYqE8OYpGo83wMT', name: 'AHL Ingest Webhook Key' } },
  },
  channelSwitch('n1g1', 'Delete Account?', [220, 1080], 'Delete Comment Hook'),
  youtubeMine('n1h', 'Delete Channel', [440, 1000]),
  youtubeMine('n1h2', 'Delete Channel Alchemane', [440, 1180]),
  {
    parameters: {
      jsCode: `const raw = $input.first().json;
const hook = $('Delete Comment Hook').first().json.body || {};
if (raw.error) {
  const message = raw.error.description || raw.error.message || 'Could not check which YouTube channel is connected';
  return [{ json: { ok: false, blocked: true, error: String(message).replace(/<[^>]+>/g, ' ').replace(/\\s+/g, ' ').trim().slice(0, 300) } }];
}
const mine = (raw.items || [])[0] || {};
const names = ${CHANNEL_NAMES};
const handle = (mine.snippet && (mine.snippet.customUrl || mine.snippet.title)) || 'another channel';
const expected = hook.channelId || '${AHL_ID}';
const expectedName = names[expected] || 'the selected channel';
if (mine.id !== expected) {
  return [{ json: { ok: false, blocked: true, error: 'YouTube is connected as ' + handle + ', not ' + expectedName + '. Connect that YouTube channel in n8n, then discard again.' } }];
}
return [{ json: { blocked: false, commentId: hook.commentId } }];`,
    },
    id: 'n1i', name: 'Delete Channel Check', type: 'n8n-nodes-base.code', typeVersion: 2, position: [660, 1080],
  },
  {
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' },
        conditions: [
          { id: 'ch2', leftValue: '={{ $json.blocked }}', rightValue: false, operator: { type: 'boolean', operation: 'false', singleValue: true } },
        ],
        combinator: 'and',
      },
      options: {},
    },
    id: 'n1j', name: 'Delete Right Channel?', type: 'n8n-nodes-base.if', typeVersion: 2.2, position: [880, 1080],
  },
  channelSwitch('n1j2', 'Delete With?', [1100, 1000], 'Delete Comment Hook'),
  youtubeReject('n1k', 'Delete on YouTube', [1320, 920]),
  youtubeReject('n1k2', 'Delete on YouTube Alchemane', [1320, 1120]),
  {
    parameters: {
      jsCode: `const item = $input.first().json;
if (item.ok === false) return [{ json: { ok: false, error: item.error || 'YouTube did not delete the comment' } }];
if (item.error) {
  const raw = item.error.description || item.error.message || 'YouTube did not delete the comment';
  const error = String(raw).replace(/<[^>]+>/g, ' ').replace(/\\s+/g, ' ').trim().slice(0, 300);
  if (/not found|commentNotFound|already been deleted|Invalid JSON in response body/i.test(error)) return [{ json: { ok: true, alreadyGone: true } }];
  return [{ json: { ok: false, error } }];
}
return [{ json: { ok: true } }];`,
    },
    id: 'n1l', name: 'Delete Comment Result', type: 'n8n-nodes-base.code', typeVersion: 2, position: [1540, 1080],
  },
  {
    parameters: {
      assignments: { assignments: [
        { id: 'a1', name: 'channelId', value: '={{ $json.channelId }}', type: 'string' },
        { id: 'a6', name: 'channelName', value: '={{ $json.channelName }}', type: 'string' },
        { id: 'a7', name: 'topic', value: '={{ $json.topic }}', type: 'string' },
        { id: 'a2', name: 'minConfidence', value: 0.75, type: 'number' },
        { id: 'a3', name: 'maxPerRun', value: 10, type: 'number' },
        { id: 'a5', name: 'maxAgeHours', value: 48, type: 'number' },
        { id: 'a4', name: 'footer', value: 'If you have any questions or would like to know more, please feel free to connect with us at +91 92226 66111. We’ll be happy to help!', type: 'string' },
      ]},
      options: {},
    },
    id: 'n2', name: 'Config', type: 'n8n-nodes-base.set', typeVersion: 3.4, position: [220, 300],
  },
  {
    parameters: {
      url: 'https://www.googleapis.com/youtube/v3/commentThreads',
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'youTubeOAuth2Api',
      sendQuery: true,
      queryParameters: { parameters: [
        { name: 'part', value: 'snippet' },
        { name: 'allThreadsRelatedToChannelId', value: '={{ $json.channelId }}' },
        { name: 'order', value: 'time' },
        { name: 'maxResults', value: '50' },
        { name: 'textFormat', value: 'plainText' },
      ]},
      options: {
        pagination: {
          pagination: {
            paginationMode: 'updateAParameterInEachRequest',
            parameters: { parameters: [
              { type: 'qs', name: 'pageToken', value: '={{ $response.body.nextPageToken }}' },
            ]},
            paginationCompleteWhen: 'other',
            completeExpression: "={{ !$response.body.nextPageToken || Date.parse($response.body.items[$response.body.items.length - 1].snippet.topLevelComment.snippet.publishedAt) < Date.now() - $('Config').first().json.maxAgeHours * 60 * 60 * 1000 }}",
            limitPagesFetched: true,
            maxRequests: 4,
            requestInterval: 200,
          },
        },
      },
    },
    id: 'n3', name: 'Fetch Channel Comments', type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2, position: [440, 300],
  },
  {
    parameters: { jsCode: filterCode },
    id: 'n4', name: 'Filter New Comments', type: 'n8n-nodes-base.code', typeVersion: 2, position: [660, 300],
  },
  {
    parameters: {
      resource: 'row',
      operation: 'getAll',
      tableId: 'documents',
      returnAll: false,
      limit: 4,
      filterType: 'manual',
      matchType: 'allFilters',
      filters: { conditions: [
        { keyName: 'metadata->>videoId', condition: 'eq', keyValue: '={{ $json.videoId }}' },
      ]},
    },
    id: 'n4b', name: 'Video Chunks', type: 'n8n-nodes-base.supabase', typeVersion: 1, position: [880, 300],
    alwaysOutputData: true,
  },
  {
    parameters: { jsCode: `// One item per comment, with the title and opening of the video it was posted on
const comments = $('Filter New Comments').all().map((item) => item.json);
const chunksByVideo = new Map();
for (const item of $input.all()) {
  const meta = item.json.metadata || {};
  const id = meta.videoId;
  if (!id || !item.json.content) continue;
  if (!chunksByVideo.has(id)) chunksByVideo.set(id, []);
  chunksByVideo.get(id).push({ start: Number(meta.start) || 0, title: meta.title || '', text: String(item.json.content) });
}
return comments.map((comment) => {
  const bits = (chunksByVideo.get(comment.videoId) || []).sort((a, b) => a.start - b.start).slice(0, 4);
  return { json: {
    ...comment,
    videoTitle: bits.find((bit) => bit.title)?.title || '',
    videoContext: bits.map((bit) => bit.text).join(' ').slice(0, 900),
  }};
});` },
    id: 'n4c', name: 'This Video', type: 'n8n-nodes-base.code', typeVersion: 2, position: [1100, 300],
  },
  {
    parameters: {
      promptType: 'define',
      text: '=Video: {{ $json.videoTitle }}\nVideo ID: {{ $json.videoId }}\nWhat this video covers: {{ $json.videoContext }}\nViewer: {{ $json.author }}\nComment: {{ $json.comment }}',
      options: { systemMessage },
    },
    id: 'n5', name: 'Answer From Knowledge Base', type: '@n8n/n8n-nodes-langchain.agent',
    typeVersion: 1.7, position: [1320, 300],
  },
  {
    parameters: { model: 'google/gemini-2.5-flash', options: { temperature: 0.2 } },
    id: 'n6', name: 'Chat Model (OpenRouter)', type: '@n8n/n8n-nodes-langchain.lmChatOpenRouter',
    typeVersion: 1, position: [800, 540],
  },
  {
    parameters: {
      mode: 'retrieve-as-tool',
      toolName: 'knowledge_base',
      toolDescription: 'Search this channel’s video transcripts and approved documents. Input: the viewer question in plain words. Ignore results about the other brand.',
      tableName: 'documents',
      topK: 5,
      includeDocumentMetadata: true,
      options: { queryName: 'match_documents' },
    },
    id: 'n7', name: 'Knowledge Base (Supabase)', type: '@n8n/n8n-nodes-langchain.vectorStoreSupabase',
    typeVersion: 1.1, position: [1020, 540],
  },
  {
    parameters: { model: 'openai/text-embedding-3-small', options: {} },
    id: 'n8', name: 'Embeddings', type: '@n8n/n8n-nodes-langchain.embeddingsOpenAi',
    typeVersion: 1.2, position: [1020, 740],
  },
  {
    parameters: { jsCode: parseCode },
    id: 'n9', name: 'Parse Answer', type: 'n8n-nodes-base.code', typeVersion: 2, position: [1540, 300],
  },
  {
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' },
        conditions: [
          { id: 'c1', leftValue: '={{ $json.action }}', rightValue: 'reply', operator: { type: 'string', operation: 'equals' } },
        ],
        combinator: 'and',
      },
      options: {},
    },
    id: 'n10', name: 'Auto Reply?', type: 'n8n-nodes-base.if', typeVersion: 2.2, position: [1760, 300],
  },
  {
    parameters: {
      method: 'POST',
      url: 'https://www.googleapis.com/youtube/v3/comments',
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'youTubeOAuth2Api',
      sendQuery: true,
      queryParameters: { parameters: [{ name: 'part', value: 'snippet' }] },
      sendBody: true,
      specifyBody: 'json',
      jsonBody: '={{ JSON.stringify({ snippet: { parentId: $json.commentId, textOriginal: $json.reply } }) }}',
      options: { batching: { batch: { batchSize: 1, batchInterval: 20000 } } }, // one reply every 20 s
    },
    id: 'n12', name: 'Post Reply to YouTube', type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2, position: [1980, 220], onError: 'continueRegularOutput', disabled: true,
    notes: 'DISABLED by the owner. Enable to post publicly on the channel (one reply every 20 s). While disabled, replies are only logged as "drafted".',
    notesInFlow: true,
  },
  {
    parameters: {
      resource: 'row', operation: 'create', tableId: 'comment_log', dataToSend: 'defineBelow',
      fieldsUi: { fieldValues: [
        { fieldId: 'comment_id', fieldValue: "={{ $('Parse Answer').item.json.commentId }}" },
        { fieldId: 'video_id', fieldValue: "={{ $('Parse Answer').item.json.videoId }}" },
        { fieldId: 'author', fieldValue: "={{ $('Parse Answer').item.json.author }}" },
        { fieldId: 'comment', fieldValue: "={{ $('Parse Answer').item.json.comment }}" },
        { fieldId: 'published_at', fieldValue: "={{ $('Parse Answer').item.json.publishedAt }}" },
        { fieldId: 'category', fieldValue: "={{ $('Parse Answer').item.json.category }}" },
        { fieldId: 'confidence', fieldValue: "={{ $('Parse Answer').item.json.confidence }}" },
        { fieldId: 'reason', fieldValue: "={{ $('Parse Answer').item.json.reason }}" },
        { fieldId: 'reply', fieldValue: "={{ $('Parse Answer').item.json.reply }}" },
        { fieldId: 'status', fieldValue: "={{ $json.error ? 'error' : ($json.id ? 'replied' : 'drafted') }}" },
        { fieldId: 'youtube_reply_id', fieldValue: '={{ $json.id || "" }}' },
        { fieldId: 'error_message', fieldValue: '={{ $json.error ? JSON.stringify($json.error).slice(0, 500) : "" }}' },
      ]},
    },
    id: 'n13', name: 'Log: Replied', type: 'n8n-nodes-base.supabase', typeVersion: 1, position: [2200, 220],
  },
  {
    parameters: {
      resource: 'row', operation: 'create', tableId: 'comment_log', dataToSend: 'defineBelow',
      fieldsUi: { fieldValues: [
        { fieldId: 'comment_id', fieldValue: '={{ $json.commentId }}' },
        { fieldId: 'video_id', fieldValue: '={{ $json.videoId }}' },
        { fieldId: 'author', fieldValue: '={{ $json.author }}' },
        { fieldId: 'comment', fieldValue: '={{ $json.comment }}' },
        { fieldId: 'published_at', fieldValue: '={{ $json.publishedAt }}' },
        { fieldId: 'category', fieldValue: '={{ $json.category }}' },
        { fieldId: 'confidence', fieldValue: '={{ $json.confidence }}' },
        { fieldId: 'reason', fieldValue: '={{ $json.reason }}' },
        { fieldId: 'status', fieldValue: "={{ $json.action === 'ignore' ? 'skipped' : 'needs_human' }}" },
      ]},
    },
    id: 'n14', name: 'Log: Needs Human / Skipped', type: 'n8n-nodes-base.supabase', typeVersion: 1, position: [1980, 460],
  },
];

const main = (node) => ({ node, type: 'main', index: 0 });
const connections = {
  'Every 5 Minutes': { main: [[main('Active Channel')]] },
  'Review Comments': { main: [[main('Active Channel')]] },
  'Active Channel': { main: [[main('Config')]] },
  'Post One Reply Hook': { main: [[main('Post Account?')]] },
  'Post Account?': { main: [[main('Posting Channel Alchemane')], [main('Posting Channel')]] },
  'Posting Channel': { main: [[main('Channel Check')]] },
  'Posting Channel Alchemane': { main: [[main('Channel Check')]] },
  'Channel Check': { main: [[main('Right Channel?')]] },
  'Right Channel?': { main: [[main('Post With?')], [main('Post One Reply Result')]] },
  'Post With?': { main: [[main('Post One Reply Alchemane')], [main('Post One Reply')]] },
  'Post One Reply': { main: [[main('Post One Reply Result')]] },
  'Post One Reply Alchemane': { main: [[main('Post One Reply Result')]] },
  'Delete Comment Hook': { main: [[main('Delete Account?')]] },
  'Delete Account?': { main: [[main('Delete Channel Alchemane')], [main('Delete Channel')]] },
  'Delete Channel': { main: [[main('Delete Channel Check')]] },
  'Delete Channel Alchemane': { main: [[main('Delete Channel Check')]] },
  'Delete Channel Check': { main: [[main('Delete Right Channel?')]] },
  'Delete Right Channel?': { main: [[main('Delete With?')], [main('Delete Comment Result')]] },
  'Delete With?': { main: [[main('Delete on YouTube Alchemane')], [main('Delete on YouTube')]] },
  'Delete on YouTube': { main: [[main('Delete Comment Result')]] },
  'Delete on YouTube Alchemane': { main: [[main('Delete Comment Result')]] },
  'Config': { main: [[main('Fetch Channel Comments')]] },
  'Fetch Channel Comments': { main: [[main('Filter New Comments')]] },
  'Filter New Comments': { main: [[main('Video Chunks')]] },
  'Video Chunks': { main: [[main('This Video')]] },
  'This Video': { main: [[main('Answer From Knowledge Base')]] },
  'Answer From Knowledge Base': { main: [[main('Parse Answer')]] },
  'Parse Answer': { main: [[main('Auto Reply?')]] },
  'Auto Reply?': { main: [[main('Post Reply to YouTube')], [main('Log: Needs Human / Skipped')]] },
  'Post Reply to YouTube': { main: [[main('Log: Replied')]] },
  'Chat Model (OpenRouter)': { ai_languageModel: [[{ node: 'Answer From Knowledge Base', type: 'ai_languageModel', index: 0 }]] },
  'Knowledge Base (Supabase)': { ai_tool: [[{ node: 'Answer From Knowledge Base', type: 'ai_tool', index: 0 }]] },
  'Embeddings': { ai_embedding: [[{ node: 'Knowledge Base (Supabase)', type: 'ai_embedding', index: 0 }]] },
};

const workflow = {
  name: 'AHL - YouTube Comment Auto-Reply (RAG)',
  nodes, connections,
  settings: { executionOrder: 'v1' },
};

fs.writeFileSync(path.join(__dirname, 'workflow.json'), JSON.stringify(workflow, null, 2));
console.log('workflow.json written');

if (process.argv.includes('--push')) {
  const envFile = ['.env', '.env.txt'].map(f => path.join(__dirname, f)).find(fs.existsSync);
  const env = {};
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  const base = env.N8N_BASE_URL.replace(/\/+$/, '');
  const upd = (process.argv.find((x) => x.startsWith('--update=')) || '').slice(9);
  fetch(`${base}/api/v1/workflows${upd ? '/' + upd : ''}`, {
    method: upd ? 'PUT' : 'POST',
    headers: { 'X-N8N-API-KEY': env.N8N_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(workflow),
  }).then(async r => {
    const body = await r.json().catch(() => ({}));
    console.log('status', r.status);
    console.log(r.ok ? `created id=${body.id} name=${body.name}` : JSON.stringify(body).slice(0, 800));
  });
}
