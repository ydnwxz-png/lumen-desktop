// Движок автоматики Lumen: следит за FunPay и делает всё сам.
// Движок автоматики Lumen (работает в главном процессе приложения).
//
// События (EventEmitter):
//   message {chat, message, text, author}        новое сообщение от покупателя
//   order {order}                                новый заказ
//   orderStatus {order, from, to}                заказ закрыт / возвращён
//   review {orderId, rating, text, buyer, order} новый или изменённый отзыв
//   delivered {order, rule, products, left}      товар выдан
//   deliveryEmpty {order, rule, need, left}      товара не хватило
//   raised {game, title, ok, msg, wait}          лоты подняты / FunPay просит подождать
//   command {chat, rule, text}                   сработал автоответ
//   notify {text, from}                          уведомление от плагина
//   status {status, error} · log {t, level, text} · config
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { Store } from './store.js';
import { Plugins } from './plugins.js';
import { fill } from './fill.js';
import { DEFAULTS } from './defaults.js';

const ORDER_RE = /#([A-Z0-9]{8})\b/;
const norm = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class Engine extends EventEmitter {
  /**
   * @param {object} o
   * @param {object} o.account  аккаунт FunPay (renderer/js/fp/account.js)
   * @param {string} o.dataDir  куда сохранять настройки, товары, состояние
   * @param {string} o.pluginsDir папка с плагинами
   * @param {string[]} [o.off]   функции, которые здесь не нужны (например ['raise'] в приложении)
   */
  constructor({ account, dataDir, pluginsDir, off = [], log, accounts } = {}) {
    super();
    this.accountsFn = accounts || null; // все аккаунты программы — для плагинов (api.accounts())
    this.setMaxListeners(50);
    this.acc = account;
    this.dir = dataDir;
    this.off = new Set(off);
    fs.mkdirSync(path.join(dataDir, 'products'), { recursive: true });
    this.cfgStore = new Store(path.join(dataDir, 'automation.json'), DEFAULTS);
    this.state = new Store(path.join(dataDir, 'state.json'), { greeted: {}, orders: {}, reminders: [], stats: {} });
    this.plugins = new Plugins(this, pluginsDir || path.join(dataDir, 'plugins'));
    this.logFn = log || (() => {});
    this.events = [];
    this.running = false;
    this.me = null;
    this.tags = {};
    this.known = new Map(); // чат -> id последнего сообщения в списке чатов
    this.lastIds = new Map(); // чат -> id последнего обработанного сообщения
    this.first = true;
    this.errors = 0;
    this.status = 'stopped';
    this.raiseGames = null;
    this.raiseSt = new Map();
    this.busy = Promise.resolve();
  }

  get cfg() {
    return this.cfgStore.data;
  }
  saveCfg() {
    this.cfgStore.save();
    this.emit('config');
  }

  log(level, text) {
    const e = { t: Date.now(), level, text: String(text) };
    this.events.push(e);
    if (this.events.length > 300) this.events.splice(0, this.events.length - 300);
    this.emit('log', e);
    this.logFn(e);
  }

  stat(k, n = 1) {
    const s = this.state.data.stats;
    const day = new Date().toISOString().slice(0, 10);
    if (s.day !== day) Object.assign(s, { day, today: {} });
    s[k] = (s[k] || 0) + n;
    s.today[k] = (s.today[k] || 0) + n;
    this.state.save();
  }

  setStatus(status, error = '') {
    if (this.status === status && this.error === error) return;
    this.status = status;
    this.error = error;
    this.emit('status', { status, error });
  }

  // ---------------------------------------------------------------- запуск

  async start() {
    if (this.running) return;
    this.running = true;
    this.setStatus('starting');
    try {
      this.me = await this.acc.auth(false);
    } catch (e) {
      this.running = false;
      this.setStatus('error', e.message);
      throw e;
    }
    this.startedAt = Date.now();
    this.first = true;
    await this.plugins.loadAll();
    await this.plugins.call('onStart', {});
    this.log('info', `Автоматика запущена: ${this.me.username}`);
    this.emit('started', { me: this.me });
    this.loop();
    this.slow = setInterval(() => this.slowTick().catch((e) => this.log('warn', e.message)), 60e3);
    setTimeout(() => this.slowTick().catch(() => {}), 15e3);
  }

  async stop() {
    if (!this.running) return;
    this.running = false;
    clearTimeout(this.timer);
    clearInterval(this.slow);
    await this.plugins.call('onStop', {});
    this.state.flush();
    this.cfgStore.flush();
    this.plugins.flush();
    this.setStatus('stopped');
    this.log('info', 'Автоматика остановлена');
  }

  async loop() {
    if (!this.running) return;
    try {
      await this.tick();
      this.errors = 0;
      this.setStatus('ok');
    } catch (e) {
      this.errors++;
      this.setStatus('error', e.message);
      if (this.errors === 1 || this.errors % 10 === 0) this.log('warn', 'FunPay: ' + e.message);
    }
    if (!this.running) return;
    const base = Math.max(2000, +this.cfg.pollMs || 4000);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.loop(), this.errors ? Math.min(60000, base * 2 ** Math.min(this.errors, 4)) : base);
  }

  async tick() {
    const r = await this.acc.pollTags(this.tags);
    if (r.chats) await this.onChats(r.chats);
    if (r.counters) await this.onCounters();
    this.first = false;
  }

  // ---------------------------------------------------------------- сообщения

  async onChats(list) {
    const changed = [];
    const greeted = this.state.data.greeted;
    for (const c of list) {
      const prev = this.known.get(c.id);
      this.known.set(c.id, c.nodeMsg);
      if (this.first) {
        this.lastIds.set(c.id, c.nodeMsg);
        if (!greeted[c.id]) greeted[c.id] = 1; // старые чаты не приветствуем
        continue;
      }
      if (prev !== undefined && c.nodeMsg <= prev) continue;
      changed.push({ c, prev });
    }
    if (this.first) this.state.save();
    for (const { c, prev } of changed.slice(0, 20)) {
      let msgs;
      try {
        msgs = (await this.acc.lastMessages(c.id)).sort((a, b) => a.id - b.id);
      } catch (e) {
        this.log('warn', `Чат ${c.name}: ${e.message}`);
        continue;
      }
      const seen = this.lastIds.get(c.id);
      const from = seen ?? prev ?? c.userMsg ?? 0;
      let fresh = msgs.filter((m) => m.id > from);
      if (seen === undefined) fresh = fresh.slice(-3);
      if (msgs.length) this.lastIds.set(c.id, Math.max(from, msgs[msgs.length - 1].id));
      for (const m of fresh) await this.onMessage(c, m);
    }
  }

  async onMessage(chat, m) {
    const mine = this.me && m.authorId === String(this.me.userId);
    const system = m.authorId === '0';
    const e = { chat: { id: chat.id, name: chat.name, avatar: chat.avatar }, message: m, text: m.text || '', author: m.author, authorId: m.authorId, mine, system, image: m.image || null };
    if (system) await this.onSystem(chat, m);
    else if (!mine) {
      this.stat('messages');
      this.emit('message', e);
      if (!this.blocked(m.author, 'replies')) {
        await this.greet(e);
        await this.commands(e);
      }
    }
    await this.plugins.call('onMessage', e);
  }

  blocked(name, what) {
    const b = this.cfg.blacklist;
    const hit = (b.users || []).some((u) => norm(u) === norm(name));
    if (!hit) return false;
    return what === 'delivery' ? b.skipDelivery !== false : what === 'replies' ? b.skipReplies !== false : true;
  }

  ctx(extra = {}) {
    return { myName: this.me?.username, ...extra };
  }

  async greet(e) {
    const g = this.cfg.greeting;
    if (!g.on || !g.text) return;
    const st = this.state.data.greeted;
    const last = st[e.chat.id];
    if (last && (last === 1 || Date.now() - last < (+g.cooldownDays || 0) * 86400e3)) return;
    st[e.chat.id] = Date.now();
    this.state.save();
    await this.send(e.chat.id, fill(g.text, this.ctx({ username: e.author, message: e.text })), 'приветствие');
  }

  async commands(e) {
    const c = this.cfg.commands;
    if (!c.on || !e.text) return;
    const t = norm(e.text);
    for (const r of c.rules || []) {
      if (r.on === false || !r.text) continue;
      const triggers = String(r.triggers || '')
        .split(/[,\n|]/)
        .map(norm)
        .filter(Boolean);
      if (!triggers.some((k) => (r.contains ? t.includes(k) : t === k))) continue;
      await this.send(e.chat.id, fill(r.text, this.ctx({ username: e.author, message: e.text })), 'автоответ');
      this.stat('commands');
      this.emit('command', { chat: e.chat, rule: r, text: e.text, notify: !!r.notify });
      return;
    }
  }

  async onSystem(chat, m) {
    const id = ORDER_RE.exec(m.text)?.[1];
    if (id && /отзыв|review/i.test(m.text) && /написал|изменил|оставил|wrote|changed|left/i.test(m.text)) await this.onReview(chat, id);
  }

  async onReview(chat, orderId) {
    let o;
    try {
      o = await this.acc.order(orderId);
    } catch (e) {
      return this.log('warn', `Отзыв к #${orderId}: ${e.message}`);
    }
    if (!o.review || o.isBuyer) return;
    const e = { orderId, rating: o.review.rating, text: o.review.text, buyer: o.peerName, order: o, chat: { id: chat.id, name: chat.name } };
    this.stat('reviews');
    this.emit('review', e);
    const rv = this.cfg.reviews;
    const tpl = rv.on ? rv.texts?.[o.review.rating] : '';
    if (tpl && (!o.review.reply || rv.overwrite)) {
      try {
        await this.acc.review(orderId, fill(tpl, this.ctx({ username: o.peerName, orderId, lotName: o.shortDesc, stars: o.review.rating })), 5);
        this.log('info', `Ответил на отзыв ${'★'.repeat(o.review.rating)} к #${orderId}`);
      } catch (err) {
        this.log('warn', `Ответ на отзыв #${orderId}: ${err.message}`);
      }
    }
    await this.plugins.call('onReview', e);
  }

  // ---------------------------------------------------------------- заказы

  async onCounters() {
    const { items } = await this.acc.trades('sales', '', '');
    const saved = this.state.data.orders;
    if (!this.state.data.ordersInit) {
      // самый первый запуск: запоминаем, ничего не выдаём
      for (const o of items) saved[o.id] = o.state;
      this.state.data.ordersInit = true;
      this.state.save();
      return;
    }
    for (const o of [...items].reverse()) {
      const prev = saved[o.id];
      if (prev === o.state) continue;
      saved[o.id] = o.state;
      this.state.save();
      o.chatNode = o.peerId && this.me ? this.acc.chatWith(o.peerId) : null;
      if (prev === undefined) {
        await this.onNewOrder(o);
        if (o.state !== 'paid') await this.onOrderStatus(o, 'paid');
      } else await this.onOrderStatus(o, prev);
    }
    const ids = Object.keys(saved);
    if (ids.length > 600) for (const k of ids.slice(0, ids.length - 500)) delete saved[k];
  }

  async onNewOrder(o) {
    this.stat('orders');
    this.log('info', `Новый заказ #${o.id} от ${o.peer}: ${o.desc} — ${o.price}`);
    this.emit('order', { order: o });
    if (o.state === 'paid') {
      if (this.blocked(o.peer, 'delivery')) this.log('warn', `${o.peer} в чёрном списке — автовыдача пропущена (#${o.id})`);
      else await this.deliver(o).catch((e) => this.log('error', `Выдача #${o.id}: ${e.message}`));
      if (this.cfg.remind.on && o.chatNode) {
        this.state.data.reminders.push({ id: o.id, at: Date.now() + (+this.cfg.remind.hours || 12) * 3600e3, chat: o.chatNode, buyer: o.peer });
        this.state.save();
      }
    }
    await this.plugins.call('onOrder', { order: o });
  }

  async onOrderStatus(o, from) {
    const e = { order: o, from, to: o.state };
    this.emit('orderStatus', e);
    if (o.state === 'closed' && this.cfg.thanks.on && this.cfg.thanks.text && o.chatNode && !this.blocked(o.peer, 'replies')) {
      await this.send(o.chatNode, fill(this.cfg.thanks.text, this.ctx({ username: o.peer, orderId: o.id, lotName: o.desc, price: o.price })), 'спасибо за подтверждение');
    }
    await this.plugins.call('onOrderStatus', e);
  }

  // ---------------------------------------------------------------- автовыдача

  productsFile(rule) {
    return path.join(this.dir, 'products', String(rule.id).replace(/[^\w-]/g, '') + '.txt');
  }
  products(rule) {
    try {
      return fs
        .readFileSync(this.productsFile(rule), 'utf8')
        .split(/\r?\n/)
        .filter((l) => l.trim());
    } catch {
      return [];
    }
  }
  setProducts(rule, lines) {
    fs.writeFileSync(this.productsFile(rule), lines.filter((l) => String(l).trim()).join('\n') + (lines.length ? '\n' : ''));
  }
  addProducts(rule, lines) {
    this.setProducts(rule, [...this.products(rule), ...lines]);
    return this.products(rule).length;
  }
  /** Товары не нужны, если в тексте выдачи нет $product (одинаковый текст всем). */
  infinite(rule) {
    return !String(rule.text || '').includes('$product');
  }

  findRule(desc) {
    const d = norm(desc);
    let best = null;
    for (const r of this.cfg.delivery.rules || []) {
      if (r.on === false || !r.name) continue;
      const n = norm(r.name);
      if (d.includes(n) && (!best || n.length > norm(best.name).length)) best = r;
    }
    return best;
  }

  async deliver(o) {
    if (!this.cfg.delivery.on) return;
    const rule = this.findRule(o.desc);
    if (!rule || !o.chatNode) return;
    let need = 1;
    if (rule.byAmount !== false && !this.infinite(rule)) {
      try {
        need = this.acc.orderAmount(await this.acc.order(o.id));
      } catch {}
    }
    let take = [];
    let left = Infinity;
    if (!this.infinite(rule)) {
      const all = this.products(rule);
      if (all.length < need) {
        this.log('warn', `Не хватило товара «${rule.name}» для #${o.id}: нужно ${need}, есть ${all.length}`);
        this.emit('deliveryEmpty', { order: o, rule, need, left: all.length });
        if (rule.disableWhenEmpty && rule.lotId) await this.lotActive(rule, false);
        return;
      }
      take = all.slice(0, need);
      this.setProducts(rule, all.slice(need));
      left = all.length - need;
    }
    const text = fill(rule.text || '$product', this.ctx({ username: o.peer, orderId: o.id, lotName: o.desc, price: o.price, product: take.join('\n') }));
    try {
      await this.send(o.chatNode, text, 'автовыдача');
    } catch (e) {
      // не ушло — возвращаем товар обратно
      if (take.length) this.setProducts(rule, [...take, ...this.products(rule)]);
      throw e;
    }
    this.stat('delivered');
    this.log('info', `Выдал «${rule.name}» по #${o.id}${left !== Infinity ? ` · осталось ${left}` : ''}`);
    const ev = { order: o, rule, products: take, left };
    this.emit('delivered', ev);
    await this.plugins.call('onDelivery', ev);
    if (left === 0 && rule.disableWhenEmpty && rule.lotId) await this.lotActive(rule, false);
    else if (this.cfg.restore.on && rule.lotId) await this.lotActive(rule, true);
  }

  async lotActive(rule, on) {
    try {
      await this.acc.lotSetActive({ id: rule.lotId, node: rule.node || '' }, on);
      this.log('info', `Лот «${rule.name}» ${on ? 'снова активен' : 'выключен — товар закончился'}`);
    } catch (e) {
      this.log('warn', `Лот «${rule.name}»: ${e.message}`);
    }
  }

  // ---------------------------------------------------------------- раз в минуту: напоминания, поднятие

  async slowTick() {
    if (!this.running) return;
    const now = Date.now();
    const st = this.state.data;
    const due = st.reminders.filter((r) => r.at <= now);
    if (due.length) {
      st.reminders = st.reminders.filter((r) => r.at > now);
      this.state.save();
      for (const r of due) {
        if (st.orders[r.id] !== 'paid' || !this.cfg.remind.on) continue;
        await this.send(r.chat, fill(this.cfg.remind.text, this.ctx({ username: r.buyer, orderId: r.id })), 'напоминание').catch(() => {});
      }
    }
    if (this.cfg.raise.on && !this.off.has('raise')) await this.raiseDue(false);
    await this.plugins.call('onTick', {});
  }

  async raiseDue(force) {
    if (this.raising) return [];
    this.raising = true;
    const out = [];
    try {
      if (!this.raiseGames || force || Date.now() - this.raiseGames.at > 30 * 60e3) this.raiseGames = { at: Date.now(), list: await this.acc.raiseGames() };
      for (const g of this.raiseGames.list) {
        const s = this.raiseSt.get(g.game);
        if (!force && s && s.nextAt > Date.now()) continue;
        let r;
        try {
          r = await this.acc.raiseGame(g.game, g.nodes);
        } catch (e) {
          r = { ok: false, msg: e.message, wait: 5 * 60e3, error: true };
        }
        this.raiseSt.set(g.game, { ...r, at: Date.now(), nextAt: Date.now() + (r.wait || 10 * 60e3) + 20e3, title: g.title });
        const ev = { game: g.game, title: g.title, ok: r.ok, msg: r.msg, wait: r.wait };
        out.push(ev);
        if (r.ok) {
          this.stat('raised');
          this.log('info', `Подняты: ${g.title}`);
        }
        this.emit('raised', ev);
        await sleep(1000);
      }
    } finally {
      this.raising = false;
    }
    return out;
  }

  // ---------------------------------------------------------------- отправка

  async send(chat, text, why = '') {
    if (!text) return;
    await this.acc.send(String(chat), text);
    this.stat('sent');
    if (why) this.log('info', `Отправил ${why} → ${chat}`);
  }

  async sendImage(chat, data, name = 'image.png', type = 'image/png') {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    await this.acc.sendImage(String(chat), { name, type, arrayBuffer: async () => bytes });
  }

  info() {
    const s = this.state.data.stats;
    let next = Infinity;
    for (const v of this.raiseSt.values()) next = Math.min(next, v.nextAt);
    return {
      running: this.running,
      status: this.status,
      error: this.error || '',
      me: this.me,
      startedAt: this.startedAt,
      stats: s,
      today: s.day === new Date().toISOString().slice(0, 10) ? s.today : {},
      nextRaise: next === Infinity ? null : next,
      plugins: this.plugins.all().filter((p) => p.on).length,
    };
  }
}
