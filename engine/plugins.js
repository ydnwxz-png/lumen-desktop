// Плагины Lumen: обычные JS-файлы в папке plugins.
// Формат и API описаны в docs/PLUGINS.md.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { fill } from './fill.js';
import { Store } from './store.js';

const HOOKS = ['onStart', 'onStop', 'onMessage', 'onOrder', 'onOrderStatus', 'onReview', 'onDelivery', 'onTick'];
const TIMEOUT = 30000;

const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`не ответил за ${ms / 1000} с`)), ms))]);
const safeId = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'plugin';

export class Plugins {
  constructor(engine, dir) {
    this.e = engine;
    this.dir = dir;
    this.list = new Map(); // id -> { id, file, plugin, meta, error, store }
  }

  cfg(id) {
    const c = this.e.cfg.plugins;
    c[id] ||= { on: false, settings: {} };
    c[id].settings ||= {};
    return c[id];
  }

  enabled(id) {
    return !!this.e.cfg.plugins[id]?.on && !this.list.get(id)?.error;
  }

  settings(id) {
    const p = this.list.get(id);
    const out = {};
    for (const s of p?.meta.settings || []) out[s.key] = s.default ?? (s.type === 'bool' ? false : '');
    return { ...out, ...this.cfg(id).settings };
  }

  async loadAll() {
    fs.mkdirSync(this.dir, { recursive: true });
    // плагины пишутся как ES-модули (export default); .cjs — для CommonJS
    const pj = path.join(this.dir, 'package.json');
    if (!fs.existsSync(pj)) fs.writeFileSync(pj, '{ "type": "module" }\n');
    const files = fs.readdirSync(this.dir).filter((f) => /\.(m?js|cjs)$/.test(f));
    this.list.clear();
    for (const f of files) await this.load(f);
    return this.all();
  }

  async load(file) {
    const full = path.join(this.dir, file);
    const fallbackId = safeId(file.replace(/\.(m?js|cjs)$/, ''));
    try {
      const mod = await import(pathToFileURL(full).href + '?v=' + fs.statSync(full).mtimeMs);
      let p = mod.default ?? mod;
      if (typeof p === 'function') p = await p();
      if (!p || typeof p !== 'object') throw new Error('файл ничего не экспортирует');
      const id = safeId(p.id || fallbackId);
      const meta = {
        name: String(p.name || id),
        version: String(p.version || '1.0'),
        author: String(p.author || ''),
        description: String(p.description || ''),
        settings: Array.isArray(p.settings) ? p.settings.filter((s) => s && s.key) : [],
        commands: Object.keys(p.commands || {}),
        hooks: HOOKS.filter((h) => typeof p[h] === 'function'),
        // своя страница в меню слева: page: { title, icon, html }
        page: p.page && typeof p.page.html === 'string' ? { title: String(p.page.title || p.name || id), icon: String(p.page.icon || 'layers') } : null,
      };
      const entry = { id, file, plugin: p, meta, error: null, store: new Store(path.join(this.e.dir, 'plugins-data', id + '.json'), {}) };
      this.list.set(id, entry);
      return entry;
    } catch (err) {
      const entry = { id: fallbackId, file, plugin: {}, meta: { name: file, version: '', author: '', description: '', settings: [], commands: [], hooks: [], page: null }, error: err.message || String(err) };
      this.list.set(fallbackId, entry);
      this.e.log('error', `Плагин ${file} не загрузился: ${entry.error}`);
      return entry;
    }
  }

  all() {
    return [...this.list.values()].map((p) => ({ id: p.id, file: p.file, ...p.meta, on: this.enabled(p.id), error: p.error, values: this.settings(p.id) }));
  }

  api(id) {
    const e = this.e;
    const entry = this.list.get(id);
    const name = entry?.meta.name || id;
    return {
      id,
      name,
      get me() {
        return e.me;
      },
      account: e.acc,
      engine: e,
      settings: this.settings(id),
      log: (t) => e.log('info', `[${name}] ${t}`),
      warn: (t) => e.log('warn', `[${name}] ${t}`),
      notify: (text, opts = {}) => e.emit('notify', { text: String(text), from: name, ...opts }),
      send: (chat, text) => e.send(chat, text, `плагин ${name}`),
      sendImage: (chat, data, fileName = 'image.png', mime = 'image/png') => e.sendImage(chat, data, fileName, mime),
      fill: (text, ctx) => fill(text, { myName: e.me?.username, ...ctx }),
      chatWith: (userId) => e.acc.chatWith(userId),
      // все аккаунты, добавленные в Lumen: [{ id, userId, username, active, account }]
      accounts: async () => (e.accountsFn ? e.accountsFn() : [{ id: '', userId: e.me?.userId, username: e.me?.username, active: true, account: e.acc }]),
      storage: {
        get: (k, d) => (entry.store.data[k] === undefined ? d : entry.store.data[k]),
        set: (k, v) => {
          entry.store.data[k] = v;
          entry.store.save();
        },
        remove: (k) => {
          delete entry.store.data[k];
          entry.store.save();
        },
      },
    };
  }

