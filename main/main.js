const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, shell, Notification, screen, session, nativeTheme, clipboard } = require('electron');
const path = require('path');
const store = require('./store');
const { Session, cleanKey, UA } = require('./fp');
const updater = require('./updater');
const automation = require('./automation');

const ROOT = path.join(__dirname, '..');
const ICON = path.join(ROOT, 'assets', process.platform === 'win32' ? 'icon.ico' : 'icon.png');
const isMac = process.platform === 'darwin';

app.setAppUserModelId('online.lumenfp.desktop');
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

let win = null;
let tray = null;
let quitting = false;
const sessions = new Map();

// ---------------------------------------------------------------- FunPay-сессии

function sessionFor(id) {
  if (sessions.has(id)) return sessions.get(id);
  const acc = store.account(id);
  if (!acc) throw new Error('Аккаунт не найден');
  const s = new Session({ gk: store.gk(acc), cookies: acc.cookies, ua: acc.ua }, { onCookies: (cookies) => store.patchAccount(id, { cookies }) });
  sessions.set(id, s);
  return s;
}

const publicAcc = (a) => ({ id: a.id, userId: a.userId, username: a.username, avatar: a.avatar });

async function addAccount(gk, extra = {}) {
  gk = cleanKey(gk);
  if (!/^[A-Za-z0-9]{16,64}$/.test(gk)) throw new Error('Это не похоже на golden_key: нужны 32 латинские буквы и цифры');
  const s = new Session({ gk, cookies: extra.cookies, ua: extra.ua });
  const me = await s.auth(true);
  const acc = store.upsertAccount({ userId: me.userId, username: me.username, avatar: me.avatar, cookies: Object.fromEntries(s.jar), ua: s.ua }, gk);
  sessions.delete(acc.id);
  store.flush();
  return publicAcc(acc);
}

// IPC-ответы оборачиваем, чтобы в интерфейс приходил чистый текст ошибки.
function handle(name, fn) {
  ipcMain.handle(name, async (_e, ...args) => {
    try {
      return { ok: true, data: await fn(...args) };
    } catch (e) {
      return { ok: false, error: String(e && e.message ? e.message : e) };
    }
  });
}

handle('acc:list', () => ({ list: store.accounts().map(publicAcc), active: store.active() }));
handle('acc:add-key', (gk) => addAccount(gk));
handle('acc:add-browser', async () => {
  const r = await loginViaBrowser();
  return addAccount(r.gk, r);
});
handle('acc:remove', async (id) => {
  await automation.detach();
  sessions.delete(id);
  store.removeAccount(id);
  session.fromPartition('persist:fp-' + id).clearStorageData().catch(() => {});
  return true;
});
handle('acc:active', (id) => store.setActive(id));
handle('acc:key', (id) => store.gk(store.account(id)));

handle('fp:auth', async (id, force) => {
  const me = await sessionFor(id).auth(!!force);
  store.patchAccount(id, { username: me.username, avatar: me.avatar });
  return { userId: me.userId, username: me.username, avatar: me.avatar, balance: me.balance, locale: me.locale };
});
const isFunpay = (u) => /^\//.test(u) || /^https:\/\/([a-z0-9-]+\.)*funpay\.com(\/|$)/i.test(u);
handle('fp:req', (id, opts) => {
  if (!isFunpay(String(opts?.url || ''))) throw new Error('Запросы разрешены только к funpay.com');
  return sessionFor(id).request(opts);
});
handle('fp:runner', (id, objects, request) => sessionFor(id).runner(objects, request));
handle('fp:upload', (id, url, file) => {
  if (!isFunpay(String(url))) throw new Error('Запросы разрешены только к funpay.com');
  return sessionFor(id).request({ url, xhr: true, file: { ...file, data: Buffer.from(file.data) } });
});

handle('store:get', (key, def) => store.get(key, def));
handle('store:set', (key, value) => store.set(key, value));

handle('app:clipboard', () => clipboard.readText());

