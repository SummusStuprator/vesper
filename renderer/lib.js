// Shared renderer helpers: DOM builder, icons, formatting, markdown, toasts, popovers.
import { marked } from '../node_modules/marked/lib/marked.esm.js';
import hljs from '../node_modules/@highlightjs/cdn-assets/es/highlight.min.js';

export const api = window.vesper;

// Let conditional children (`cond ? node : null`) pass straight into replaceChildren/append.
for (const proto of [Element.prototype, DocumentFragment.prototype]) {
  for (const m of ['replaceChildren', 'append']) {
    const orig = proto[m];
    proto[m] = function (...kids) { return orig.apply(this, kids.filter((k) => k != null && k !== false)); };
  }
}

// ---------- DOM ----------
export function h(tag, attrs, ...kids) {
  const el = tag === 'frag' ? document.createDocumentFragment() : document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'value') el.value = v; // property, so <textarea> and <select> get it too
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}
export const $ = (s, r = document) => r.querySelector(s);
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- icons (1.6px stroke, 24 grid) ----------
const P = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
  settings: '<path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 1 1 3 3L7 19l-4 1 1-4Z"/>',
  terminal: '<path d="m4 17 6-5-6-5M12 19h8"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  bot: '<rect x="4" y="8" width="16" height="12" rx="3"/><path d="M12 4v4M9 13h.01M15 13h.01"/>',
  cursor: '<path d="m4 4 7 17 2.5-7.5L21 11Z"/>',
  plug: '<path d="M9 2v6M15 2v6M6 8h12v4a6 6 0 0 1-12 0Z M12 18v4"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  chev: '<path d="m9 6 6 6-6 6"/>',
  chevDown: '<path d="m6 9 6 6 6-6"/>',
  arrowUp: '<path d="M12 19V5M5 12l7-7 7 7"/>',
  arrowLeft: '<path d="M19 12H5M12 19l-7-7 7-7"/>',
  arrowRight: '<path d="M5 12h14M12 5l7 7-7 7"/>',
  stop: '<rect x="7" y="7" width="10" height="10" rx="1.5" fill="currentColor"/>',
  paperclip: '<path d="m21.4 11.1-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  undo: '<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-15-6.7L3 13"/>',
  sidebar: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
  panel: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/>',
  key: '<circle cx="7.5" cy="15.5" r="4.5"/><path d="m10.7 12.3 9.8-9.8M17 6l3 3M14.5 8.5l2 2"/>',
  sparkle: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-2.6-6.4L21 8"/><path d="M21 3v5h-5"/>',
  external: '<path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
  branch: '<circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="8" r="2.5"/><path d="M6 8.5v7M18 10.5c0 4-6 3-11 5.5"/>',
  compress: '<path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7"/>',
  brain: '<path d="M9 4a3 3 0 0 0-3 3 3 3 0 0 0-2 5 3 3 0 0 0 2 5 3 3 0 0 0 6 1V5a3 3 0 0 0-3-1Z"/><path d="M15 4a3 3 0 0 1 3 3 3 3 0 0 1 2 5 3 3 0 0 1-2 5 3 3 0 0 1-6 1"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/>',
  coins: '<circle cx="9" cy="9" r="6"/><path d="M18.1 10.4A6 6 0 1 1 10.4 18.1"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/>',
};
export function icon(name, cls = '') {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('class', `i ${cls}`);
  s.innerHTML = P[name] || '';
  return s;
}
export function vesperMark(cls = 'brand-mark') {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('class', cls);
  // A hard-edged V with the evening star cut above its right arm.
  s.innerHTML = '<path d="M2.5 4.5h4.6L12 15.2l2.6-5.7h4.6L12 21.5Z" fill="currentColor"/><path d="M18.6 1.6l.95 2.25 2.25.95-2.25.95-.95 2.25-.95-2.25-2.25-.95 2.25-.95Z" fill="currentColor"/>';
  return s;
}
export function rlLogo(h = 18) {
  const dark = document.documentElement.dataset.theme === 'dark';
  const img = document.createElement('img');
  img.src = `../assets/refuseless-${dark ? 'dark' : 'light'}.svg`;
  img.alt = 'Refuseless';
  img.style.height = `${h}px`;
  return img;
}