  /** HTML страницы плагина (только у включённого). */
  pageHtml(id) {
    const p = this.list.get(id);
    if (!p || !this.enabled(id) || typeof p.plugin.page?.html !== 'string') return null;
    return p.plugin.page.html;
  }

  /** Страница плагина вызывает его функцию: page.api[name](...args, api) */
  async pageCall(id, name, args) {
    const p = this.list.get(id);
    if (!p || !this.enabled(id)) throw new Error('Плагин выключен');
    const fn = p.plugin.page?.api?.[name];
    if (typeof fn !== 'function') throw new Error('В плагине нет функции ' + name);
    return withTimeout(Promise.resolve(fn.call(p.plugin, ...(Array.isArray(args) ? args : []), this.api(id))), 120000);
  }

  /** Вызвать обработчик у всех включённых плагинов. Ошибка одного не мешает остальным. */
  async call(hook, ev) {
    for (const p of this.list.values()) {
      if (!this.enabled(p.id) || typeof p.plugin[hook] !== 'function') continue;
      try {
        await withTimeout(Promise.resolve(p.plugin[hook].call(p.plugin, ev, this.api(p.id))), TIMEOUT);
      } catch (err) {
        this.e.log('error', `Плагин «${p.meta.name}» (${hook}): ${err.message || err}`);
      }
    }
  }

  async setEnabled(id, on) {
    const p = this.list.get(id);
    if (!p) throw new Error('Плагин не найден');
    if (on && p.error) throw new Error('Плагин с ошибкой: ' + p.error);
    const was = this.enabled(id);
    this.cfg(id).on = !!on;
    this.e.saveCfg();
    try {
      if (on && !was && p.plugin.onStart) await withTimeout(Promise.resolve(p.plugin.onStart({}, this.api(id))), TIMEOUT);
      if (!on && was && p.plugin.onStop) await withTimeout(Promise.resolve(p.plugin.onStop({}, this.api(id))), TIMEOUT);
    } catch (err) {
      this.e.log('error', `Плагин «${p.meta.name}»: ${err.message || err}`);
    }
  }

  setSetting(id, key, value) {
    this.cfg(id).settings[key] = value;
    this.e.saveCfg();
  }

  /** Установить плагин из кода. Новый плагин выключен, пока его не включат. */
  async install(fileName, code) {
    if (!/\.(m?js|cjs)$/.test(fileName)) throw new Error('Нужен файл .js');
    if (Buffer.byteLength(code) > 2 * 1024 * 1024) throw new Error('Файл больше 2 МБ');
    fs.mkdirSync(this.dir, { recursive: true });
    const name = path.basename(fileName).replace(/[^\w.\-]+/g, '_');
    const old = [...this.list.values()].find((p) => p.file === name);
    if (old && this.enabled(old.id)) await this.setEnabled(old.id, false);
    fs.writeFileSync(path.join(this.dir, name), code);
    const entry = await this.load(name);
    if (old && old.id !== entry.id) this.list.delete(old.id);
    return entry;
  }

  async remove(id) {
    const p = this.list.get(id);
    if (!p) return;
    if (this.enabled(id)) await this.setEnabled(id, false);
    try {
      fs.unlinkSync(path.join(this.dir, p.file));
    } catch {}
    this.list.delete(id);
    delete this.e.cfg.plugins[id];
    this.e.saveCfg();
  }

  /** Команды для Telegram от включённых плагинов: { '/cmd': {id, fn} } */
  commands() {
    const out = {};
    for (const p of this.list.values()) {
      if (!this.enabled(p.id)) continue;
      for (const [cmd, fn] of Object.entries(p.plugin.commands || {})) if (typeof fn === 'function') out[cmd.startsWith('/') ? cmd : '/' + cmd] = { id: p.id, fn };
    }
    return out;
  }
}
