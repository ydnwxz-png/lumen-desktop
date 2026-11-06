// Хранилище в %APPDATA%/Lumen Desktop/lumen.json. golden_key шифруется системой (safeStorage), если она умеет.
const fs = require('fs');
const path = require('path');
const { app, safeStorage } = require('electron');

const file = () => path.join(app.getPath('userData'), 'lumen.json');
let data = null;
let timer = null;

function load() {
  if (data) return data;
  try {
    data = JSON.parse(fs.readFileSync(file(), 'utf8'));
  } catch {
    data = {};
  }
  data.accounts ||= [];
  data.kv ||= {};
  return data;
}

function saveNow() {
  clearTimeout(timer);
  timer = null;
  const f = file();
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const tmp = f + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, f);
}

function save() {
  if (timer) return;
  timer = setTimeout(saveNow, 400);
}

const canCrypt = () => {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
};

function encKey(gk) {
  if (canCrypt()) return { enc: safeStorage.encryptString(gk).toString('base64') };
  return { plain: gk };
}

function decKey(k) {
  if (!k) return '';
  if (k.plain) return k.plain;
  try {
    return safeStorage.decryptString(Buffer.from(k.enc, 'base64'));
  } catch {
    return '';
  }
}

module.exports = {
  get(key, def) {
    const v = load().kv[key];
    return v === undefined ? def : v;
  },
  set(key, value) {
    load().kv[key] = value;
    save();
  },
  accounts() {
    return load().accounts;
  },
  account(id) {
    return load().accounts.find((a) => a.id === id);
  },
  gk(acc) {
    return decKey(acc.key);
  },
  upsertAccount(info, gk) {
    const d = load();
    let a = d.accounts.find((x) => x.userId === info.userId);
    if (!a) {
      a = { id: 'a' + Date.now().toString(36), userId: info.userId };
      d.accounts.push(a);
    }
    Object.assign(a, { username: info.username, avatar: info.avatar, ua: info.ua || a.ua, cookies: info.cookies || a.cookies || {} });
    if (gk) a.key = encKey(gk);
    d.active = a.id;
    save();
    return a;
  },
  patchAccount(id, patch) {
    const a = this.account(id);
    if (a) {
      Object.assign(a, patch);
      save();
    }
  },
  removeAccount(id) {
    const d = load();
    d.accounts = d.accounts.filter((a) => a.id !== id);
    if (d.active === id) d.active = d.accounts[0]?.id || null;
    save();
  },
  active() {
    return load().active || null;
  },
  setActive(id) {
    load().active = id;
    save();
  },
  flush: saveNow,
  dir: () => app.getPath('userData'),
};
