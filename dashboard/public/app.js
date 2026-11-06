const app = document.querySelector('#app');
const state = { page: 'review', status: 'needs_human', handled: 'false', query: '', key: '', notice: '', noticeKind: '' };
let health = null;
let summary = {};

const STATUS = [
  ['needs_human', 'Needs a person'],
  ['drafted', 'Drafts'],
  ['replied', 'Posted'],
  ['skipped', 'Skipped'],
  ['error', 'Errors'],
  ['discarded', 'Discarded'],
  ['all', 'All'],
];

function h(tag, attrs, kids) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (key === 'class') node.className = value;
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
    else if (value != null && value !== false) node.setAttribute(key, value);
  }
  for (const kid of kids || []) node.append(kid instanceof Node ? kid : document.createTextNode(kid == null ? '' : String(kid)));
  return node;
}

async function api(pathname, options = {}) {
  const response = await fetch(pathname, {
    method: options.method || 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

function ensureShell() {
  if (app.querySelector('.shell')) return;
  app.replaceChildren(h('div', { class: 'shell' }, [
    h('aside', { class: 'rail' }, [
      h('div', { class: 'brand' }, ['American Hairline', h('span', {}, ['Comment desk'])]),
      h('nav', { class: 'nav', 'aria-label': 'Desk' }, [
        h('button', { id: 'nav-review', type: 'button', onclick: () => go('review') }, ['Review', h('small', {}, ['Comments waiting on a person'])]),
        h('button', { id: 'nav-knowledge', type: 'button', onclick: () => go('knowledge') }, ['Knowledge', h('small', {}, ['Videos and documents'])]),
      ]),
    ]),
    h('main', { id: 'main', class: 'main' }, []),
  ]));
  mountLookPreview();
}

const LOOK_FILES = {
  classic: '/styles.classic.css',
  agencia: '/styles.agencia.css',
  minimize: '/styles.minimize.css',
};

function applyLook(choice) {
  const link = document.querySelector('#desk-styles');
  if (link && LOOK_FILES[choice]) link.href = `${LOOK_FILES[choice]}?v=2`;
}

function mountLookPreview() {
  if (localStorage.getItem('ahl-preview') === 'done' || document.querySelector('.look-bar')) return;
  document.body.append(h('div', { class: 'look-bar', role: 'region', 'aria-label': 'Design preview' }, [
    h('p', {}, ['Minimaze light preview. Review, edit, and discard still work the same.']),
    h('button', { type: 'button', class: 'btn', onclick: () => chooseLook('minimize') }, ['Approve look']),
    h('button', { type: 'button', class: 'btn-ghost', onclick: () => chooseLook('discard') }, ['Discard look']),
  ]));
}

function chooseLook(choice) {
  const previous = LOOK_FILES[localStorage.getItem('ahl-look')] ? localStorage.getItem('ahl-look') : 'agencia';
  const next = choice === 'discard' ? previous : choice;
  localStorage.setItem('ahl-look', next);
  localStorage.setItem('ahl-preview', 'done');
  applyLook(next);
  document.querySelector('.look-bar')?.remove();
}

function setStatus(text, kind) {
  state.notice = text || '';
  state.noticeKind = kind || '';
  const node = document.querySelector('#status');
  if (!node) return;
  node.textContent = state.notice;
  node.className = 'status' + (state.noticeKind ? ' ' + state.noticeKind : '');
}

function layout(title, lede, body, kicker = 'YouTube reply desk') {
  ensureShell();
  const review = app.querySelector('#nav-review');
  const knowledge = app.querySelector('#nav-knowledge');
  review.className = state.page === 'review' ? 'active' : '';
  knowledge.className = state.page === 'knowledge' ? 'active' : '';
  if (state.page === 'review') review.setAttribute('aria-current', 'page');
  else review.removeAttribute('aria-current');
  if (state.page === 'knowledge') knowledge.setAttribute('aria-current', 'page');
  else knowledge.removeAttribute('aria-current');
  const status = h('p', { id: 'status', class: 'status' + (state.noticeKind ? ' ' + state.noticeKind : ''), role: 'status', 'aria-live': 'polite' }, [state.notice]);
  app.querySelector('.main').replaceChildren(
    h('p', { class: 'kicker' }, [kicker]),
    h('h1', {}, [title]),
    h('p', { class: 'lede' }, [lede]),
    status,
    body,
  );
  app.querySelector('.main').classList.remove('is-busy');
}

function go(page) {
  state.page = page;
  state.key = '';
  render();
}

function setupScreen() {
  const form = h('form', { class: 'panel', onsubmit: saveSetup }, [
    h('label', { for: 'supabase-url' }, ['Supabase URL']),
    h('input', { id: 'supabase-url', name: 'supabaseUrl', type: 'url', placeholder: 'https://xxxx.supabase.co', required: true, autocomplete: 'url' }),
    h('label', { for: 'service-role-key' }, ['Service role key']),
    h('input', { id: 'service-role-key', name: 'serviceRoleKey', type: 'password', placeholder: 'service_role secret', required: true, autocomplete: 'off' }),
    h('p', { class: 'meta' }, ['Project Settings → API in Supabase. This key stays in .env.txt on this PC.']),
    h('button', { class: 'btn', type: 'submit' }, ['Connect']),
    h('p', { class: 'banner error', id: 'setup-error', role: 'alert', hidden: true }, []),
  ]);
  app.replaceChildren(h('div', { class: 'setup' }, [
    h('p', { class: 'kicker' }, ['One-time connection']),
    h('h1', {}, ['Connect the desk']),
    h('p', { class: 'lede' }, ['The review queue and knowledge base are in Supabase. Paste the project URL and service role key once.']),
    form,
  ]));
  mountLookPreview();
}

async function saveSetup(event) {
  event.preventDefault();
  const data = new FormData(event.target);
  const error = document.querySelector('#setup-error');
  error.hidden = true;
  try {
    await api('/api/setup', {
      method: 'POST',
      body: { supabaseUrl: data.get('supabaseUrl'), serviceRoleKey: data.get('serviceRoleKey') },
    });
    health = null;
    render();
  } catch (err) {
    error.hidden = false;
    error.textContent = err.message;
  }
}

async function render() {
  const main = document.querySelector('.main');
  if (main) main.classList.add('is-busy');
  setStatus('Loading…', 'loading');
  try {
    if (!health) health = await api('/api/status');
    if (!health.configured) return setupScreen();
    if (state.page === 'knowledge') return await renderKnowledge();
    return await renderReview();
  } catch (err) {
    setStatus(err.message, 'loading');
    if (!document.querySelector('.shell') && !document.querySelector('.setup')) {
      app.replaceChildren(h('div', { class: 'setup' }, [h('div', { class: 'banner error', role: 'alert' }, [err.message])]));
    }
  }
}

async function renderReview() {
  const body = h('div');
  if (!health.commentLog) {
    setStatus('');
    body.append(h('div', { class: 'banner error', role: 'alert' }, [
      'The comment_log table is missing. Run the bottom of schema.sql in the Supabase SQL editor, then reload this page.',
    ]));
  } else {
    const data = await api(`/api/comments?status=${encodeURIComponent(state.status)}&handled=${state.handled}`);
    summary = data.summary || {};
    setStatus('');
    if (health.webhook) {
      body.append(h('div', { class: 'actions' }, [
        h('button', { type: 'button', class: 'btn', id: 'review-now', onclick: reviewNow }, ['Review comments']),
      ]));
    } else {
      body.append(h('p', { class: 'meta' }, ['The n8n webhook key is missing, so comments cannot be reviewed from here.']));
    }
    body.append(h('p', { class: 'filter-label', id: 'stage-label' }, ['Stage']));
    body.append(h('div', { class: 'filters', id: 'stage-filters', role: 'group', 'aria-labelledby': 'stage-label' }, STATUS.map(([value, label]) => stageChip(value, label))));
    if (state.status !== 'discarded') {
      body.append(h('p', { class: 'filter-label', id: 'handled-label' }, ['Handled']));
      body.append(h('div', { class: 'filters', role: 'group', 'aria-labelledby': 'handled-label' }, [
        h('button', { type: 'button', class: `chip${state.handled === 'false' ? ' active' : ''}`, 'aria-pressed': state.handled === 'false' ? 'true' : 'false', onclick: () => { state.handled = 'false'; render(); } }, ['Still open']),
        h('button', { type: 'button', class: `chip${state.handled === 'true' ? ' active' : ''}`, 'aria-pressed': state.handled === 'true' ? 'true' : 'false', onclick: () => { state.handled = 'true'; render(); } }, ['Handled']),
        h('button', { type: 'button', class: `chip${state.handled === '' ? ' active' : ''}`, 'aria-pressed': state.handled === '' ? 'true' : 'false', onclick: () => { state.handled = ''; render(); } }, ['Either']),
      ]));
    }
    const list = h('div', { class: 'list' });
    if (!data.rows.length) list.append(h('div', { class: 'empty' }, ['Nothing in this filter.']));
    for (const row of data.rows) list.append(commentCard(row));
    body.append(list);
  }
  layout(
    'YouTube reply desk',
    'Click Review comments to check the last 48 hours. Replies are saved here. Nothing is posted to YouTube.',
    body,
    'Comments',
  );
}

async function reviewNow(event) {
  const button = event.currentTarget;
  button.disabled = true;
  button.textContent = 'Reviewing…';
  setStatus('Reviewing comments from the last 48 hours…', 'loading');
  try {
    let reviewed = 0;
    let summaryNow = {};
    for (let batch = 0; batch < 6; batch += 1) {
      const start = await api('/api/reply/run', { method: 'POST' });
      let status = null;
      const deadline = Date.now() + 8 * 60 * 1000;
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 4000));
        status = await api(`/api/reply/status?since=${encodeURIComponent(start.startedAt)}`);
        if (status.done) break;
      }
      if (!status || !status.done) throw new Error('The review is still running. Refresh Drafts in a minute.');
      if (status.status !== 'success') throw new Error(`The review stopped with status ${status.status}`);
      reviewed += Number(status.reviewed) || 0;
      summaryNow = status.summary || summaryNow;
      if ((Number(status.reviewed) || 0) < 10) break;
    }
    await render();
    setStatus(reviewed
      ? `Reviewed ${reviewed} comments. Drafts ${summaryNow.drafted || 0}, needs a person ${summaryNow.needs_human || 0}, skipped ${summaryNow.skipped || 0}.`
      : 'No new comments in the last 48 hours.');
  } catch (err) {
    setStatus(err.message, 'loading');
    button.disabled = false;
    button.textContent = 'Review comments';
  }
}

