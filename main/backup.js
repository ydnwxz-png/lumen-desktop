// © 2026 Lumen. Все права защищены. Копирование, изменение и распространение этого кода запрещены без разрешения автора (см. LICENSE).
// Бэкап и перенос: сохранить выбранное (вид, настройки, шаблоны, чаты, автоматика, плагины, аккаунты) в один файл
// и загрузить обратно — на этом или другом компьютере.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app, dialog } = require('electron');
const store = require('./store');

const LOOK_KEYS = ['theme', 'accent', 'customAccent', 'tint', 'bg', 'glow', 'radius', 'glass', 'font', 'fontSize', 'bgDim', 'bgBlur', 'animations', 'zoom', 'nav'];
const PARTS = ['look', 'settings', 'templates', 'chats', 'automation', 'plugins', 'accounts'];
const MAX_FILE = 20 * 1024 * 1024;
const MAX_TOTAL = 250 * 1024 * 1024;
const pl = (n, a, b, c) => `${n} ${n % 10 === 1 && n % 100 !== 11 ? a : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? b : c}`;
const ud = (...p) => path.join(app.getPath('userData'), ...p);

/** Все файлы папки: { 'отн/путь': base64 } */
function readDir(dir, out = {}, base = dir, budget = { left: MAX_TOTAL }) {
  let list = [];
  try {
    list = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of list) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) readDir(full, out, base, budget);
    else if (e.isFile()) {
      const st = fs.statSync(full);
      if (st.size > MAX_FILE || st.size > budget.left) continue;
      budget.left -= st.size;
      out[path.relative(base, full).split(path.sep).join('/')] = fs.readFileSync(full).toString('base64');
    }
  }
  return out;
}

/** Записать файлы в папку, не выходя за неё. */
function writeDir(dir, files) {
  let n = 0;
  for (const [rel, b64] of Object.entries(files || {})) {
    if (typeof rel !== 'string' || typeof b64 !== 'string' || rel.includes('..') || path.isAbsolute(rel) || /^[a-z]:/i.test(rel)) continue;
    const full = path.join(dir, ...rel.split('/'));
    if (!full.startsWith(dir + path.sep)) continue;
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, Buffer.from(b64, 'base64'));
    n++;
  }
  return n;
}

function make(parts) {
  const want = new Set((parts || []).filter((p) => PARTS.includes(p)));
  const settings = store.get('settings', {}) || {};
  const pick = (keys, inc) => Object.fromEntries(Object.entries(settings).filter(([k]) => keys.includes(k) === inc));
  const out = { lumenBackup: 1, app: app.getVersion(), made: new Date().toISOString(), parts: {} };
  if (want.has('look')) {
    out.parts.look = { settings: pick(LOOK_KEYS, true), myThemes: store.get('myThemes', []) };
    const t = store.get('bgType', '');
    if (t && fs.existsSync(ud('background.bin'))) out.parts.look.bg = { type: t, data: fs.readFileSync(ud('background.bin')).toString('base64') };
  }
  if (want.has('settings')) out.parts.settings = { settings: pick(LOOK_KEYS, false), supportText: store.get('supportText', ''), supportBatch: store.get('supportBatch', 5) };
  if (want.has('templates')) out.parts.templates = store.get('templates', null);
  if (want.has('chats')) {
    const kv = {};
    for (const k of store.keys()) if (/^(meta:|plugpage:)/.test(k)) kv[k] = store.get(k);
    out.parts.chats = kv;
  }
  if (want.has('automation')) out.parts.automation = readDir(ud('automation'));
  if (want.has('plugins')) out.parts.plugins = readDir(ud('plugins'));
  if (want.has('accounts')) out.parts.accounts = store.accounts().map((a) => ({ gk: store.gk(a), userId: a.userId, username: a.username })).filter((a) => a.gk);
  return out;
}

async function save(win, parts) {
  const data = make(parts);
  const d = new Date();
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'Сохранить бэкап Lumen',
    defaultPath: path.join(app.getPath('documents'), `Lumen-бэкап-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.lumen`),
    filters: [{ name: 'Бэкап Lumen', extensions: ['lumen'] }],
  });
  if (canceled || !filePath) return null;
  fs.writeFileSync(filePath, JSON.stringify(data));
  return { file: filePath, parts: Object.keys(data.parts), size: fs.statSync(filePath).size };
}

// открытый файл ждёт, пока человек выберет, что из него загрузить
const opened = new Map();

