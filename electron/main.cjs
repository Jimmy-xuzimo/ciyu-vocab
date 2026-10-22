const { app, BrowserWindow, protocol, session, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');

// A stable secure origin keeps localStorage across launches without a random port.
protocol.registerSchemesAsPrivileged([{ scheme: 'lexiday', privileges: {
  standard: true, secure: true, supportFetchAPI: true, corsEnabled: true,
} }]);
const contentTypes = { '.css': 'text/css', '.html': 'text/html', '.ico': 'image/x-icon', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const securityHeaders = {
  'Content-Security-Policy': "default-src 'self'; base-uri 'self'; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:",
  'X-Content-Type-Options': 'nosniff',
};
function openExternal(url) {
  try {
    const target = new URL(url);
    if (target.protocol === 'https:' && ['github.com', 'jimmy-xuzimo.github.io'].includes(target.hostname)) shell.openExternal(target.href);
  } catch { /* Ignore malformed navigation. */ }
}
async function createWindow() {
  const webRoot = path.resolve(app.getAppPath(), 'dist');
  const window = new BrowserWindow({
    width: 1280, height: 860, minWidth: 780, minHeight: 560,
    backgroundColor: '#f5f7f4', icon: path.join(webRoot, 'favicon.ico'), title: '词屿 · 英语单词学习',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true },
  });
  window.removeMenu();
  window.webContents.setWindowOpenHandler(({ url }) => { openExternal(url); return { action: 'deny' }; });
  window.webContents.on('will-navigate', (event, url) => {
    if (url !== 'lexiday://app/') { event.preventDefault(); openExternal(url); }
  });
  await window.loadURL('lexiday://app/');
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    const window = BrowserWindow.getAllWindows()[0];
    if (window) { if (window.isMinimized()) window.restore(); window.focus(); }
  });
  app.whenReady().then(async () => {
    const webRoot = path.resolve(app.getAppPath(), 'dist');
    protocol.handle('lexiday', async (request) => {
      const url = new URL(request.url);
      if (url.hostname !== 'app' || !['GET', 'HEAD'].includes(request.method)) return new Response('Forbidden', { status: 403 });
      let pathname;
      try { pathname = decodeURIComponent(url.pathname); } catch { return new Response('Bad request', { status: 400 }); }
      const target = path.resolve(webRoot, `.${pathname === '/' ? '/index.html' : pathname}`);
      if (!target.startsWith(`${webRoot}${path.sep}`)) return new Response('Forbidden', { status: 403 });
      try {
        const data = await fs.readFile(target);
        return new Response(request.method === 'HEAD' ? null : new Uint8Array(data), { headers: {
          ...securityHeaders, 'Content-Type': contentTypes[path.extname(target)] || 'application/octet-stream',
        } });
      } catch { return new Response('Not found', { status: 404 }); }
    });
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    await createWindow();
  }).catch((error) => { console.error('Unable to start 词屿:', error); app.quit(); });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
}
