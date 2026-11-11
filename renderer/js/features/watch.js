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
  for (const c of chats) {
    map.set(c.id, c.nodeMsg);
    if (!prevMap) continue; // первый проход — только запоминаем
    const prev = prevMap.get(c.id);
    if (!c.unread || (prev !== undefined && c.nodeMsg <= prev)) continue;
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
