// File tools: read, write, edit, list, glob, grep, view_image.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { lineDiff } = require('../diff');

const IGNORE = new Set(['node_modules', '.git', '.hg', '.svn', 'dist', 'build', '.next', '__pycache__', '.venv', 'venv', 'target', '.cache', '.idea']);
const IMAGE_EXT = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp' };

function resolve(ctx, p) {
  if (!p) return ctx.workspace;
  const expanded = p.replace(/^~(?=$|[\\/])/, require('os').homedir());
  return path.isAbsolute(expanded) ? path.normalize(expanded) : path.resolve(ctx.workspace, expanded);
}
const rel = (ctx, p) => {
  const r = path.relative(ctx.workspace, p);
  return r && !r.startsWith('..') && !path.isAbsolute(r) ? r.replace(/\\/g, '/') : p;
};

function isBinary(buf) {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

// ---------- read ----------
const read_file = {
  name: 'read_file', kind: 'read',
  description: 'Read a text file. Returns numbered lines (cat -n style). Use offset/limit for large files. For images use view_image.',
  parameters: { type: 'object', properties: {
    path: { type: 'string', description: 'File path, absolute or relative to the workspace' },
    offset: { type: 'integer', description: '1-based line to start at' },
    limit: { type: 'integer', description: 'Max lines (default 2000)' },
  }, required: ['path'] },
  summary: (a) => a.path,
  async run(a, ctx) {
    const p = resolve(ctx, a.path);
    if (IMAGE_EXT[path.extname(p).toLowerCase()]) return { output: `${a.path} is an image. Use view_image to look at it.` };
    const buf = fs.readFileSync(p);
    if (isBinary(buf)) return { output: `${a.path} is a binary file (${buf.length} bytes).` };
    const lines = buf.toString('utf8').split('\n');
    const start = Math.max(1, a.offset || 1);
    const limit = Math.min(a.limit || 2000, 5000);
    const slice = lines.slice(start - 1, start - 1 + limit);
    const width = String(start + slice.length).length;
    let out = slice.map((l, i) => `${String(start + i).padStart(width)}\t${l.length > 2000 ? l.slice(0, 2000) + '…' : l}`).join('\n');
    if (start - 1 + limit < lines.length) out += `\n… (${lines.length - (start - 1 + limit)} more lines; use offset)`;
    ctx.markRead && ctx.markRead(p);
    return { output: out || '(empty file)', display: { lines: slice.length, total: lines.length } };
  },
};

// ---------- write ----------
const write_file = {
  name: 'write_file', kind: 'edit',
  description: 'Create or overwrite a file with the given content. Parent directories are created. Prefer edit_file for changes to existing files.',
  parameters: { type: 'object', properties: {
    path: { type: 'string' }, content: { type: 'string' },
  }, required: ['path', 'content'] },
  summary: (a) => a.path,
  async run(a, ctx) {
    const p = resolve(ctx, a.path);
    const before = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
    ctx.snapshot && ctx.snapshot(p, before);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, a.content);
    const diff = lineDiff(before, a.content);
    ctx.touch && ctx.touch(p);
    return {
      output: `${before === null ? 'Created' : 'Overwrote'} ${rel(ctx, p)} (${a.content.split('\n').length} lines).`,
      display: { path: rel(ctx, p), created: before === null, diff },
    };
  },
};

// ---------- edit ----------
const edit_file = {
  name: 'edit_file', kind: 'edit',
  description: 'Replace an exact string in a file. old_string must match exactly (including whitespace) and be unique unless replace_all is true. Read the file first.',
  parameters: { type: 'object', properties: {
    path: { type: 'string' },
    old_string: { type: 'string', description: 'Exact text to replace' },
    new_string: { type: 'string', description: 'Replacement text' },
    replace_all: { type: 'boolean' },
  }, required: ['path', 'old_string', 'new_string'] },
  summary: (a) => a.path,
  async run(a, ctx) {
    const p = resolve(ctx, a.path);
    if (!fs.existsSync(p)) throw new Error(`File not found: ${a.path}`);
    const before = fs.readFileSync(p, 'utf8');
    let oldS = a.old_string;
    // Tolerate CRLF files when the model sends LF.
    if (!before.includes(oldS) && before.includes('\r\n') && oldS.includes('\n')) {
      const crlf = oldS.replace(/\r?\n/g, '\r\n');
      if (before.includes(crlf)) { oldS = crlf; a.new_string = a.new_string.replace(/\r?\n/g, '\r\n'); }
    }
    const count = before.split(oldS).length - 1;
    if (count === 0) throw new Error('old_string not found in file. Re-read the file and copy the exact text.');
    if (count > 1 && !a.replace_all) throw new Error(`old_string occurs ${count} times. Add surrounding context to make it unique, or set replace_all.`);
    const after = a.replace_all ? before.split(oldS).join(a.new_string) : before.replace(oldS, () => a.new_string);
    ctx.snapshot && ctx.snapshot(p, before);
    fs.writeFileSync(p, after);
    ctx.touch && ctx.touch(p);
    const diff = lineDiff(before, after);
    return { output: `Edited ${rel(ctx, p)} (+${diff.added} −${diff.removed}).`, display: { path: rel(ctx, p), diff } };
  },
};

