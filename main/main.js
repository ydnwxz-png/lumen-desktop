const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, shell, Notification, screen, session, nativeTheme, clipboard, protocol } = require('electron');
const fs = require('fs');
const path = require('path');
const store = require('./store');
const { Session, cleanKey, UA } = require('./fp');
const updater = require('./updater');
const automation = require('./automation');

const ROOT = path.join(__dirname, '..');
const ICON = path.join(ROOT, 'assets', process.platform === 'win32' ? 'icon.ico' : 'icon.png');
const isMac = process.platform === 'darwin';

app.setAppUserModelId('online.lumenfp.desktop');
// Страницы плагинов открываются по адресу lumen-plugin://<id>/ — отдельно от окна приложения
protocol.registerSchemesAsPrivileged([{ scheme: 'lumen-plugin', privileges: { standard: true, secure: true, supportFetchAPI: false } }]);
// «Не нагружать видеокарту» (для игр): Lumen рисуется процессором, видеокарта целиком остаётся игре.
// Читается до запуска окна, поэтому меняется только с перезапуском.
try {
  if ((store.get('settings', {}) || {}).noGpu) app.disableHardwareAcceleration();
} catch {}

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
  automation.forgetAccount(id);
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
handle('fp:support', (id, p) => sessionFor(id).supportTicket({ orders: p?.orders, text: p?.text }));
handle('fp:runner', (id, objects, request) => sessionFor(id).runner(objects, request));
handle('fp:upload', (id, url, file) => {
  if (!isFunpay(String(url))) throw new Error('Запросы разрешены только к funpay.com');
  return sessionFor(id).request({ url, xhr: true, file: { ...file, data: Buffer.from(file.data) } });
});

handle('store:get', (key, def) => store.get(key, def));
handle('store:set', (key, value) => store.set(key, value));

