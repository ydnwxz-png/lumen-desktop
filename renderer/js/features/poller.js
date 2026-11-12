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
let startedAt = 0;
let slow = 0; // после 429 опрашиваем реже, потом постепенно возвращаемся

// Журнал последних входящих: что показали и почему пропустили (Настройки → Уведомления)
export const NLOG = [];
export function nlog(name, text, result) {
  NLOG.unshift({ t: Date.now(), name, text: String(text || '').slice(0, 80), result });
  NLOG.length = Math.min(NLOG.length, 30);
  bus.emit('nlog');
}

/** Окно Lumen реально перед глазами (а не свёрнуто / в трее / за игрой) */
export const reallyFocused = () => !!S.focused && document.hasFocus() && document.visibilityState === 'visible';

// Сторож: если запрос к FunPay завис (сеть, сон ПК) — опрос не должен остановиться навсегда
setInterval(() => {
  if (running && startedAt && Date.now() - startedAt > 75000) {
    gen++;
    running = false;
    again = false;
    status('err', 'FunPay долго не отвечал — переподключаюсь');
    loop();
  }
}, 15000);

export const setOpenProvider = (fn) => (provider = fn);

export async function start() {
  stop();
  gen++;
  first = true;
  known.clear();
  // новый аккаунт: сбрасываем статус, иначе «На связи» после первого опроса не покажется
  // (надпись так и висела «Подключаюсь…», хотя всё работало)
  CS.status = 'load';
  CS.error = '';
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
  if (!S.backend) {
    // аккаунт ещё подключается — не бросаем опрос, пробуем позже
    clearTimeout(timer);
    timer = setTimeout(loop, 2000);
    return;
  }
  const my = gen;
  running = true;
  startedAt = Date.now();
  try {
    const { node, lastId } = provider();
    const r = await S.backend.poll(node, lastId);
    if (my !== gen) return;
    if (r.chats) handleChats(r.chats);
    if (r.messages?.length && node) bus.emit('messages', node, r.messages);
    status('ok');
  } catch (e) {
    if (my !== gen) return;
    const msg = e.message || String(e);
    // 429 — FunPay просит не спешить (часто из-за плагинов/статистики): это не обрыв связи
    if (/429/.test(msg)) {
      slow = Math.min(4, slow + 1);
      status('ok', 'FunPay просит не спешить — проверяю реже');
    } else status('err', msg);
  } finally {
    if (my === gen) running = false;
  }
  if (my !== gen) return;
  const base = Math.max(2, +S.settings.pollInterval || 3) * 1000;
  if (CS.status === 'ok' && !CS.error && slow) slow--;
  const wait = again ? 50 : CS.status === 'err' ? Math.min(30000, base * 3) : (reallyFocused() ? base : base * 1.6) * (1 + slow);
  again = false;
  clearTimeout(timer);
  timer = setTimeout(loop, wait);
}

function handleChats(list) {
  const fresh = [];
  const readElsewhere = [];
  for (const c of list) {
    const prev = known.get(c.id);
    if (!first && (prev === undefined || c.nodeMsg > prev)) {
      if (c.unread) fresh.push({ c, isNew: !seen.has(c.id) });
      // сообщение уже прочитано в другом месте (бот, телефон, сайт) — FunPay снял «непрочитано»,
      // но уведомить всё равно нужно: смотрим, кто написал
      else readElsewhere.push({ c, prev: prev || 0, isNew: !seen.has(c.id) });
    }
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
  if (readElsewhere.length) checkReadElsewhere(readElsewhere.slice(0, 10));
}

// Чаты, где новое сообщение кто-то уже прочитал. /chat/history не отмечает чат прочитанным.
const checking = new Set();
async function checkReadElsewhere(items) {
  const my = gen;
  const me = String(S.me?.userId || '');
  for (const { c, prev, isNew } of items) {
    if (checking.has(c.id) || !S.backend?.history) continue;
    checking.add(c.id);
    try {
      // FunPay иногда не отвечает с первого раза — раньше такое уведомление терялось молча, теперь 3 попытки
      let r = null;
      for (let i = 0; i < 3 && !r; i++) {
        try {
          r = await S.backend.history(c.id);
        } catch (e) {
          if (i === 2) throw e;
          await new Promise((res) => setTimeout(res, 3000 * (i + 1)));
          if (my !== gen) return;
        }
      }
      if (my !== gen) return;
      // только чужие (покупатель или FunPay об оплате); свои и ответы бота с твоего аккаунта — пропускаем
      const news = (r.messages || []).filter((m) => m.id > prev && m.id <= c.nodeMsg && String(m.authorId) !== me);
      const m = news[news.length - 1];
      if (m) incoming({ ...c, preview: m.text || (m.image ? 'Изображение' : c.preview) }, isNew);
    } catch (e) {
      nlog(c.name, c.preview, 'не проверил чат: ' + (e.message || 'нет связи'));
    } finally {
      checking.delete(c.id);
    }
  }
}

function incoming(c, isNew) {
  const m = meta(c.id);
  const isOrder = /оплатил заказ|paid for order/i.test(c.preview);
  bus.emit('incoming', c);
  const open = provider().node === c.id && reallyFocused() && S.view === 'chats';
  const dnd = dndTick();
  if (dnd) dndIncoming(c);
  if (m.muted) nlog(c.name, c.preview, 'пропущено: чат без звука');
  else if (open) nlog(c.name, c.preview, 'чат открыт — уведомление не нужно');
  else if (dnd) nlog(c.name, c.preview, 'пропущено: «Не беспокоить»');
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


/** Чат, открытый (или последний открытый) во вкладке «Чаты». */
export const openNode = () => provider().node;