function stageChip(value, label) {
  const count = summary[value];
  return h('button', {
    type: 'button',
    class: state.status === value ? 'chip active' : 'chip',
    'aria-pressed': state.status === value ? 'true' : 'false',
    'data-stage': value,
    onclick: () => { state.status = value; if (value === 'discarded') state.handled = ''; render(); },
  }, [count == null ? label : `${label} ${count}`]);
}

function bumpCounts(fromStatus) {
  if (summary[fromStatus] > 0) summary[fromStatus] -= 1;
  summary.discarded = (summary.discarded || 0) + 1;
  if (fromStatus !== 'discarded' && summary.all > 0) summary.all -= 1;
  if (fromStatus === 'needs_human' && summary.open > 0) summary.open -= 1;
  for (const button of document.querySelectorAll('#stage-filters button')) {
    const value = button.getAttribute('data-stage');
    const label = (STATUS.find(([name]) => name === value) || [])[1] || value;
    const count = summary[value];
    button.textContent = count == null ? label : `${label} ${count}`;
  }
}

function replyBox(row) {
  const box = h('div', { class: 'reply-box' });
  showReply(box, row);
  return box;
}

function showReply(box, row) {
  box.replaceChildren(row.reply ? h('div', { class: 'reply' }, [row.reply]) : h('p', { class: 'meta' }, ['No reply saved yet.']));
}