handle('app:clipboard', () => clipboard.readText());
handle('app:copy', (t) => (clipboard.writeText(String(t ?? '')), true));

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
// Общий чат Lumen и «онлайн»: тот же сервер, что у расширения и приложения на телефон.
const LUMEN_API = process.env.LUMEN_API || 'https://lumenfp.online';
function lumenIid() {
  let iid = store.get('lumenIid', '');
  if (!/^[a-z0-9]{20}$/.test(iid)) {
    iid = Array.from(require('crypto').randomBytes(20), (x) => 'abcdefghijklmnopqrstuvwxyz0123456789'[x % 36]).join('');
    store.set('lumenIid', iid);
  }
  return iid;
}
handle('lumen:api', async (p, method, body) => {
  p = String(p || '');
  if (!/^\/api\/(chat(\/(login|me|send))?|online)(\?|$)/.test(p)) throw new Error('bad path');
  let url = LUMEN_API + p;
  if (/^\/api\/(chat|online)(\?|$)/.test(p)) url += (p.includes('?') ? '&' : '?') + 'i=' + lumenIid() + '&c=desk';
  const post = method === 'POST';
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 15000);
  try {
    const r = await fetch(url, {
      method: post ? 'POST' : 'GET', signal: ctl.signal,
      headers: Object.assign({ 'User-Agent': 'Lumen-Desktop' }, post ? { 'Content-Type': 'application/json' } : {}),
      body: post ? JSON.stringify(Object.assign({ c: 'desk' }, body || {})) : undefined,
    });
    const j = await r.json().catch(() => null);
    return { status: r.status, j };
  } finally {
    clearTimeout(t);
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
// «Что нового» — один раз после обновления: раздел CHANGELOG.md для текущей версии
handle('app:whatsNew', () => {
  const v = app.getVersion();
  const seen = store.get('seenVersion', '');
  if (seen === v) return null;
  store.set('seenVersion', v);
  if (!seen && !store.accounts().length) return null;   // самый первый запуск — без окна
  try {
    const md = fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8');
    const m = md.split(/^## /m).find((x) => x.startsWith(v));
    const notes = m ? m.split('\n').slice(1).join('\n').trim() : '';
    return notes ? { version: v, notes } : null;
  } catch {
    return null;
  }
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
// Перевод RU → EN для лотов (бесплатный переводчик Google)
handle('tr:en', async (text) => {
  const r = await fetch('https://translate.googleapis.com/translate_a/single?client=gtx&sl=ru&tl=en&dt=t', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body: 'q=' + encodeURIComponent(String(text || '')),
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw new Error(`Переводчик не ответил (HTTP ${r.status})`);
  const j = await r.json();
  return (j?.[0] || []).map((x) => x?.[0] || '').join('');
});
// Перевод в обе стороны (RU ⇄ EN) для редактора лота
handle('tr:x', async (text, sl, tl) => {
  const L = /^(ru|en|auto)$/;
  sl = L.test(sl) ? sl : 'auto';
  tl = /^(ru|en)$/.test(tl) ? tl : 'en';
  const src = String(text || '');
  if (!src.trim()) return '';
  // длинный текст — кусками по строкам, чтобы переводчик не обрезал
  const chunks = [];
  let cur = '';
  for (const ln of src.split('\n')) {
    if (cur && (cur + '\n' + ln).length > 1500) (chunks.push(cur), (cur = ln));
    else cur = cur ? cur + '\n' + ln : ln;
  }
  if (cur) chunks.push(cur);
  const out = [];
  for (const c of chunks) {
    if (!c.trim()) {
      out.push(c);
      continue;
    }
    const r = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sl}&tl=${tl}&dt=t`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: 'q=' + encodeURIComponent(c),
      signal: AbortSignal.timeout(20000),
    });
    if (!r.ok) throw new Error(`Переводчик не ответил (HTTP ${r.status})`);
    const j = await r.json();
    out.push((j?.[0] || []).map((x) => x?.[0] || '').join(''));
  }
  return out.join('\n');
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
  clearTimeout(toastKill);
  const w = toastWindow();
  await toastReady;
  toastCorner = p.corner || 'br';
  w.webContents.send('toast', p);
}

ipcMain.on('toast:size', (_e, h) => placeToast(+h || 0));
ipcMain.on('toast:mouse', () => {});
ipcMain.on('toast:click', (_e, node) => showMain(node));
let toastKill = null;
ipcMain.on('toast:empty', () => {
  placeToast(0);
  // пустое окно уведомлений не держим: через 20 с закрываем, при новом уведомлении создастся заново
  clearTimeout(toastKill);
  toastKill = setTimeout(() => {
    if (toastWin && !toastWin.isDestroyed() && !toastWin.isVisible()) toastWin.destroy();
  }, 20000);
});

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

// Правый клик внутри страниц FunPay (встроенная панель и отдельное окно):
// копировать / вставить / выделить всё, ссылки, адрес страницы, назад / обновить.
const FP_RE = /^https:\/\/([a-z0-9-]+\.)?funpay\.com\//;
function pageMenu(wc, p, host) {
  const nav = wc.navigationHistory;
  const items = [];
  for (const w of (p.dictionarySuggestions || []).slice(0, 5)) items.push({ label: w, click: () => wc.replaceMisspelling(w) });
  if (items.length) items.push({ type: 'separator' });
  if (p.linkURL && /^https?:/.test(p.linkURL)) {
    items.push(
      { label: 'Открыть ссылку', click: () => (FP_RE.test(p.linkURL) ? wc.loadURL(p.linkURL) : shell.openExternal(p.linkURL)) },
      { label: 'Открыть в обычном браузере', click: () => shell.openExternal(p.linkURL) },
      { label: 'Скопировать ссылку', click: () => clipboard.writeText(p.linkURL) },
      { type: 'separator' }
    );
  }
  if (p.isEditable) {
    items.push(
      { label: 'Вырезать', role: 'cut', enabled: p.editFlags.canCut },
      { label: 'Копировать', role: 'copy', enabled: p.editFlags.canCopy },
      { label: 'Вставить', role: 'paste', enabled: p.editFlags.canPaste },
      { label: 'Выделить всё', role: 'selectAll' }
    );
  } else {
    if (p.selectionText) items.push({ label: 'Копировать', role: 'copy' });
    items.push({ label: 'Выделить всё', role: 'selectAll' });
  }
  if (p.mediaType === 'image' && p.srcURL) items.push({ label: 'Скопировать ссылку на картинку', click: () => clipboard.writeText(p.srcURL) });
  items.push(
    { type: 'separator' },
    { label: 'Назад', enabled: nav ? nav.canGoBack() : wc.canGoBack(), click: () => (nav ? nav.goBack() : wc.goBack()) },
    { label: 'Обновить', click: () => wc.reload() },
    { label: 'Скопировать адрес страницы', click: () => clipboard.writeText(wc.getURL()) },
    { label: 'Открыть страницу в обычном браузере', click: () => shell.openExternal(wc.getURL()) }
  );
  Menu.buildFromTemplate(items).popup(host && !host.isDestroyed() ? { window: host } : {});
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
  w.webContents.on('context-menu', (_e, p) => pageMenu(w.webContents, p, w));
  w.loadURL(url || 'https://funpay.com/');
  return true;
}

// ---------------------------------------------------------------- жизненный цикл

app.on('web-contents-created', (_e, wc) => {
  if (wc.getType() !== 'webview') return;
  // правый клик в панели FunPay: копировать, ссылки, адрес, назад
  wc.on('context-menu', (_e, p) => pageMenu(wc, p, wc.hostWebContents ? BrowserWindow.fromWebContents(wc.hostWebContents) : win));
  // ссылки FunPay открываем в той же панели, остальные — в обычном браузере
  wc.setWindowOpenHandler(({ url: u }) => {
    if (/^https:\/\/([a-z0-9-]+\.)?funpay\.com\//.test(u)) wc.loadURL(u);
    else if (/^https?:\/\//.test(u)) shell.openExternal(u);
    return { action: 'deny' };
  });
});
app.on('second-instance', () => showMain());
const PLUG_CSP = "default-src 'none'; script-src 'self' lumen-plugin: 'unsafe-inline'; style-src 'self' lumen-plugin: 'unsafe-inline'; img-src * data: blob:; font-src 'self' lumen-plugin: data:; media-src * data: blob:";
const PLUG_KIT = { '/__lumen.js': ['renderer/plugin-kit/lumen.js', 'text/javascript'], '/__kit.css': ['renderer/plugin-kit/kit.css', 'text/css'] };
function pluginPage(req) {
  const u = new URL(req.url);
  const res = (body, type, status = 200) => new Response(body, { status, headers: { 'content-type': type + '; charset=utf-8', 'content-security-policy': PLUG_CSP, 'cache-control': 'no-store' } });
  const kit = PLUG_KIT[u.pathname];
  if (kit) return res(fs.readFileSync(path.join(ROOT, kit[0])), kit[1]);
  const font = /^\/fonts\/(Inter-[A-Za-z]+\.woff)$/.exec(u.pathname);
  if (font) return new Response(fs.readFileSync(path.join(ROOT, 'assets', 'fonts', font[1])), { headers: { 'content-type': 'font/woff' } });
  if (u.pathname !== '/' && u.pathname !== '/index.html') return res('Not found', 'text/plain', 404);
  const html = automation.pageHtml(u.hostname);
  if (html == null) return res('<!doctype html><link rel="stylesheet" href="/__kit.css"><p class="dim">Плагин выключен или не найден.</p>', 'text/html', 404);
  const head = '<meta charset="utf-8"><link rel="stylesheet" href="/__kit.css"><script src="/__lumen.js"></script>';
  return res(/<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => m + head) : '<!doctype html><html><head>' + head + '</head><body>' + html + '</body></html>', 'text/html');
}

app.whenReady().then(() => {
  if (!gotLock) return;
  protocol.handle('lumen-plugin', (req) => {
    try {
      return pluginPage(req);
    } catch (e) {
      return new Response(String(e.message || e), { status: 500 });
    }
  });
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
  updater.init((st) => win && !win.isDestroyed() && win.webContents.send('upd:state', st), settings, {
    // обновление скачалось: если Lumen свёрнут / в трее — уведомление Windows, нажал → перезапуск в новую версию
    ready: (v) => {
      if (win && !win.isDestroyed() && win.isVisible() && win.isFocused()) return;   // в окне и так покажется
      if (!Notification.isSupported()) return;
      const n = new Notification({ title: `Lumen ${v} готов`, body: 'Нажми, чтобы обновить — займёт пару секунд. Или обновится сам, когда закроешь Lumen.',
        silent: true, icon: nativeImage.createFromPath(path.join(ROOT, 'assets', 'icon.png')) });
      n.on('click', () => {
        quitting = true;
        store.flush();
        updater.install();
      });
      n.show();
    },
    // в прошлый раз не успели поставить — ставим сразу при запуске (окно показывает «Обновляю…»)
    autoInstall: () => {
      quitting = true;
      automation.detach();
      store.flush();
      updater.install();
    },
  });
  automation.init((ev) => win && !win.isDestroyed() && win.webContents.send('auto:event', ev), {
    accounts: () => store.accounts().map((a) => ({ id: a.id, userId: a.userId, username: a.username, session: sessionFor(a.id) })),
  });
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