// ---------- multi_edit ----------
const multi_edit = {
  name: 'multi_edit', kind: 'edit',
  description: 'Apply several exact string replacements to one file atomically (all succeed or none are written). Edits apply in order, each to the result of the previous one.',
  parameters: { type: 'object', properties: {
    path: { type: 'string' },
    edits: { type: 'array', items: { type: 'object', properties: {
      old_string: { type: 'string' }, new_string: { type: 'string' }, replace_all: { type: 'boolean' },
    }, required: ['old_string', 'new_string'] } },
  }, required: ['path', 'edits'] },
  summary: (a) => `${a.path} (${(a.edits || []).length} edits)`,
  async run(a, ctx) {
    const p = resolve(ctx, a.path);
    if (!fs.existsSync(p)) throw new Error(`File not found: ${a.path}`);
    const before = fs.readFileSync(p, 'utf8');
    const crlf = before.includes('\r\n');
    let cur = before;
    (a.edits || []).forEach((e, i) => {
      let o = e.old_string, n = e.new_string;
      if (!cur.includes(o) && crlf) { o = o.replace(/\r?\n/g, '\r\n'); n = n.replace(/\r?\n/g, '\r\n'); }
      const count = cur.split(o).length - 1;
      if (!o || count === 0) throw new Error(`Edit ${i + 1}: old_string not found. No changes were written.`);
      if (count > 1 && !e.replace_all) throw new Error(`Edit ${i + 1}: old_string occurs ${count} times; add context or set replace_all. No changes were written.`);
      cur = e.replace_all ? cur.split(o).join(n) : cur.replace(o, () => n);
    });
    ctx.snapshot && ctx.snapshot(p, before);
    fs.writeFileSync(p, cur);
    ctx.touch && ctx.touch(p);
    const diff = lineDiff(before, cur);
    return { output: `Applied ${(a.edits || []).length} edits to ${rel(ctx, p)} (+${diff.added} −${diff.removed}).`, display: { path: rel(ctx, p), diff } };
  },
};

// ---------- list ----------
const list_dir = {
  name: 'list_dir', kind: 'read',
  description: 'List a directory as a tree (ignores node_modules, .git, build output).',
  parameters: { type: 'object', properties: {
    path: { type: 'string' }, depth: { type: 'integer', description: 'Default 2, max 5' },
  } },
  summary: (a) => a.path || '.',
  async run(a, ctx) {
    const root = resolve(ctx, a.path);
    const depth = Math.min(a.depth || 2, 5);
    const out = [];
    let count = 0;
    const walk = (dir, d, prefix) => {
      if (count > 600) return;
      let ents;
      try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      ents.sort((x, y) => (y.isDirectory() - x.isDirectory()) || x.name.localeCompare(y.name));
      for (const e of ents) {
        if (IGNORE.has(e.name)) continue;
        if (++count > 600) { out.push(prefix + '…'); return; }
        if (e.isDirectory()) {
          out.push(`${prefix}${e.name}/`);
          if (d < depth) walk(path.join(dir, e.name), d + 1, prefix + '  ');
        } else {
          let size = '';
          try { size = fmtSize(fs.statSync(path.join(dir, e.name)).size); } catch {}
          out.push(`${prefix}${e.name}  ${size}`);
        }
      }
    };
    walk(root, 1, '');
    return { output: out.join('\n') || '(empty)' };
  },
};
function fmtSize(n) { return n < 1024 ? `${n}B` : n < 1048576 ? `${(n / 1024).toFixed(1)}K` : `${(n / 1048576).toFixed(1)}M`; }