function openReplyEditor(card, row) {
  const box = card.querySelector('.reply-box');
  const area = h('textarea', { class: 'reply-edit', 'aria-label': 'Reply' }, [row.reply || '']);
  const note = h('p', { class: 'meta', role: 'alert' }, []);
  const save = h('button', {
    class: 'btn',
    type: 'button',
    onclick: async () => {
      save.disabled = true;
      note.textContent = '';
      try {
        const data = await api(`/api/comments/${row.id}/reply`, { method: 'POST', body: { reply: area.value } });
        row.reply = data.row ? data.row.reply : area.value;
        showReply(box, row);
        setStatus('Reply saved.');
      } catch (err) {
        save.disabled = false;
        note.textContent = err.message;
      }
    },
  }, ['Save reply']);
  box.replaceChildren(
    area,
    h('div', { class: 'actions' }, [
      save,
      h('button', { class: 'btn-ghost', type: 'button', onclick: () => showReply(box, row) }, ['Cancel']),
    ]),
    note,
  );
  area.focus();
}

function commentCard(row) {
  const when = row.created_at ? new Date(row.created_at).toLocaleString() : '';
  const video = row.video_id ? `https://www.youtube.com/watch?v=${row.video_id}` : '';
  return h('article', { class: 'card' }, [
    h('header', {}, [
      h('div', {}, [
        h('strong', {}, [row.author || 'Viewer']),
        h('div', { class: 'meta' }, [`${row.category || 'uncategorized'} · ${when}`]),
      ]),
      h('span', { class: `pill${row.handled ? ' good' : ''}` }, [row.handled ? 'Handled' : (row.status || '').replace('_', ' ')]),
    ]),
    h('p', { class: 'comment' }, [row.comment || '']),
    row.reason ? h('p', { class: 'meta' }, [`Bot note: ${row.reason}`]) : h('span'),
    replyBox(row),
    row.error_message ? h('p', { class: 'banner error' }, [row.error_message]) : h('span'),
    h('div', { class: 'actions' }, [
      video ? h('a', { href: video, target: '_blank', rel: 'noreferrer' }, ['Open video']) : h('span'),
      h('button', {
        class: 'btn-ghost',
        onclick: (event) => openReplyEditor(event.currentTarget.closest('.card'), row),
      }, ['Edit reply']),
      h('button', {
        class: 'btn',
        onclick: async (event) => {
          event.currentTarget.disabled = true;
          await api(`/api/comments/${row.id}/handled`, { method: 'POST', body: { handled: !row.handled } });
          render();
        },
      }, [row.handled ? 'Mark open' : 'Mark handled']),
      row.status === 'discarded' ? h('span') : h('button', {
        class: 'btn danger',
        onclick: async (event) => {
          const button = event.currentTarget;
          button.disabled = true;
          const card = button.closest('.card');
          try {
            await api(`/api/comments/${row.id}/discard`, { method: 'POST' });
            card.remove();
            bumpCounts(row.status);
            setStatus('Comment discarded.');
            if (!document.querySelector('.card')) {
              const list = document.querySelector('.list');
              if (list && !list.querySelector('.empty')) list.append(h('div', { class: 'empty' }, ['Nothing in this filter.']));
            }
          } catch (err) {
            button.disabled = false;
            button.textContent = err.message;
          }
        },
      }, ['Discard']),
    ]),
  ]);
}

