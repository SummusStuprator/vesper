// Renders assets/icon.svg to PNGs and a multi-size ICO.  Run: npx electron scripts/make-icons.js
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const ASSETS = path.join(__dirname, '..', 'assets');
const SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256];

function ico(pngs) {
  // ICO with PNG-compressed entries (supported since Vista).
  const head = Buffer.alloc(6 + 16 * pngs.length);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(pngs.length, 4);
  let offset = head.length;
  pngs.forEach(({ size, buf }, i) => {
    const o = 6 + 16 * i;
    head.writeUInt8(size >= 256 ? 0 : size, o);
    head.writeUInt8(size >= 256 ? 0 : size, o + 1);
    head.writeUInt8(0, o + 2); head.writeUInt8(0, o + 3);
    head.writeUInt16LE(1, o + 4); head.writeUInt16LE(32, o + 6);
    head.writeUInt32LE(buf.length, o + 8); head.writeUInt32LE(offset, o + 12);
    offset += buf.length;
  });
  return Buffer.concat([head, ...pngs.map(p => p.buf)]);
}

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const svg = fs.readFileSync(path.join(ASSETS, 'icon.svg'), 'utf8');
  const win = new BrowserWindow({ show: false, width: 1024, height: 1024, transparent: true, frame: false,
    webPreferences: { offscreen: true } });
  const html = `<html><body style="margin:0;background:transparent"><img id=i src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}"></body></html>`;
  await win.loadURL('data:text/html;base64,' + Buffer.from(html).toString('base64'));
  const out = [];
  for (const size of [1024, ...SIZES]) {
    // Rasterise directly at each size (crisper than downscaling one bitmap).
    const dataUrl = await win.webContents.executeJavaScript(`(async () => {
      const img = document.getElementById('i'); await img.decode();
      const c = document.createElement('canvas'); c.width = c.height = ${size};
      const g = c.getContext('2d'); g.imageSmoothingQuality = 'high';
      g.drawImage(img, 0, 0, ${size}, ${size});
      return c.toDataURL('image/png');
    })()`);
    const buf = Buffer.from(dataUrl.split(',')[1], 'base64');
    if (size === 1024) fs.writeFileSync(path.join(ASSETS, 'icon-1024.png'), buf);
    else out.push({ size, buf });
    if (size === 256) fs.writeFileSync(path.join(ASSETS, 'icon.png'), buf);
  }
  fs.writeFileSync(path.join(ASSETS, 'icon.ico'), ico(out));
  console.log('wrote icon.png, icon-1024.png, icon.ico (' + SIZES.join(',') + ')');
  app.quit();
});
