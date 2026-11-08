// Persistence: config (with OS-encrypted secrets), sessions, usage ledger, file snapshots.
const fs = require('fs');
const path = require('path');

let root = null;
let safe = null;

function init(dir) {
  root = dir;
  for (const d of ['sessions', 'snapshots']) fs.mkdirSync(path.join(root, d), { recursive: true });
  try { safe = require('electron').safeStorage; } catch { safe = null; }
}

const file = (...p) => path.join(root, ...p);

function readJSON(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
}
function writeJSON(p, v) {
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(v, null, 2));
  fs.renameSync(tmp, p);
}

// ---------- secrets ----------
function seal(s) {
  if (!s) return s;
  if (safe && safe.isEncryptionAvailable()) return 'enc:' + safe.encryptString(s).toString('base64');
  return 'raw:' + Buffer.from(s).toString('base64');
}
function unseal(s) {
  if (!s || typeof s !== 'string') return s;
  try {
    if (s.startsWith('enc:') && safe) return safe.decryptString(Buffer.from(s.slice(4), 'base64'));
    if (s.startsWith('raw:')) return Buffer.from(s.slice(4), 'base64').toString();
  } catch { return ''; }
  return s;
}

// ---------- config ----------
const DEFAULT_CONFIG = {
  setupComplete: false,
  providers: [],
  activeProviderId: null,
  activeModel: null,
  effort: null,
  subagentModel: null,
  permissionMode: 'ask', // plan | ask | edits | auto | full
  autoCompact: true,
  compactThreshold: 0.8,
  theme: 'light',
  configVersion: 2,
  maxTurns: 0,               // agent steps per message, 0 = unlimited (long-running agents)
  maxOutputTokens: 0,        // per response, 0 = provider default
  sessionBudget: 0,          // USD per session, 0 = unlimited
  notifyOnFinish: true,
  memoryEnabled: true,
  tools: { web: true, computer: false, subagents: true, shell: true, mcp: true, hideOnScreenshot: true },
  search: { engine: 'duckduckgo', braveKey: '', tavilyKey: '' },
  security: require('./security').DEFAULT_SECURITY,
  mcpServers: [],
  recentWorkspaces: [],
  systemPromptExtra: '',
};

function loadConfig() {
  const c = Object.assign({}, DEFAULT_CONFIG, readJSON(file('config.json'), {}));
  c.tools = Object.assign({}, DEFAULT_CONFIG.tools, c.tools);
  c.search = Object.assign({}, DEFAULT_CONFIG.search, c.search);
  c.security = Object.assign({}, DEFAULT_CONFIG.security, c.security);
  c.providers = (c.providers || []).map((p) => Object.assign({}, p, { apiKey: unseal(p.apiKey) }));
  c.search.braveKey = unseal(c.search.braveKey);
  c.search.tavilyKey = unseal(c.search.tavilyKey);
  if (!(c.configVersion >= 2)) {
    // v2: step and output caps removed by default (they cut long agent runs short).
    if (c.maxTurns === 80) c.maxTurns = 0;
    if (c.maxOutputTokens === 32000) c.maxOutputTokens = 0;
    c.configVersion = 2;
  }
  return c;
}
function saveConfig(c) {
  const out = Object.assign({}, c, {
    providers: (c.providers || []).map((p) => Object.assign({}, p, { apiKey: seal(p.apiKey) })),
    search: Object.assign({}, c.search, { braveKey: seal(c.search.braveKey), tavilyKey: seal(c.search.tavilyKey) }),
  });
  writeJSON(file('config.json'), out);
}