async function renderKnowledge() {
  const body = h('div', { class: 'grid' });
  if (!health.documents) {
    setStatus('');
    layout('Knowledge base', 'Supabase did not return the documents table.', h('div', { class: 'banner error', role: 'alert' }, [health.documentsError || 'Cannot read documents.']));
    return;
  }
  if (!health.webhook) {
    body.append(h('div', { class: 'banner error' }, ['The n8n ingest webhook key is missing, so edits cannot be re-embedded.']));
  }
  if (state.key) {
    const data = await api(`/api/knowledge?key=${encodeURIComponent(state.key)}`);
    body.append(editor(data.group));
    setStatus('');
    layout('Edit knowledge', 'Saving sends the text through the ingest webhook, which rebuilds the embeddings. The previous chunks are removed after the new ones land.', body);
    return;
  }
  setStatus('');
  const data = await api(`/api/knowledge?q=${encodeURIComponent(state.query)}`);
  const list = h('div');
  const search = h('input', {
    id: 'knowledge-search',
    type: 'search',
    placeholder: 'Search titles',
    value: state.query,
    oninput: (event) => { state.query = event.target.value; },
  });
  list.append(h('form', { class: 'search-row', onsubmit: (event) => { event.preventDefault(); render(); } }, [
    h('div', {}, [
      h('label', { for: 'knowledge-search' }, ['Search titles']),
      search,
    ]),
    h('button', { class: 'btn', type: 'submit' }, ['Search']),
  ]));
  if (!data.groups.length) list.append(h('div', { class: 'empty' }, ['No matching entries. Add a document, or ingest videos with node ingest_local.js.']));
  data.groups.forEach((group, index) => {
    list.append(h('button', { class: 'entry', onclick: () => { state.key = group.key; render(); } }, [
      h('div', { class: 'row-top' }, [
        h('strong', {}, [group.title]),
        h('span', { class: `pill${index < 5 ? ' warn' : ''}` }, [index < 5 ? 'Latest' : group.type]),
      ]),
      h('div', { class: 'meta' }, [
        `${group.type} · ${group.chunkCount} chunks${group.language ? ` · ${group.language}` : ''}${group.transcript ? ` · ${group.transcript}` : ''}`,
      ]),
      h('div', { class: 'meta' }, [group.preview]),
    ]));
  });
  const form = h('form', { class: 'panel', onsubmit: addDocument }, [
    h('h2', {}, ['Add a document']),
    h('label', { for: 'doc-title' }, ['Title']),
    h('input', { id: 'doc-title', name: 'title', required: true, placeholder: 'Pricing policy' }),
    h('label', { for: 'doc-text' }, ['Text']),
    h('textarea', { id: 'doc-text', name: 'text', required: true, placeholder: 'Facts the bot is allowed to use' }),
    h('button', { class: 'btn', type: 'submit' }, ['Add to knowledge base']),
    h('p', { class: 'meta', id: 'add-note' }, ['New videos show up here after ingest_local.js finishes. The newest inserts are marked Latest.']),
  ]);
  body.append(list, form);
  layout(
    'Knowledge base',
    'Videos transcribed into Supabase, plus any notes you add here. Open an entry to correct it. Latest means most recently inserted.',
    body,
  );
}

