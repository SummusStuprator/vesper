// Vesper — Electron main process: window, IPC, sessions, agent runs, embedded signup.
const { app, BrowserWindow, WebContentsView, ipcMain, dialog, shell, nativeTheme, Menu, Notification, session: eSession } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const store = require('./store');
const security = require('./security');
const providers = require('./providers');
const { Runner } = require('./agent');
const mcp = require('./tools/mcp');
const { killAllJobs } = require('./tools/shell');

const DEV = process.argv.includes('--dev');
if (process.env.VESPER_DATA_DIR) app.setPath('userData', process.env.VESPER_DATA_DIR);
// Own taskbar identity on Windows so the taskbar shows Vesper's icon, not Electron's.
const APP_ID = 'com.vesper.app';
if (process.platform === 'win32') app.setAppUserModelId(APP_ID);
const ICON = path.join(__dirname, '..', 'assets', process.platform === 'win32' ? 'icon.ico' : 'icon.png');
let win = null;
let config = null;
const catalogs = new Map();        // providerId -> { models, live, error, at }
const runs = new Map();            // sessionId -> { controller, runner }
const sessions = new Map();        // sessionId -> session (loaded)
const approvals = new Map();       // requestId -> resolve
let hiddenForComputer = false;     // window minimized so screenshots show the desktop

// ------------------------------------------------------------------ helpers

const send = (ch, payload) => { if (win && !win.isDestroyed()) win.webContents.send(ch, payload); };
const newId = () => crypto.randomBytes(8).toString('hex');
function mask(k) { return k ? `${k.slice(0, 4)}••••${k.slice(-4)}` : ''; }

function publicConfig() {
  return Object.assign({}, config, {
    providers: config.providers.map((p) => Object.assign({}, p, { apiKey: undefined, keyMask: mask(p.apiKey), hasKey: !!p.apiKey })),
    search: Object.assign({}, config.search, { braveKey: mask(config.search.braveKey), tavilyKey: mask(config.search.tavilyKey) }),
    platform: process.platform,
    referral: providers.REFUSELESS.referral,
  });
}

function providerById(id) { return config.providers.find((p) => p.id === id) || config.providers[0]; }

async function catalog(providerId, force = false) {
  const p = providerById(providerId);
  if (!p) return { models: [], live: false, error: 'No provider configured' };
  const c = catalogs.get(p.id);
  if (c && !force && Date.now() - c.at < 10 * 60 * 1000) return c;
  const r = await providers.fetchCatalog(p);
  const entry = Object.assign(r, { at: Date.now() });
  catalogs.set(p.id, entry);
  return entry;
}

async function resolveModel(providerId, modelId) {
  const c = await catalog(providerId);
  return c.models.find((m) => m.id === modelId) || { id: modelId, providerId, pricing: null };
}

function persistSession(s) { try { store.saveSession(s); } catch (e) { console.error('save failed', e); } }

function getSession(id) {
  if (sessions.has(id)) return sessions.get(id);
  const s = store.loadSession(id);
  if (s) sessions.set(id, s);
  return s;
}

function newSession(workspace, opts = {}) {
  const s = {
    id: newId(), title: opts.incognito ? 'Incognito session' : 'New session', workspace: workspace || app.getPath('home'),
    incognito: !!opts.incognito,
    createdAt: Date.now(), updatedAt: Date.now(),
    providerId: config.activeProviderId, model: config.activeModel, effort: config.effort,
    context: [], transcript: [], usage: { input: 0, cached: 0, output: 0, cost: 0, requests: 0 },
    lastPromptTokens: 0, todos: [], compactions: 0, allowedTools: [], touched: [],
  };
  sessions.set(s.id, s);
  persistSession(s);
  rememberWorkspace(s.workspace);
  return s;
}

function rememberWorkspace(ws) {
  config.recentWorkspaces = [ws, ...(config.recentWorkspaces || []).filter((w) => w !== ws)].slice(0, 12);
  store.saveConfig(config);
}

