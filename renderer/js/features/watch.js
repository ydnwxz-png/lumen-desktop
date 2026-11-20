// © 2026 Lumen. Все права защищены. Копирование, изменение и распространение этого кода запрещены без разрешения автора (см. LICENSE).
// Уведомления со всех аккаунтов: активный опрашивает poller.js, остальные — здесь, раз в 6 секунд.
// Это дёшево: список чатов спрашивается с тегом (FunPay шлёт его, только если что-то изменилось),
// а плагины, которым тоже нужен список чатов этого аккаунта, берут ту же копию без запроса.
// Нажал на уведомление — Lumen переключается на этот аккаунт и открывает чат.
import { S, bus } from '../core/state.js';
import { notify } from './notify.js';
import { accountsList, clientFor, forget } from './accounts.js';

const EVERY = 6e3;   // фоновые аккаунты: уведомление приходит за несколько секунд
const known = new Map(); // accId → { at, map: Map(chatId → nodeMsg) }
const STALE = 10 * 60e3; // память старше 10 мин (сон компа, нет сети) — не верим, запоминаем заново
const PACK = 3;          // больше 3 уведомлений за раз с одного аккаунта — одно общее
let timer = null;
let lastActive = null;
let busy = false;
let pending = null; // { accId, node } — открыть после переключения

export function initWatch() {
  bus.on('me', () => {
    // активный аккаунт опрашивает poller.js. Сменили аккаунт — память о нём и о прошлом активном устарела:
    // без этого после переключения всё, что пришло за это время, сыпалось пачкой уведомлений
    known.delete(S.accId);
    if (lastActive && lastActive !== S.accId) known.delete(lastActive);
    lastActive = S.accId;
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
      await new Promise((r) => setTimeout(r, 300));
    }
  } finally {
    busy = false;
  }
}

async function checkAccount(a) {
  const { client, me } = await clientFor(a.id);
  const chats = await client.chats();
  const k = known.get(a.id);
  const prevMap = k && Date.now() - k.at < STALE ? k.map : null; // нет памяти или старая — первый проход
  const map = new Map();
  const out = [];
  let checks = 0; // не больше 12 проверок истории за проход — чтобы FunPay не ругался на частые запросы
  for (const c of chats) {
    map.set(c.id, c.nodeMsg);
    if (!prevMap) continue; // первый проход — только запоминаем
    const prev = prevMap.get(c.id);
    if (prev !== undefined && c.nodeMsg <= prev) continue;
    if (!c.unread) {
      if (checks++ >= 12) {
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
    out.push({ c, order });
  }
  known.set(a.id, { at: Date.now(), map });
  if (!out.length) return;
  const who = me?.username || a.username || 'другой аккаунт';
  if (out.length > PACK) {
    // пачка — одно уведомление, а не десять подряд
    const names = [...new Set(out.map((x) => x.c.name))];
    const orders = out.filter((x) => x.order).length;
    notify({
      title: `📬 ${out.length} новых · ${who}`,
      name: who,
      body: (orders ? `💸 заказов: ${orders} · ` : '') + names.slice(0, 4).join(', ') + (names.length > 4 ? ` и ещё ${names.length - 4}` : ''),
      node: accNode(a.id, out[0].c.id),
      kind: orders ? 'order' : 'msg',
      onClick: () => openOn(a.id, out[0].c.id),
    });
    return;
  }
  for (const { c, order } of out) {
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
}
