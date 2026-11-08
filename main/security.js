// Privacy & security: permission policy, secret redaction, sensitive-path and
// dangerous-command guards, domain rules, untrusted-content wrapping, audit log.
const fs = require('fs');
const os = require('os');
const path = require('path');

const HOME = os.homedir();

const DEFAULT_SECURITY = {
  redactSecrets: true,
  protectSensitivePaths: true,
  confineWrites: true,
  guardCommands: true,
  wrapUntrusted: true,
  auditLog: true,
  encryptSessions: false,
  allowedDomains: [],
  blockedDomains: [],
  sensitivePaths: [
    '~/.ssh', '~/.aws', '~/.gnupg', '~/.azure', '~/.kube', '~/.config/gcloud', '~/.docker/config.json',
    '~/.netrc', '~/.npmrc', '~/.pypirc', '~/.git-credentials', '~/.password-store', '~/.vault-token',
    '~/AppData/Local/Google/Chrome/User Data', '~/AppData/Local/Microsoft/Edge/User Data',
    '~/AppData/Roaming/Mozilla/Firefox/Profiles', '~/AppData/Local/BraveSoftware',
    '~/Library/Keychains', '~/Library/Application Support/Google/Chrome',
    '**/.env', '**/.env.*', '**/*.pem', '**/*.key', '**/*.p12', '**/*.pfx', '**/id_rsa*', '**/id_ed25519*', '**/id_ecdsa*', '**/*.kdbx',
  ],
};

// ---------------------------------------------------------------- permission modes

const MODES = {
  plan: { label: 'Plan', desc: 'Read-only. Vesper investigates and proposes; nothing is changed.' },
  ask: { label: 'Ask', desc: 'Approve every edit, command and desktop action.' },
  edits: { label: 'Auto-edit', desc: 'Edits inside the workspace apply; commands still ask.' },
  auto: { label: 'Auto', desc: 'Runs on its own; guards still stop risky commands, secrets and out-of-workspace writes.' },
  full: { label: 'Full access', desc: 'No prompts and no guards. Vesper can do anything your user account can.' },
};

// ---------------------------------------------------------------- secrets

