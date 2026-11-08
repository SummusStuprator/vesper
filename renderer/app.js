// Vesper renderer: boot, workspace UI, transcript, composer, status bar, inspector, palette.
import { h, $, api, icon, vesperMark, md, hl, langOf, toast, popover, closePop, lightbox, fmtUsd, fmtTok, fmtMs, fmtPrice, shortPath, relTime, modelTags, MODES, modeLabel } from './lib.js';
import { mountSetup } from './setup.js';
import { openSettings } from './settings.js';

const root = document.getElementById('app');
const S = {
  cfg: null, catalogs: [], sessions: [], cur: null, busy: false, phase: '',
  sidebar: true, inspector: localStorage.getItem('vesper.inspector') !== '0',
  attachments: [], credits: null, search: '', lastTps: null,
  queues: new Map(),          // sessionId -> [{ qid, text, images, state: 'queued' | 'now' }]
  openWork: new Set(),        // turn ids whose work block the user expanded
  approvals: new Map(),       // sessionId -> Map(itemId -> event)  (approvals and questions)
  live: new Map(),            // sessionId -> { busy, phase }
};
const isMac = navigator.platform.toLowerCase().includes('mac');
const MOD = isMac ? '⌘' : 'Ctrl ';
if (isMac) document.body.classList.add('mac');

// ───────────────────────────────────────────── theme
function isDark() {
  const t = (S.cfg && S.cfg.theme) || 'light';
  return t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
}
function applyTheme() {
  document.documentElement.dataset.theme = isDark() ? 'dark' : 'light';
  api.titlebarTheme(isDark());
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { applyTheme(); renderTitleRight(); });
async function toggleTheme() {
  S.cfg = await api.config.set({ theme: isDark() ? 'light' : 'dark' });
  applyTheme(); renderTitleRight();
}

// ───────────────────────────────────────────── boot
async function boot() {
  S.cfg = await api.config.get();
  applyTheme();
  if (!S.cfg.setupComplete || !S.cfg.providers.length) {
    mountSetup(root, S.cfg, async () => { S.cfg = await api.config.get(); startApp(); });
  } else startApp();
}

async function startApp() {
  S.cfg = await api.config.get();
  applyTheme();
  root.replaceChildren(layout());
  await Promise.all([refreshSessions(), refreshCatalogs(), restorePending()]);
  if (S.sessions[0]) await openSession(S.sessions[0].id);
  else await newSession(S.cfg.recentWorkspaces[0]);
  refreshCredits();
  setInterval(refreshCredits, 90000);
}

async function refreshCatalogs(force) {
  try { S.catalogs = await api.catalog(force); } catch (e) { toast(e.message, 'err'); }
  renderComposerBar(); renderInspector(); renderStatus();
}
async function refreshCredits() {
  try { S.credits = await api.credits(); } catch { S.credits = null; }
  // Warn once per launch when the balance gets low, before a run fails on insufficient credits.
  if (S.credits && S.credits.available < 0.5 && !S.lowWarned) {
    S.lowWarned = true;
    toast(`Credit balance is low (${fmtUsd(S.credits.available, 2)}). Top up from the title bar.`, 'err');
  }
  renderTitleRight(); renderInspector(); renderStatus();
}
// After a reload, rebuild which sessions are running and the approvals/questions they are waiting on.
async function restorePending() {
  try {
    const p = await api.agent.pending();
    for (const id of p.running) S.live.set(id, { busy: true, phase: 'working' });
    for (const ev of p.events) registerPending(ev);
  } catch {}
}
function registerPending(ev) {
  const itemId = ev.kind === 'question' ? ev.itemId : ev.item.id;
  if (!S.approvals.has(ev.sessionId)) S.approvals.set(ev.sessionId, new Map());
  S.approvals.get(ev.sessionId).set(itemId, ev);
  S.live.set(ev.sessionId, { busy: true, phase: ev.kind === 'question' ? 'waiting for your answer' : 'waiting for your approval' });
  return itemId;
}

async function refreshSessions() { S.sessions = await api.sessions.list(); renderSessionList(); }

function currentProvider() { return S.cfg.providers.find((p) => p.id === ((S.cur && S.cur.providerId) || S.cfg.activeProviderId)) || S.cfg.providers[0]; }
function currentModel() {
  if (!S.cur) return null;
  const id = S.cur.model || S.cfg.activeModel;
  const cat = S.catalogs.find((c) => c.id === (S.cur.providerId || S.cfg.activeProviderId)) || S.catalogs[0];
  return (cat && cat.models.find((m) => m.id === id)) || { id };
}
const hasRefuseless = () => S.cfg.providers.some((p) => p.kind === 'refuseless');

// ───────────────────────────────────────────── layout
let els = {};
function layout() {
  els = {};
  els.sessionList = h('div', { class: 'sb-list' });
  els.sbFoot = h('div', { class: 'sb-bottom' });
  els.crumb = h('button', { class: 'crumb', title: 'Change workspace folder', onclick: changeWorkspace });
  els.titleRight = h('div', { class: 'row', style: { gap: '4px' } });
  els.transcript = h('div', { class: 'transcript' });
  els.scroller = h('div', { class: 'scroller' }, els.transcript);
  els.composer = composer();
  els.inspector = h('aside', { class: `inspector ${S.inspector ? '' : 'closed'}` });
  els.status = h('footer', { class: 'statusbar' });
  els.shell = h('div', { class: `shell ${S.sidebar ? '' : 'no-sidebar'}` },
    h('header', { class: 'titlebar' },
      h('button', { class: 'icon-btn', title: `Toggle sidebar (${MOD}B)`, onclick: toggleSidebar }, icon('sidebar')),
      h('div', { class: 'brand' }, vesperMark(), h('span', { class: 'word' }, 'VESPER')),
      h('div', { class: 'tb-sep' }),
      els.crumb,
      h('div', { class: 'grow' }),
      els.titleRight),
    h('aside', { class: 'sidebar' },
      h('div', { class: 'sb-top' },
        h('button', { class: 'btn sb-new', onclick: () => newSession() }, icon('plus'), 'New session', h('span', { class: 'kbd' }, `${MOD}N`)),
        h('div', { class: 'sb-row' },
          h('button', { class: 'btn sm', title: 'Session that is never written to disk', onclick: () => newSession(null, { incognito: true }) }, icon('eye', 'sm'), 'Incognito'),
          h('button', { class: 'btn sm', title: `Command palette (${MOD}K)`, onclick: openPalette }, icon('search', 'sm'), 'Commands')),
        h('div', { class: 'sb-search' }, icon('search', 'sm'), h('input', { class: 'input', placeholder: 'Filter sessions', oninput: (e) => { S.search = e.target.value.toLowerCase(); renderSessionList(); } }))),
      els.sessionList, els.sbFoot),
    h('main', { class: 'main' }, els.scroller, els.composer),
    els.inspector,
    els.status);
  els.scroller.addEventListener('scroll', () => { const s = els.scroller; S.stick = s.scrollHeight - s.scrollTop - s.clientHeight < 80; });
  renderSidebarFoot(); renderTitleRight();
  return els.shell;
}

function renderTitleRight() {
  if (!els.titleRight) return;
  const c = S.credits;
  const low = c && c.available < 1;
  els.titleRight.replaceChildren(
    hasRefuseless() ? h('div', { class: 'rl-pill', title: 'Credit balance' },
      h('button', { class: 'row', style: { border: 'none', background: 'none', padding: 0, gap: '7px' }, onclick: () => openSettings(ctx(), 'refuseless') }, icon('coins', 'sm'),
        h('span', { class: `bal ${low ? 'low' : ''}` }, c ? fmtUsd(c.available, 2) : '—')),
      h('button', { class: 'top', title: 'Add credits', onclick: () => api.open(S.cfg.referral) }, 'TOP UP'))
      : h('button', { class: 'btn sm', title: 'Add a hosted provider key', onclick: () => openSettings(ctx(), 'refuseless') }, icon('key', 'sm'), 'Get credits'),
    h('div', { class: 'tb-sep', style: { margin: '0 6px' } }),
    h('button', { class: 'icon-btn', title: `Command palette (${MOD}K)`, onclick: openPalette }, icon('search')),
    h('button', { class: 'icon-btn', title: 'Toggle light / dark', onclick: toggleTheme }, icon('moon')),
    h('button', { class: `icon-btn ${S.inspector ? 'active' : ''}`, title: `Inspector (${MOD}.)`, onclick: toggleInspector }, icon('panel')));
}

function toggleSidebar() { S.sidebar = !S.sidebar; els.shell.classList.toggle('no-sidebar', !S.sidebar); }
function toggleInspector() { S.inspector = !S.inspector; localStorage.setItem('vesper.inspector', S.inspector ? '1' : '0'); els.inspector.classList.toggle('closed', !S.inspector); renderInspector(); renderTitleRight(); }