// ---------- formatting ----------
export function fmtUsd(n, digits) {
  if (!n) return '$0.00';
  if (digits == null) digits = n < 0.01 ? 4 : n < 1 ? 3 : 2;
  return '$' + n.toFixed(digits);
}
export function fmtTok(n) {
  if (n == null) return '—';
  if (n < 1000) return String(n);
  if (n < 1e6) return (n / 1000).toFixed(n < 10000 ? 1 : 0) + 'k';
  return (n / 1e6).toFixed(n < 1e7 ? 2 : 1) + 'M';
}
export function fmtMs(ms) { if (ms == null) return ''; return ms < 1000 ? `${ms}ms` : ms < 60000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.floor(ms / 60000)}m ${Math.round(ms % 60000 / 1000)}s`; }
export function fmtPrice(p) { if (!p) return 'pricing unknown'; if (!p.input && !p.output) return 'free'; return `$${trimNum(p.input)} in · $${trimNum(p.output)} out`; }
const trimNum = (n) => (n == null ? '?' : Number(n.toFixed(3)).toString());
export function shortPath(p, home) { if (!p) return ''; let s = p; if (home && s.startsWith(home)) s = '~' + s.slice(home.length); return s.replace(/\\/g, '/'); }
export function relTime(t) {
  const d = (Date.now() - t) / 1000;
  if (d < 60) return 'now'; if (d < 3600) return `${Math.floor(d / 60)}m`; if (d < 86400) return `${Math.floor(d / 3600)}h`;
  return `${Math.floor(d / 86400)}d`;
}

// ---------- markdown ----------
marked.use({
  gfm: true, breaks: false,
  renderer: {
    html(token) { return esc(token.text || token.raw || ''); },
    code(token) {
      const lang = (token.lang || '').split(/\s/)[0];
      let body;
      try { body = lang && hljs.getLanguage(lang) ? hljs.highlight(token.text, { language: lang, ignoreIllegals: true }).value : esc(token.text); }
      catch { body = esc(token.text); }
      return `<div class="codeblock"><div class="cb-head"><span>${esc(lang || 'text')}</span><button class="icon-btn" data-copy title="Copy"><svg viewBox="0 0 24 24" class="i sm">${P.copy}</svg></button></div><pre><code class="hljs">${body}</code></pre></div>`;
    },
    link(token) {
      const href = esc(token.href || '');
      const text = this.parser.parseInline(token.tokens);
      return /^(https?:|mailto:)/.test(token.href || '') ? `<a href="${href}" target="_blank" rel="noreferrer">${text}</a>` : text;
    },
    image(token) {
      return /^(https?:|data:image\/)/.test(token.href || '') ? `<img src="${esc(token.href)}" alt="${esc(token.text)}">` : esc(token.text);
    },
  },
});
export function md(text) {
  try { return marked.parse(text || ''); } catch { return `<p>${esc(text)}</p>`; }
}
export function hl(code, lang) {
  try { return lang && hljs.getLanguage(lang) ? hljs.highlight(code, { language: lang, ignoreIllegals: true }).value : esc(code); } catch { return esc(code); }
}
export function langOf(path) {
  const ext = (String(path).split('.').pop() || '').toLowerCase();
  return ({ js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript', py: 'python', rs: 'rust', go: 'go', rb: 'ruby', java: 'java', kt: 'kotlin', cs: 'csharp', cpp: 'cpp', cc: 'cpp', c: 'c', h: 'c', hpp: 'cpp', css: 'css', scss: 'scss', html: 'xml', xml: 'xml', svg: 'xml', json: 'json', md: 'markdown', sh: 'bash', bash: 'bash', ps1: 'powershell', yml: 'yaml', yaml: 'yaml', toml: 'ini', sql: 'sql', lua: 'lua', swift: 'swift', php: 'php', r: 'r' })[ext] || '';
}

// Delegated copy buttons in rendered markdown.
document.addEventListener('click', (e) => {
  const b = e.target.closest && e.target.closest('[data-copy]');
  if (!b) return;
  const code = b.closest('.codeblock').querySelector('code').innerText;
  navigator.clipboard.writeText(code);
  toast('Copied');
});

// ---------- toasts ----------
export function toast(msg, kind = '') {
  const t = h('div', { class: `toast ${kind}` }, msg);
  document.getElementById('toasts').append(t);
  setTimeout(() => { t.style.transition = 'opacity .3s'; t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, kind === 'err' ? 5200 : 2200);
}

// ---------- popovers ----------
let openPop = null;
export function closePop() { if (openPop) { openPop.remove(); openPop = null; } }
export function popover(anchor, content, { place = 'top', cls = '', align = 'left' } = {}) {
  closePop();
  const pop = h('div', { class: `pop ${cls}` }, content);
  document.body.append(pop);
  const r = anchor.getBoundingClientRect();
  const pr = pop.getBoundingClientRect();
  let top = place === 'top' ? r.top - pr.height - 8 : r.bottom + 8;
  if (top < 48) top = r.bottom + 8;
  if (top + pr.height > innerHeight - 8) top = Math.max(48, innerHeight - pr.height - 8);
  let left = align === 'right' ? r.right - pr.width : r.left;
  left = Math.max(8, Math.min(left, innerWidth - pr.width - 8));
  Object.assign(pop.style, { top: `${top}px`, left: `${left}px` });
  openPop = pop;
  setTimeout(() => {
    const off = (e) => { if (!pop.contains(e.target)) { closePop(); document.removeEventListener('mousedown', off, true); } };
    document.addEventListener('mousedown', off, true);
  });
  return pop;
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePop(); });

export function lightbox(src) {
  const lb = h('div', { class: 'lightbox', onclick: () => lb.remove() }, h('img', { src }));
  document.body.append(lb);
}

// Permission ladder, least to most autonomous.
export const MODES = [
  ['plan', 'Plan', 'Read-only. Investigates and proposes a plan; changes nothing.'],
  ['ask', 'Ask', 'Approve every edit, command and desktop action.'],
  ['edits', 'Auto-edit', 'Workspace edits apply; commands still ask.'],
  ['auto', 'Auto', 'Runs unattended. Guards still stop risky commands, secrets and outside writes.'],
  ['full', 'Full access', 'No prompts, no guards. Anything your account can do.'],
];
export const modeLabel = (k) => (MODES.find((m) => m[0] === k) || MODES[1])[1];
export function modeLadder(cur, onPick) {
  return h('div', { class: 'ladder' }, MODES.map(([k, l, d], i) => h('button', {
    class: `${cur === k ? 'on' : ''} ${k}`,
    onclick: () => {
      if (k === 'full' && cur !== 'full' && !confirm('Full access turns off every prompt and safety guard. Vesper will be able to run any command and edit any file your account can. Continue?')) return;
      onPick(k);
    },
  }, h('span', { class: `mode-badge mode-${k}` }, `${i} · ${l}`), h('span', { class: 'd' }, d))));
}

export function modelTags(m) {
  const tags = [];
  if (m.abliterated) tags.push(h('span', { class: 'tag red' }, 'abliterated'));
  if (m.contextLength) tags.push(h('span', { class: 'tag' }, `${fmtTok(m.contextLength)} ctx`));
  if (m.vision) tags.push(h('span', { class: 'tag' }, icon('image', 'sm'), 'vision'));
  if (m.reasoningEfforts && m.reasoningEfforts.length) tags.push(h('span', { class: 'tag' }, 'reasoning'));
  if (m.pricing && !m.pricing.input && !m.pricing.output) tags.push(h('span', { class: 'tag ok' }, 'free'));
  return tags;
}