// ---------- sessions (optionally encrypted at rest) ----------
let encryptSessions = false;
function setSessionEncryption(on) { encryptSessions = !!on && !!(safe && safe.isEncryptionAvailable()); return encryptSessions; }
const MAGIC = 'VESPER-ENC1:';
function readSessionFile(p) {
  try {
    const raw = fs.readFileSync(p, 'utf8');
    if (raw.startsWith(MAGIC)) return JSON.parse(safe.decryptString(Buffer.from(raw.slice(MAGIC.length), 'base64')));
    return JSON.parse(raw);
  } catch { return null; }
}
const memIndex = new Map(); // id -> summary, for incognito sessions that never touch disk
function listSessions() {
  const dir = file('sessions');
  const onDisk = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => {
    const s = readSessionFile(path.join(dir, f));
    if (!s) return null;
    return { id: s.id, title: s.title, workspace: s.workspace, updatedAt: s.updatedAt, cost: (s.usage && s.usage.cost) || 0, model: s.model, pinned: !!s.pinned };
  }).filter(Boolean);
  return onDisk.concat([...memIndex.values()]).sort((a, b) => (b.pinned - a.pinned) || (b.updatedAt - a.updatedAt));
}
function loadSession(id) { return readSessionFile(file('sessions', id + '.json')); }
function saveSession(s) {
  s.updatedAt = Date.now();
  if (s.incognito) {
    memIndex.set(s.id, { id: s.id, title: s.title, workspace: s.workspace, updatedAt: s.updatedAt, cost: (s.usage && s.usage.cost) || 0, model: s.model, incognito: true, pinned: !!s.pinned });
    return;
  }
  const p = file('sessions', s.id + '.json');
  if (encryptSessions) {
    const tmp = p + '.tmp';
    fs.writeFileSync(tmp, MAGIC + safe.encryptString(JSON.stringify(s)).toString('base64'));
    fs.renameSync(tmp, p);
  } else writeJSON(p, s);
}
/** Rewrite every stored session with the current encryption setting. */
function reencryptAll() {
  const dir = file('sessions');
  let n = 0;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    const s = readSessionFile(path.join(dir, f));
    if (s) { const t = s.updatedAt; saveSession(s); s.updatedAt = t; n++; }
  }
  return n;
}
function deleteSession(id) {
  memIndex.delete(id);
  try { fs.unlinkSync(file('sessions', id + '.json')); } catch {}
  try { fs.rmSync(file('snapshots', id), { recursive: true, force: true }); } catch {}
}

// ---------- memory (persistent notes the agent keeps across sessions) ----------
function loadMemory() { return readJSON(file('memory.json'), []); }
function saveMemory(list) { writeJSON(file('memory.json'), list.slice(-200)); }

// ---------- wipe ----------
function wipe({ sessions = true, usage = true, memory = true } = {}) {
  if (sessions) {
    memIndex.clear();
    for (const d of ['sessions', 'snapshots']) { fs.rmSync(file(d), { recursive: true, force: true }); fs.mkdirSync(file(d), { recursive: true }); }
  }
  if (usage) try { fs.unlinkSync(file('usage.json')); } catch {}
  if (memory) try { fs.unlinkSync(file('memory.json')); } catch {}
}
function dataDir() { return root; }

// ---------- snapshots (for revert) ----------
function saveSnapshot(sessionId, key, data) {
  const d = file('snapshots', sessionId);
  fs.mkdirSync(d, { recursive: true });
  writeJSON(path.join(d, key + '.json'), data);
}
function loadSnapshot(sessionId, key) { return readJSON(file('snapshots', sessionId, key + '.json'), null); }

// ---------- usage ledger ----------
function recordUsage(entry) {
  const p = file('usage.json');
  const u = readJSON(p, { byModel: {}, byDay: {}, total: { requests: 0, input: 0, cached: 0, output: 0, cost: 0 } });
  const add = (o) => {
    o.requests = (o.requests || 0) + 1;
    o.input = (o.input || 0) + entry.input;
    o.cached = (o.cached || 0) + entry.cached;
    o.output = (o.output || 0) + entry.output;
    o.cost = (o.cost || 0) + entry.cost;
  };
  const day = new Date().toISOString().slice(0, 10);
  add(u.byModel[entry.model] = u.byModel[entry.model] || {});
  add(u.byDay[day] = u.byDay[day] || {});
  add(u.total);
  writeJSON(p, u);
}
function loadUsage() { return readJSON(file('usage.json'), { byModel: {}, byDay: {}, total: { requests: 0, input: 0, cached: 0, output: 0, cost: 0 } }); }

module.exports = {
  init, loadConfig, saveConfig, listSessions, loadSession, saveSession, deleteSession, saveSnapshot, loadSnapshot,
  recordUsage, loadUsage, loadMemory, saveMemory, wipe, dataDir, setSessionEncryption, reencryptAll,
};
