// Computer use: screenshots via Electron's desktopCapturer, input via a native driver
// (PowerShell + SendInput on Windows, xdotool on Linux, cliclick/osascript on macOS).
const path = require('path');
const { spawn } = require('child_process');

const MAX_W = 1366; // screenshots are scaled to this width; model coordinates live in this space
let lastShot = null; // { w, h, physW, physH, originX, originY }

function primary() {
  const { screen } = require('electron');
  const d = screen.getPrimaryDisplay();
  const sf = d.scaleFactor || 1;
  return { d, sf, physW: Math.round(d.size.width * sf), physH: Math.round(d.size.height * sf) };
}

async function screenshot() {
  const { desktopCapturer } = require('electron');
  const { d, physW, physH } = primary();
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: physW, height: physH } });
  const src = sources.find((s) => String(s.display_id) === String(d.id)) || sources[0];
  if (!src) throw new Error('No screen available to capture.');
  let img = src.thumbnail;
  const size = img.getSize();
  if (size.width > MAX_W) img = img.resize({ width: MAX_W, quality: 'good' });
  const s2 = img.getSize();
  lastShot = { w: s2.width, h: s2.height, physW, physH };
  return { url: 'data:image/jpeg;base64,' + img.toJPEG(78).toString('base64'), w: s2.width, h: s2.height };
}

function toPhysical(x, y) {
  const shot = lastShot || { w: MAX_W, h: Math.round(MAX_W * 9 / 16), ...primary() };
  return { x: Math.round(x * shot.physW / shot.w), y: Math.round(y * shot.physH / shot.h) };
}
function fromPhysical(x, y) {
  const shot = lastShot; if (!shot) return { x, y };
  return { x: Math.round(x * shot.w / shot.physW), y: Math.round(y * shot.h / shot.physH) };
}

function run(bin, args, env) {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { windowsHide: true, env: Object.assign({}, process.env, env) });
    let out = '', err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('error', reject);
    p.on('close', (c) => (c === 0 ? resolve(out.trim()) : reject(new Error((err || out || `exit ${c}`).trim().slice(0, 500)))));
  });
}

async function drive(act) {
  if (process.platform === 'win32') {
    const script = path.join(__dirname, 'computer.ps1').replace('app.asar', 'app.asar.unpacked');
    const env = { VESPER_ACTION: Buffer.from(JSON.stringify(act)).toString('base64') };
    return run('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], env);
  }
  if (process.platform === 'linux') {
    const a = [];
    if (act.x != null) a.push('mousemove', String(act.x), String(act.y));
    const btn = { click: 1, double_click: 1, right_click: 3, middle_click: 2 }[act.action];
    if (btn) a.push('click', ...(act.action === 'double_click' ? ['--repeat', '2'] : []), String(btn));
    if (act.action === 'type') a.push('type', '--delay', '8', act.text);
    if (act.action === 'key') a.push('key', ...act.keys.split(/\s+/).map((k) => k.replace(/ctrl/gi, 'ctrl').replace(/enter/gi, 'Return')));
    if (act.action === 'scroll') a.push('click', '--repeat', String(act.amount || 3), act.direction === 'up' ? '4' : act.direction === 'left' ? '6' : act.direction === 'right' ? '7' : '5');
    if (act.action === 'drag') a.push('mousedown', '1', 'mousemove', String(act.to_x), String(act.to_y), 'mouseup', '1');
    if (a.length) await run('xdotool', a);
    return run('xdotool', ['getmouselocation', '--shell']).then((o) => { const m = o.match(/X=(\d+)\s+Y=(\d+)/); return m ? `${m[1]},${m[2]}` : ''; });
  }
  // macOS: cliclick (brew install cliclick)
  const c = [];
  const pt = act.x != null ? `${act.x},${act.y}` : '.';
  const map = { move: `m:${pt}`, click: `c:${pt}`, double_click: `dc:${pt}`, right_click: `rc:${pt}` };
  if (map[act.action]) c.push(map[act.action]);
  if (act.action === 'type') c.push(`t:${act.text}`);
  if (act.action === 'key') c.push(...act.keys.split(/\s+/).map((k) => `kp:${k.toLowerCase()}`));
  if (act.action === 'drag') c.push(`dd:${pt}`, `du:${act.to_x},${act.to_y}`);
  if (c.length) await run('cliclick', c);
  return run('cliclick', ['p']).catch(() => '');
}

const computer = {
  name: 'computer', kind: 'computer', vision: true,
  description: () => `Control the user's desktop. Actions: screenshot, click, double_click, right_click, middle_click, move, drag (x,y → to_x,to_y), scroll (x,y, direction up|down|left|right, amount), type (text), key (keys, e.g. "ctrl+s", "enter", "alt+tab", several separated by spaces), cursor_position, wait (seconds). Coordinates are pixels in the most recent screenshot (width ≤ ${MAX_W}). Take a screenshot first, and again after acting to verify.`,
  parameters: { type: 'object', properties: {
    action: { type: 'string', enum: ['screenshot', 'click', 'double_click', 'right_click', 'middle_click', 'move', 'drag', 'scroll', 'type', 'key', 'cursor_position', 'wait'] },
    x: { type: 'integer' }, y: { type: 'integer' }, to_x: { type: 'integer' }, to_y: { type: 'integer' },
    text: { type: 'string' }, keys: { type: 'string' },
    direction: { type: 'string', enum: ['up', 'down', 'left', 'right'] }, amount: { type: 'integer' },
    seconds: { type: 'number' },
  }, required: ['action'] },
  summary: (a) => a.action + (a.x != null ? ` (${a.x}, ${a.y})` : '') + (a.text ? ` “${a.text.slice(0, 40)}”` : '') + (a.keys ? ` ${a.keys}` : ''),
  async run(a, ctx) {
    if (a.action === 'screenshot') {
      ctx.beforeScreenshot && await ctx.beforeScreenshot();
      const s = await screenshot();
      ctx.afterScreenshot && ctx.afterScreenshot();
      return { output: `Screenshot ${s.w}×${s.h}.`, images: [s.url], display: { image: s.url } };
    }
    if (a.action === 'wait') {
      await new Promise((r) => setTimeout(r, Math.min(10, a.seconds || 1) * 1000));
      return { output: `Waited ${Math.min(10, a.seconds || 1)}s.` };
    }
    const act = Object.assign({}, a);
    if (a.x != null && a.y != null) Object.assign(act, toPhysical(a.x, a.y));
    if (a.to_x != null && a.to_y != null) { const t = toPhysical(a.to_x, a.to_y); act.to_x = t.x; act.to_y = t.y; }
    if ((a.action === 'drag') && (act.to_x == null)) throw new Error('drag needs to_x and to_y');
    const pos = await drive(act);
    const [px, py] = String(pos).split(',').map(Number);
    const cur = Number.isFinite(px) ? fromPhysical(px, py) : null;
    await new Promise((r) => setTimeout(r, 250));
    return { output: `Done: ${computer.summary(a)}.${cur ? ` Cursor at (${cur.x}, ${cur.y}).` : ''} Take a screenshot to check the result.` };
  },
};

module.exports = { computer, screenshot };