const SECRET_PATTERNS = [
  ['Refuseless key', /\babl_[A-Za-z0-9_\-]{16,}/g],
  ['Anthropic key', /\bsk-ant-[A-Za-z0-9_\-]{20,}/g],
  ['OpenAI-style key', /\bsk-(?:proj-|live-|test-)?[A-Za-z0-9_\-]{20,}/g],
  ['GitHub token', /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}|\bgithub_pat_[A-Za-z0-9_]{40,}/g],
  ['AWS access key', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g],
  ['Google API key', /\bAIza[0-9A-Za-z_\-]{35}\b/g],
  ['Slack token', /\bxox[abprs]-[A-Za-z0-9\-]{10,}/g],
  ['Stripe key', /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{20,}/g],
  ['Hugging Face token', /\bhf_[A-Za-z0-9]{30,}/g],
  ['private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g],
  ['JWT', /\beyJ[A-Za-z0-9_\-]{10,}\.eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}/g],
  ['connection string password', /\b([a-z][a-z0-9+.\-]*:\/\/[^:\s/]+:)([^@\s]{4,})(@)/gi],
  // Quoted literals assigned to secret-looking names (code, JSON, YAML)…
  ['assigned secret', /\b((?:api[_-]?key|secret|access[_-]?token|auth[_-]?token|token|passw(?:or)?d|client[_-]?secret)["']?\s*[:=]\s*["'])([^"'\s]{8,})(?=["'])/gi],
  // …and dotenv-style lines (KEY=value).
  ['assigned secret', /^((?:export\s+)?[A-Z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIALS?)[A-Z0-9_]*\s*=\s*["']?)([^\s"'#]{8,})/gm],
];

function redact(text, extraSecrets = []) {
  if (!text || typeof text !== 'string') return { text, count: 0, kinds: [] };
  let count = 0;
  const kinds = new Set();
  let out = text;
  for (const s of extraSecrets) {
    if (s && s.length >= 8 && out.includes(s)) { out = out.split(s).join('[REDACTED:configured-key]'); count++; kinds.add('configured key'); }
  }
  for (const [kind, re] of SECRET_PATTERNS) {
    out = out.replace(re, (...m) => {
      count++; kinds.add(kind);
      if (kind === 'connection string password') return `${m[1]}[REDACTED]${m[3]}`;
      if (kind === 'assigned secret') return `${m[1]}[REDACTED]`;
      return `[REDACTED:${kind}]`;
    });
  }
  return { text: out, count, kinds: [...kinds] };
}

// ---------------------------------------------------------------- paths

const norm = (p) => path.resolve(String(p).replace(/^~(?=$|[\\/])/, HOME)).replace(/\\/g, '/').toLowerCase();

function globRe(pattern) {
  const g = pattern.replace(/^~(?=$|[\\/])/, HOME).replace(/\\/g, '/').toLowerCase();
  let re = '';
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*') { if (g[i + 1] === '*') { re += '.*'; i++; if (g[i + 1] === '/') i++; } else re += '[^/]*'; }
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^$()|[\]{}\\]/g, '\\$&');
  }
  return new RegExp('^' + re + '(?:/.*)?$');
}

function sensitiveMatch(absPath, sec) {
  if (!sec.protectSensitivePaths) return null;
  const p = norm(absPath);
  for (const pat of sec.sensitivePaths || []) {
    if (globRe(pat).test(p)) return pat;
  }
  return null;
}

function outsideWorkspace(absPath, ws) {
  const p = norm(absPath), w = norm(ws);
  return !(p === w || p.startsWith(w.endsWith('/') ? w : w + '/'));
}

// ---------------------------------------------------------------- commands

const DANGEROUS = [
  [/\brm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r|--recursive\s+--force|--force\s+--recursive)\b/i, 'recursive force delete'],
  [/\bRemove-Item\b[^|;\n]*-Recurse\b/i, 'recursive delete'],
  [/\b(rd|rmdir)\s+\/s\b/i, 'recursive directory delete'],
  [/\bdel\s+[^|\n]*\/[sq]\b/i, 'bulk delete'],
  [/\b(format(\.com)?\s+[a-z]:|mkfs(\.\w+)?|diskpart|fdisk|parted)\b/i, 'disk formatting / partitioning'],
  [/\bdd\b[^\n]*\bof=\/dev\//i, 'raw disk write'],
  [/\bgit\s+push\b[^\n]*(--force\b|-f\b|--force-with-lease)/i, 'force push'],
  [/\bgit\s+(reset\s+--hard|clean\s+-[a-z]*f|checkout\s+--\s+\.|branch\s+-D|filter-branch|filter-repo)\b/i, 'destructive git operation'],
  [/\b(curl|wget|iwr|Invoke-WebRequest|irm|Invoke-RestMethod)\b[^\n|]*\|\s*(sh|bash|zsh|python\d?|node|iex|Invoke-Expression|pwsh|powershell)\b/i, 'pipes a download into a shell'],
  [/\b(iex|Invoke-Expression)\b[^\n]*(DownloadString|iwr|irm|Invoke-WebRequest|Invoke-RestMethod)/i, 'executes downloaded code'],
  [/\breg(\.exe)?\s+(delete|add)\b|\bRemove-ItemProperty\b[^\n]*HK(LM|CU)/i, 'registry modification'],
  [/\bSet-ExecutionPolicy\b|\bbcdedit\b|\bvssadmin\s+delete\b|\bcipher\s+\/w\b|\bwevtutil\s+cl\b/i, 'system configuration change'],
  [/\bnetsh\s+(advfirewall|firewall)\b|\bSet-MpPreference\b|\bDisable-WindowsOptionalFeature\b/i, 'security configuration change'],
  [/\b(shutdown|reboot|halt|poweroff|Stop-Computer|Restart-Computer)\b/i, 'shuts down or restarts the machine'],
  [/\bchmod\s+(-R\s+)?[0-7]*777\b|\bchown\s+-R\b|\bicacls\b[^\n]*\/grant/i, 'broad permission change'],
  [/:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/, 'fork bomb'],
  [/\b(npm|pnpm|yarn)\s+publish\b|\bcargo\s+publish\b|\btwine\s+upload\b|\bgh\s+release\s+create\b/i, 'publishes a package'],
  [/\bdocker\s+(system\s+prune|rm\s+-f|volume\s+rm)\b/i, 'removes containers or volumes'],
  [/\b(DROP\s+(DATABASE|TABLE|SCHEMA)|TRUNCATE\s+TABLE)\b/i, 'drops database objects'],
  [/\bkill\s+-9\s+-1\b|\btaskkill\b[^\n]*\/IM\b|\bStop-Process\b[^\n]*-Name\b|\bpkill\b|\bkillall\b/i, 'kills processes by name'],
  [/\bsudo\b|\brunas\b|\bStart-Process\b[^\n]*-Verb\s+RunAs/i, 'elevated privileges'],
  [/\b(crontab\s+-r|schtasks\s+\/(create|delete)|Register-ScheduledTask|Unregister-ScheduledTask)\b/i, 'modifies scheduled tasks'],
  [/(\.ssh[\\/]|\.aws[\\/]credentials|id_rsa|id_ed25519|\.git-credentials|\.netrc|Login Data|\bcookies\.sqlite\b)/i, 'touches credentials'],
];

function dangerousCommand(cmd) {
  for (const [re, why] of DANGEROUS) if (re.test(cmd)) return why;
  return null;
}

// ---------------------------------------------------------------- domains

function hostOf(url) { try { return new URL(/^https?:/i.test(url) ? url : 'https://' + url).hostname.toLowerCase(); } catch { return ''; } }
const domainMatch = (host, d) => { d = d.toLowerCase().replace(/^\*?\./, ''); return host === d || host.endsWith('.' + d); };

function domainVerdict(url, sec) {
  const host = hostOf(url);
  if (!host) return { ok: false, reason: 'invalid URL' };
  if ((sec.blockedDomains || []).some((d) => domainMatch(host, d))) return { ok: false, reason: `${host} is on your blocked-domains list` };
  if ((sec.allowedDomains || []).length && !sec.allowedDomains.some((d) => domainMatch(host, d))) return { ok: false, reason: `${host} is not on your allowed-domains list` };
  return { ok: true };
}

// ---------------------------------------------------------------- policy

const PATH_TOOLS = new Set(['read_file', 'write_file', 'edit_file', 'multi_edit', 'list_dir', 'glob', 'grep', 'view_image']);
const WRITE_TOOLS = new Set(['write_file', 'edit_file', 'multi_edit']);

/**
 * Decide whether a tool call may run.
 * returns { action: 'allow' | 'ask' | 'deny', reason?, guard? }
 */
function decide({ tool, args, mode, allowed, workspace, sec, resolvePath }) {
  const kind = tool.kind;
  if (kind === 'net' && args && args.url) {
    const v = domainVerdict(args.url, sec);
    if (!v.ok) return { action: 'deny', reason: v.reason };
  }
  if (mode === 'full') return { action: 'allow' };

  if (mode === 'plan' && ['edit', 'exec', 'computer'].includes(kind)) {
    return { action: 'deny', reason: 'Plan mode is read-only. Describe the change instead of making it; the user can switch modes to apply it.' };
  }

  // Guards (apply in every mode except full, and override "always allow").
  let guard = null;
  if (PATH_TOOLS.has(tool.name) && args) {
    const p = resolvePath(args.path || '.');
    const s = sensitiveMatch(p, sec);
    if (s) guard = `touches a protected path (${s})`;
    else if (WRITE_TOOLS.has(tool.name) && sec.confineWrites && outsideWorkspace(p, workspace)) guard = 'writes outside the workspace';
  }
  if (tool.name === 'shell' && sec.guardCommands && args && args.command) {
    const why = dangerousCommand(args.command);
    if (why) guard = `risky command: ${why}`;
  }
  if (!guard && tool.name === 'shell' && sec.confineWrites && args && args.cwd) {
    const c = resolvePath(args.cwd);
    if (outsideWorkspace(c, workspace)) guard = 'runs outside the workspace';
    else { const s2 = sensitiveMatch(c, sec); if (s2) guard = `runs in a protected path (${s2})`; }
  }
  if (guard) return { action: 'ask', reason: guard, guard: true };

  if (allowed && allowed.has(tool.name)) return { action: 'allow' };
  if (['read', 'net', 'meta'].includes(kind)) return { action: 'allow' };
  if (mode === 'auto') return { action: 'allow' };
  if (mode === 'edits' && kind === 'edit') return { action: 'allow' };
  return { action: 'ask' };
}

function wrapUntrusted(source, text, sec) {
  if (!sec.wrapUntrusted) return text;
  const safe = String(text).replace(/<\/?untrusted_content[^>]*>/gi, '[tag removed]');
  return `<untrusted_content source="${source}">\n${safe}\n</untrusted_content>`;
}

// ---------------------------------------------------------------- audit

let auditPath = null;
function initAudit(dir) { auditPath = path.join(dir, 'audit.log'); }
function audit(entry, sec) {
  if (!sec.auditLog || !auditPath) return;
  try {
    const line = JSON.stringify(Object.assign({ ts: new Date().toISOString() }, entry));
    fs.appendFileSync(auditPath, redact(line).text + '\n');
    const st = fs.statSync(auditPath);
    if (st.size > 5 * 1048576) { // keep the newest ~2.5 MB
      const buf = fs.readFileSync(auditPath, 'utf8');
      fs.writeFileSync(auditPath, buf.slice(buf.indexOf('\n', buf.length / 2) + 1));
    }
  } catch {}
}
function readAudit(limit = 300) {
  try {
    const lines = fs.readFileSync(auditPath, 'utf8').trim().split('\n');
    return lines.slice(-limit).reverse().map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}
function clearAudit() { try { fs.unlinkSync(auditPath); } catch {} }

module.exports = { DEFAULT_SECURITY, MODES, redact, sensitiveMatch, outsideWorkspace, dangerousCommand, domainVerdict, decide, wrapUntrusted, initAudit, audit, readAudit, clearAudit };