// ---------- glob ----------
function globToRegex(g) {
  let re = '';
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*') {
      if (g[i + 1] === '*') { re += '(?:.*/)?'; i++; if (g[i + 1] === '/') i++; else re += '.*'; }
      else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else if (c === '{') { const end = g.indexOf('}', i); re += '(?:' + g.slice(i + 1, end).split(',').map((s) => s.replace(/[.+^$()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')).join('|') + ')'; i = end; }
    else re += c.replace(/[.+^$()|[\]\\]/g, '\\$&');
  }
  return new RegExp('^' + re + '$', 'i');
}
function walkFiles(root, cb, limit = 50000) {
  let n = 0;
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let ents;
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of ents) {
      if (IGNORE.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (++n > limit || cb(full) === false) return;
    }
  }
}
const glob = {
  name: 'glob', kind: 'read',
  description: 'Find files by glob pattern, e.g. "src/**/*.ts" or "**/*.{js,jsx}". Results sorted by modification time, newest first.',
  parameters: { type: 'object', properties: { pattern: { type: 'string' }, path: { type: 'string' } }, required: ['pattern'] },
  summary: (a) => a.pattern,
  async run(a, ctx) {
    const root = resolve(ctx, a.path);
    const re = globToRegex(a.pattern.replace(/\\/g, '/'));
    const hits = [];
    walkFiles(root, (f) => {
      const r = path.relative(root, f).replace(/\\/g, '/');
      if (re.test(r)) hits.push(f);
    });
    const sorted = hits.map((f) => [f, fs.statSync(f).mtimeMs]).sort((x, y) => y[1] - x[1]).map(([f]) => rel(ctx, f));
    return { output: sorted.slice(0, 300).join('\n') + (sorted.length > 300 ? `\n… ${sorted.length - 300} more` : '') || 'No files matched.', display: { count: sorted.length } };
  },
};

// ---------- grep ----------
let rgAvailable = null;
function hasRg() {
  if (rgAvailable !== null) return Promise.resolve(rgAvailable);
  return new Promise((res) => {
    const p = spawn('rg', ['--version'], { windowsHide: true });
    p.on('error', () => res(rgAvailable = false));
    p.on('close', (c) => res(rgAvailable = c === 0));
  });
}
const grep = {
  name: 'grep', kind: 'read',
  description: 'Search file contents with a regular expression (ripgrep when available). Returns file:line:text matches.',
  parameters: { type: 'object', properties: {
    pattern: { type: 'string' }, path: { type: 'string' },
    glob: { type: 'string', description: 'Filter files, e.g. "*.py"' },
    ignore_case: { type: 'boolean' },
    files_only: { type: 'boolean', description: 'Only list matching files' },
    max_results: { type: 'integer', description: 'Default 200' },
  }, required: ['pattern'] },
  summary: (a) => `/${a.pattern}/` + (a.glob ? ` in ${a.glob}` : ''),
  async run(a, ctx) {
    const root = resolve(ctx, a.path);
    const max = a.max_results || 200;
    if (await hasRg()) {
      const args = ['--no-heading', '--line-number', '--color', 'never', '-M', '400'];
      if (a.ignore_case) args.push('-i');
      if (a.files_only) args.push('-l');
      if (a.glob) args.push('-g', a.glob);
      args.push('-e', a.pattern);
      const isFile = fs.existsSync(root) && fs.statSync(root).isFile();
      args.push(isFile ? root : '.'); // explicit path: with a piped stdin rg would search stdin
      const out = await new Promise((res) => {
        let s = '';
        const p = spawn('rg', args, { windowsHide: true, cwd: isFile ? path.dirname(root) : root, stdio: ['ignore', 'pipe', 'pipe'] });
        p.stdout.on('data', (d) => { s += d; if (s.length > 400000) p.kill(); });
        p.on('close', () => res(s));
        p.on('error', () => res(''));
      });
      const lines = out.split('\n').map((l) => l.replace(/\r$/, '')).filter(Boolean).map((l) => {
        const i = a.files_only ? l.length : l.search(/:\d+:/);
        return i < 0 ? l : l.slice(0, i).replace(/\\/g, '/').replace(/^\.\//, '') + l.slice(i);
      });
      return { output: lines.slice(0, max).join('\n') + (lines.length > max ? `\n… ${lines.length - max} more` : '') || 'No matches.', display: { count: lines.length } };
    }
    const re = new RegExp(a.pattern, a.ignore_case ? 'i' : '');
    const fre = a.glob ? globToRegex(a.glob.includes('/') ? a.glob : '**/' + a.glob) : null;
    const hits = [];
    walkFiles(root, (f) => {
      const r = path.relative(root, f).replace(/\\/g, '/');
      if (fre && !fre.test(r)) return;
      let buf;
      try { buf = fs.readFileSync(f); } catch { return; }
      if (buf.length > 2e6 || isBinary(buf)) return;
      const lines = buf.toString('utf8').split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (re.test(lines[i])) {
          hits.push(a.files_only ? r : `${r}:${i + 1}:${lines[i].slice(0, 400)}`);
          if (a.files_only) break;
        }
      }
      if (hits.length > max * 2) return false;
    });
    return { output: hits.slice(0, max).join('\n') || 'No matches.', display: { count: hits.length } };
  },
};

// ---------- view_image ----------
const view_image = {
  name: 'view_image', kind: 'read', vision: true,
  description: 'Look at an image file (png, jpg, gif, webp). The image is attached to the conversation so you can see it.',
  parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
  summary: (a) => a.path,
  async run(a, ctx) {
    const p = resolve(ctx, a.path);
    const mime = IMAGE_EXT[path.extname(p).toLowerCase()];
    if (!mime) throw new Error('Not a supported image type.');
    const buf = fs.readFileSync(p);
    if (buf.length > 8 * 1048576) throw new Error('Image is larger than 8 MB.');
    const url = `data:${mime};base64,${buf.toString('base64')}`;
    return { output: `Attached ${rel(ctx, p)} (${fmtSize(buf.length)}).`, images: [url], display: { image: url } };
  },
};

module.exports = { read_file, write_file, edit_file, multi_edit, list_dir, glob, grep, view_image, resolve, IMAGE_EXT };