// ───────────────────────────────────────────── sidebar
function renderSessionList() {
  if (!els.sessionList) return;
  const list = S.sessions.filter((s) => !S.search || (s.title || '').toLowerCase().includes(S.search) || (s.workspace || '').toLowerCase().includes(S.search));
  const now = Date.now();
  const groupOf = (s) => (s.pinned ? 'Pinned' : now - s.updatedAt < 864e5 ? 'Today' : now - s.updatedAt < 7 * 864e5 ? 'This week' : 'Earlier');
  const out = [];
  let g = null;
  for (const s of list) {
    const gg = groupOf(s);
    if (gg !== g) { g = gg; out.push(h('div', { class: 'sb-group label' }, g)); }
    const live = S.live.get(s.id);
    const waiting = S.approvals.get(s.id) && S.approvals.get(s.id).size;
    out.push(h('div', {
      class: `sb-item ${S.cur && S.cur.id === s.id ? 'on' : ''}`, title: `${s.title}\n${s.workspace}`,
      onclick: () => openSession(s.id), ondblclick: () => renameSession(s),
    },
    live && live.busy ? h('span', { class: 'live' }) : null,
    s.incognito ? icon('eye', 'sm') : null,
    h('span', { class: 't' }, s.title || 'Untitled'),
    waiting ? h('span', { class: 'tag red' }, 'needs you') : h('span', { class: 'c' }, s.cost ? fmtUsd(s.cost) : relTime(s.updatedAt)),
    h('span', { class: 'acts' },
      h('button', { class: 'icon-btn', title: s.pinned ? 'Unpin' : 'Pin', onclick: async (e) => { e.stopPropagation(); await api.sessions.pin(s.id, !s.pinned); refreshSessions(); } }, icon('sparkle', 'sm')),
      h('button', { class: 'icon-btn', title: 'Delete', onclick: (e) => { e.stopPropagation(); deleteSession(s); } }, icon('trash', 'sm')))));
  }
  if (!list.length) out.push(h('div', { class: 'faint', style: { padding: '18px 8px', fontSize: '12.5px' } }, S.search ? 'No matches.' : 'No sessions yet.'));
  els.sessionList.replaceChildren(...out);
}

function renderSidebarFoot() {
  if (!els.sbFoot) return;
  els.sbFoot.replaceChildren(
    h('button', { class: 'sb-link', onclick: () => openSettings(ctx(), 'security') }, icon('shield'), 'Privacy & security', h('span', { class: 'r' }, S.cfg ? modeLabel(S.cfg.permissionMode) : '')),
    h('button', { class: 'sb-link', onclick: () => openSettings(ctx(), 'usage') }, icon('chart'), 'Usage & cost'),
    h('button', { class: 'sb-link', onclick: () => openSettings(ctx(), 'general') }, icon('settings'), 'Settings', h('span', { class: 'r' }, `${MOD},`)));
}

async function renameSession(s) {
  const t = prompt('Rename session', s.title);
  if (t && t.trim()) { await api.sessions.rename(s.id, t.trim()); if (S.cur && S.cur.id === s.id) S.cur.title = t.trim(); refreshSessions(); }
}
async function deleteSession(s) {
  if (!confirm(`Delete “${s.title}”? Its history and file snapshots are removed.`)) return;
  await api.sessions.remove(s.id);
  await refreshSessions();
  if (S.cur && S.cur.id === s.id) { if (S.sessions[0]) openSession(S.sessions[0].id); else newSession(s.workspace); }
}

// ───────────────────────────────────────────── sessions
async function newSession(ws, opts) {
  let s;
  try { s = await api.sessions.create(ws || (S.cur && S.cur.workspace) || S.cfg.recentWorkspaces[0], opts); }
  catch (e) { toast(`${e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')}. Using your home folder.`, 'err'); s = await api.sessions.create(null, opts); }
  await refreshSessions();
  await openSession(s.id);
  els.ta && els.ta.focus();
  if (opts && opts.incognito) toast('Incognito: this session is never written to disk');
}

async function openSession(id) {
  S.cur = await api.sessions.load(id);
  const live = S.live.get(id);
  S.busy = !!(S.cur.running || (live && live.busy));
  S.phase = live ? live.phase : '';
  S.attachments = [];
  renderAll();
  S.stick = true; scrollBottom(true);
  focusComposer();
}
function focusComposer() {
  const a = document.activeElement;
  if (els.ta && (!a || a === document.body || a.closest('.composer'))) els.ta.focus();
}

async function changeWorkspace() {
  const dir = await api.pickFolder();
  if (!dir || !S.cur) return;
  if (S.cur.transcript.length) { await newSession(dir); return; }
  S.cur = await api.sessions.update(S.cur.id, { workspace: dir });
  S.cfg = await api.config.get();
  renderAll(); refreshSessions();
}

function renderAll() {
  renderCrumb(); renderSessionList(); renderTranscript(); renderComposerBar(); renderInspector(); renderAttachments(); renderSendBtn(); renderQueue(); renderStatus(); renderSidebarFoot();
}
function renderCrumb() {
  if (!els.crumb || !S.cur) return;
  els.crumb.replaceChildren(icon('folder', 'sm'), h('span', { class: 'path' }, shortPath(S.cur.workspace)), S.cur.incognito ? h('span', { class: 'tag' }, 'incognito') : null);
}

// ───────────────────────────────────────────── transcript
const nodes = new Map();
let groups = [];                 // turn groups of the open session, in order

// A turn = a message you sent while the agent was idle + everything the agent did for it.
// Its work (thinking, tool calls, intermediate replies, messages you sent mid-run) folds into one
// collapsible block; the final answer stays outside so it stands out.
const startsTurn = (it) => (it.type === 'user' && !it.interjected) || (it.type === 'compaction' && it.reason === 'manual');

function groupTranscript(items) {
  const out = [];
  let g = null;
  for (const it of items) {
    if (!g || startsTurn(it)) {
      g = { id: it.id, lead: startsTurn(it) ? it : null, items: [] };
      out.push(g);
      if (g.lead) continue;
    }
    g.items.push(it);
  }
  return out;
}

function splitGroup(g, live) {
  if (live) return { work: g.items, answer: [] };
  let last = -1;
  g.items.forEach((it, i) => { if (it.type === 'tool' || (it.type === 'user' && it.interjected) || it.type === 'compaction') last = i; });
  const work = g.items.slice(0, last + 1);
  const answer = [];
  for (const it of g.items.slice(last + 1)) {
    if (it.type === 'assistant' || it.type === 'notice' || it.type === 'error') answer.push(it); else work.push(it);
  }
  // Only the last reply is "the answer"; earlier replies in the same stretch are part of the work.
  const finals = answer.filter((x) => x.type === 'assistant');
  if (finals.length > 1) for (const x of finals.slice(0, -1)) { answer.splice(answer.indexOf(x), 1); work.push(x); }
  return { work, answer };
}

const isLive = (g) => S.busy && groups[groups.length - 1] === g;

