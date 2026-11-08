// Shell tools: run commands (foreground with live output, or background jobs).
const { spawn, spawnSync } = require('child_process');
const { resolve } = require('./fs');

const isWin = process.platform === 'win32';
let shellBin = null;
function pickShell() {
  if (shellBin) return shellBin;
  if (isWin) {
    const pwsh = spawnSync('pwsh', ['-NoLogo', '-NoProfile', '-Command', '$PSVersionTable.PSVersion.Major'], { windowsHide: true });
    shellBin = pwsh.status === 0
      ? { bin: 'pwsh', args: (c) => ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', c], name: 'PowerShell 7' }
      : { bin: 'powershell.exe', args: (c) => ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', c], name: 'Windows PowerShell' };
  } else {
    const sh = process.env.SHELL || '/bin/bash';
    shellBin = { bin: sh, args: (c) => ['-lc', c], name: sh.split('/').pop() };
  }
  return shellBin;
}

const MAX_OUT = 30000;
function clip(s) {
  if (s.length <= MAX_OUT) return s;
  const head = s.slice(0, MAX_OUT * 0.4), tail = s.slice(-MAX_OUT * 0.6);
  return `${head}\n\n… [${s.length - MAX_OUT} characters omitted] …\n\n${tail}`;
}
const stripAnsi = (s) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');

function killTree(p) {
  if (!p || p.exitCode !== null) return;
  if (isWin) spawn('taskkill', ['/pid', String(p.pid), '/T', '/F'], { windowsHide: true });
  else try { process.kill(-p.pid, 'SIGTERM'); } catch { try { p.kill('SIGTERM'); } catch {} }
}

const jobs = new Map(); // id -> { proc, out, command, startedAt, exitCode }
let jobSeq = 0;

const shell = {
  name: 'shell', kind: 'exec',
  description: () => `Run a command in ${pickShell().name} (${isWin ? 'Windows — use PowerShell syntax' : 'POSIX shell'}). Working directory is the workspace unless cwd is given. Output is captured (stdout+stderr). Set background=true for servers/watchers; then use shell_output to read or stop it.`,
  parameters: { type: 'object', properties: {
    command: { type: 'string' },
    cwd: { type: 'string' },
    timeout_ms: { type: 'integer', description: 'Default 120000, max 600000' },
    background: { type: 'boolean' },
  }, required: ['command'] },
  summary: (a) => a.command,
  async run(a, ctx) {
    const sh = pickShell();
    const cwd = resolve(ctx, a.cwd);
    const proc = spawn(sh.bin, sh.args(a.command), {
      cwd, windowsHide: true, detached: !isWin, stdio: ['ignore', 'pipe', 'pipe'],
      env: Object.assign({}, process.env, { TERM: 'dumb', NO_COLOR: '1', PAGER: 'cat', GIT_PAGER: 'cat' }),
    });
    if (a.background) {
      const id = `job${++jobSeq}`;
      const job = { proc, out: '', command: a.command, startedAt: Date.now(), exitCode: null };
      proc.stdout.on('data', (d) => { job.out = (job.out + d).slice(-200000); });
      proc.stderr.on('data', (d) => { job.out = (job.out + d).slice(-200000); });
      proc.on('close', (c) => { job.exitCode = c; });
      proc.on('error', (e) => { job.out += `\n${e.message}`; job.exitCode = -1; });
      jobs.set(id, job);
      await new Promise((r) => setTimeout(r, 1500));
      return { output: `Started background job ${id} (pid ${proc.pid}).\nInitial output:\n${clip(stripAnsi(job.out)) || '(none yet)'}`, display: { job: id } };
    }
    const timeout = Math.min(a.timeout_ms || 120000, 600000);
    let out = '';
    const onData = (d) => { const s = d.toString(); out += s; ctx.progress && ctx.progress(stripAnsi(s)); };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    const abort = () => killTree(proc);
    ctx.signal && ctx.signal.addEventListener('abort', abort);
    let timedOut = false;
    const t = setTimeout(() => { timedOut = true; killTree(proc); }, timeout);
    const code = await new Promise((res) => {
      proc.on('close', res);
      proc.on('error', (e) => { out += e.message; res(-1); });
    });
    clearTimeout(t);
    ctx.signal && ctx.signal.removeEventListener('abort', abort);
    const body = clip(stripAnsi(out)).trimEnd();
    const tail = timedOut ? `\n[timed out after ${timeout} ms]` : code ? `\n[exit code ${code}]` : '';
    return { output: (body || '(no output)') + tail, display: { exitCode: code, timedOut }, isError: code !== 0 };
  },
};

const shell_output = {
  name: 'shell_output', kind: 'read',
  description: 'Read new output from a background job started with shell(background=true), or stop it.',
  parameters: { type: 'object', properties: {
    job: { type: 'string' }, stop: { type: 'boolean' },
  }, required: ['job'] },
  summary: (a) => `${a.stop ? 'stop' : 'read'} ${a.job}`,
  async run(a) {
    const j = jobs.get(a.job);
    if (!j) return { output: `No job ${a.job}. Jobs: ${[...jobs.keys()].join(', ') || 'none'}` };
    if (a.stop) { killTree(j.proc); }
    const out = j.out; j.out = '';
    const state = a.stop ? 'stopped' : j.exitCode === null ? 'running' : `exited (${j.exitCode})`;
    return { output: `[${a.job} ${state}]\n${clip(stripAnsi(out)) || '(no new output)'}` };
  },
};

function killAllJobs() { for (const j of jobs.values()) killTree(j.proc); }

module.exports = { shell, shell_output, killAllJobs, pickShell };
