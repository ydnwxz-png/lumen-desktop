// Уведомления со всех аккаунтов: активный опрашивает poller.js, остальные — здесь, раз в ~45 секунд.
// Нажал на уведомление — Lumen переключается на этот аккаунт и открывает чат.
import { S, bus } from '../core/state.js';
import { notify } from './notify.js';
import { accountsList, clientFor, forget } from './accounts.js';

const EVERY = 45e3;
const known = new Map(); // accId → Map(chatId → nodeMsg)
let timer = null;
let busy = false;
let pending = null; // { accId, node } — открыть после переключения

export function initWatch() {
  bus.on('me', () => {
    // после переключения аккаунта из уведомления — открыть нужный чат
    if (pending && pending.accId === S.accId) {
      const node = pending.node;
      pending = null;
      setTimeout(() => (bus.emit('nav', 'chats'), bus.emit('open-chat', node)), 300);
    }
    clearTimeout(timer);
    timer = setTimeout(tick, 8000);
  });
  // клик по всплывашке/системному уведомлению, когда окно было свёрнуто
  window.api?.app.on('nav:chat', (node) => {
    const m = /^acc:([^:]+):(.+)$/.exec(String(node || ''));
    if (m) openOn(m[1], m[2]);
  });
}

/** node для уведомления: «acc:<id>:<чат>» — чтобы клик открыл чат на нужном аккаунте */
export const accNode = (accId, node) => `acc:${accId}:${node}`;

export function openOn(accId, node) {
  if (accId === S.accId) return bus.emit('nav', 'chats'), bus.emit('open-chat', node);
  pending = { accId, node };
  bus.emit('switch-account', accId);
}

async function tick() {
  clearTimeout(timer);
  timer = setTimeout(tick, EVERY);
  if (busy || S.demo || !S.me || S.settings.notify?.allAccounts === false) return;
  busy = true;
  try {
    const list = (await accountsList()).filter((a) => a.id !== S.accId);
    for (const a of list) {
      try {
        await checkAccount(a);
      } catch {
        forget(a.id);
      }
      await new Promise((r) => setTimeout(r, 1500));
    }
  } finally {
    busy = false;
  }
}

async function checkAccount(a) {
  const { client, me } = await clientFor(a.id);
  const chats = await client.chats();
  const prevMap = known.get(a.id);
  const map = new Map();
  let checks = 0; // не больше 5 проверок истории за проход — чтобы FunPay не ругался на частые запросы
  for (const c of chats) {
    map.set(c.id, c.nodeMsg);
    if (!prevMap) continue; // первый проход — только запоминаем
    const prev = prevMap.get(c.id);
    if (prev !== undefined && c.nodeMsg <= prev) continue;
    if (!c.unread) {
      if (checks++ >= 5) {
        if (prev !== undefined) map.set(c.id, prev); // проверим в следующий проход
        continue;
      }
      // уже прочитано (бот вроде Cardinal ответил, телефон, сайт) — смотрим, писал ли покупатель
      try {
        const r = await client.history(c.id);
        const myId = String(me?.userId || '');
        const news = (r.messages || []).filter((m) => m.id > (prev || 0) && m.id <= c.nodeMsg && String(m.authorId) !== myId);
        const m = news[news.length - 1];
        if (!m) continue;
        c.preview = m.text || (m.image ? 'Изображение' : c.preview);
      } catch {
        continue;
      }
    }
    const isOrder = /оплатил заказ|paid for order/i.test(c.preview);
    const order = isOrder && S.settings.notify.orders;
    const who = me?.username || a.username || 'другой аккаунт';
    notify({
      title: (order ? `💸 Новый заказ от ${c.name}` : c.name) + ` · ${who}`,
      name: c.name,
      body: c.preview || 'Изображение',
      avatar: c.avatar,
      node: accNode(a.id, c.id),
      kind: order ? 'order' : 'msg',
      onClick: () => openOn(a.id, c.id),
    });
  }
  known.set(a.id, map);
}