function workSummary(g, live) {
  const its = g.items;
  const tools = its.filter((x) => x.type === 'tool' && x.name !== 'todo_write');
  const edits = its.filter((x) => x.type === 'tool' && x.display && x.display.diff).length;
  const notes = its.filter((x) => x.type === 'user' && x.interjected).length;
  const failed = tools.filter((x) => x.status === 'error').length;
  const start = g.lead ? g.lead.ts : (its[0] && its[0].ts);
  const end = live ? Date.now() : Math.max(start || 0, ...its.map((x) => x.ts || 0));
  const dur = start ? fmtDuration(end - start) : '';
  const bits = [
    tools.length ? `${tools.length} tool call${tools.length === 1 ? '' : 's'}` : null,
    edits ? `${edits} edit${edits === 1 ? '' : 's'}` : null,
    notes ? `${notes} message${notes === 1 ? '' : 's'} from you` : null,
    failed ? `${failed} failed` : null,
  ].filter(Boolean);
  return { title: live ? `Working${dur ? ` · ${dur}` : ''}` : `Worked${dur ? ` for ${dur}` : ''}`, bits };
}
function fmtDuration(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m ${String(s % 60).padStart(2, '0')}s` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

function renderWorkHead(g) {
  if (!g.headEl) return;
  const live = isLive(g);
  const { title, bits } = workSummary(g, live);
  const open = g.workEl && g.workEl.classList.contains('open');
  g.headEl.replaceChildren(
    live ? h('span', { class: 'spinner' }) : icon('chev', 'sm chev'),
    h('b', null, title),
    bits.length ? h('span', { class: 'bits' }, bits.join(' · ')) : null,
    h('span', { class: 'grow' }),
    live ? null : h('span', { class: 'hint' }, open ? 'hide' : 'show'));
}

function renderGroup(g) {
  const live = isLive(g);
  const el = h('div', { class: 'turn' });
  if (g.lead) { const n = renderItem(g.lead); if (n) { nodes.set(g.lead.id, n); el.append(n); } }
  const { work, answer } = splitGroup(g, live);
  g.bodyEl = h('div', { class: 'work-body' });
  for (const it of work) { const n = renderItem(it); if (n) { nodes.set(it.id, n); g.bodyEl.append(n); } }
  g.workEl = null; g.headEl = null;
  if (work.length) {
    const pend = S.approvals.get(S.cur.id);
    const needsYou = pend && work.some((x) => pend.has(x.id));
    const open = live || needsYou || S.openWork.has(g.id);
    g.headEl = h('button', { class: 'work-head', onclick: () => {
      if (isLive(g)) return;
      const nowOpen = !g.workEl.classList.contains('open');
      g.workEl.classList.toggle('open', nowOpen);
      if (nowOpen) S.openWork.add(g.id); else S.openWork.delete(g.id);
      renderWorkHead(g);
    } });
    g.workEl = h('div', { class: `work ${open ? 'open' : ''} ${live ? 'live' : ''}` }, g.headEl, g.bodyEl);
    el.append(g.workEl);
    renderWorkHead(g);
  }
  g.answerEl = h('div', { class: 'answer' });
  for (const it of answer) { const n = renderItem(it); if (n) { nodes.set(it.id, n); g.answerEl.append(n); } }
  el.append(g.answerEl);
  if (g.el && g.el.isConnected) g.el.replaceWith(el);
  g.el = el;
  return el;
}

function rerenderGroup(g) {
  if (!g || !S.cur) return;
  renderGroup(g);
  const pend = S.approvals.get(S.cur.id);
  if (pend) for (const [itemId, a] of pend) if (g.items.some((x) => x.id === itemId)) attachPending(itemId, a);
}

function renderTranscript() {
  nodes.clear();
  const t = els.transcript;
  if (!S.cur || !S.cur.transcript.length) { groups = []; t.replaceChildren(emptyState()); return; }
  groups = groupTranscript(S.cur.transcript);
  const frag = document.createDocumentFragment();
  for (const g of groups) frag.append(renderGroup(g));
  frag.append(els.working = workingRow());
  t.replaceChildren(frag);
  const pend = S.approvals.get(S.cur.id);
  if (pend) for (const [itemId, a] of pend) attachPending(itemId, a);
}
// Keep the live work header's clock ticking.
setInterval(() => { const g = groups[groups.length - 1]; if (g && isLive(g)) renderWorkHead(g); }, 1000);

function emptyState() {
  const ws = S.cur ? shortPath(S.cur.workspace) : '';
  const m = currentModel() || {};
  const starters = [
    ['Map this codebase', 'Tour the structure, entry points, and how the pieces fit together.'],
    ['Find & fix a bug', 'Run the tests, find what is failing, fix it, and prove it.'],
    ['Ship a feature', 'Plan it with a todo list, implement it, then verify it.'],
    ['Research anything', 'Search the web and come back with sources.'],
  ];
  return h('div', { class: 'empty' },
    h('div', { class: 'kicker' }, h('span', { class: `mode-badge mode-${S.cfg.permissionMode}` }, modeLabel(S.cfg.permissionMode)), h('span', { class: 'label' }, m.id || ''), S.cur && S.cur.incognito ? h('span', { class: 'tag' }, 'incognito') : null),
    h('h1', null, 'What are we', h('br'), 'shipping ', h('em', null, 'tonight?')),
    h('p', { class: 'lede' }, 'Working in ', h('span', { class: 'mono' }, ws), '. Vesper reads and edits files, runs commands, searches the web, delegates to subagents, and remembers what matters.'),
    h('div', { class: 'starters' }, starters.map(([b, s], i) => h('button', { class: 'starter', onclick: () => { els.ta.value = s; autosize(els.ta); els.ta.focus(); renderSendBtn(); } }, h('span', { class: 'n' }, `0${i + 1}`), h('b', null, b), h('span', null, s)))));
}

function workingRow() { return h('div', { class: `working ${S.busy ? '' : 'hidden'}` }, h('span', { class: 'pulse-dot' }), h('span', { class: 'phase' }, S.phase || 'working')); }
function updateWorking() {
  renderQueue();
  if (els.working && els.working.isConnected) {
    els.working.classList.toggle('hidden', !S.busy);
    els.working.querySelector('.phase').textContent = `${S.phase || 'working'}…`;
  }
  renderStatus();
}

function renderItem(it) {
  switch (it.type) {
    case 'user': return renderUser(it);
    case 'assistant': return renderAssistant(it);
    case 'tool': return renderTool(it);
    case 'compaction': return renderCompaction(it);
    case 'error': return h('div', { class: 'callout err' }, icon('x'), h('div', { class: 'grow msg' }, h('b', null, it.status ? `Error ${it.status}` : 'Error'), h('div', null, it.text),
      it.code === 'insufficient_credits' || it.status === 402 ? h('button', { class: 'btn rl sm', style: { marginTop: '8px' }, onclick: () => api.open(S.cfg.referral) }, 'Top up credits') : null),
      h('button', { class: 'btn sm', onclick: retryLast }, icon('refresh', 'sm'), 'Retry'));
    case 'notice': return h('div', { class: 'callout note' }, icon('sparkle'), h('div', null, it.text));
    default: return null;
  }
}

function renderUser(it) {
  if (it.interjected) {
    return h('div', { class: 'msg-user mid' }, h('span', { class: 'label' }, 'you, mid-run'), h('div', null, it.text),
      it.images && it.images.length ? h('div', { class: 'imgs' }, it.images.map((src) => h('img', { src, onclick: () => lightbox(src) }))) : null);
  }
  const turnEdits = S.cur.transcript.filter((x) => x.type === 'tool' && x.turn === it.id && x.revertable && !x.reverted).length;
  return h('div', { class: 'msg-user' }, it.text,
    it.images && it.images.length ? h('div', { class: 'imgs' }, it.images.map((src) => h('img', { src, onclick: () => lightbox(src) }))) : null,
    h('div', { class: 'u-acts' },
      h('button', { class: 'icon-btn', title: 'Copy', onclick: () => { navigator.clipboard.writeText(it.text || ''); toast('Copied'); } }, icon('copy', 'sm')),
      h('button', { class: 'icon-btn', title: 'Put back in the composer', onclick: () => { els.ta.value = it.text || ''; autosize(els.ta); els.ta.focus(); renderSendBtn(); } }, icon('edit', 'sm')),
      turnEdits ? h('button', { class: 'icon-btn', title: `Revert ${turnEdits} file change(s) from this turn`, onclick: () => revertTurn(it) }, icon('undo', 'sm')) : null));
}

async function revertTurn(it) {
  if (!confirm('Revert every file change Vesper made in response to this message?')) return;
  try {
    const r = await api.agent.revertTurn(S.cur.id, it.id);
    S.cur.transcript.forEach((x) => { if (x.type === 'tool' && x.turn === it.id && x.revertable) x.reverted = true; });
    renderTranscript();
    toast(r.files.length ? `Reverted ${r.files.length} file(s)` : 'Nothing to revert');
  } catch (e) { toast(e.message, 'err'); }
}

function renderAssistant(it) {
  const body = h('div', { class: 'prose', html: md(it.text) });
  const think = it.reasoning ? h('details', { class: 'thinking', open: it.streaming && !it.text ? true : undefined },
    h('summary', null, icon('chev', 'sm'), it.streaming && !it.text ? 'thinking…' : `thought${it.ms ? ` · ${fmtMs(it.ms)}` : ''}`),
    h('div', { class: 'body' }, it.reasoning)) : null;
  const u = it.usage;
  const meta = !it.streaming && u && it.text ? h('div', { class: 'meta tnum' },
    h('span', null, it.model),
    h('span', null, `${fmtTok(u.input)} in${u.cached ? ` · ${fmtTok(u.cached)} cached` : ''} · ${fmtTok(u.output)} out${u.estimated ? ' (est)' : ''}`),
    h('span', null, fmtUsd(u.cost)),
    it.tps ? h('span', null, `${it.tps} tok/s`) : null,
    it.ttft ? h('span', null, `ttft ${fmtMs(it.ttft)}`) : null,
    h('button', { title: 'Copy', onclick: () => { navigator.clipboard.writeText(it.text); toast('Copied'); } }, icon('copy', 'sm'))) : null;
  const el = h('div', { class: 'msg-asst' }, think, it.text ? body : null, meta);
  if (it.streaming && it.text) (body.lastElementChild || body).classList.add('cursor-blink');
  return el;
}

const TOOL_META = {
  read_file: ['file', 'Read'], write_file: ['edit', 'Write'], edit_file: ['edit', 'Edit'], multi_edit: ['edit', 'Edit'], list_dir: ['folder', 'List'],
  glob: ['search', 'Find'], grep: ['search', 'Grep'], shell: ['terminal', 'Run'], shell_output: ['terminal', 'Job'],
  web_search: ['globe', 'Search'], web_fetch: ['globe', 'Fetch'], view_image: ['image', 'View'], todo_write: ['list', 'Plan'],
  task: ['bot', 'Agent'], computer: ['cursor', 'Desktop'], ask_user: ['user', 'Ask'], memory: ['brain', 'Memory'],
};
function renderTool(it) {
  if (it.name === 'todo_write' && it.status === 'done') return h('div', { class: 'hidden' });
  const [ic, verb] = TOOL_META[it.name] || (it.name.startsWith('mcp__') ? ['plug', it.name.split('__')[1]] : ['sparkle', it.name]);
  const d = it.display || {};
  const status = it.status === 'running' ? h('span', { class: 'spinner' })
    : it.status === 'pending' ? h('span', { class: 'dot' })
      : it.status === 'awaiting' ? h('span', { class: 'tag red' }, it.name === 'ask_user' ? 'your answer' : 'approval')
        : it.status === 'error' ? h('span', { class: 'red' }, 'failed')
          : it.status === 'denied' ? h('span', null, 'blocked')
            : h('span', null, fmtMs(it.ms));
  const stats = d.diff ? [h('span', { class: 'stat-add' }, `+${d.diff.added}`), h('span', { class: 'stat-del' }, `−${d.diff.removed}`)] : null;
  const extra = [
    it.name === 'shell' && d.exitCode ? h('span', { class: 'tag' }, `exit ${d.exitCode}`) : null,
    d.count != null ? h('span', { class: 'faint mono', style: { fontSize: '11px' } }, `${d.count} hit${d.count === 1 ? '' : 's'}`) : null,
    d.redacted ? h('span', { class: 'tag red', title: 'Secrets were removed before the model saw this output' }, `${d.redacted} redacted`) : null,
    it.guard && it.status === 'awaiting' ? h('span', { class: 'tag red' }, 'guard') : null,
  ];
  const wrap = h('div', { class: `tool ${it.status === 'error' ? 'err' : ''} ${it.status === 'denied' ? 'denied' : ''} ${it.status === 'running' ? 'running' : ''}` });
  const head = h('div', { class: 'tool-head', onclick: () => { it._open = !wrap.classList.contains('open'); replaceNode(it); } },
    h('div', { class: 'ic' }, icon(ic)),
    h('span', { class: 'verb' }, verb),
    h('span', { class: 'arg', title: it.summary || '' }, it.name === 'ask_user' && d.answer ? `${it.summary} → ${d.answer}` : relSummary(it.summary)),
    stats, extra,
    h('span', { class: 'st' }, it.reverted ? h('span', { class: 'tag' }, 'reverted') : null, status),
    icon('chev', 'sm chev'));
  wrap.append(head);
  if (it.name === 'task' && it.children && it.children.length) {
    wrap.append(h('div', { class: 'children' }, it.children.slice(-12).map((c) => h('div', { class: 'child' },
      h('span', { class: `dot ${c.status === 'done' ? 'ok' : c.status === 'error' ? 'err' : c.status === 'running' ? 'run' : ''}` }),
      h('span', null, (TOOL_META[c.name] || [0, c.name])[1]), h('span', { class: 'arg' }, relSummary(c.summary || ''))))));
  }
  const autoOpen = (it.name === 'shell' && it.status === 'running') || (['edit_file', 'write_file', 'multi_edit'].includes(it.name) && d.diff);
  if (it._open ?? autoOpen) { wrap.classList.add('open'); wrap.append(toolBody(it)); }
  return wrap;
}

// Show paths inside the workspace relative to it.
function relSummary(s) {
  if (!s || !S.cur) return s || '';
  const ws = S.cur.workspace.replace(/\\/g, '/').replace(/\/+$/, '');
  const re = new RegExp(ws.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/?', 'gi');
  return String(s).replace(/\\/g, '/').replace(re, '') || '.';
}

function toolBody(it) {
  const d = it.display || {};
  const body = h('div', { class: 'tool-body' });
  if (it.name === 'shell') {
    body.append(h('div', { class: 'cmd' }, it.args.command), h('pre', { class: 'live-out' }, it.output || it._live || ''));
  } else if (d.diff) {
    body.append(diffView(d.diff, d.path));
    if (it.revertable && !it.reverted) body.append(h('div', { class: 'bar' },
      h('button', { class: 'btn sm ghost', onclick: () => api.openPath(joinPath(S.cur.workspace, d.path)) }, icon('external', 'sm'), 'Open'),
      h('button', { class: 'btn sm', onclick: async () => { try { await api.agent.revert(S.cur.id, it.id); it.reverted = true; replaceNode(it); toast('Change reverted'); } catch (e) { toast(e.message, 'err'); } } }, icon('undo', 'sm'), 'Revert')));
  } else if (d.image) {
    body.append(h('img', { class: 'shot', src: d.image, onclick: () => lightbox(d.image) }));
  } else if (d.results) {
    body.append(h('div', { class: 'results' }, d.results.map((r) => h('a', { href: r.url, target: '_blank' }, h('b', null, r.title), h('span', null, r.url)))));
  } else if (it.name === 'task') {
    body.append(h('div', { class: 'prose', style: { padding: '12px 14px', fontSize: '13px' }, html: md(it.output || '') }));
  } else {
    if (it.args && Object.keys(it.args).length && !['read_file', 'list_dir', 'glob', 'grep'].includes(it.name)) body.append(h('pre', { style: { borderBottom: '1px solid var(--line)' } }, JSON.stringify(it.args, null, 2)));
    const lang = it.name === 'read_file' ? langOf(it.args.path) : '';
    const pre = h('pre');
    if (lang && it.output) pre.innerHTML = hl(it.output, lang); else pre.textContent = it.output || '';
    body.append(pre);
  }
  return body;
}
const joinPath = (a, b) => (/^([a-z]:[\\/]|\/)/i.test(b) ? b : `${a.replace(/[\\/]+$/, '')}/${b}`);

function diffView(diff, path) {
  const lang = langOf(path);
  return h('div', { class: 'diff' }, diff.hunks.map((hk) => h('div', { class: 'hunk' }, hk.map((r) => {
    const c = h('span', { class: 'c' });
    c.innerHTML = lang ? hl(r.text, lang) : r.text.replace(/[&<>]/g, (x) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[x]));
    return h('div', { class: `ln ${r.op === '+' ? 'add' : r.op === '-' ? 'del' : ''}` },
      h('span', { class: 'n' }, r.a ?? ''), h('span', { class: 'n' }, r.b ?? ''), h('span', { class: 's' }, r.op === ' ' ? '' : r.op === '-' ? '−' : '+'), c);
  }))), diff.truncated ? h('div', { class: 'faint', style: { padding: '6px 12px' } }, '… more changes not shown') : null);
}

function renderCompaction(it) {
  const label = it.status === 'running' ? 'compacting context…' : it.status === 'error' ? 'compaction failed' : `context compacted · ${fmtTok(it.before)} → ${fmtTok(it.after)} tokens`;
  const det = h('details', null, h('summary', null, it.status === 'running' ? h('span', { class: 'row' }, h('span', { class: 'spinner' }), label) : label));
  const wrap = h('div', null, h('div', { class: 'divider' }, icon('compress', 'sm'), det));
  if (it.summary) {
    const sum = h('div', { class: 'compact-summary prose hidden', html: md(it.summary) });
    det.addEventListener('toggle', () => sum.classList.toggle('hidden', !det.open));
    wrap.append(sum);
  }
  return wrap;
}

function replaceNode(it) {
  const old = nodes.get(it.id);
  const n = renderItem(it);
  if (old && n) { old.replaceWith(n); nodes.set(it.id, n); }
  const pend = S.approvals.get(S.cur.id);
  if (pend && pend.has(it.id)) attachPending(it.id, pend.get(it.id));
}

function appendItem(it) {
  if (!S.cur.transcript.includes(it)) S.cur.transcript.push(it);
  if (els.transcript.querySelector('.empty') || !groups.length) { renderTranscript(); return; }
  const place = (node) => (els.working && els.working.isConnected ? els.working.before(node) : els.transcript.append(node));
  if (startsTurn(it)) {
    const g = { id: it.id, lead: it, items: [] };
    groups.push(g);
    place(renderGroup(g));
  } else {
    const g = groups[groups.length - 1];
    g.items.push(it);
    if (!isLive(g) || !g.workEl) rerenderGroup(g);
    else {
      const n = renderItem(it);
      if (n) { nodes.set(it.id, n); g.bodyEl.append(n); renderWorkHead(g); }
    }
  }
  // A tool on a user's turn makes that turn revertable: refresh the user bubble's actions.
  if (it.type === 'tool' && it.turn) { const u = S.cur.transcript.find((x) => x.id === it.turn); if (u) setTimeout(() => replaceNode(u), 0); }
}

// ───────────────────────────────────────────── approvals & questions
function attachPending(itemId, a) {
  const node = nodes.get(itemId);
  if (!node) return;
  node.querySelector('.approval') && node.querySelector('.approval').remove();
  const done = () => {
    const pend = S.approvals.get(S.cur.id); pend && pend.delete(itemId);
    node.querySelector('.approval') && node.querySelector('.approval').remove();
    renderSessionList();
  };
  if (a.kind === 'question') {
    const inp = h('input', { class: 'input', placeholder: 'Type an answer…' });
    const answer = async (text) => { if (!text) return; await api.agent.reply({ requestId: a.requestId, answer: text }); done(); };
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') answer(inp.value.trim()); });
    node.append(h('div', { class: 'approval' },
      h('div', { class: 'q' }, icon('user', 'sm'), a.question),
      a.options && a.options.length ? h('div', { class: 'opts' }, a.options.map((o) => h('button', { class: 'btn sm', onclick: () => answer(o) }, o))) : null,
      h('div', { class: 'acts' }, inp, h('button', { class: 'btn primary sm', onclick: () => answer(inp.value.trim()) }, 'Answer'))));
    setTimeout(() => inp.focus(), 30);
    scrollBottom();
    return;
  }
  const it = a.item;
  const fb = h('input', { class: 'input', placeholder: 'Or tell Vesper what to do instead…' });
  const decide = async (decision) => { await api.agent.reply({ requestId: a.requestId, decision, feedback: fb.value.trim() }); done(); };
  let preview;
  if (it.name === 'shell') preview = it.args.command;
  else if (it.name === 'write_file') preview = `${it.args.path}\n\n${String(it.args.content || '').slice(0, 3000)}`;
  else if (it.name === 'edit_file') preview = `${it.args.path}\n\n− ${String(it.args.old_string).slice(0, 1500).split('\n').join('\n− ')}\n+ ${String(it.args.new_string).slice(0, 1500).split('\n').join('\n+ ')}`;
  else if (it.name === 'multi_edit') preview = `${it.args.path}\n\n${(it.args.edits || []).map((e, i) => `#${i + 1}\n− ${String(e.old_string).slice(0, 600)}\n+ ${String(e.new_string).slice(0, 600)}`).join('\n\n')}`;
  else preview = JSON.stringify(it.args, null, 2);
  const q = { shell: 'Run this command?', write_file: 'Write this file?', edit_file: 'Apply this edit?', multi_edit: 'Apply these edits?', computer: 'Let Vesper control your computer?' }[it.name] || `Allow ${it.name}?`;
  const card = h('div', { class: `approval ${a.guard ? 'guard' : ''}` },
    h('div', { class: 'q' }, icon('shield', 'sm'), q, a.depth ? h('span', { class: 'tag' }, 'subagent') : null),
    a.reason ? h('div', { class: 'why' }, icon('shield', 'sm'), `Guard: ${a.reason}`) : null,
    h('div', { class: 'preview' }, h('pre', null, preview)),
    h('div', { class: 'acts' },
      h('button', { class: 'btn primary sm', onclick: () => decide('once') }, 'Allow', h('span', { class: 'kbd', style: { color: 'inherit', borderColor: 'currentColor', opacity: .6 } }, '↵')),
      a.guard ? null : h('button', { class: 'btn sm', onclick: () => decide('always') }, `Always allow ${(TOOL_META[it.name] || [0, it.name])[1].toLowerCase()}`),
      fb,
      h('button', { class: 'btn sm ghost', onclick: () => decide('deny') }, 'Deny')));
  fb.addEventListener('keydown', (e) => { if (e.key === 'Enter') decide('deny'); });
  node.append(card);
  scrollBottom();
}

// ───────────────────────────────────────────── agent events
const renderQ = new Set();
let rafPending = false;
function queueRender(it) {
  renderQ.add(it);
  if (rafPending) return;
  rafPending = true;
  // Pace re-renders by message size so very long streamed answers don't pin the UI thread.
  const size = Math.max(0, ...[...renderQ].map((x) => (x.text || '').length + (x.reasoning || '').length));
  setTimeout(() => {
    rafPending = false;
    for (const x of renderQ) replaceNode(x);
    renderQ.clear();
    const g = groups[groups.length - 1]; if (g && isLive(g)) renderWorkHead(g);
    scrollBottom();
  }, Math.min(400, 50 + size / 80));
}

api.on.agent((ev) => {
  const sid = ev.sessionId;
  if (ev.kind === 'inbox') return;
  if (ev.kind === 'status') {
    S.live.set(sid, { busy: ev.busy, phase: ev.phase || '' });
    if (S.cur && S.cur.id === sid) { S.busy = ev.busy; S.phase = ev.phase || ''; updateWorking(); renderSendBtn(); }
    renderSessionList();
    return;
  }
  if (ev.kind === 'approval' || ev.kind === 'question') {
    const itemId = registerPending(ev);
    const phase = S.live.get(sid).phase;
    if (S.cur && S.cur.id === sid) { S.phase = phase; updateWorking(); attachPending(itemId, ev); }
    else toast('A session is waiting for you');
    renderSessionList();
    return;
  }
  if (ev.kind === 'done') {
    S.live.set(sid, { busy: false, phase: '' });
    if (S.approvals.get(sid)) S.approvals.get(sid).clear();
    const q = queueOf(sid);
    for (const x of q) if (x.state === 'now') x.state = 'queued';   // not delivered before the run ended
    if (S.cur && S.cur.id === sid) {
      S.busy = false; S.phase = ''; updateWorking(); renderSendBtn();
      if (ev.usage) S.cur.usage = ev.usage;
      if (ev.contextMessages != null) S.cur.contextMessages = ev.contextMessages;
      rerenderGroup(groups[groups.length - 1]);
      renderInspector(); renderStatus(); renderQueue();
    }
    if (q.length) {
      if (ev.stopped || ev.failed) { if (S.cur && S.cur.id === sid) toast(`${q.length} queued message${q.length === 1 ? '' : 's'} kept. Press Send to deliver.`); }
      else setTimeout(() => drainQueue(sid), 350);
    }
    refreshSessions(); refreshCredits();
    return;
  }
  if (!S.cur || S.cur.id !== sid) return;
  const items = S.cur.transcript;
  const find = (id) => items.find((x) => x.id === id);
  switch (ev.kind) {
    case 'item:add':
      if (ev.item.qid) { const q = queueOf(sid); const k = q.findIndex((x) => x.qid === ev.item.qid); if (k >= 0) { q.splice(k, 1); renderQueue(); } }
      appendItem(ev.item); scrollBottom(); break;
    case 'item:update': { const it = find(ev.id); if (it) { Object.assign(it, ev.patch); if (ev.patch.tps) S.lastTps = ev.patch.tps; queueRender(it); } break; }
    case 'item:remove': {
      const i = items.findIndex((x) => x.id === ev.id); if (i >= 0) items.splice(i, 1);
      for (const g of groups) { const j = g.items.findIndex((x) => x.id === ev.id); if (j >= 0) g.items.splice(j, 1); }
      const n = nodes.get(ev.id); n && n.remove(); nodes.delete(ev.id); break;
    }
    case 'text': { const it = find(ev.id); if (it) { it.text = (it.text || '') + ev.delta; queueRender(it); } break; }
    case 'reasoning': { const it = find(ev.id); if (it) { it.reasoning = (it.reasoning || '') + ev.delta; queueRender(it); } break; }
    case 'tool:progress': {
      const it = find(ev.id); if (!it) break;
      it._live = ((it._live || '') + ev.chunk).slice(-20000);
      const n = nodes.get(ev.id); const pre = n && n.querySelector('.live-out');
      if (pre) { pre.textContent = it._live; pre.scrollTop = pre.scrollHeight; } else queueRender(it);
      break;
    }
    case 'todos': S.cur.todos = ev.todos; renderInspector(); break;
    case 'usage': S.cur.usage = ev.usage; S.cur.lastPromptTokens = ev.lastPromptTokens; S.ctxLen = ev.contextLength; if (ev.contextMessages != null) S.cur.contextMessages = ev.contextMessages; renderInspector(); renderStatus(); break;
  }
});
api.on.sessions(() => refreshSessions());

function scrollBottom(force) {
  if (!els.scroller) return;
  if (force || S.stick !== false) requestAnimationFrame(() => { els.scroller.scrollTop = els.scroller.scrollHeight; });
}

// ───────────────────────────────────────────── composer
const SLASH = [
  ['/plan', 'Switch to Plan mode (read-only)'],
  ['/compact', 'Summarize the conversation to free context', '[focus]'],
  ['/clear', 'Fresh session in this folder'],
  ['/incognito', 'Fresh session that never touches disk'],
  ['/fork', 'Branch this conversation into a new session'],
  ['/model', 'Switch model'],
  ['/mode', 'Change permission mode'],
  ['/init', 'Write an AGENTS.md for this project'],
  ['/memory', 'View and edit long-term memory'],
  ['/export', 'Export this session to Markdown'],
  ['/cost', 'Show cost and token usage'],
  ['/settings', 'Open settings'],
];

function composer() {
  const ta = h('textarea', { rows: 1, placeholder: 'Tell Vesper what to build, fix or find…  (/ for commands, Shift+Tab to change mode)', spellcheck: true });
  els.ta = ta;
  els.attach = h('div', { class: 'attachments hidden' });
  els.bar = h('div', { class: 'composer-bar' });
  els.queueEl = h('div', { class: 'queue' });
  els.send = h('button', { class: 'send', title: 'Send (Enter)', onclick: () => (S.busy && !els.ta.value.trim() ? stop() : submit()) }, icon('arrowUp'));
  els.box = h('div', { class: 'composer' }, els.attach, ta, els.bar);
  ta.addEventListener('input', () => { autosize(ta); renderSendBtn(); slashMenu(); });
  ta.addEventListener('keydown', (e) => {
    if (els.slash && ['ArrowDown', 'ArrowUp', 'Tab'].includes(e.key)) { e.preventDefault(); moveSlash(e.key === 'ArrowUp' ? -1 : 1); return; }
    if (e.key === 'Tab' && e.shiftKey) { e.preventDefault(); cycleMode(); return; }
    if (e.key === 'ArrowUp' && !ta.value && S.cur) {
      const q = queueOf(S.cur.id).filter((x) => x.state !== 'now');
      const last = q[q.length - 1];
      if (last) { e.preventDefault(); removeQueued(last); ta.value = last.text; autosize(ta); renderSendBtn(); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      if (els.slash && els.slashSel != null) { pickSlash(els.slashItems[els.slashSel][0]); return; }
      submit();
    }
    if (e.key === 'Escape' && S.busy) stop();
  });
  els.box.addEventListener('mousedown', (e) => {
    // Clicking anywhere in the composer (padding, bar background) puts the caret in the text box.
    if (e.target === ta || e.target.closest('button, input, select, .pop, .att')) return;
    e.preventDefault(); ta.focus();
  });
  ta.addEventListener('paste', (e) => { const files = [...((e.clipboardData && e.clipboardData.files) || [])]; if (files.length) { e.preventDefault(); addFiles(files); } });
  els.box.addEventListener('dragover', (e) => { e.preventDefault(); els.box.classList.add('drag'); });
  els.box.addEventListener('dragleave', () => els.box.classList.remove('drag'));
  els.box.addEventListener('drop', (e) => { e.preventDefault(); els.box.classList.remove('drag'); addFiles([...e.dataTransfer.files]); });
  return h('div', { class: 'composer-wrap' }, els.queueEl, els.box);
}

function autosize(ta) { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, innerHeight * 0.4) + 'px'; }

function renderSendBtn() {
  if (!els.send) return;
  const empty = !els.ta.value.trim() && !S.attachments.length;
  const stopMode = S.busy && empty;
  els.send.classList.toggle('stop', stopMode);
  els.send.replaceChildren(icon(stopMode ? 'stop' : 'arrowUp'));
  els.send.title = stopMode ? 'Stop (Esc)' : S.busy ? 'Queue: sent when Vesper finishes (Enter)' : 'Send (Enter)';
  els.send.disabled = !S.busy && empty;
}

function renderComposerBar() {
  if (!els.bar || !S.cur) return;
  const m = currentModel() || {};
  const effort = S.cur.effort || m.reasoningDefault;
  const mode = S.cfg.permissionMode;
  els.box.classList.toggle('plan', mode === 'plan');
  els.bar.replaceChildren(
    h('button', { class: 'chip', title: 'Attach images or files', onclick: async () => addPicked(await api.pickFiles()) }, icon('paperclip')),
    h('button', { class: 'chip', title: 'Permission mode (Shift+Tab)', onclick: (e) => modeMenu(e.currentTarget) }, h('span', { class: `mode-badge mode-${mode}` }, modeLabel(mode)), icon('chevDown', 'sm')),
    h('button', { class: 'chip mono-chip', onclick: (e) => modelMenu(e.currentTarget) }, m.id || 'choose model', effort && m.reasoningEfforts ? h('span', { class: 'sub' }, `· ${effort}`) : null, icon('chevDown', 'sm')),
    h('div', { class: 'grow' }),
    els.send);
  renderSendBtn();
}

// ── status bar
function renderStatus() {
  if (!els.status || !S.cur) return;
  const m = currentModel() || {};
  const limit = m.contextLength || S.ctxLen || 128000;
  const used = S.cur.lastPromptTokens || 0;
  const pct = Math.min(1, used / limit);
  const u = S.cur.usage || {};
  const budget = Number(S.cfg.sessionBudget) || 0;
  const mode = S.cfg.permissionMode;
  els.status.replaceChildren(
    h('button', { class: 'seg-s', title: 'Permission mode (Shift+Tab)', onclick: (e) => modeMenu(e.currentTarget, 'top') }, h('span', { class: `mode-badge mode-${mode}` }, modeLabel(mode))),
    h('div', { class: `seg-s ${S.busy ? 'busy' : ''}` }, S.busy ? h('span', { class: 'pulse-dot' }) : h('span', { class: 'dot ok' }), S.busy ? (S.phase || 'working') : 'ready'),
    h('button', { class: 'seg-s', title: 'Context window · click to compact', onclick: () => runSlash('/compact') }, 'ctx', h('div', { class: `bar-meter ${pct > 0.8 ? 'warn' : ''}` }, h('i', { style: { width: `${pct * 100}%` } })), `${fmtTok(used)}/${fmtTok(limit)}`),
    h('div', { class: 'seg-s tnum' }, `${fmtUsd(u.cost || 0)}${budget ? ` / ${fmtUsd(budget, 2)}` : ''}`),
    h('div', { class: 'seg-s tnum' }, `↑${fmtTok(u.input || 0)} ↓${fmtTok(u.output || 0)}`),
    S.lastTps ? h('div', { class: 'seg-s tnum' }, `${S.lastTps} tok/s`) : null,
    S.cfg.security && S.cfg.security.redactSecrets ? h('div', { class: 'seg-s', title: 'Secrets are redacted from tool output' }, icon('shield', 'sm'), 'redact') : null,
    S.cur.incognito ? h('div', { class: 'seg-s' }, icon('eye', 'sm'), 'incognito') : null,
    h('div', { class: 'grow' }),
    h('button', { class: 'seg-s right', title: 'Model', onclick: (e) => modelMenu(e.currentTarget) }, m.id || ''),
    S.credits ? h('button', { class: `seg-s right ${S.credits.available < 1 ? 'warn' : ''}`, title: 'Credit balance · click to top up', onclick: () => api.open(S.cfg.referral) }, icon('coins', 'sm'), fmtUsd(S.credits.available, 2)) : null);
}

function modelMenu(anchor) {
  const cur = currentModel() || {};
  const content = h('div', null);
  for (const cat of S.catalogs) {
    content.append(h('div', { class: 'hdr label' }, cat.name, cat.error && !cat.live ? ' · offline list' : ''));
    for (const m of cat.models) {
      const on = m.id === cur.id && cat.id === (S.cur.providerId || S.cfg.activeProviderId);
      content.append(h('div', { class: 'opt model', onclick: async () => {
        S.cur = Object.assign(S.cur, await api.sessions.update(S.cur.id, { providerId: cat.id, model: m.id, effort: m.reasoningDefault || null }));
        S.cfg = await api.config.get(); closePop(); renderComposerBar(); renderInspector(); renderStatus();
      } },
      h('span', { class: 'check' }, on ? icon('check', 'sm') : null),
      h('div', { class: 'grow' }, h('div', { class: 'mono', style: { fontSize: '12.5px', fontWeight: 600 } }, m.id),
        m.blurb ? h('div', { class: 'd', style: { margin: '2px 0 3px' } }, m.blurb) : null,
        h('div', { class: 'tags' }, modelTags(m))),
      h('span', { class: 'r' }, m.pricing ? `${fmtPrice(m.pricing)}${m.priceEstimate ? ' (est.)' : ''}` : '')));
    }
  }
  if (cur.reasoningEfforts && cur.reasoningEfforts.length) {
    content.append(h('div', { class: 'sep' }), h('div', { class: 'hdr label' }, 'Reasoning effort'),
      h('div', { style: { padding: '4px 8px 6px' } }, h('div', { class: 'seg' }, cur.reasoningEfforts.map((e) => h('button', {
        class: (S.cur.effort || cur.reasoningDefault) === e ? 'on' : '',
        onclick: async () => { S.cur = Object.assign(S.cur, await api.sessions.update(S.cur.id, { effort: e })); closePop(); renderComposerBar(); },
      }, e)))));
  }
  content.append(h('div', { class: 'sep' }),
    h('div', { class: 'opt', onclick: () => { closePop(); refreshCatalogs(true).then(() => toast('Model list refreshed')); } }, icon('refresh', 'sm'), 'Refresh model list'),
    h('div', { class: 'opt', onclick: () => { closePop(); openSettings(ctx(), 'providers'); } }, icon('plug', 'sm'), 'Manage providers…'));
  popover(anchor, content, { cls: 'models' });
}

async function setMode(k) {
  if (k === 'full' && S.cfg.permissionMode !== 'full' && !confirm('Full access turns off every prompt and safety guard. Vesper can run any command and edit any file your account can. Continue?')) return;
  S.cfg = await api.config.set({ permissionMode: k });
  renderComposerBar(); renderStatus(); renderSidebarFoot(); renderInspector();
  if (els.transcript.querySelector('.empty')) renderTranscript();
  toast(`Mode: ${modeLabel(k)}`);
}
function cycleMode() {
  const order = MODES.map((m) => m[0]).filter((k) => k !== 'full'); // never cycle into full access by accident
  const i = order.indexOf(S.cfg.permissionMode);
  setMode(order[(i + 1) % order.length]);
}
function modeMenu(anchor, place = 'top') {
  popover(anchor, h('div', null, h('div', { class: 'hdr label' }, 'Permission mode'), MODES.map(([k, l, d], i) => h('div', { class: 'opt', onclick: () => { closePop(); setMode(k); } },
    h('span', { class: 'check' }, S.cfg.permissionMode === k ? icon('check', 'sm') : null),
    h('div', { class: 'grow' }, h('div', { class: 'row' }, h('span', { class: `mode-badge mode-${k}` }, `${i} · ${l}`)), h('div', { class: 'd', style: { marginTop: '4px' } }, d))))), { place, cls: 'modes' });
}

// ── slash commands
function slashMenu() {
  const v = els.ta.value;
  if (!v.startsWith('/') || v.includes('\n') || (v.includes(' ') && !v.startsWith('/compact'))) { closeSlash(); return; }
  const q = v.split(' ')[0].toLowerCase();
  const items = SLASH.filter(([c]) => c.startsWith(q));
  if (!items.length || (items.length === 1 && items[0][0] === q && v.includes(' '))) { closeSlash(); return; }
  closeSlash();
  els.slashItems = items; els.slashSel = 0;
  els.slash = h('div', { class: 'pop slash' }, items.map(([c, d, arg], i) => h('div', { class: `opt ${i === 0 ? 'sel' : ''}`, onmousedown: (e) => { e.preventDefault(); pickSlash(c); } },
    h('span', { class: 'mono', style: { fontSize: '12.5px', fontWeight: 600 } }, c), arg ? h('span', { class: 'faint mono', style: { fontSize: '11px' } }, arg) : null, h('span', { class: 'd', style: { marginLeft: 'auto' } }, d))));
  els.box.append(els.slash);
}
function moveSlash(dir) { els.slashSel = (els.slashSel + dir + els.slashItems.length) % els.slashItems.length; [...els.slash.children].forEach((c, i) => c.classList.toggle('sel', i === els.slashSel)); }
function closeSlash() { if (els.slash) { els.slash.remove(); els.slash = null; els.slashSel = null; } }
function pickSlash(cmd) {
  closeSlash();
  if (cmd === '/compact') { els.ta.value = '/compact '; els.ta.focus(); return; }
  els.ta.value = ''; autosize(els.ta); renderSendBtn(); runSlash(cmd);
}

async function runSlash(cmd, arg = '') {
  switch (cmd) {
    case '/compact':
      if (S.busy) return toast('Wait for the current run to finish.');
      try { S.busy = true; S.phase = 'compacting context'; updateWorking(); renderSendBtn(); const ok = await api.agent.compact(S.cur.id, arg); if (!ok) toast('Nothing to compact yet.'); }
      catch (e) { toast(e.message, 'err'); }
      finally { S.busy = false; updateWorking(); renderSendBtn(); }
      return;
    case '/plan': return setMode('plan');
    case '/mode': return modeMenu(els.bar.children[1]);
    case '/clear': return newSession(S.cur.workspace);
    case '/incognito': return newSession(S.cur.workspace, { incognito: true });
    case '/fork': { const s = await api.sessions.fork(S.cur.id); await refreshSessions(); return openSession(s.id); }
    case '/model': return modelMenu(els.bar.children[2]);
    case '/cost': if (!S.inspector) toggleInspector(); return;
    case '/memory': return openSettings(ctx(), 'memory');
    case '/export': { const p = await api.sessions.exportTo(S.cur.id); if (p) toast(`Exported to ${p}`); return; }
    case '/settings': return openSettings(ctx(), 'general');
    case '/init': return send('Analyze this repository and write a concise AGENTS.md at its root for future coding agents: purpose, stack, layout of key directories, how to install/build/test/run, code conventions, and gotchas. Read the important files first; keep it under 150 lines. If an AGENTS.md exists, improve it instead.', []);
    default: toast(`Unknown command ${cmd}`);
  }
}

// ── attachments
async function addFiles(files) {
  for (const f of files) {
    if (f.type.startsWith('image/')) {
      const url = await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(f); });
      S.attachments.push({ name: f.name || 'pasted image', image: url });
    } else {
      S.attachments.push({ name: f.name, path: api.filePath(f), text: f.size < 400000 ? await f.text() : null });
    }
  }
  renderAttachments(); renderSendBtn();
}
function addPicked(list) { S.attachments.push(...(list || [])); renderAttachments(); renderSendBtn(); }
function renderAttachments() {
  if (!els.attach) return;
  els.attach.classList.toggle('hidden', !S.attachments.length);
  els.attach.replaceChildren(...S.attachments.map((a, i) => h('div', { class: 'att', title: a.path || a.name },
    a.image ? h('img', { src: a.image }) : h('div', { style: { width: '38px', display: 'grid', placeItems: 'center' } }, icon('file')),
    h('span', null, a.name.length > 24 ? a.name.slice(0, 22) + '…' : a.name),
    h('button', { class: 'x', onclick: () => { S.attachments.splice(i, 1); renderAttachments(); renderSendBtn(); } }, '×'))));
}
// ── message queue: messages sent while the agent works wait here (FIFO) and go out when it finishes.
// "Send now" delivers one to the running agent at its next step instead.
function queueOf(sid) { if (!S.queues.has(sid)) S.queues.set(sid, []); return S.queues.get(sid); }
const newQid = () => Math.random().toString(36).slice(2, 10);

function renderQueue() {
  if (!els.queueEl || !S.cur) return;
  const q = queueOf(S.cur.id);
  if (!q.length) { els.queueEl.replaceChildren(); return; }
  els.queueEl.replaceChildren(
    h('div', { class: 'q-head' }, h('span', { class: 'label' }, S.busy ? 'Queued · sent when Vesper finishes' : 'Queued'), h('span', { class: 'grow' }),
      q.length > 1 ? h('button', { class: 'link', onclick: () => { q.length = 0; renderQueue(); } }, 'Clear all') : null),
    ...q.map((item) => {
      const text = h('span', { class: 't', title: 'Click to edit', onclick: () => editQueued(item, text) }, item.text || '(image)');
      return h('div', { class: `qi ${item.state === 'now' ? 'now' : ''}` },
        text,
        item.images && item.images.length ? h('span', { class: 'tag' }, `+${item.images.length} image${item.images.length === 1 ? '' : 's'}`) : null,
        item.state === 'now' ? h('span', { class: 'tag red' }, 'at next step')
          : h('button', { class: 'btn sm now-btn', title: S.busy ? 'Deliver to the running agent after its current step' : 'Send this now', onclick: () => sendNow(item) }, icon('arrowUp', 'sm'), S.busy ? 'Send now' : 'Send'),
        h('button', { class: 'icon-btn', title: 'Move back into the composer', onclick: () => {
          removeQueued(item);
          els.ta.value = els.ta.value.trim() ? `${item.text}\n\n${els.ta.value}` : item.text;
          if (item.images && item.images.length) { S.attachments.push(...item.images.map((image, i) => ({ name: `image ${i + 1}`, image }))); renderAttachments(); }
          autosize(els.ta); els.ta.focus(); renderSendBtn();
        } }, icon('edit', 'sm')),
        h('button', { class: 'icon-btn', title: 'Remove', onclick: () => removeQueued(item) }, icon('x', 'sm')));
    }));
}
function removeQueued(item) { const q = queueOf(S.cur.id); const i = q.indexOf(item); if (i >= 0) q.splice(i, 1); renderQueue(); }
function editQueued(item, span) {
  if (item.state === 'now') return toast('Already on its way to the agent');
  const ta = h('textarea', { class: 'q-edit', value: item.text, rows: Math.min(8, item.text.split('\n').length + 1) });
  let closed = false;
  const done = (save) => { if (closed) return; closed = true; if (save) item.text = ta.value.trim() || item.text; renderQueue(); };
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); done(true); }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(false); }
  });
  ta.addEventListener('blur', () => done(true));
  span.replaceWith(ta); ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
}
async function sendNow(item) {
  const sid = S.cur.id;
  if (!S.busy) { removeQueued(item); return send(item.text, item.images); }
  const ok = await api.agent.interject({ sessionId: sid, text: item.text, images: item.images, qid: item.qid }).catch(() => false);
  if (ok) { item.state = 'now'; toast('Delivered at the agent\'s next step'); }
  else toast('The run is wrapping up; it goes out right after');
  renderQueue();
}
function drainQueue(sid) {
  const q = queueOf(sid);
  if (!q.length || (S.live.get(sid) || {}).busy) return;
  const next = q.shift();
  if (S.cur && S.cur.id === sid) { renderQueue(); send(next.text, next.images); }
  else api.agent.send({ sessionId: sid, text: next.text, images: next.images }).catch((e) => { q.unshift(next); toast(e.message, 'err'); });
}

// ── send / stop
async function submit() {
  const raw = els.ta.value.trim();
  if (!raw && !S.attachments.length) return;
  if (raw.startsWith('/')) {
    const [cmd, ...rest] = raw.split(' ');
    if (SLASH.some(([c]) => c === cmd)) { els.ta.value = ''; autosize(els.ta); closeSlash(); renderSendBtn(); return runSlash(cmd, rest.join(' ')); }
  }
  const images = S.attachments.filter((a) => a.image).map((a) => a.image);
  let text = raw;
  for (const f of S.attachments.filter((a) => !a.image)) {
    text += f.text != null ? `\n\n<attached_file name="${f.name}"${f.path ? ` path="${f.path}"` : ''}>\n${f.text}\n</attached_file>` : `\n\n[Attached file: ${f.path || f.name}]`;
  }
  els.ta.value = ''; autosize(els.ta);
  S.attachments = []; renderAttachments();
  if (S.busy) { queueOf(S.cur.id).push({ qid: newQid(), text, images, state: 'queued' }); renderQueue(); renderSendBtn(); return; }
  await send(text, images);
}

async function send(text, images) {
  S.busy = true; S.phase = 'thinking'; updateWorking(); renderSendBtn();
  S.stick = true;
  try { await api.agent.send({ sessionId: S.cur.id, text, images }); }
  catch (e) {
    if (/already running/i.test(e.message)) {
      // The UI thought the session was idle but it is still working: never lose the message.
      queueOf(S.cur.id).push({ qid: newQid(), text, images, state: 'queued' }); renderQueue();
      toast('Still working. Your message is queued (Send now delivers it at the next step).');
      return;
    }
    S.busy = false; updateWorking(); renderSendBtn(); toast(e.message, 'err');
  }
  if (!els.working || !els.working.isConnected) { els.working = workingRow(); els.transcript.append(els.working); }
  updateWorking();
}
function stop() { if (S.cur) api.agent.stop(S.cur.id); }
function retryLast() { send('Please continue — the previous request failed. Pick up where you left off.', []); }

// ───────────────────────────────────────────── inspector
function renderInspector() {
  if (!els.inspector || !S.inspector || !S.cur) return;
  const s = S.cur;
  const m = currentModel() || {};
  const limit = m.contextLength || S.ctxLen || 128000;
  const used = s.lastPromptTokens || 0;
  const pct = Math.min(1, used / limit);
  const u = s.usage || {};
  const todos = s.todos || [];
  const done = todos.filter((t) => t.status === 'completed').length;
  const sec = S.cfg.security || {};
  const flag = (on, label) => h('div', { class: 'sec-row' }, h('span', { class: on ? 'on' : 'off' }, on ? icon('check', 'sm') : icon('x', 'sm')), label);
  els.inspector.replaceChildren(
    todos.length ? h('section', { class: 'ins-sec' },
      h('h4', null, h('span', { class: 'label' }, 'Plan'), h('span', { class: 'mono faint' }, `${done}/${todos.length}`)),
      todos.map((t) => h('div', { class: `todo ${t.status}` }, h('span', { class: 'box' }, t.status === 'completed' ? icon('check') : null), h('span', null, t.content)))) : null,
    h('section', { class: 'ins-sec' },
      h('h4', null, h('span', { class: 'label' }, 'Context'), h('button', { class: 'btn sm ghost', disabled: S.busy, onclick: () => runSlash('/compact') }, icon('compress', 'sm'), 'Compact')),
      h('div', { class: 'big-num' }, fmtTok(used), h('small', null, `/ ${fmtTok(limit)}`)),
      h('div', { class: `meter ${pct > 0.8 ? 'warn' : ''}` }, h('div', { style: { width: `${pct * 100}%` } })),
      h('div', { class: 'kv' }, h('span', null, 'Auto-compact at'), h('span', null, S.cfg.autoCompact ? `${Math.round(S.cfg.compactThreshold * 100)}%` : 'off')),
      h('div', { class: 'kv' }, h('span', null, 'Compactions'), h('span', null, s.compactions || 0)),
      h('div', { class: 'kv' }, h('span', null, 'Messages in context'), h('span', null, s.contextMessages ?? '—'))),
    h('section', { class: 'ins-sec' },
      h('h4', null, h('span', { class: 'label' }, 'Session cost'), S.cfg.sessionBudget ? h('span', { class: 'mono faint' }, `budget ${fmtUsd(S.cfg.sessionBudget, 2)}`) : null),
      h('div', { class: 'big-num' }, fmtUsd(u.cost || 0)),
      S.cfg.sessionBudget ? h('div', { class: `meter ${u.cost / S.cfg.sessionBudget > 0.8 ? 'warn' : ''}` }, h('div', { style: { width: `${Math.min(100, (u.cost || 0) / S.cfg.sessionBudget * 100)}%` } })) : h('div', { style: { height: '10px' } }),
      h('div', { class: 'kv' }, h('span', null, 'Input'), h('span', null, fmtTok(u.input || 0))),
      h('div', { class: 'kv' }, h('span', null, 'Cached input'), h('span', null, fmtTok(u.cached || 0))),
      h('div', { class: 'kv' }, h('span', null, 'Output'), h('span', null, fmtTok(u.output || 0))),
      h('div', { class: 'kv' }, h('span', null, 'Requests'), h('span', null, u.requests || 0))),
    h('section', { class: 'ins-sec' },
      h('h4', null, h('span', { class: 'label' }, 'Credits'), h('button', { class: 'btn sm rl', onclick: () => api.open(S.cfg.referral) }, 'Top up')),
      S.credits ? h('frag', null,
        h('div', { class: 'big-num' }, fmtUsd(S.credits.available, 2), h('small', null, 'available')),
        h('div', { style: { height: '8px' } }),
        h('div', { class: 'kv' }, h('span', null, 'Held by running requests'), h('span', null, fmtUsd(S.credits.reserved || 0, 2))),
        S.credits.key_limit != null ? h('div', { class: 'kv' }, h('span', null, 'Key budget left'), h('span', null, fmtUsd(S.credits.key_limit, 2))) : null)
        : h('div', { class: 'faint', style: { fontSize: '12.5px' } }, hasRefuseless() ? 'Balance unavailable right now.' : 'Connect a hosted account in Settings to see your balance here.')),
    h('section', { class: 'ins-sec' },
      h('h4', null, h('span', { class: 'label' }, 'Model'), m.abliterated ? h('span', { class: 'tag red' }, 'abliterated') : null),
      h('div', { class: 'mono', style: { fontSize: '12.5px', marginBottom: '8px', fontWeight: 600 } }, m.id || '—'),
      h('div', { class: 'kv' }, h('span', null, 'Input / 1M'), h('span', null, m.pricing ? `$${m.pricing.input}` : '—')),
      h('div', { class: 'kv' }, h('span', null, 'Cached / 1M'), h('span', null, m.pricing ? `$${m.pricing.cachedInput ?? m.pricing.input}` : '—')),
      h('div', { class: 'kv' }, h('span', null, 'Output / 1M'), h('span', null, m.pricing ? `$${m.pricing.output}` : '—')),
      h('div', { class: 'kv' }, h('span', null, 'Context'), h('span', null, m.contextLength ? fmtTok(m.contextLength) : '—')),
      h('div', { class: 'kv' }, h('span', null, 'Images'), h('span', null, m.vision ? 'yes' : m.vision === false ? 'no' : '?')),
      m.reasoningEfforts ? h('div', { class: 'kv' }, h('span', null, 'Reasoning'), h('span', null, m.reasoningEfforts.join(' · '))) : null),
    h('section', { class: 'ins-sec' },
      h('h4', null, h('span', { class: 'label' }, 'Security'), h('span', { class: `mode-badge mode-${S.cfg.permissionMode}` }, modeLabel(S.cfg.permissionMode))),
      flag(S.cfg.permissionMode !== 'full' && sec.guardCommands, 'Risky-command guard'),
      flag(S.cfg.permissionMode !== 'full' && sec.protectSensitivePaths, 'Secret-file protection'),
      flag(S.cfg.permissionMode !== 'full' && sec.confineWrites, 'Writes confined to workspace'),
      flag(sec.redactSecrets, 'Secret redaction'),
      flag(sec.wrapUntrusted, 'Prompt-injection fencing'),
      flag(sec.encryptSessions, 'Sessions encrypted at rest'),
      flag(sec.auditLog, 'Audit log')),
    (s.touched && s.touched.length) ? h('section', { class: 'ins-sec' },
      h('h4', null, h('span', { class: 'label' }, 'Files changed'), h('span', { class: 'mono faint' }, s.touched.length)),
      s.touched.slice(-30).reverse().map((f) => h('div', { class: 'file-row', title: f, onclick: () => api.reveal(f) }, icon('file', 'sm'), h('span', null, shortPath(f, s.workspace).replace(/^~\/?/, ''))))) : null,
  );
}

// ───────────────────────────────────────────── command palette
function openPalette() {
  closePop();
  const cmds = [
    ['New session', () => newSession(), `${MOD}N`],
    ['New incognito session', () => newSession(null, { incognito: true })],
    ['Change workspace folder', changeWorkspace],
    ['Switch model', () => modelMenu(els.bar.children[2])],
    ...MODES.map(([k, l]) => [`Mode: ${l}`, () => setMode(k)]),
    ['Compact context', () => runSlash('/compact')],
    ['Fork session', () => runSlash('/fork')],
    ['Export session', () => runSlash('/export')],
    ['Write AGENTS.md (/init)', () => runSlash('/init')],
    ['Toggle light / dark', toggleTheme],
    ['Toggle sidebar', toggleSidebar, `${MOD}B`],
    ['Toggle inspector', toggleInspector, `${MOD}.`],
    ['Top up credits', () => api.open(S.cfg.referral)],
    ['Settings: General', () => openSettings(ctx(), 'general'), `${MOD},`],
    ['Settings: Account & credits', () => openSettings(ctx(), 'refuseless')],
    ['Settings: Privacy & security', () => openSettings(ctx(), 'security')],
    ['Settings: Memory', () => openSettings(ctx(), 'memory')],
    ['Settings: Providers', () => openSettings(ctx(), 'providers')],
    ['Settings: Models & pricing', () => openSettings(ctx(), 'models')],
    ['Settings: Tools', () => openSettings(ctx(), 'tools')],
    ['Settings: MCP servers', () => openSettings(ctx(), 'mcp')],
    ['Settings: Usage', () => openSettings(ctx(), 'usage')],
    ['Settings: Audit log', () => openSettings(ctx(), 'audit')],
    ...S.sessions.slice(0, 30).map((s) => [`Open: ${s.title}`, () => openSession(s.id), relTime(s.updatedAt)]),
  ];
  let sel = 0, shown = cmds;
  const input = h('input', { placeholder: 'Type a command or session name…' });
  const list = h('div', { class: 'list' });
  const draw = () => {
    list.replaceChildren(...shown.slice(0, 60).map(([l, , k], i) => h('div', { class: `opt ${i === sel ? 'sel' : ''}`, onmousedown: (e) => { e.preventDefault(); run(i); } }, h('span', null, l), k ? h('span', { class: 'k' }, k) : null)));
    const el = list.children[sel]; el && el.scrollIntoView({ block: 'nearest' });
  };
  const run = (i) => { const c = shown[i]; wrap.remove(); c && c[1](); };
  input.addEventListener('input', () => {
    const q = input.value.toLowerCase().trim();
    shown = !q ? cmds : cmds.filter(([l]) => q.split(/\s+/).every((w) => l.toLowerCase().includes(w)));
    sel = 0; draw();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(shown.length - 1, sel + 1); draw(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); draw(); }
    if (e.key === 'Enter') { e.preventDefault(); run(sel); }
    if (e.key === 'Escape') wrap.remove();
  });
  const wrap = h('div', { class: 'palette-wrap', onmousedown: (e) => { if (e.target === wrap) wrap.remove(); } }, h('div', { class: 'palette' }, input, list));
  document.body.append(wrap);
  draw(); input.focus();
}

// ───────────────────────────────────────────── keyboard
document.addEventListener('keydown', (e) => {
  // Start typing anywhere and it lands in the composer.
  const a = document.activeElement;
  if (els.ta && S.cur && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && (!a || a === document.body || a === document.documentElement)
    && !document.querySelector('.palette-wrap, .overlay')) els.ta.focus();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && S.busy && !e.defaultPrevented && !document.querySelector('.palette-wrap, .overlay, .pop') && document.activeElement !== els.ta) { stop(); return; }
  const mod = isMac ? e.metaKey : e.ctrlKey;
  if (!mod || !S.cur) return;
  const k = e.key.toLowerCase();
  if (k === 'n' && !e.shiftKey) { e.preventDefault(); newSession(); }
  if (k === 'n' && e.shiftKey) { e.preventDefault(); newSession(null, { incognito: true }); }
  if (k === 'k') { e.preventDefault(); openPalette(); }
  if (k === 'b') { e.preventDefault(); toggleSidebar(); }
  if (k === '.') { e.preventDefault(); toggleInspector(); }
  if (k === ',') { e.preventDefault(); openSettings(ctx(), 'general'); }
  if (k === 'l') { e.preventDefault(); els.ta && els.ta.focus(); }
  if (k === 'j') { e.preventDefault(); toggleTheme(); }
});

function ctx() {
  return {
    get cfg() { return S.cfg; },
    setCfg: (c) => { S.cfg = c; applyTheme(); renderComposerBar(); renderInspector(); renderStatus(); renderSidebarFoot(); renderTitleRight(); },
    refreshCatalogs, refreshCredits,
    get catalogs() { return S.catalogs; },
    get credits() { return S.credits; },
    rerunSetup: async () => { await api.setup.reset(); location.reload(); },
    afterWipe: async () => { await refreshSessions(); if (S.sessions[0]) openSession(S.sessions[0].id); else newSession(); },
  };
}

boot().catch((e) => { root.replaceChildren(h('pre', { style: { padding: '40px', color: 'var(--err)' } }, e.stack || e.message)); });
