// Minimal MCP client over stdio (newline-delimited JSON-RPC 2.0): initialize, tools/list, tools/call.
const { spawn } = require('child_process');

class McpServer {
  constructor(cfg) {
    this.cfg = cfg; this.name = cfg.name; this.tools = []; this.status = 'stopped'; this.error = null;
    this.seq = 0; this.pending = new Map(); this.buf = ''; this.proc = null; this.log = '';
  }
  async start() {
    this.status = 'starting';
    const isWin = process.platform === 'win32';
    this.proc = spawn(this.cfg.command, this.cfg.args || [], {
      env: Object.assign({}, process.env, this.cfg.env || {}), windowsHide: true, shell: isWin, cwd: this.cfg.cwd || undefined,
    });
    this.proc.stdout.on('data', (d) => this._onData(d));
    this.proc.stderr.on('data', (d) => { this.log = (this.log + d).slice(-8000); });
    this.proc.on('error', (e) => { this.status = 'error'; this.error = e.message; this._failAll(e); });
    this.proc.on('close', (c) => { if (this.status !== 'error') this.status = 'stopped'; this._failAll(new Error(`MCP server exited (${c})`)); });
    await this.request('initialize', {
      protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'vesper', version: '0.1.0' },
    }, 20000);
    this.notify('notifications/initialized', {});
    const r = await this.request('tools/list', {}, 20000);
    this.tools = r.tools || [];
    this.status = 'ready';
    return this;
  }
  _onData(d) {
    this.buf += d;
    let nl;
    while ((nl = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, nl).trim(); this.buf = this.buf.slice(nl + 1);
      if (!line) continue;
      let msg; try { msg = JSON.parse(line); } catch { continue; }
      if (msg.id != null && this.pending.has(msg.id)) {
        const { res, rej, t } = this.pending.get(msg.id);
        clearTimeout(t); this.pending.delete(msg.id);
        msg.error ? rej(new Error(msg.error.message || 'MCP error')) : res(msg.result);
      } else if (msg.id != null && msg.method) {
        // Server-initiated request we don't support (sampling, roots…): reply politely.
        this._send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'Not supported by Vesper' } });
      }
    }
  }
  _send(o) { if (this.proc && this.proc.stdin.writable) this.proc.stdin.write(JSON.stringify(o) + '\n'); }
  _failAll(e) { for (const { rej, t } of this.pending.values()) { clearTimeout(t); rej(e); } this.pending.clear(); }
  request(method, params, timeout = 120000) {
    const id = ++this.seq;
    return new Promise((res, rej) => {
      const t = setTimeout(() => { this.pending.delete(id); rej(new Error(`MCP ${method} timed out`)); }, timeout);
      this.pending.set(id, { res, rej, t });
      this._send({ jsonrpc: '2.0', id, method, params });
    });
  }
  notify(method, params) { this._send({ jsonrpc: '2.0', method, params }); }
  stop() { try { this.proc && this.proc.kill(); } catch {} this.status = 'stopped'; }
}

const servers = new Map();
const safe = (s) => String(s).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 40);

async function syncServers(configs) {
  const wanted = new Set((configs || []).filter((c) => c.enabled !== false).map((c) => c.name));
  for (const [name, s] of servers) if (!wanted.has(name)) { s.stop(); servers.delete(name); }
  await Promise.all((configs || []).filter((c) => c.enabled !== false && !servers.has(c.name)).map(async (c) => {
    const s = new McpServer(c);
    servers.set(c.name, s);
    try { await s.start(); } catch (e) { s.status = 'error'; s.error = e.message; }
  }));
}

function mcpTools() {
  const out = [];
  for (const s of servers.values()) {
    if (s.status !== 'ready') continue;
    for (const t of s.tools) {
      const name = `mcp__${safe(s.name)}__${safe(t.name)}`;
      out.push({
        name, kind: 'mcp', mcp: true,
        description: `[MCP ${s.name}] ${t.description || t.name}`.slice(0, 1024),
        parameters: t.inputSchema || { type: 'object', properties: {} },
        summary: (a) => `${s.name} · ${t.name}`,
        async run(a) {
          const r = await s.request('tools/call', { name: t.name, arguments: a || {} });
          const images = [];
          const text = (r.content || []).map((c) => {
            if (c.type === 'text') return c.text;
            if (c.type === 'image') { images.push(`data:${c.mimeType};base64,${c.data}`); return '[image]'; }
            if (c.type === 'resource') return c.resource && (c.resource.text || c.resource.uri);
            return JSON.stringify(c);
          }).join('\n');
          return { output: text || '(no content)', images, isError: !!r.isError };
        },
      });
    }
  }
  return out;
}

function status() { return [...servers.values()].map((s) => ({ name: s.name, status: s.status, error: s.error, tools: s.tools.map((t) => t.name), log: s.log.slice(-1500) })); }
function stopAll() { for (const s of servers.values()) s.stop(); servers.clear(); }

module.exports = { syncServers, mcpTools, status, stopAll };
