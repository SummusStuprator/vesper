// Creates a "Vesper" shortcut on the desktop (and Start menu) with Vesper's icon and taskbar identity.
// Run: npm run shortcut          (optional: -- --root <project dir> to point it elsewhere)
const { app, shell } = require('electron');
const path = require('path');

const i = process.argv.indexOf('--root');
const root = path.resolve(i > 0 ? process.argv[i + 1] : path.join(__dirname, '..'));
const link = {
  target: path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe'),
  args: `"${root}"`,
  cwd: root,
  description: 'Vesper — coding agent',
  icon: path.join(root, 'assets', 'icon.ico'),
  iconIndex: 0,
  appUserModelId: 'com.vesper.app',    // must match main.js so pinned icons group correctly
};

app.whenReady().then(() => {
  if (process.platform !== 'win32') { console.log('Shortcuts are Windows-only for now.'); return app.quit(); }
  const places = [
    path.join(app.getPath('desktop'), 'Vesper.lnk'),
    path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Vesper.lnk'),
  ];
  for (const p of places) console.log(shell.writeShortcutLink(p, 'create', link) ? 'created ' : 'FAILED  ', p);
  app.quit();
});