async function open(win) {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, { title: 'Загрузить бэкап Lumen', properties: ['openFile'], filters: [{ name: 'Бэкап Lumen', extensions: ['lumen', 'json'] }] });
  if (canceled || !filePaths[0]) return null;
  const st = fs.statSync(filePaths[0]);
  if (st.size > MAX_TOTAL + 50 * 1024 * 1024) throw new Error('Файл слишком большой');
  let data;
  try {
    data = JSON.parse(fs.readFileSync(filePaths[0], 'utf8'));
  } catch {
    throw new Error('Это не бэкап Lumen');
  }
  if (!data || data.lumenBackup !== 1 || typeof data.parts !== 'object') throw new Error('Это не бэкап Lumen');
  const token = crypto.randomBytes(8).toString('hex');
  opened.clear();
  opened.set(token, data);
  const p = data.parts;
  const info = {};
  if (p.look) info.look = p.look.bg ? 'вид и свой фон' : 'цвета и вид';
  if (p.settings) info.settings = 'уведомления, чаты, система';
  if (Array.isArray(p.templates)) info.templates = pl(p.templates.length, 'шаблон', 'шаблона', 'шаблонов');
  if (p.chats) info.chats = pl(Object.keys(p.chats).length, 'запись', 'записи', 'записей');
  if (p.automation) info.automation = pl(Object.keys(p.automation).length, 'файл', 'файла', 'файлов');
  if (p.plugins) info.plugins = pl(Object.keys(p.plugins).filter((f) => /\.(m?js|cjs)$/.test(f) && !f.startsWith('.lumen/')).length, 'плагин', 'плагина', 'плагинов');
  if (Array.isArray(p.accounts)) info.accounts = pl(p.accounts.length, 'аккаунт', 'аккаунта', 'аккаунтов');
  return { token, made: data.made, app: data.app, info };
}

/** Загрузить выбранное. addAccount — функция из main.js (проверяет ключ на FunPay). */
async function apply(token, parts, { addAccount, automation }) {
  const data = opened.get(token);
  if (!data) throw new Error('Файл уже закрыт — открой его ещё раз');
  const p = data.parts;
  const want = new Set(parts || []);
  const done = [];
  const cur = store.get('settings', {}) || {};
  if (want.has('look') && p.look) {
    const ls = Object.fromEntries(Object.entries(p.look.settings || {}).filter(([k]) => LOOK_KEYS.includes(k)));
    Object.assign(cur, ls);
    if (p.look.bg?.data && /^(image|video)\//.test(p.look.bg.type)) {
      fs.writeFileSync(ud('background.bin'), Buffer.from(p.look.bg.data, 'base64'));
      store.set('bgType', p.look.bg.type);
      cur.bgVer = Date.now();
    }
    if (Array.isArray(p.look.myThemes) && p.look.myThemes.length) store.set('myThemes', p.look.myThemes);
    done.push('вид');
  }
  if (want.has('settings') && p.settings) {
    Object.assign(cur, Object.fromEntries(Object.entries(p.settings.settings || {}).filter(([k]) => !LOOK_KEYS.includes(k))));
    if (typeof p.settings.supportText === 'string') store.set('supportText', p.settings.supportText);
    if (p.settings.supportBatch) store.set('supportBatch', p.settings.supportBatch);
    done.push('настройки');
  }
  store.set('settings', cur);
  if (want.has('templates') && Array.isArray(p.templates)) (store.set('templates', p.templates), done.push('шаблоны'));
  if (want.has('chats') && p.chats) {
    for (const [k, v] of Object.entries(p.chats)) if (/^(meta:|plugpage:)/.test(k)) store.set(k, v);
    done.push('метки чатов');
  }
  if ((want.has('automation') && p.automation) || (want.has('plugins') && p.plugins)) await automation.detach().catch(() => {});
  if (want.has('automation') && p.automation) (writeDir(ud('automation'), p.automation), done.push('автоматика'));
  if (want.has('plugins') && p.plugins) (writeDir(ud('plugins'), p.plugins), done.push('плагины'));
  let accOk = 0;
  let accBad = 0;
  if (want.has('accounts') && Array.isArray(p.accounts)) {
    for (const a of p.accounts) {
      try {
        await addAccount(String(a.gk || ''));
        accOk++;
      } catch {
        accBad++;
      }
    }
    done.push(`аккаунты: ${accOk}${accBad ? `, не вошли ${accBad}` : ''}`);
  }
  store.flush();
  opened.delete(token);
  return { done };
}

module.exports = { save, open, apply, LOOK_KEYS };