function editor(group) {
  const form = h('form', { class: 'panel', onsubmit: (event) => saveGroup(event, group) }, [
    h('div', { class: 'row-top' }, [
      h('div', {}, [
        h('span', { class: 'pill' }, [group.type]),
        h('h2', {}, [group.title]),
        h('div', { class: 'meta' }, [group.videoId || 'Document']),
      ]),
      group.watchUrl ? h('a', { href: group.watchUrl, target: '_blank', rel: 'noreferrer' }, ['Open on YouTube']) : h('span'),
    ]),
  ]);
  group.chunks.forEach((chunk, index) => {
    const block = h('div', { class: 'chunk' }, [
      h('span', {}, [chunk.start ? `From ${chunk.start}s` : `Part ${index + 1}`]),
    ]);
    const area = h('textarea', { name: 'chunk', 'aria-label': chunk.start ? `Transcript from ${chunk.start} seconds` : `Part ${index + 1}` }, [chunk.text]);
    area.dataset.start = String(chunk.start || 0);
    area.dataset.url = chunk.url || '';
    block.append(area);
    form.append(block);
  });
  form.append(h('div', { class: 'actions' }, [
    h('button', { class: 'btn', type: 'submit' }, ['Save and re-embed']),
    h('button', { class: 'btn-ghost', type: 'button', onclick: () => { state.key = ''; render(); } }, ['Back']),
    h('button', { class: 'btn danger', type: 'button', onclick: () => removeGroup(group) }, ['Delete from knowledge base']),
  ]));
  form.append(h('p', { class: 'banner', id: 'save-note', hidden: true }, []));
  return form;
}

async function addDocument(event) {
  event.preventDefault();
  const data = new FormData(event.target);
  const note = document.querySelector('#add-note');
  note.textContent = 'Sending to the ingest webhook…';
  setStatus('Sending to the ingest webhook…', 'loading');
  try {
    await api('/api/knowledge', { method: 'POST', body: { title: data.get('title'), text: data.get('text') } });
    event.target.reset();
    note.textContent = 'Added. It will show in the list in a few seconds, once n8n finishes the embedding.';
    setStatus('Document added.');
    setTimeout(render, 4000);
  } catch (err) {
    note.textContent = err.message;
  }
}

async function saveGroup(event, group) {
  event.preventDefault();
  const note = document.querySelector('#save-note');
  note.hidden = false;
  note.textContent = 'Re-embedding. This can take up to a minute.';
  setStatus('Re-embedding. This can take up to a minute.', 'loading');
  const chunks = [...event.target.querySelectorAll('textarea[name="chunk"]')].map((area) => ({
    text: area.value,
    start: Number(area.dataset.start) || 0,
    url: area.dataset.url || '',
  }));
  try {
    await api('/api/knowledge', { method: 'PUT', body: { key: group.key, chunks } });
    note.textContent = 'Saved.';
    setStatus('Knowledge saved.');
    state.key = '';
    render();
  } catch (err) {
    note.textContent = err.message;
  }
}

async function removeGroup(group) {
  if (!confirm(`Remove “${group.title}” from the knowledge base?`)) return;
  await api(`/api/knowledge?key=${encodeURIComponent(group.key)}`, { method: 'DELETE' });
  state.key = '';
  render();
}

render();
