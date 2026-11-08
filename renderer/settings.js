// Settings modal: general, providers, models & pricing, tools, MCP, usage.
import { h, api, icon, toast, fmtUsd, fmtTok, modelTags, modeLadder, relTime } from './lib.js';

const SECTIONS = [
  ['general', 'General', 'settings'],
  ['refuseless', 'Account & credits', 'coins'],
  ['security', 'Privacy & security', 'shield'],
  ['providers', 'Providers', 'plug'],
  ['models', 'Models & pricing', 'sparkle'],
  ['tools', 'Tools', 'terminal'],
  ['mcp', 'MCP servers', 'branch'],
  ['memory', 'Memory', 'brain'],
  ['usage', 'Usage', 'chart'],
  ['audit', 'Audit log', 'list'],
];

export function openSettings(app, start = 'general') {
  let sec = start;
  const pane = h('div', { class: 'pane' });
  const nav = h('nav');
  const overlay = h('div', { class: 'overlay', onmousedown: (e) => { if (e.target === overlay) close(); } },
    h('div', { class: 'modal' }, nav, pane));
  const close = () => { overlay.remove(); document.removeEventListener('keydown', esc); };
  const esc = (e) => { if (e.key === 'Escape' && !document.querySelector('.pop')) close(); };
  document.addEventListener('keydown', esc);
  document.body.append(overlay);

  const save = async (patch) => { const c = await api.config.set(patch); app.setCfg(c); return c; };

  function renderNav() {
    nav.replaceChildren(h('div', { class: 'ttl label' }, 'Settings'), ...SECTIONS.map(([id, label, ic]) => h('button', { class: sec === id ? 'on' : '', onclick: () => { sec = id; render(); } }, icon(ic, 'sm'), label)),
      h('div', { class: 'spacer' }), h('div', { class: 'faint mono', style: { fontSize: '10.5px', padding: '0 10px' } }, 'Vesper 0.2 · no telemetry'));
  }
  async function render() {
    renderNav();
    const closeBtn = h('button', { class: 'icon-btn close', onclick: close }, icon('x'));
    const body = await ({ general, refuseless, security, providers, models, tools, mcp, memory, usage, audit })[sec]();
    pane.replaceChildren(closeBtn, body);
  }

  const row = (title, desc, control) => h('div', { class: 'set-row' }, h('div', { class: 'lbl' }, h('b', null, title), desc ? h('span', null, desc) : null), control);
  const toggle = (on, fn) => h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: !!on, onchange: (e) => fn(e.target.checked) }), h('span'));
  const seg = (opts, cur, fn) => h('div', { class: 'seg' }, opts.map(([k, l]) => h('button', { class: cur === k ? 'on' : '', onclick: () => fn(k) }, l)));

  // ---------------------------------------------------------- general
  function general() {
    const c = app.cfg;
    return h('div', null,
      h('h2', null, 'General'), h('p', { class: 'sub' }, 'How Vesper looks and behaves.'),
      row('Appearance', 'Light is the default. Ctrl+J toggles.', seg([['light', 'Light'], ['dark', 'Dark'], ['system', 'System']], c.theme, async (k) => { await save({ theme: k }); render(); })),
      row('Session budget', 'Stop a session once it has spent this much (USD). 0 means no limit.',
        h('input', { class: 'input', type: 'number', min: 0, step: 0.5, value: c.sessionBudget || 0, style: { width: '110px' }, onchange: (e) => save({ sessionBudget: Math.max(0, Number(e.target.value) || 0) }) })),
      row('Desktop notifications', 'Notify when a run finishes or needs you while Vesper is in the background.', toggle(c.notifyOnFinish !== false, (v) => save({ notifyOnFinish: v }))),
      row('Auto-compact', 'Summarize older messages automatically as the context window fills.', toggle(c.autoCompact, (v) => save({ autoCompact: v }))),
      row('Compact threshold', 'Share of the context window that triggers auto-compaction.',
        h('select', { class: 'select', style: { width: '120px' }, onchange: (e) => save({ compactThreshold: Number(e.target.value) }) },
          [0.6, 0.7, 0.8, 0.9].map((v) => h('option', { value: v, selected: c.compactThreshold === v }, `${v * 100}%`)))),
      row('Step limit', 'Model calls per message before pausing. 0 = unlimited, for long-running agents (a loop detector still stops runs that are stuck).',
        h('input', { class: 'input', type: 'number', min: 0, max: 100000, value: c.maxTurns || 0, style: { width: '100px' }, onchange: (e) => save({ maxTurns: Math.max(0, Number(e.target.value) || 0) }) })),
      row('Max output tokens', 'Per response. 0 = no cap (provider default). Hosted providers hold credit for the maximum while a request runs, so a cap lowers that hold.',
        h('input', { class: 'input', type: 'number', min: 0, max: 512000, value: c.maxOutputTokens || 0, style: { width: '120px' }, onchange: (e) => save({ maxOutputTokens: Math.max(0, Number(e.target.value) || 0) }) })),
      h('div', { class: 'field', style: { marginTop: '18px' } },
        h('label', null, 'Custom instructions'),
        h('textarea', { class: 'input', rows: 6, placeholder: 'Added to every session, e.g. “Prefer TypeScript. Always run the tests before finishing.”', value: c.systemPromptExtra || '', onchange: (e) => save({ systemPromptExtra: e.target.value }) }),
        h('span', { class: 'hint' }, 'Project-specific instructions belong in AGENTS.md at the repository root — Vesper reads it automatically.')));
  }

  // ---------------------------------------------------------- refuseless
  async function refuseless() {
    const c = app.cfg;
    const rl = c.providers.find((p) => p.kind === 'refuseless');
    let credits = null, err = '';
    if (rl) { try { credits = await api.credits(rl.id); } catch (e) { err = e.message; } }
    const cat = app.catalogs.find((x) => x.kind === 'refuseless');
    const keyInput = h('input', { class: 'input mono', type: 'password', placeholder: rl && rl.hasKey ? `${rl.keyMask} — paste a new key to replace` : 'abl_…' });
    return h('div', null,
      h('h2', null, 'Account & credits'),
      h('p', { class: 'sub' }, 'Hosted open-weight models with refusal behaviour removed from the weights. OpenAI-compatible, billed per token.'),
      h('div', { class: 'grid3' },
        h('div', { class: 'card red' }, h('div', { class: 'label' }, 'Available'), h('div', { class: 'big-num', style: { marginTop: '8px' } }, credits ? fmtUsd(credits.available, 2) : '—'),
          h('div', { class: 'faint', style: { fontSize: '12px', marginTop: '6px' } }, credits ? `${fmtUsd(credits.reserved || 0, 2)} held by running requests` : err || (rl ? 'Balance unavailable' : 'No key yet'))),
        h('div', { class: 'card' }, h('div', { class: 'label' }, 'Key budget'), h('div', { class: 'big-num', style: { marginTop: '8px' } }, credits && credits.key_limit != null ? fmtUsd(credits.key_limit, 2) : '∞'),
          h('div', { class: 'faint', style: { fontSize: '12px', marginTop: '6px' } }, 'Set per-key limits on refuseless.com')),
        h('div', { class: 'card' }, h('div', { class: 'label' }, 'Models'), h('div', { class: 'big-num', style: { marginTop: '8px' } }, cat ? cat.models.length : '—'),
          h('div', { class: 'faint', style: { fontSize: '12px', marginTop: '6px' } }, cat && cat.live ? 'live catalog' : 'built-in list'))),
      h('div', { class: 'row', style: { marginTop: '14px', gap: '8px' } },
        h('button', { class: 'btn rl', onclick: () => api.open(c.referral) }, icon('coins', 'sm'), 'Top up credits'),
        h('button', { class: 'btn', onclick: () => api.open(c.referral) }, icon('key', 'sm'), 'Manage API keys'),
        h('button', { class: 'btn ghost', onclick: () => api.open('https://refuseless.com/docs') }, icon('external', 'sm'), 'API docs')),
      h('h3', null, rl ? 'Replace key' : 'Add your key'),
      h('div', { class: 'row' }, keyInput, h('button', { class: 'btn primary', onclick: async () => {
        const k = keyInput.value.trim();
        if (!k) return;
        try {
          await api.provider.validate({ kind: 'refuseless', apiKey: k });
          app.setCfg(await api.provider.save({ id: rl && rl.id, kind: 'refuseless', name: 'Refuseless', apiKey: k }));
          await app.refreshCatalogs(true); await app.refreshCredits(); toast('Key saved'); render();
        } catch (e) { toast(e.status === 401 ? 'That key was rejected.' : e.message, 'err'); }
      } }, 'Verify & save')),
      h('h3', null, 'Support Vesper'),
      h('div', { class: 'card' },
        h('p', { style: { margin: '0 0 10px' } }, 'Vesper\'s sign-up and top-up links use a referral code that helps fund development. Sharing it costs nobody anything extra.'),
        h('div', { class: 'row' }, h('input', { class: 'input mono', readOnly: true, value: c.referral }),
          h('button', { class: 'btn', onclick: () => { navigator.clipboard.writeText(c.referral); toast('Link copied'); } }, icon('copy', 'sm'), 'Copy'))));
  }

  // ---------------------------------------------------------- security
  async function security() {
    const c = app.cfg;
    const s = c.security;
    const setSec = (k) => async (v) => { await save({ security: { [k]: v } }); render(); };
    const listEditor = (k, placeholder) => h('textarea', { class: 'input mono', rows: 3, placeholder, value: (s[k] || []).join('\n'), onchange: (e) => save({ security: { [k]: e.target.value.split('\n').map((x) => x.trim()).filter(Boolean) } }) });
    const tester = h('input', { class: 'input mono', placeholder: 'Try a command or some text, e.g.  git push --force   or   API_KEY=sk-…' });
    const verdict = h('div', { class: 'key-status' });
    tester.addEventListener('input', async () => {
      const r = await api.security.test(tester.value);
      verdict.className = `key-status ${r.danger ? 'err' : 'ok'}`;
      verdict.replaceChildren(r.danger ? icon('shield', 'sm') : icon('check', 'sm'), r.danger ? `Guarded: ${r.danger}` : 'Not a risky command', r.redacted !== tester.value ? h('span', { class: 'faint mono', style: { marginLeft: '10px' } }, `→ ${r.redacted.slice(0, 80)}`) : null);
    });
    return h('div', null,
      h('h2', null, 'Privacy & security'),
      h('p', { class: 'sub' }, 'Everything stays on this machine: no telemetry and no analytics. The only requests that leave are to the providers you configure and the sites the agent visits.'),
      h('h3', null, 'Permission mode'),
      modeLadder(c.permissionMode, async (k) => { await save({ permissionMode: k }); render(); }),
      h('h3', null, 'Guards (on in every mode except Full access)'),
      row('Risky-command guard', 'Always ask before recursive deletes, force pushes, curl | sh, registry or firewall edits, sudo, publishing, and similar commands.', toggle(s.guardCommands, setSec('guardCommands'))),
      row('Protect secret files', 'Ask before touching SSH keys, cloud credentials, .env files, browser profiles and keychains.', toggle(s.protectSensitivePaths, setSec('protectSensitivePaths'))),
      row('Confine writes to the workspace', 'Edits outside the session folder always need approval.', toggle(s.confineWrites, setSec('confineWrites'))),
      h('div', { class: 'field', style: { margin: '6px 0 4px' } }, h('label', null, 'Protected paths (globs, one per line)'), listEditor('sensitivePaths', '~/.ssh')),
      h('div', { class: 'field', style: { margin: '10px 0 0' } }, h('label', null, 'Test the guards'), tester, verdict),
      h('h3', null, 'Data protection'),
      row('Redact secrets', 'Strip API keys, tokens, private keys and passwords from tool output before the model sees it. Your configured keys are always redacted.', toggle(s.redactSecrets, setSec('redactSecrets'))),
      row('Prompt-injection fencing', 'Wrap web pages, search results and MCP output in untrusted-content tags, and tell the model never to follow instructions inside them.', toggle(s.wrapUntrusted, setSec('wrapUntrusted'))),
      row('Encrypt sessions at rest', 'Encrypt conversation history on disk with your OS keychain (DPAPI, Keychain or libsecret).', toggle(s.encryptSessions, async (v) => { try { await save({ security: { encryptSessions: v } }); toast(v ? 'Sessions encrypted' : 'Sessions decrypted'); } catch (e) { toast(e.message, 'err'); } render(); })),
      row('Audit log', 'Record every tool call, approval decision and guard hit locally (secrets redacted).', toggle(s.auditLog, setSec('auditLog'))),
      h('h3', null, 'Network'),
      h('div', { class: 'grid2' },
        h('div', { class: 'field' }, h('label', null, 'Blocked domains'), listEditor('blockedDomains', 'pastebin.com')),
        h('div', { class: 'field' }, h('label', null, 'Allowed domains (if set, only these)'), listEditor('allowedDomains', 'leave empty to allow all'))),
      h('h3', null, 'Your data'),
      h('div', { class: 'row', style: { flexWrap: 'wrap' } },
        h('button', { class: 'btn', onclick: () => api.data.reveal() }, icon('folder', 'sm'), 'Open data folder'),
        h('button', { class: 'btn', onclick: async () => { if (confirm('Clear the signup browser\'s cookies and storage?')) { await api.data.wipe({ sessions: false, usage: false, memory: false, audit: false, signup: true }); toast('Signup browser cleared'); } } }, 'Clear signup browser'),
        h('button', { class: 'btn danger', onclick: async () => {
          if (!confirm('Permanently delete ALL sessions, file snapshots, usage history, memory, audit log and signup cookies? Settings and keys are kept. This cannot be undone.')) return;
          await api.data.wipe(); toast('All local data wiped'); close(); app.afterWipe();
        } }, icon('trash', 'sm'), 'Wipe all local data')));
  }

  // ---------------------------------------------------------- memory
  async function memory() {
    const list = await api.memory.list();
    const add = h('input', { class: 'input', placeholder: 'Add something Vesper should always remember…' });
    const doAdd = async () => { const t = add.value.trim(); if (!t) return; await api.memory.save([...list, { text: t }]); render(); };
    add.addEventListener('keydown', (e) => { if (e.key === 'Enter') doAdd(); });
    return h('div', null,
      h('h2', null, 'Memory'),
      h('p', { class: 'sub' }, 'Durable notes shared by every session: preferences, conventions, gotchas. The agent can add to it with the memory tool; you can edit it here. Secrets are stripped before saving.'),
      row('Use memory', 'Inject memories into every session and give the agent the memory tool.', toggle(app.cfg.memoryEnabled !== false, async (v) => { await save({ memoryEnabled: v }); render(); })),
      h('div', { class: 'row', style: { margin: '10px 0 14px' } }, add, h('button', { class: 'btn primary', onclick: doAdd }, 'Add')),
      list.length ? list.slice().reverse().map((m) => h('div', { class: 'mem-item' },
        h('span', { class: 'id' }, m.id),
        h('span', { class: 't', contentEditable: 'true', onblur: async (e) => { const t = e.target.textContent.trim(); if (t !== m.text) { m.text = t; await api.memory.save(list.filter((x) => x.text)); toast('Memory updated'); } } }, m.text),
        h('span', { class: 'faint mono', style: { fontSize: '11px' } }, m.at ? relTime(m.at) : ''),
        h('button', { class: 'icon-btn', title: 'Forget', onclick: async () => { await api.memory.save(list.filter((x) => x !== m)); render(); } }, icon('trash', 'sm')))) : h('p', { class: 'faint' }, 'Nothing remembered yet.'));
  }

  // ---------------------------------------------------------- audit
  async function audit() {
    const rows = await api.audit.list(400);
    return h('div', null,
      h('h2', null, 'Audit log'),
      h('p', { class: 'sub' }, 'Every tool call the agent made, what was decided, and which guard fired. Stored only on this machine, with secrets redacted.'),
      h('div', { class: 'row', style: { marginBottom: '12px' } }, h('div', { class: 'grow' }),
        h('button', { class: 'btn sm', onclick: render }, icon('refresh', 'sm'), 'Refresh'),
        h('button', { class: 'btn sm danger', onclick: async () => { if (confirm('Clear the audit log?')) { await api.audit.clear(); render(); } } }, 'Clear')),
      rows.length ? h('table', { class: 'data' },
        h('thead', null, h('tr', null, ['When', 'Tool', 'Detail', 'Decision', 'Result'].map((t) => h('th', null, t)))),
        h('tbody', null, rows.map((r) => h('tr', null,
          h('td', { class: 'mono faint', style: { whiteSpace: 'nowrap' } }, new Date(r.ts).toLocaleString()),
          h('td', { class: 'mono' }, r.tool, r.depth ? h('span', { class: 'tag', style: { marginLeft: '4px' } }, 'sub') : null),
          h('td', { class: 'mono', style: { maxWidth: '320px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, title: r.summary }, r.summary, r.guard ? h('div', { class: 'red', style: { fontSize: '11px' } }, `guard: ${r.guard}`) : null),
          h('td', null, h('span', { class: `tag ${r.decision === 'deny' || r.decision === 'blocked' ? 'red' : r.decision === 'auto' ? '' : 'ok'}` }, r.decision)),
          h('td', null, h('span', { class: `tag ${r.status === 'ok' ? 'ok' : r.status === 'error' ? 'red' : ''}` }, r.status), r.redacted ? h('span', { class: 'tag red', style: { marginLeft: '4px' } }, `${r.redacted} redacted`) : null))))) : h('p', { class: 'faint' }, 'No entries yet.'));
  }

  // ---------------------------------------------------------- providers
  function providers() {
    const c = app.cfg;
    const list = c.providers.map((p) => providerCard(p));
    return h('div', null,
      h('h2', null, 'Providers'), h('p', { class: 'sub' }, 'Any OpenAI-compatible endpoint. Keys are encrypted with your OS keychain.'),
      ...list,
      h('div', { class: 'row', style: { marginTop: '16px' } },
        h('button', { class: 'btn', onclick: () => editProvider(null) }, icon('plus', 'sm'), 'Add provider'),
        h('div', { class: 'grow' }),
        h('button', { class: 'btn ghost', onclick: () => { if (confirm('Run first-time setup again? Your sessions are kept.')) app.rerunSetup(); } }, 'Run setup again')));
  }
  function providerCard(p) {
    const active = app.cfg.activeProviderId === p.id;
    return h('div', { class: 'card' },
      h('div', { class: 'row' },
        h('div', { class: 'grow' },
          h('div', { class: 'row' }, h('b', null, p.name), active ? h('span', { class: 'tag gold' }, 'default') : null),
          h('div', { class: 'mono faint', style: { marginTop: '4px' } }, p.baseUrl),
          h('div', { class: 'faint', style: { fontSize: '12px', marginTop: '2px' } }, p.hasKey ? `Key ${p.keyMask}` : 'No key')),
        h('button', { class: 'btn sm', onclick: () => editProvider(p) }, 'Edit'),
        app.cfg.providers.length > 1 ? h('button', { class: 'btn sm ghost danger', onclick: async () => { if (!confirm(`Remove ${p.name}?`)) return; app.setCfg(await api.provider.remove(p.id)); app.refreshCatalogs(true); render(); } }, 'Remove') : null));
  }
  function editProvider(p) {
    const isNew = !p;
    const f = { id: p && p.id, kind: p ? p.kind : 'openai', preset: p && p.preset || 'custom', name: p ? p.name : '', baseUrl: p ? p.baseUrl : '', apiKey: '', models: (p && p.models || []).map((m) => (typeof m === 'string' ? m : m.id)).join(', ') };
    const status = h('div', { class: 'key-status' });
    const body = h('div', { class: 'pane', style: { padding: '24px 26px' } },
      h('h2', { style: { fontSize: '24px' } }, isNew ? 'Add provider' : `Edit ${p.name}`),
      h('div', { class: 'stack', style: { marginTop: '16px' } },
        h('div', { class: 'field' }, h('label', null, 'Name'), h('input', { class: 'input', value: f.name, oninput: (e) => (f.name = e.target.value) })),
        f.kind === 'refuseless' ? null : h('div', { class: 'field' }, h('label', null, 'Base URL'), h('input', { class: 'input mono', value: f.baseUrl, placeholder: 'https://api.example.com/v1', oninput: (e) => (f.baseUrl = e.target.value.trim()) })),
        h('div', { class: 'field' }, h('label', null, 'API key'), h('input', { class: 'input mono', type: 'password', placeholder: p && p.hasKey ? `${p.keyMask} (leave empty to keep)` : 'key', oninput: (e) => (f.apiKey = e.target.value.trim()) })),
        f.kind === 'refuseless' ? null : h('div', { class: 'field' }, h('label', null, 'Extra model ids (comma-separated)'), h('input', { class: 'input mono', value: f.models, placeholder: 'for endpoints without /models', oninput: (e) => (f.models = e.target.value) })),
        status),
      h('div', { class: 'actions' },
        h('button', { class: 'btn ghost', onclick: () => sub.remove() }, 'Cancel'),
        h('button', { class: 'btn', onclick: async () => {
          status.replaceChildren(h('span', { class: 'spinner' }), 'Testing…'); status.className = 'key-status';
          try {
            if (!f.apiKey && p && p.hasKey && !isNew) { status.replaceChildren('Saved key will be used — save to test it.'); return; }
            const r = await api.provider.validate({ kind: f.kind, preset: f.preset, baseUrl: f.baseUrl, apiKey: f.apiKey });
            status.className = 'key-status ok'; status.replaceChildren(icon('check', 'sm'), `Connected · ${r.models.length} models`);
          } catch (e) { status.className = 'key-status err'; status.replaceChildren(icon('x', 'sm'), e.message); }
        } }, 'Test'),
        h('button', { class: 'btn primary', onclick: async () => {
          const payload = { id: f.id, kind: f.kind, preset: f.preset, name: f.name || 'Custom', baseUrl: f.baseUrl, models: f.models.split(',').map((s) => s.trim()).filter(Boolean) };
          if (f.apiKey) payload.apiKey = f.apiKey;
          app.setCfg(await api.provider.save(payload));
          await app.refreshCatalogs(true);
          sub.remove(); render(); toast('Provider saved');
        } }, 'Save')));
    const sub = h('div', { class: 'overlay', onmousedown: (e) => { if (e.target === sub) sub.remove(); } }, h('div', { class: 'modal small' }, body));
    document.body.append(sub);
  }

  // ---------------------------------------------------------- models
  async function models() {
    const cats = app.catalogs.length ? app.catalogs : await api.catalog();
    const usage = await api.usage();
    const c = app.cfg;
    const allModels = cats.flatMap((cat) => cat.models.map((m) => ({ cat, m })));
    return h('div', null,
      h('h2', null, 'Models & pricing'), h('p', { class: 'sub' }, 'Live catalogs from your providers. Prices are USD per million tokens and drive the cost tracking.'),
      row('Subagent model', 'Model used by subagents (defaults to the session\'s model). A cheaper, faster model keeps research cheap.',
        h('select', { class: 'select', style: { width: '260px' }, onchange: (e) => save({ subagentModel: e.target.value || null }) },
          h('option', { value: '' }, 'Same as session'),
          allModels.map(({ m }) => h('option', { value: m.id, selected: c.subagentModel === m.id }, m.id)))),
      h('div', { class: 'row', style: { margin: '14px 0 8px' } }, h('div', { class: 'grow' }), h('button', { class: 'btn sm', onclick: async () => { await app.refreshCatalogs(true); render(); } }, icon('refresh', 'sm'), 'Refresh')),
      ...cats.map((cat) => h('div', { style: { marginBottom: '22px' } },
        h('div', { class: 'row', style: { marginBottom: '6px' } }, h('b', null, cat.name), cat.live ? h('span', { class: 'tag ok' }, 'live') : h('span', { class: 'tag', title: cat.error || '' }, 'offline list')),
        h('table', { class: 'data' },
          h('thead', null, h('tr', null, ['Model', 'Context', 'Input', 'Cached', 'Output', 'Your usage', ''].map((t) => h('th', null, t)))),
          h('tbody', null, cat.models.map((m) => {
            const u = usage.byModel[`${cat.name} · ${m.id}`];
            return h('tr', null,
              h('td', { class: 'mono' }, m.id, h('div', { class: 'row', style: { gap: '4px', marginTop: '3px' } }, modelTags(m))),
              h('td', null, m.contextLength ? fmtTok(m.contextLength) : '—'),
              h('td', null, m.pricing ? `$${m.pricing.input}` : '—'),
              h('td', null, m.pricing ? `$${m.pricing.cachedInput ?? m.pricing.input}` : '—'),
              h('td', null, m.pricing ? `$${m.pricing.output}` : '—'),
              h('td', null, u ? `${fmtUsd(u.cost)} · ${u.requests} req` : '—'),
              h('td', null, h('button', { class: 'btn sm ghost', title: 'Override pricing', onclick: () => editPrice(cat, m) }, icon('edit', 'sm'))));
          }))))));
  }
  function editPrice(cat, m) {
    const p = m.pricing || { input: 0, cachedInput: 0, output: 0 };
    const vals = { ...p };
    const inp = (k) => h('div', { class: 'field' }, h('label', null, k), h('input', { class: 'input', type: 'number', step: '0.001', value: vals[k] ?? 0, oninput: (e) => (vals[k] = Number(e.target.value)) }));
    const body = h('div', { class: 'pane', style: { padding: '24px 26px' } },
      h('h2', { style: { fontSize: '24px' } }, 'Pricing override'), h('p', { class: 'sub mono' }, m.id),
      h('div', { class: 'grid2' }, inp('input'), inp('cachedInput'), inp('output')),
      h('div', { class: 'actions' }, h('button', { class: 'btn ghost', onclick: () => sub.remove() }, 'Cancel'), h('button', { class: 'btn primary', onclick: async () => {
        const prov = app.cfg.providers.find((x) => x.id === cat.id);
        const overrides = Object.assign({}, prov.pricingOverrides || {}, { [m.id]: vals });
        app.setCfg(await api.provider.save({ id: prov.id, pricingOverrides: overrides }));
        await app.refreshCatalogs(true); sub.remove(); render();
      } }, 'Save')));
    const sub = h('div', { class: 'overlay', onmousedown: (e) => { if (e.target === sub) sub.remove(); } }, h('div', { class: 'modal small' }, body));
    document.body.append(sub);
  }

  // ---------------------------------------------------------- tools
  function tools() {
    const c = app.cfg;
    const t = c.tools;
    const setTool = (k) => (v) => save({ tools: { [k]: v } });
    return h('div', null,
      h('h2', null, 'Tools'), h('p', { class: 'sub' }, 'What the agent is allowed to use. File reading, editing and search are always on.'),
      row('Shell', 'Run commands in PowerShell / your shell, including background jobs.', toggle(t.shell, setTool('shell'))),
      row('Web search & fetch', 'Search the web and read pages.', toggle(t.web, setTool('web'))),
      row('Subagents', 'Let the agent delegate research and sub-tasks to parallel subagents.', toggle(t.subagents, setTool('subagents'))),
      row('MCP tools', 'Expose tools from your MCP servers.', toggle(t.mcp, setTool('mcp'))),
      row('Computer use', 'Screenshots plus mouse & keyboard control of your desktop. Needs a vision model. Always asks first unless in Full auto.', toggle(t.computer, setTool('computer'))),
      row('Hide Vesper during screenshots', 'Minimize the window so the agent sees your desktop, not itself.', toggle(t.hideOnScreenshot !== false, setTool('hideOnScreenshot'))),
      h('h3', { style: { margin: '26px 0 6px', fontSize: '14px' } }, 'Web search engine'),
      row('Engine', 'DuckDuckGo needs no key. Brave and Tavily are more reliable.', seg([['duckduckgo', 'DuckDuckGo'], ['brave', 'Brave'], ['tavily', 'Tavily']], c.search.engine, async (k) => { await save({ search: { engine: k } }); render(); })),
      c.search.engine === 'brave' ? row('Brave API key', null, h('input', { class: 'input mono', type: 'password', style: { width: '260px' }, placeholder: c.search.braveKey || 'key', onchange: (e) => save({ search: { braveKey: e.target.value.trim() } }) })) : null,
      c.search.engine === 'tavily' ? row('Tavily API key', null, h('input', { class: 'input mono', type: 'password', style: { width: '260px' }, placeholder: c.search.tavilyKey || 'tvly-…', onchange: (e) => save({ search: { tavilyKey: e.target.value.trim() } }) })) : null);
  }

  // ---------------------------------------------------------- mcp
  async function mcp() {
    const status = await api.mcp.status();
    const c = app.cfg;
    const servers = c.mcpServers || [];
    const st = (name) => status.find((s) => s.name === name);
    return h('div', null,
      h('h2', null, 'MCP servers'), h('p', { class: 'sub' }, 'Model Context Protocol servers over stdio. Their tools appear to the agent as mcp__server__tool.'),
      ...servers.map((s, i) => {
        const x = st(s.name);
        return h('div', { class: 'card' },
          h('div', { class: 'row' },
            h('span', { class: `dot ${x && x.status === 'ready' ? 'ok' : x && x.status === 'error' ? 'err' : ''}` }),
            h('b', null, s.name), h('span', { class: 'mono faint grow', style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, `${s.command} ${(s.args || []).join(' ')}`),
            toggle(s.enabled !== false, async (v) => { servers[i].enabled = v; await save({ mcpServers: servers }); setTimeout(render, 800); }),
            h('button', { class: 'btn sm ghost danger', onclick: async () => { servers.splice(i, 1); await save({ mcpServers: servers }); render(); } }, icon('trash', 'sm'))),
          x && x.tools.length ? h('div', { class: 'row', style: { flexWrap: 'wrap', gap: '4px', marginTop: '10px' } }, x.tools.map((t) => h('span', { class: 'tag' }, t))) : null,
          x && x.error ? h('div', { class: 'key-status err', style: { marginTop: '8px' } }, x.error) : null);
      }),
      addMcpForm(servers),
      h('div', { class: 'row', style: { marginTop: '12px' } }, h('button', { class: 'btn sm', onclick: async () => { await api.mcp.restart(); render(); } }, icon('refresh', 'sm'), 'Restart all')));
  }
  function addMcpForm(servers) {
    const f = { name: '', command: '', args: '', env: '' };
    return h('div', { class: 'card', style: { marginTop: '14px' } },
      h('b', null, 'Add server'),
      h('div', { class: 'grid2', style: { marginTop: '10px' } },
        h('div', { class: 'field' }, h('label', null, 'Name'), h('input', { class: 'input', placeholder: 'github', oninput: (e) => (f.name = e.target.value.trim()) })),
        h('div', { class: 'field' }, h('label', null, 'Command'), h('input', { class: 'input mono', placeholder: 'npx', oninput: (e) => (f.command = e.target.value.trim()) })),
        h('div', { class: 'field' }, h('label', null, 'Arguments'), h('input', { class: 'input mono', placeholder: '-y @modelcontextprotocol/server-github', oninput: (e) => (f.args = e.target.value) })),
        h('div', { class: 'field' }, h('label', null, 'Environment (KEY=value, one per line)'), h('textarea', { class: 'input mono', rows: 1, oninput: (e) => (f.env = e.target.value) }))),
      h('div', { class: 'actions', style: { marginTop: '12px' } }, h('button', { class: 'btn primary sm', onclick: async () => {
        if (!f.name || !f.command) return toast('Name and command are required', 'err');
        const env = Object.fromEntries(f.env.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
        const args = (f.args.match(/"[^"]*"|\S+/g) || []).map((a) => a.replace(/^"|"$/g, ''));
        servers.push({ name: f.name, command: f.command, args, env, enabled: true });
        await save({ mcpServers: servers });
        toast('Starting server…');
        setTimeout(render, 2500);
      } }, 'Add & start')));
  }

  // ---------------------------------------------------------- usage
  async function usage() {
    const u = await api.usage();
    const credits = app.credits;
    const days = [];
    for (let i = 29; i >= 0; i--) { const d = new Date(Date.now() - i * 864e5).toISOString().slice(0, 10); days.push([d, (u.byDay[d] || {}).cost || 0]); }
    const max = Math.max(...days.map((d) => d[1]), 0.0001);
    const models = Object.entries(u.byModel).sort((a, b) => b[1].cost - a[1].cost);
    return h('div', null,
      h('h2', null, 'Usage'), h('p', { class: 'sub' }, 'Every request is metered locally from the provider\'s token counts and the model\'s price.'),
      h('div', { class: 'grid2' },
        h('div', { class: 'card' }, h('div', { class: 'faint', style: { fontSize: '12px' } }, 'All-time spend'), h('div', { class: 'big-num tnum', style: { marginTop: '6px' } }, fmtUsd(u.total.cost, 2)),
          h('div', { class: 'faint tnum', style: { fontSize: '12px', marginTop: '6px' } }, `${u.total.requests} requests · ${fmtTok(u.total.input)} in · ${fmtTok(u.total.output)} out`)),
        h('div', { class: 'card' }, h('div', { class: 'faint', style: { fontSize: '12px' } }, 'Account balance'),
          h('div', { class: 'big-num tnum', style: { marginTop: '6px' } }, credits ? fmtUsd(credits.available, 2) : '—'),
          h('div', { class: 'row', style: { marginTop: '6px' } },
            credits && credits.reserved ? h('span', { class: 'faint', style: { fontSize: '12px' } }, `${fmtUsd(credits.reserved, 2)} held by running requests`) : h('span', { class: 'faint', style: { fontSize: '12px' } }, credits ? 'Paid credit available now' : 'Not available for this provider'),
            h('div', { class: 'grow' }),
            credits ? h('button', { class: 'btn sm', onclick: () => api.open(app.cfg.referral) }, 'Add credits') : null))),
      h('div', { class: 'card', style: { marginTop: '12px' } },
        h('div', { class: 'row' }, h('b', null, 'Last 30 days'), h('div', { class: 'grow' }), h('span', { class: 'faint tnum', style: { fontSize: '12px' } }, fmtUsd(days.reduce((s, d) => s + d[1], 0), 2))),
        h('div', { class: 'bars' }, days.map(([d, c]) => h('div', { title: `${d}: ${fmtUsd(c)}`, style: { height: `${Math.max(2, (c / max) * 100)}%` } })))),
      h('div', { class: 'card', style: { marginTop: '12px' } },
        h('b', null, 'By model'),
        models.length ? h('table', { class: 'data', style: { marginTop: '8px' } },
          h('thead', null, h('tr', null, ['Model', 'Requests', 'Input', 'Cached', 'Output', 'Cost'].map((t) => h('th', null, t)))),
          h('tbody', null, models.map(([k, v]) => h('tr', null, h('td', { class: 'mono' }, k), h('td', null, v.requests), h('td', null, fmtTok(v.input)), h('td', null, fmtTok(v.cached)), h('td', null, fmtTok(v.output)), h('td', null, fmtUsd(v.cost)))))) :
          h('p', { class: 'faint' }, 'No usage yet.')));
  }

  render();
}
