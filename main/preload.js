// Bridge between the renderer and the main process.
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const call = async (ch, ...args) => {
  const r = await ipcRenderer.invoke(ch, ...args);
  if (!r.ok) { const e = new Error(r.error); e.code = r.code; e.status = r.status; throw e; }
  return r.data;
};
const on = (ch) => (fn) => {
  const h = (_e, payload) => fn(payload);
  ipcRenderer.on(ch, h);
  return () => ipcRenderer.removeListener(ch, h);
};

contextBridge.exposeInMainWorld('vesper', {
  config: { get: () => call('config:get'), set: (p) => call('config:set', p) },
  provider: {
    validate: (p) => call('provider:validate', p),
    save: (p) => call('provider:save', p),
    remove: (id) => call('provider:remove', id),
  },
  setup: { complete: (o) => call('setup:complete', o), reset: () => call('setup:reset') },
  catalog: (force) => call('catalog:get', force),
  credits: (id) => call('credits:get', id),
  sessions: {
    list: () => call('sessions:list'),
    create: (ws, opts) => call('sessions:create', ws, opts),
    pin: (id, on) => call('sessions:pin', id, on),
    exportTo: (id) => call('sessions:export', id),
    load: (id) => call('sessions:load', id),
    remove: (id) => call('sessions:delete', id),
    rename: (id, t) => call('sessions:rename', id, t),
    update: (id, p) => call('sessions:update', id, p),
    fork: (id) => call('sessions:fork', id),
  },
  agent: {
    send: (o) => call('agent:send', o),
    interject: (o) => call('agent:interject', o),
    stop: (id) => call('agent:stop', id),
    pending: () => call('agent:pending'),
    compact: (id, ins) => call('agent:compact', id, ins),
    reply: (o) => call('approval:reply', o),
    revert: (sid, itemId) => call('agent:revert', sid, itemId),
    revertTurn: (sid, userItemId) => call('agent:revertTurn', sid, userItemId),
  },
  memory: { list: () => call('memory:list'), save: (l) => call('memory:save', l) },
  audit: { list: (n) => call('audit:list', n), clear: () => call('audit:clear') },
  data: { wipe: (w) => call('data:wipe', w), reveal: () => call('data:reveal') },
  security: { modes: () => call('security:modes'), test: (c) => call('security:test', c) },
  lineup: () => call('refuseless:lineup'),
  pickFolder: () => call('dialog:folder'),
  pickFiles: () => call('dialog:files'),
  filePath: (f) => { try { return webUtils.getPathForFile(f); } catch { return ''; } },
  usage: () => call('usage:get'),
  mcp: { status: () => call('mcp:status'), restart: () => call('mcp:restart') },
  open: (url) => call('open:external', url),
  openPath: (p) => call('open:path', p),
  reveal: (p) => call('reveal:path', p),
  signup: {
    open: (b) => call('signup:open', b),
    bounds: (b) => call('signup:bounds', b),
    nav: (c) => call('signup:nav', c),
    close: () => call('signup:close'),
  },
  titlebarTheme: (dark) => ipcRenderer.send('titlebar:theme', dark),
  on: {
    agent: on('agent:event'),
    sessions: on('sessions:changed'),
    usage: on('usage:changed'),
    mcp: on('mcp:changed'),
    signupState: on('signup:state'),
    signupKey: on('signup:key'),
  },
});
