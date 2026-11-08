// Dev helper: drive a running Vesper (started with --remote-debugging-port=9333) over CDP.
//   node scripts/cdp.js eval "<expression>"
//   node scripts/cdp.js shot out.png
const fs = require('fs');
const [cmd, arg] = process.argv.slice(2);
const port = process.env.CDP_PORT || 9333;

(async () => {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const page = targets.find((t) => t.type === 'page' && t.url.includes('index.html')) || targets.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0;
  const pending = new Map();
  ws.onmessage = (m) => { const j = JSON.parse(m.data); if (pending.has(j.id)) { pending.get(j.id)(j); pending.delete(j.id); } };
  const call = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  if (cmd === 'eval') {
    const r = await call('Runtime.evaluate', { expression: arg, awaitPromise: true, returnByValue: true });
    console.log(JSON.stringify(r.result.result ? r.result.result.value ?? r.result.result.description : r.result, null, 2));
  } else if (cmd === 'reload') {
    await call('Network.enable'); await call('Network.setCacheDisabled', { cacheDisabled: true });
    await call('Page.reload', { ignoreCache: true });
    console.log('reloaded');
  } else if (cmd === 'shot') {
    await call('Page.bringToFront');
    await call('Emulation.setFocusEmulationEnabled', { enabled: true });
    const r = await call('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
    fs.writeFileSync(arg, Buffer.from(r.result.data, 'base64'));
    console.log('saved', arg);
  }
  ws.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
