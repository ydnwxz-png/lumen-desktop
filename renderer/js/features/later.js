// Отложенные сообщения и режим «Не беспокоить».
import { S, bus, persist } from '../core/state.js';
import { err, toast } from '../ui/kit.js';
import { pollNow, CS } from './poller.js';

// ---------------------------------------------------------------- отложенные
export const L = { list: [] };
let timer = null;
const key = () => 'later:' + (S.accId || 'demo');

export async function loadLater() {
  L.list = (await persist.get(key(), [])) || [];
  clearInterval(timer);
  timer = setInterval(tick, 10000);
  bus.emit('later');
  tick();
}

function save() {
  persist.set(key(), L.list);
  bus.emit('later');
}

export function addLater(chat, name, text, at) {
  L.list.push({ id: 'l' + Date.now().toString(36), chat: String(chat), name, text, at });
  L.list.sort((a, b) => a.at - b.at);
  save();
}

export function cancelLater(id) {
  L.list = L.list.filter((x) => x.id !== id);
  save();
}

export async function sendLaterNow(id) {
  const x = L.list.find((y) => y.id === id);
  if (!x) return;
  cancelLater(id);
  try {
    await S.backend.send(x.chat, x.text);
    toast('Отложенное сообщение ушло', `${x.name}: ${x.text}`, { kind: 'ok', icon: 'clock', ms: 3000 });
    pollNow();
  } catch (e) {
    err(`Не отправилось отложенное сообщение в чат ${x.name}`, e);
  }
}

let ticking = false;
async function tick() {
  if (ticking || !S.backend || !S.me) return;
  ticking = true;
  try {
    for (const x of L.list.filter((y) => y.at <= Date.now())) await sendLaterNow(x.id);
  } finally {
    ticking = false;
  }
}

export function whenText(at) {
  const d = new Date(at);
  const today = new Date();
  const tm = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === today.toDateString()) return `сегодня в ${tm}`;
  if (d.toDateString() === new Date(Date.now() + 86400e3).toDateString()) return `завтра в ${tm}`;
  return `${d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })} в ${tm}`;
}

export function presets() {
  const t10 = new Date();
  t10.setDate(t10.getDate() + 1);
  t10.setHours(10, 0, 0, 0);
  return [
    ['Через 15 минут', Date.now() + 15 * 60e3],
    ['Через час', Date.now() + 3600e3],
    ['Через 3 часа', Date.now() + 3 * 3600e3],
    ['Завтра в 10:00', t10.getTime()],
  ];
}

// ---------------------------------------------------------------- не беспокоить
const replied = new Set();
let wasActive = false;

function inSchedule(d, h = new Date().getHours()) {
  const from = +d.from,
    to = +d.to;
  return from <= to ? h >= from && h < to : h >= from || h < to;
}

export function dndActive() {
  const d = S.settings.dnd || {};
  if (d.on) return true;
  if (!d.schedule || (d.snoozeUntil || 0) > Date.now()) return false;
  return inSchedule(d);
}

/** Выключить «Не беспокоить» сейчас. Расписание не трогаем: просто пропускаем текущий интервал. */
export function dndOff() {
  const d = S.settings.dnd;
  d.on = false;
  if (d.schedule && inSchedule(d)) {
    const end = new Date();
    end.setMinutes(0, 0, 0);
    do end.setHours(end.getHours() + 1);
    while (inSchedule(d, end.getHours()));
    d.snoozeUntil = end.getTime();
  }
}

export function dndOn() {
  S.settings.dnd.on = true;
  S.settings.dnd.snoozeUntil = 0;
}

export function dndTick() {
  const a = dndActive();
  if (a !== wasActive) {
    wasActive = a;
    if (!a) replied.clear();
    bus.emit('dnd', a);
  }
  return a;
}

/** Новое входящее при «Не беспокоить»: автоответ один раз в чат. */
export async function dndIncoming(c) {
  const d = S.settings.dnd || {};
  if (!d.reply || !d.text || replied.has(c.id) || /^Покупатель|^FunPay/i.test(c.preview)) return;
  replied.add(c.id);
  // ждём немного: если за это время ответил бот или автоматика — чат станет прочитанным,
  // и тогда наш «я не на связи» не нужен (иначе покупатель получит два ответа)
  await new Promise((r) => setTimeout(r, 12000));
  if (!dndActive()) return replied.delete(c.id);
  const now = CS.chats.find((x) => x.id === c.id);
  if (now && !now.unread) return;
  try {
    await S.backend.send(c.id, d.text);
    pollNow();
  } catch {}
}

setInterval(dndTick, 30000);