// Украшения ников Lumen FX: список с сервера (как у расширения Lumen). Копия хранится на случай без интернета.
const FX_URL = process.env.LUMEN_FX_URL || 'https://lumenfp.online/fx.json';
let fxCache = { at: 0, data: null };
handle('fx:list', async () => {
  if (fxCache.data && Date.now() - fxCache.at < 5 * 60e3) return fxCache.data;
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 15000);
    const r = await fetch(FX_URL, { signal: ctl.signal, headers: { 'User-Agent': 'Lumen-Desktop' } });
    clearTimeout(t);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const text = await r.text();
    if (text.length > 20e6) throw new Error('слишком большой ответ');
    const data = JSON.parse(text);
    fxCache = { at: Date.now(), data };
    store.set('fxCache', data);
    return data;
  } catch {
    return fxCache.data || store.get('fxCache', null);
  }
});
handle('auto:attach', (id, mode) => automation.attach(id, sessionFor(id), mode));
handle('auto:detach', () => automation.detach());
handle('auto:mode', (mode) => automation.syncMode(mode));
handle('auto:info', () => automation.info());
handle('auto:cfg', (cfg) => automation.setCfg(cfg));
handle('auto:products', (id) => automation.products(id));
handle('auto:setProducts', (id, lines) => automation.setProducts(id, lines));
handle('auto:plugin', (action, id, a, b) => automation.plugin(action, id, a, b));
handle('upd:state', () => updater.state());
handle('upd:check', () => updater.check().then(() => updater.state()));
handle('upd:download', () => updater.download());
handle('upd:install', () => {
  quitting = true;
  store.flush();
  updater.install();
});
handle('upd:releases', () => {
  const u = updater.releasesUrl();
  if (u) shell.openExternal(u);
  return !!u;
});
handle('app:info', () => ({ version: app.getVersion(), platform: process.platform, dataDir: store.dir() }));
handle('app:open', (url) => {
  if (/^https?:\/\//.test(url)) shell.openExternal(url);
});
handle('app:browser', (id, url) => openBrowser(id, url));
handle('app:browserPrep', (id) => prepBrowser(id));
handle('app:notify', (p) => systemNotify(p));
handle('app:toast', (p) => toast(p));
handle('app:badge', (count, dataUrl) => setBadge(count, dataUrl));
handle('app:flash', () => {
  if (win && !win.isFocused()) win.flashFrame(true);
});
handle('app:chrome', (c) => {
  // цвет системных кнопок окна под тему
  if (win) win.setBackgroundColor(c.bg);
});
handle('win:ctl', (a) => {
  if (!win) return false;
  if (a === 'min') win.minimize();
  if (a === 'max') win.isMaximized() ? win.unmaximize() : win.maximize();
  if (a === 'close') win.close();
  return win.isMaximized();
});
handle('app:autostart', (on) => {
  // у portable-версии exe распаковывается во временную папку — в автозапуск пишем сам файл
  const exe = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
  const opts = { path: exe, args: ['--hidden'] };
  if (on !== undefined) app.setLoginItemSettings({ openAtLogin: !!on, ...opts });
  return app.getLoginItemSettings(opts).openAtLogin;
});
handle('app:quit', () => {
  quitting = true;
  app.quit();
});
handle('ai:chat', async (cfg, messages) => {
  const base = String(cfg.base || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const r = await fetch(base + '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.key },
    body: JSON.stringify({ model: cfg.model || 'gpt-4o-mini', messages, temperature: 0.5 }),
    signal: AbortSignal.timeout(40000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error?.message || `ИИ ответил ошибкой (HTTP ${r.status})`);
  return (j.choices?.[0]?.message?.content || '').trim();
});

// ---------------------------------------------------------------- окна

function settings() {
  return store.get('settings', {}) || {};
}

function createWindow() {
  const hidden = process.argv.includes('--hidden') || settings().startMinimized;
  win = new BrowserWindow({
    width: 1320,
    height: 840,
    minWidth: 960,
    minHeight: 620,
    show: false,
    backgroundColor: '#0b0b10',
    icon: ICON,
    title: 'Lumen',
    autoHideMenuBar: true,
    // Windows/Mac — своя шапка (на Windows свои кнопки окна); Linux — обычная рамка
    ...(isMac ? { titleBarStyle: 'hidden', trafficLightPosition: { x: 18, y: 15 } } : process.platform === 'win32' ? { frame: false } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required', // звук уведомлений сразу после запуска, без клика по окну
      spellcheck: true,
      webviewTag: true, // встроенная панель FunPay
    },
  });
  // встроенная панель FunPay: только funpay.com, без доступа к API приложения
  win.webContents.on('will-attach-webview', (e, prefs, params) => {
    delete prefs.preload;
    Object.assign(prefs, { nodeIntegration: false, contextIsolation: true, sandbox: true });
    if (!/^persist:fp-/.test(params.partition || '') || !/^https:\/\/([a-z0-9-]+\.)?funpay\.com\//.test(params.src || '')) e.preventDefault();
  });
  win.loadFile(path.join(ROOT, 'renderer', 'index.html'));
  win.once('ready-to-show', () => {
    if (!hidden) win.show();
  });
  win.on('close', (e) => {
    if (!quitting && settings().tray !== false && !isMac) {
      e.preventDefault();
      win.hide();
    }
  });
  win.on('focus', () => {
    win.flashFrame(false);
    win.webContents.send('app:focus', true);
  });
  win.on('blur', () => win.webContents.send('app:focus', false));
  win.on('maximize', () => win.webContents.send('win:max', true));
  win.on('unmaximize', () => win.webContents.send('win:max', false));
  win.on('closed', () => {
    win = null;
    if (!isMac) {
      quitting = true;
      app.quit();
    }
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.setMenuBarVisibility(false);
  // Правый клик по полю ввода: вырезать / копировать / вставить + исправление опечаток
  win.webContents.on('context-menu', (_e, p) => {
    const items = [];
    for (const w of (p.dictionarySuggestions || []).slice(0, 5)) items.push({ label: w, click: () => win.webContents.replaceMisspelling(w) });
    if (items.length) items.push({ type: 'separator' });
    if (p.isEditable) {
      items.push(
        { role: 'cut', label: 'Вырезать', enabled: p.editFlags.canCut },
        { role: 'copy', label: 'Копировать', enabled: p.editFlags.canCopy },
        { role: 'paste', label: 'Вставить' },
        { type: 'separator' },
        { role: 'selectAll', label: 'Выделить всё' }
      );
    } else if (p.selectionText) items.push({ role: 'copy', label: 'Копировать' });
    if (items.length) Menu.buildFromTemplate(items).popup({ window: win });
  });
}

function showMain(node) {
  if (!win || win.isDestroyed()) {
    createWindow();
    win.show();
    if (node) win.webContents.once('did-finish-load', () => win && setTimeout(() => win.webContents.send('nav:chat', node), 1500));
    return;
  }
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  if (node) win.webContents.send('nav:chat', node);
}

function createTray() {
  const img = nativeImage.createFromPath(path.join(ROOT, 'assets', 'tray.png'));
  tray = new Tray(img.isEmpty() ? nativeImage.createFromPath(ICON) : img);
  tray.setToolTip('Lumen — FunPay');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Открыть Lumen', click: () => showMain() },
      { type: 'separator' },
      {
        label: 'Выйти',
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ])
  );
  tray.on('click', () => showMain());
}

function setBadge(count, dataUrl) {
  if (isMac || process.platform === 'linux') app.setBadgeCount(count);
  if (process.platform === 'win32' && win) {
    win.setOverlayIcon(count > 0 && dataUrl ? nativeImage.createFromDataURL(dataUrl) : null, count > 0 ? `${count} непрочитанных` : '');
  }
  if (tray) tray.setToolTip(count > 0 ? `Lumen — ${count} непрочитанных` : 'Lumen — FunPay');
}

function systemNotify(p) {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title: p.title || 'Lumen', body: p.body || '', silent: true, icon: nativeImage.createFromPath(path.join(ROOT, 'assets', 'icon.png')) });
  n.on('click', () => showMain(p.node));
  n.show();
}

// Свои всплывающие уведомления: окно без рамки ровно по размеру карточек, в углу экрана.
let toastWin = null;
let toastReady = null;
let toastCorner = 'br';
const TW = 400;

function toastWindow() {
  if (toastWin && !toastWin.isDestroyed()) return toastWin;
  toastWin = new BrowserWindow({
    width: TW,
    height: 100,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    show: false,
    hasShadow: false,
    thickFrame: false,
    webPreferences: { preload: path.join(__dirname, 'toast-preload.js'), contextIsolation: true, sandbox: true, backgroundThrottling: false },
  });
  toastWin.setAlwaysOnTop(true, 'screen-saver');
  toastReady = new Promise((r) => toastWin.webContents.once('did-finish-load', r));
  toastWin.loadFile(path.join(ROOT, 'renderer', 'toast.html'));
  toastWin.on('closed', () => (toastWin = null));
  return toastWin;
}

function placeToast(h) {
  if (!toastWin || toastWin.isDestroyed()) return;
  if (h <= 0) return toastWin.hide();
  const wa = screen.getPrimaryDisplay().workArea;
  const x = toastCorner.includes('r') ? wa.x + wa.width - TW - 8 : wa.x + 8;
  const y = toastCorner.includes('b') ? wa.y + wa.height - h - 8 : wa.y + 8;
  toastWin.setBounds({ x: Math.round(x), y: Math.round(y), width: TW, height: Math.ceil(h) });
  if (!toastWin.isVisible()) toastWin.showInactive();
}

async function toast(p) {
  const w = toastWindow();
  await toastReady;
  toastCorner = p.corner || 'br';
  w.webContents.send('toast', p);
}

ipcMain.on('toast:size', (_e, h) => placeToast(+h || 0));
ipcMain.on('toast:mouse', () => {});
ipcMain.on('toast:click', (_e, node) => showMain(node));
ipcMain.on('toast:empty', () => placeToast(0));

// Вход через браузер: обычная страница входа FunPay, ловим куку golden_key.
function loginViaBrowser() {
  return new Promise((resolve, reject) => {
    const part = 'fplogin-' + Date.now();
    const ses = session.fromPartition(part);
    ses.setUserAgent(UA);
    const w = new BrowserWindow({
      width: 520,
      height: 760,
      parent: win || undefined,
      modal: false,
      title: 'Вход в FunPay',
      autoHideMenuBar: true,
      backgroundColor: '#ffffff',
      icon: ICON,
      webPreferences: { partition: part, contextIsolation: true, sandbox: true },
    });
    let done = false;
    const finish = async (gk) => {
      if (done) return;
      done = true;
      await new Promise((r) => setTimeout(r, 900));
      const list = await ses.cookies.get({ domain: 'funpay.com' }).catch(() => []);
      const cookies = {};
      for (const c of list) if (c.name !== 'golden_key') cookies[c.name] = c.value;
      if (!w.isDestroyed()) w.close();
      resolve({ gk, cookies, ua: UA });
    };
    ses.cookies.on('changed', (_e, c, _cause, removed) => {
      if (!removed && c.name === 'golden_key' && c.value) finish(c.value);
    });
    w.on('closed', () => {
      if (!done) reject(new Error('Окно входа закрыто'));
    });
    w.loadURL('https://funpay.com/account/login');
  });
}

// Встроенный браузер с куками аккаунта.
// Сессия браузера FunPay с куками аккаунта (для встроенной панели и отдельного окна)
async function prepBrowser(id) {
  const s = sessionFor(id);
  const part = 'persist:fp-' + id;
  const ses = session.fromPartition(part);
  ses.setUserAgent(s.ua);
  for (const [name, value] of s.cookies()) {
    await ses.cookies.set({ url: 'https://funpay.com', domain: '.funpay.com', name, value, secure: true, httpOnly: name !== 'cookie_prefs', expirationDate: Date.now() / 1000 + 86400 * 30 }).catch(() => {});
  }
  return { partition: part, ua: s.ua };
}

async function openBrowser(id, url) {
  const { partition: part } = await prepBrowser(id);
  const w = new BrowserWindow({
    width: 1200,
    height: 820,
    title: 'FunPay',
    autoHideMenuBar: true,
    icon: ICON,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#111' : '#fff',
    webPreferences: { partition: part, contextIsolation: true, sandbox: true },
  });
  w.webContents.setWindowOpenHandler(({ url: u }) => {
    if (/^https:\/\/([a-z0-9-]+\.)?funpay\.com\//.test(u)) {
      w.loadURL(u);
    } else if (/^https?:\/\//.test(u)) shell.openExternal(u);
    return { action: 'deny' };
  });
  w.loadURL(url || 'https://funpay.com/');
  return true;
}

// ---------------------------------------------------------------- жизненный цикл

app.on('web-contents-created', (_e, wc) => {
  if (wc.getType() !== 'webview') return;
  // ссылки FunPay открываем в той же панели, остальные — в обычном браузере
  wc.setWindowOpenHandler(({ url: u }) => {
    if (/^https:\/\/([a-z0-9-]+\.)?funpay\.com\//.test(u)) wc.loadURL(u);
    else if (/^https?:\/\//.test(u)) shell.openExternal(u);
    return { action: 'deny' };
  });
});
app.on('second-instance', () => showMain());
app.whenReady().then(() => {
  if (!gotLock) return;
  // Скрытое меню только ради горячих клавиш: Ctrl+C / Ctrl+V / Ctrl+X / Ctrl+A / Ctrl+Z
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(isMac ? [{ role: 'appMenu' }] : []),
      { label: 'Правка', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
      { label: 'Вид', submenu: [{ role: 'toggleDevTools', accelerator: 'CmdOrCtrl+Shift+I' }] },
    ])
  );
  createWindow();
  if (!isMac) createTray();
  updater.init((st) => win && !win.isDestroyed() && win.webContents.send('upd:state', st), settings);
  automation.init((ev) => win && !win.isDestroyed() && win.webContents.send('auto:event', ev));
});
app.on('activate', () => gotLock && showMain());
app.on('before-quit', () => {
  quitting = true;
  automation.detach();
  store.flush();
});
app.on('window-all-closed', () => {
  if (!isMac) app.quit();
});
