// Опрос FunPay (как делает сам сайт: runner раз в пару секунд), новые сообщения, уведомления, автоответы.
import { S, bus, meta, persist } from '../core/state.js';
import { notify, badge } from './notify.js';
import { dndTick, dndIncoming } from './later.js';

export const CS = { chats: [], loaded: false, status: 'load', error: '' };
const known = new Map();
let first = true;
let seen = new Set();
let provider = () => ({ node: null, lastId: 0 });
let timer = null;
let running = false;
let again = false;
let gen = 0;

export const setOpenProvider = (fn) => (provider = fn);

export async function start() {
  stop();
  gen++;
  first = true;
  known.clear();
  CS.chats = [];
  CS.loaded = false;
  seen = new Set((await persist.get('seen:' + (S.accId || 'demo'), [])) || []);
  loop();
}

export function stop() {
  gen++;
  clearTimeout(timer);
  timer = null;
  running = false;
}

export function pollNow() {
  if (running) {
    again = true;
    return;
  }
  clearTimeout(timer);
  loop();
}

function status(s, e = '') {
  if (CS.status === s && CS.error === e) return;
  CS.status = s;
  CS.error = e;
  bus.emit('status', s, e);
}

async function loop() {
  if (!S.backend) return;
  const my = gen;
  running = true;
  try {
    const { node, lastId } = provider();
    const r = await S.backend.poll(node, lastId);
    if (my !== gen) return;
    if (r.chats) handleChats(r.chats);
    if (r.messages?.length && node) bus.emit('messages', node, r.messages);
    status('ok');
  } catch (e) {
    if (my !== gen) return;
    status('err', e.message || String(e));
  } finally {
    if (my === gen) running = false;
  }
  if (my !== gen) return;
  const base = Math.max(2, +S.settings.pollInterval || 3) * 1000;
  const wait = again ? 50 : CS.status === 'err' ? Math.min(30000, base * 3) : S.focused ? base : base * 1.6;
  again = false;
  clearTimeout(timer);
  timer = setTimeout(loop, wait);
}

function handleChats(list) {
  const fresh = [];
  for (const c of list) {
    const prev = known.get(c.id);
    if (!first && (prev === undefined || c.nodeMsg > prev) && c.unread) fresh.push({ c, isNew: !seen.has(c.id) });
    known.set(c.id, c.nodeMsg);
  }
  let seenChanged = false;
  for (const c of list)
    if (!seen.has(c.id)) {
      seen.add(c.id);
      seenChanged = true;
    }
  if (seenChanged) persist.set('seen:' + (S.accId || 'demo'), [...seen].slice(-3000));
  first = false;
  CS.chats = list;
  CS.loaded = true;
  bus.emit('chats', list);
  badge(list.filter((c) => c.unread && !meta(c.id).muted && !meta(c.id).archived).length);
  for (const f of fresh) incoming(f.c, f.isNew);
}

function incoming(c, isNew) {
  const m = meta(c.id);
  const isOrder = /оплатил заказ|paid for order/i.test(c.preview);
  bus.emit('incoming', c);
  const open = provider().node === c.id && S.focused && S.view === 'chats';
  const dnd = dndTick();
  if (dnd) dndIncoming(c);
  if (!m.muted && !open && !dnd) {
    const order = isOrder && S.settings.notify.orders;
    notify({
      title: order ? `💸 Новый заказ от ${c.name}` : c.name,
      name: c.name,
      body: c.preview || 'Изображение',
      avatar: c.avatar,
      node: c.id,
      kind: order ? 'order' : 'msg',
      onClick: () => bus.emit('open-chat', c.id),
    });
  }
}