function makeRunner(s, model, controller) {
  let saveT = null;
  const runner = new Runner({
    session: s, config, provider: providerById(s.providerId), model,
    models: (catalogs.get(s.providerId) || {}).models || [],
    signal: controller.signal,
    emit: (ev) => {
      if (ev.kind === 'usage') ev.contextMessages = s.context.length;
      send('agent:event', Object.assign({ sessionId: s.id }, ev));
      if (!saveT) saveT = setTimeout(() => { saveT = null; persistSession(s); }, 1500);
    },
    approve: ({ item, depth, reason, guard }) => new Promise((resolve) => {
      const requestId = newId();
      approvals.set(requestId, resolve);
      send('agent:event', { sessionId: s.id, kind: 'approval', requestId, item: { id: item.id, name: item.name, args: item.args, summary: item.summary, kind: item.kind }, depth, reason, guard });
      controller.signal.addEventListener('abort', () => { if (approvals.has(requestId)) { approvals.delete(requestId); resolve({ decision: 'deny', feedback: 'Run was stopped.' }); } });
      attention('Vesper needs your approval', item.summary || item.name);
    }),
    ask: ({ itemId, question, options }) => new Promise((resolve) => {
      const requestId = newId();
      approvals.set(requestId, resolve);
      send('agent:event', { sessionId: s.id, kind: 'question', requestId, itemId, question, options });
      controller.signal.addEventListener('abort', () => { if (approvals.has(requestId)) { approvals.delete(requestId); resolve({ answer: '' }); } });
      attention('Vesper has a question', question);
    }),
    onUsage: (u, m) => {
      const p = providerById(s.providerId);
      store.recordUsage(Object.assign({ model: `${p ? p.name : '?'} · ${m.id}` }, u));
      send('usage:changed', null);
    },
    beforeScreenshot: async () => {
      if (config.tools.hideOnScreenshot !== false && win && !win.isMinimized()) {
        hiddenForComputer = true;
        win.minimize(); await new Promise((r) => setTimeout(r, 450));
      }
    },
    afterScreenshot: () => {},
  });
  return runner;
}

function attention(title, body) {
  if (!win || win.isFocused()) return;
  win.flashFrame(true);
  if (config.notifyOnFinish !== false && Notification.isSupported()) {
    const n = new Notification({ title, body: String(body || '').slice(0, 140), silent: false });
    n.on('click', () => { win.show(); win.focus(); });
    n.show();
  }
}

// ------------------------------------------------------------------ IPC

const APP_URL = 'file://';
function handle(ch, fn) {
  ipcMain.handle(ch, async (e, ...args) => {
    // Only Vesper's own UI may call into the main process (never the signup page or anything remote).
    const url = (e.senderFrame && e.senderFrame.url) || '';
    if (!url.startsWith(APP_URL) || (win && e.sender !== win.webContents)) return { ok: false, error: 'Forbidden' };
    try { return { ok: true, data: await fn(...args) }; }
    catch (e) { return { ok: false, error: e.message, code: e.code, status: e.status }; }
  });
}

