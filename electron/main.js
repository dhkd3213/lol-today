const { app, BrowserWindow, Menu, shell, Tray, nativeImage, Notification, ipcMain } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const net = require('net');
const fs = require('fs');

const PORT = 8765;
const isDev = !app.isPackaged;

let mainWindow = null;
let splash = null;
let serverProc = null;
let tray = null;

function log(...args) {
  console.log('[lol-today]', ...args);
}

function backendExecutable() {
  if (isDev) {
    return { cmd: process.platform === 'win32' ? 'python' : 'python3', args: ['-m', 'cli', '--no-browser', '--port', String(PORT)], cwd: path.join(__dirname, '..') };
  }
  const exeName = process.platform === 'win32' ? 'lol-today-server.exe' : 'lol-today-server';
  const exePath = path.join(process.resourcesPath, 'backend', exeName);
  return { cmd: exePath, args: ['--no-browser', '--port', String(PORT)], cwd: path.dirname(exePath) };
}

function startBackend() {
  const { cmd, args, cwd } = backendExecutable();
  log('spawning backend:', cmd, args.join(' '));
  serverProc = spawn(cmd, args, { cwd, stdio: 'pipe', windowsHide: true });
  serverProc.stdout.on('data', (d) => log('[py]', d.toString().trim()));
  serverProc.stderr.on('data', (d) => log('[py-err]', d.toString().trim()));
  serverProc.on('exit', (code) => log('backend exited:', code));
}

function waitForPort(port, attempts = 50) {
  return new Promise((resolve, reject) => {
    let tries = 0;
    const tick = () => {
      const sock = new net.Socket();
      sock.setTimeout(400);
      sock.once('connect', () => { sock.destroy(); resolve(); });
      sock.once('error', () => { sock.destroy(); retry(); });
      sock.once('timeout', () => { sock.destroy(); retry(); });
      sock.connect(port, '127.0.0.1');
    };
    const retry = () => {
      if (++tries >= attempts) reject(new Error('backend timeout'));
      else setTimeout(tick, 300);
    };
    tick();
  });
}

function createSplash() {
  splash = new BrowserWindow({
    width: 420,
    height: 260,
    frame: false,
    resizable: false,
    transparent: true,
    alwaysOnTop: true,
    show: true,
    webPreferences: { contextIsolation: true },
  });
  splash.loadFile(path.join(__dirname, 'splash.html'));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#0a1420',
    show: false,
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    title: '칼바람 딜량 내기 정산기',
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });

  mainWindow.loadURL(`http://127.0.0.1:${PORT}/`);

  mainWindow.once('ready-to-show', () => {
    if (splash) { splash.destroy(); splash = null; }
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

function buildMenu() {
  const template = [
    {
      label: '파일',
      submenu: [
        { role: 'reload', label: '새로고침' },
        { type: 'separator' },
        { role: 'quit', label: '종료' },
      ],
    },
    {
      label: '보기',
      submenu: [
        { role: 'togglefullscreen', label: '전체화면' },
        { role: 'toggleDevTools', label: '개발자 도구' },
      ],
    },
    {
      label: '도움말',
      submenu: [
        {
          label: 'GitHub',
          click: () => shell.openExternal('https://github.com/dhkd3213/lol-today'),
        },
        {
          label: '버전',
          click: () => {
            const { dialog } = require('electron');
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: '정보',
              message: '칼바람 딜량 내기 정산기',
              detail: `버전 ${app.getVersion()}\nElectron ${process.versions.electron}\n\nMade with ♥ by dhkd3213`,
            });
          },
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function setupTray() {
  const iconPath = path.join(__dirname, '..', 'assets', 'icon.png');
  if (!fs.existsSync(iconPath)) return;
  try {
    tray = new Tray(nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 }));
    tray.setToolTip('칼바람 딜량 내기 정산기');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: '열기', click: () => mainWindow?.show() },
      { type: 'separator' },
      { role: 'quit', label: '종료' },
    ]));
    tray.on('click', () => { if (mainWindow) { mainWindow.isVisible() ? mainWindow.focus() : mainWindow.show(); } });
  } catch (e) {
    log('tray setup failed:', e.message);
  }
}

app.whenReady().then(async () => {
  buildMenu();
  createSplash();
  startBackend();
  try {
    await waitForPort(PORT);
    createWindow();
    setupTray();
  } catch (e) {
    log('failed to start:', e);
    const { dialog } = require('electron');
    dialog.showErrorBox('시작 실패', '백엔드 서버를 시작할 수 없습니다.\n\n' + e.message);
    app.quit();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (serverProc && !serverProc.killed) {
    try { serverProc.kill(); } catch (_) { /* ignore */ }
  }
});

ipcMain.on('notify', (_e, { title, body }) => {
  if (Notification.isSupported()) {
    new Notification({ title, body }).show();
  }
});
