// Runs inside the embedded refuseless.com signup view (sandboxed, isolated world).
// Watches the page for a freshly created API key (abl_…) and hands it to setup.
// Only the matched key string crosses back; the page gets no access to Vesper.
const { ipcRenderer } = require('electron');

const KEY = /\babl_[A-Za-z0-9_\-]{16,}\b/;
let reported = false;

function report(k) {
  if (reported || !k) return;
  reported = true;
  ipcRenderer.send('signup:key-found', k);
  const d = document.createElement('div');
  d.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147483647;' +
    'background:#141414;color:#f4f2ec;border:1px solid #2a2a2a;border-radius:12px;padding:12px 18px;' +
    'font:500 13px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif;box-shadow:0 10px 40px rgba(0,0,0,.4);' +
    'display:flex;gap:10px;align-items:center';
  d.innerHTML = '<span style="width:8px;height:8px;border-radius:50%;background:#3ccf7a;display:inline-block"></span>' +
    'Key detected — Vesper filled it in for you.';
  (document.body || document.documentElement).appendChild(d);
}

function valueOf(el) {
  return el.value || el.getAttribute('data-clipboard-text') || el.getAttribute('data-value') || el.textContent || '';
}

function scan() {
  if (reported || !document.body) return;
  const cands = document.querySelectorAll('input, textarea, code, pre, kbd, [data-clipboard-text], [data-value], .font-mono, td, span');
  for (let i = 0; i < cands.length && i < 800; i++) {
    const m = String(valueOf(cands[i])).match(KEY);
    if (m) return report(m[0]);
  }
  const t = document.body.innerText;
  if (t && t.length < 500000) { const m = t.match(KEY); if (m) report(m[0]); }
}

// Copy buttons usually write the key to the clipboard: catch that too.
document.addEventListener('copy', () => {
  setTimeout(() => { const s = String(window.getSelection() || ''); const m = s.match(KEY); if (m) report(m[0]); }, 0);
}, true);

function arm() {
  if (!document.documentElement) return setTimeout(arm, 50);
  new MutationObserver(() => { clearTimeout(arm.t); arm.t = setTimeout(scan, 150); })
    .observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['value', 'data-clipboard-text'] });
  scan();
  setInterval(scan, 1500);
}
arm();