function registerIpc() {
  handle('config:get', () => publicConfig());
  handle('config:set', (patch) => {
    const wasEncrypted = !!config.security.encryptSessions;
    for (const [k, v] of Object.entries(patch || {})) {
      if (k === 'providers') continue;
      if (k === 'search' || k === 'tools' || k === 'security') {
        const cur = config[k];
        for (const [kk, vv] of Object.entries(v)) if (!(typeof vv === 'string' && vv.includes('••••'))) cur[kk] = vv;
      } else config[k] = v;
    }
    if (!!config.security.encryptSessions !== wasEncrypted) {
      const on = store.setSessionEncryption(config.security.encryptSessions);
      if (config.security.encryptSessions && !on) { config.security.encryptSessions = false; throw new Error('OS encryption is not available on this system.'); }
      store.reencryptAll();
    }
    store.saveConfig(config);
    if (patch && patch.mcpServers) mcp.syncServers(config.mcpServers);
    if (patch && patch.theme) nativeTheme.themeSource = patch.theme;
    return publicConfig();
  });

  // ---- providers & setup
  handle('provider:validate', async (p) => {
    const prov = { id: 'probe', kind: p.kind, preset: p.preset, baseUrl: p.baseUrl || (p.kind === 'refuseless' ? providers.REFUSELESS.baseUrl : ''), apiKey: (p.apiKey || '').trim() };
    if (!prov.baseUrl) throw new Error('Enter the provider\'s base URL.');
    const v = await providers.validateKey(prov);
    const cat = await providers.fetchCatalog(prov);
    return { credits: v.credits || null, models: cat.models, live: cat.live, catalogError: cat.error };
  });
  handle('provider:save', (p) => {
    const existing = p.id && config.providers.find((x) => x.id === p.id);
    const entry = existing || { id: p.id || newId() };
    Object.assign(entry, {
      kind: p.kind || entry.kind || 'openai',
      preset: p.preset ?? entry.preset,
      name: p.name || entry.name || (p.kind === 'refuseless' ? 'Refuseless' : (providers.PRESETS[p.preset] || {}).name || 'Custom'),
      baseUrl: p.baseUrl || entry.baseUrl || (p.kind === 'refuseless' ? providers.REFUSELESS.baseUrl : ''),
      models: p.models ?? entry.models ?? [],
      pricingOverrides: p.pricingOverrides ?? entry.pricingOverrides ?? {},
      headers: p.headers ?? entry.headers ?? {},
    });
    if (p.apiKey !== undefined && !String(p.apiKey).includes('••••')) entry.apiKey = String(p.apiKey).trim();
    if (!existing) config.providers.push(entry);
    if (!config.activeProviderId) config.activeProviderId = entry.id;
    catalogs.delete(entry.id);
    store.saveConfig(config);
    return publicConfig();
  });
  handle('provider:remove', (id) => {
    config.providers = config.providers.filter((p) => p.id !== id);
    if (config.activeProviderId === id) config.activeProviderId = config.providers[0] ? config.providers[0].id : null;
    catalogs.delete(id);
    store.saveConfig(config);
    return publicConfig();
  });
  handle('setup:complete', (o) => {
    Object.assign(config, { setupComplete: true, activeProviderId: o.providerId, activeModel: o.model, effort: o.effort || null });
    if (o.permissionMode) config.permissionMode = o.permissionMode;
    store.saveConfig(config);
    destroySignup();
    return publicConfig();
  });
  handle('setup:reset', () => { config.setupComplete = false; store.saveConfig(config); return publicConfig(); });
  handle('catalog:get', async (force) => {
    const out = [];
    for (const p of config.providers) {
      const c = await catalog(p.id, !!force);
      out.push({ id: p.id, name: p.name, kind: p.kind, models: c.models, live: c.live, error: c.error });
    }
    return out;
  });
  handle('credits:get', async (providerId) => {
    const p = providerById(providerId || config.activeProviderId);
    if (!p || p.kind !== 'refuseless') return null;
    return providers.fetchCredits(p);
  });

  // ---- sessions
  handle('sessions:list', () => store.listSessions().map((x) => Object.assign(x, { running: runs.has(x.id) })));
  handle('sessions:create', (ws, opts) => strip(newSession(ws, opts || {})));
  handle('sessions:load', (id) => { const s = getSession(id); if (!s) throw new Error('Session not found'); return strip(s); });
  handle('sessions:delete', (id) => { stopRun(id); sessions.delete(id); store.deleteSession(id); return true; });
  handle('sessions:rename', (id, title) => { const s = getSession(id); s.title = title; persistSession(s); return true; });
  handle('sessions:update', (id, patch) => {
    const s = getSession(id);
    for (const k of ['providerId', 'model', 'effort', 'workspace']) if (k in patch) s[k] = patch[k];
    if (patch.workspace) rememberWorkspace(patch.workspace);
    if (patch.model) { config.activeModel = patch.model; config.activeProviderId = s.providerId; if ('effort' in patch) config.effort = patch.effort; store.saveConfig(config); }
    persistSession(s);
    return strip(s);
  });
  handle('sessions:fork', (id, uptoItemId) => {
    const src = getSession(id);
    const s = newSession(src.workspace);
    Object.assign(s, JSON.parse(JSON.stringify({ context: src.context, transcript: src.transcript, usage: { input: 0, cached: 0, output: 0, cost: 0, requests: 0 }, todos: src.todos, providerId: src.providerId, model: src.model, effort: src.effort })));
    s.title = `${src.title} (fork)`;
    persistSession(s);
    return strip(s);
  });

  // ---- agent
  handle('agent:send', async ({ sessionId, text, images }) => {
    const s = getSession(sessionId);
    if (!s) throw new Error('Session not found');
    if (runs.has(sessionId)) throw new Error('This session is already running.');
    const p = providerById(s.providerId || config.activeProviderId);
    if (!p) throw new Error('No provider configured. Open Settings → Providers.');
    s.providerId = p.id;
    s.model = s.model || config.activeModel;
    if (s.title === 'New session' && text) s.title = text.replace(/\s+/g, ' ').trim().slice(0, 64);
    const model = await resolveModel(p.id, s.model);
    const controller = new AbortController();
    const runner = makeRunner(s, model, controller);
    runs.set(sessionId, { controller, runner });
    send('sessions:changed', null);
    (async () => {
      try { await runner.run({ text, images }); }
      catch (e) { if (!controller.signal.aborted) console.error('[run]', e.message); }
      finally {
        runs.delete(sessionId);
        persistSession(s);
        if (hiddenForComputer && win) { hiddenForComputer = false; win.restore(); }
        send('agent:event', { sessionId, kind: 'done', usage: s.usage, todos: s.todos, contextMessages: s.context.length });
        send('sessions:changed', null);
        attention('Vesper finished', s.title);
      }
    })();
    return true;
  });
  handle('agent:stop', (sessionId) => { stopRun(sessionId); return true; });
  handle('agent:compact', async (sessionId, instructions) => {
    const s = getSession(sessionId);
    if (runs.has(sessionId)) throw new Error('Wait for the current run to finish.');
    const p = providerById(s.providerId || config.activeProviderId);
    s.providerId = p.id;
    const model = await resolveModel(p.id, s.model || config.activeModel);
    const controller = new AbortController();
    const runner = makeRunner(s, model, controller);
    runs.set(sessionId, { controller, runner });
    try { return await runner.compact('manual', instructions || ''); }
    finally { runs.delete(sessionId); persistSession(s); send('agent:event', { sessionId, kind: 'done', usage: s.usage }); }
  });
  handle('approval:reply', ({ requestId, decision, feedback, answer }) => {
    const r = approvals.get(requestId);
    if (r) { approvals.delete(requestId); r({ decision, feedback, answer }); }
    return true;
  });
  handle('agent:revertTurn', (sessionId, userItemId) => {
    const s = getSession(sessionId);
    const items = s.transcript.filter((x) => x.type === 'tool' && x.turn === userItemId && x.revertable && !x.reverted);
    const files = [];
    for (const it of items.reverse()) {
      const snap = store.loadSnapshot(sessionId, it.id);
      if (!snap) continue;
      if (snap.before === null) { if (fs.existsSync(snap.file)) shell.trashItem(snap.file); }
      else fs.writeFileSync(snap.file, snap.before);
      it.reverted = true;
      files.push(snap.file);
    }
    if (files.length) {
      s.context.push({ role: 'user', content: `[Note from the harness: the user reverted all file changes from one of your turns. These files are back to their earlier content: ${[...new Set(files)].join(', ')}]` });
      s.context.push({ role: 'assistant', content: 'Noted.' });
    }
    persistSession(s);
    return { files: [...new Set(files)] };
  });
  handle('agent:revert', (sessionId, itemId) => {
    const snap = store.loadSnapshot(sessionId, itemId);
    if (!snap) throw new Error('No snapshot for this change.');
    if (snap.before === null) { if (fs.existsSync(snap.file)) shell.trashItem(snap.file); }
    else fs.writeFileSync(snap.file, snap.before);
    const s = getSession(sessionId);
    const it = s.transcript.find((x) => x.id === itemId);
    if (it) { it.reverted = true; persistSession(s); }
    s.context.push({ role: 'user', content: `[Note from the harness: the user reverted your change to ${snap.file}. It is back to its previous content.]` });
    s.context.push({ role: 'assistant', content: 'Noted.' });
    return { file: snap.file };
  });

  // ---- misc
  handle('dialog:folder', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });
  handle('dialog:files', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'], filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }, { name: 'All files', extensions: ['*'] }] });
    if (r.canceled) return [];
    return r.filePaths.map((f) => {
      const ext = path.extname(f).slice(1).toLowerCase();
      const buf = fs.readFileSync(f);
      const isImg = ['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext);
      return isImg
        ? { name: path.basename(f), image: `data:image/${ext === 'jpg' ? 'jpeg' : ext};base64,${buf.toString('base64')}` }
        : { name: path.basename(f), path: f, text: buf.length < 400000 ? buf.toString('utf8') : null };
    });
  });
  handle('usage:get', () => store.loadUsage());

  // ---- memory, audit, data
  handle('memory:list', () => store.loadMemory());
  handle('memory:save', (list) => { store.saveMemory((list || []).map((m) => ({ id: m.id || newId().slice(0, 6), text: security.redact(String(m.text)).text.slice(0, 500), at: m.at || Date.now() }))); return store.loadMemory(); });
  handle('audit:list', (n) => security.readAudit(n || 300));
  handle('audit:clear', () => { security.clearAudit(); return true; });
  handle('data:wipe', async (what) => {
    for (const id of [...runs.keys()]) stopRun(id);
    sessions.clear();
    store.wipe(what || {});
    if (!what || what.audit !== false) security.clearAudit();
    if (!what || what.signup !== false) await eSession.fromPartition('persist:signup').clearStorageData();
    send('sessions:changed', null);
    return true;
  });
  handle('data:reveal', () => { shell.openPath(store.dataDir()); return true; });
  handle('security:modes', () => security.MODES);
  handle('security:test', (cmd) => ({ danger: security.dangerousCommand(cmd || ''), redacted: security.redact(cmd || '').text }));
  handle('refuseless:lineup', async () => {
    const r = await providers.fetchCatalog({ id: 'public', kind: 'refuseless', baseUrl: providers.REFUSELESS.baseUrl });
    return r.models;
  });
  handle('sessions:pin', (id, on) => { const s = getSession(id); s.pinned = !!on; persistSession(s); return true; });
  handle('sessions:export', async (id) => {
    const s = getSession(id);
    const r = await dialog.showSaveDialog(win, { defaultPath: `${(s.title || 'session').replace(/[^\w\- ]+/g, '').slice(0, 60) || 'session'}.md`, filters: [{ name: 'Markdown', extensions: ['md'] }, { name: 'JSON', extensions: ['json'] }] });
    if (r.canceled || !r.filePath) return null;
    if (r.filePath.endsWith('.json')) { fs.writeFileSync(r.filePath, JSON.stringify(s, null, 2)); return r.filePath; }
    const out = [`# ${s.title}`, '', `- Workspace: \`${s.workspace}\``, `- Model: \`${s.model}\``, `- Cost: $${(s.usage.cost || 0).toFixed(4)} · ${s.usage.input} in / ${s.usage.output} out`, `- Exported: ${new Date().toISOString()}`, ''];
    for (const it of s.transcript) {
      if (it.type === 'user') out.push('## You', '', it.text || '', '');
      else if (it.type === 'assistant' && it.text) out.push('## Vesper', '', it.text, '');
      else if (it.type === 'tool') out.push(`> **${it.name}** \`${String(it.summary || '').replace(/`/g, "'").slice(0, 200)}\` — ${it.status}`, '');
      else if (it.type === 'compaction' && it.summary) out.push('---', '*Context compacted.*', '');
      else if (it.type === 'error') out.push(`> ⚠ ${it.text}`, '');
    }
    fs.writeFileSync(r.filePath, security.redact(out.join('\n')).text);
    return r.filePath;
  });
  handle('mcp:status', () => mcp.status());
  handle('mcp:restart', async () => { mcp.stopAll(); await mcp.syncServers(config.mcpServers); return mcp.status(); });
  handle('open:external', (url) => { if (/^https?:\/\//.test(url)) shell.openExternal(url); return true; });
  handle('open:path', (p) => shell.openPath(p));
  handle('reveal:path', (p) => { shell.showItemInFolder(p); return true; });

  // ---- signup (embedded)
  handle('signup:open', (bounds) => openSignup(bounds));
  handle('signup:bounds', (bounds) => { if (signupView) signupView.setBounds(roundRect(bounds)); return true; });
  handle('signup:nav', (cmd) => {
    if (!signupView) return false;
    const wc = signupView.webContents;
    if (cmd === 'back' && wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
    if (cmd === 'reload') wc.reload();
    if (cmd === 'external') shell.openExternal(wc.getURL());
    if (cmd === 'hide') signupView.setVisible(false);
    if (cmd === 'show') signupView.setVisible(true);
    return true;
  });
  handle('signup:close', () => { destroySignup(); return true; });
}

function strip(s) {
  // Renderer needs the transcript, not the raw API context.
  const { context, ...rest } = s;
  return Object.assign(rest, { running: runs.has(s.id), contextMessages: context.length });
}

function stopRun(id) {
  const r = runs.get(id);
  if (r) r.controller.abort();
}

// ------------------------------------------------------------------ embedded signup

let signupView = null;
const roundRect = (b) => ({ x: Math.round(b.x), y: Math.round(b.y), width: Math.max(1, Math.round(b.width)), height: Math.max(1, Math.round(b.height)) });

function openSignup(bounds) {
  if (signupView) { signupView.setVisible(true); signupView.setBounds(roundRect(bounds)); return true; }
  signupView = new WebContentsView({
    webPreferences: {
      partition: 'persist:signup',
      preload: path.join(__dirname, 'signup-preload.js'),
      contextIsolation: true, sandbox: true, nodeIntegration: false,
    },
  });
  win.contentView.addChildView(signupView);
  signupView.setBounds(roundRect(bounds));
  signupView.setBorderRadius && signupView.setBorderRadius(10);
  const wc = signupView.webContents;
  const state = () => send('signup:state', {
    url: wc.getURL(), title: wc.getTitle(), loading: wc.isLoading(), canGoBack: wc.navigationHistory.canGoBack(),
  });
  wc.on('did-start-loading', state);
  wc.on('did-stop-loading', state);
  wc.on('did-navigate', state);
  wc.on('did-navigate-in-page', state);
  wc.on('page-title-updated', state);
  wc.on('did-fail-load', (_e, code, desc, url) => { if (code !== -3) send('signup:state', { url, error: desc, loading: false }); });
  // OAuth providers open pop-ups that need window.opener: allow them as child windows in the same cookie jar.
  wc.setWindowOpenHandler(({ url }) => {
    if (!/^https?:/.test(url)) return { action: 'deny' };
    return { action: 'allow', overrideBrowserWindowOptions: { parent: win, width: 520, height: 720, autoHideMenuBar: true, webPreferences: { partition: 'persist:signup', sandbox: true, contextIsolation: true } } };
  });
  wc.loadURL(providers.REFUSELESS.referral);
  return true;
}

function destroySignup() {
  if (!signupView) return;
  try { win.contentView.removeChildView(signupView); signupView.webContents.close(); } catch {}
  signupView = null;
}

ipcMain.on('signup:key-found', (e, key) => {
  if (!signupView || e.sender !== signupView.webContents) return;
  const k = String(key || '').trim();
  if (!/^abl_[A-Za-z0-9_\-]{12,}$/.test(k)) return;
  send('signup:key', k);
});

// ------------------------------------------------------------------ app lifecycle

function createWindow() {
  win = new BrowserWindow({
    width: 1360, height: 880, minWidth: 940, minHeight: 600,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0f0f10' : '#f6f5f1',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    titleBarOverlay: process.platform === 'darwin' ? false : { color: '#00000000', symbolColor: nativeTheme.shouldUseDarkColors ? '#a8a6a0' : '#55534e', height: 40 },
    icon: ICON,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true,
      spellcheck: true, webviewTag: false, navigateOnDragDrop: false, safeDialogs: true,
    },
  });
  win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file:')) { e.preventDefault(); shell.openExternal(url); } });
  if (DEV) win.webContents.openDevTools({ mode: 'detach' });
  nativeTheme.on('updated', () => {
    if (process.platform !== 'darwin') try { win.setTitleBarOverlay({ color: '#00000000', symbolColor: nativeTheme.shouldUseDarkColors ? '#a8a6a0' : '#55534e', height: 40 }); } catch {}
  });
  ipcMain.on('titlebar:theme', (_e, dark) => {
    if (process.platform !== 'darwin') try { win.setTitleBarOverlay({ color: '#00000000', symbolColor: dark ? '#a8a6a0' : '#55534e', height: 40 }); } catch {}
  });
}

// ------------------------------------------------------------------ hardening

function harden() {
  // No web permission (camera, mic, geolocation, notifications…) is ever granted to page content.
  // The signup page may only write to the clipboard (its "copy key" buttons).
  const deny = (wc, perm, cb) => cb(false);
  eSession.defaultSession.setPermissionRequestHandler(deny);
  eSession.defaultSession.setPermissionCheckHandler(() => false);
  const signup = eSession.fromPartition('persist:signup');
  signup.setPermissionRequestHandler((wc, perm, cb) => cb(perm === 'clipboard-sanitized-write'));
  signup.setPermissionCheckHandler((wc, perm) => perm === 'clipboard-sanitized-write');
  // Downloads only ever happen with an explicit save dialog.
  for (const ses of [eSession.defaultSession, signup]) ses.on('will-download', (e, item) => { item.setSaveDialogOptions({ title: 'Save download' }); });
  app.on('web-contents-created', (_e, wc) => {
    wc.on('will-attach-webview', (ev) => ev.preventDefault());
    if (wc.getType() === 'window' && wc !== (win && win.webContents)) {
      // OAuth pop-ups opened from signup: keep them on http(s).
      wc.on('will-navigate', (ev, url) => { if (!/^https?:/i.test(url)) ev.preventDefault(); });
    }
  });
}

app.whenReady().then(() => {
  store.init(path.join(app.getPath('userData'), 'vesper'));
  config = store.loadConfig();
  security.initAudit(store.dataDir());
  store.setSessionEncryption(config.security.encryptSessions);
  harden();
  nativeTheme.themeSource = config.theme || 'system';
  Menu.setApplicationMenu(process.platform === 'darwin' ? Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' }]) : null);
  registerIpc();
  createWindow();
  mcp.syncServers(config.mcpServers).then(() => send('mcp:changed', null));
});

app.on('window-all-closed', () => {
  for (const r of runs.values()) r.controller.abort();
  for (const s of sessions.values()) {
    if (s.incognito) store.deleteSession(s.id); // incognito leaves nothing behind
    else persistSession(s);
  }
  killAllJobs(); mcp.stopAll();
  app.quit();
});
