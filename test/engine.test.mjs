// © 2026 Lumen. Все права защищены. Копирование, изменение и распространение этого кода запрещены без разрешения автора (см. LICENSE).
// Движок автоматики на подставном аккаунте: приветствие, автоответ, автовыдача, спасибо, отзыв, чёрный список, плагины.
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Engine } from '../engine/engine.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-eng-'));
const pdir = path.join(dir, 'plugins');
fs.mkdirSync(pdir, { recursive: true });
fs.writeFileSync(
  path.join(pdir, 'echo.js'),
  `export default { id: 'echo', name: 'Эхо', settings: [{ key: 'prefix', default: '> ' }],
    async onMessage(e, api) { if (e.text === 'эхо') await api.send(e.chat.id, api.settings.prefix + e.text); api.storage.set('n', api.storage.get('n', 0) + 1); },
    onOrder(e, api) { api.notify('заказ ' + e.order.id); },
    commands: { '/ping': (api) => 'pong' } };`
);
fs.writeFileSync(path.join(pdir, 'broken.js'), 'export default {{{');

const sent = [];
const msgs = new Map();
let polls = [];
let sales = [];
const acc = {
  me: () => ({ userId: '42', username: 'me' }),
  auth: async () => ({ userId: '42', username: 'me' }),
  pollTags: async (tags) => polls.shift() || {},
  lastMessages: async (id) => msgs.get(id) || [],
  trades: async () => ({ items: sales, next: '' }),
  order: async (id) => (id === 'REV00001' ? { id, peerName: 'bob', shortDesc: 'Ключ', isBuyer: false, review: { rating: 5, text: 'топ', reply: '' }, params: [] } : { id, params: [['Количество', '2 шт.']] }),
  orderAmount: (o) => parseInt((o.params.find(([k]) => /Количество/.test(k)) || [, '1'])[1], 10),
  chatWith: (uid) => `users-42-${uid}`,
  send: async (node, text) => sent.push([node, text]),
  review: async (id, text) => sent.push(['review:' + id, text]),
  lotSetActive: async (lot, on) => sent.push(['lot:' + lot.id, on]),
  raiseGames: async () => [{ game: '41', title: 'TG', nodes: ['1'] }],
  raiseGame: async () => ({ ok: true, msg: 'ok', wait: 3600e3 }),
};
const chat = (id, name, nodeMsg, userMsg = nodeMsg) => ({ id, name, preview: '', nodeMsg, userMsg, unread: nodeMsg > userMsg });
const m = (id, authorId, author, text) => ({ id, authorId, author, text });

const eng = new Engine({ account: acc, dataDir: dir, pluginsDir: pdir });
Object.assign(eng.cfg.greeting, { on: true, text: 'Привет, $username!' });
eng.cfg.commands.rules.push({ id: 'c1', triggers: '!помощь, помощь', text: 'Чем помочь, $username?' });
eng.cfg.delivery.rules.push({ id: 'r1', name: 'Steam ключ', text: 'Ваш ключ:\n$product', lotId: '555', disableWhenEmpty: true });
eng.addProducts(eng.cfg.delivery.rules[0], ['KEY-1', 'KEY-2', 'KEY-3']);
Object.assign(eng.cfg.thanks, { on: true, text: 'Спасибо за $order_id' });
eng.cfg.reviews.on = true;
eng.cfg.blacklist.users = ['spammer'];
eng.cfg.plugins.echo = { on: true, settings: {} };
const events = [];
for (const ev of ['message', 'order', 'orderStatus', 'delivered', 'review', 'notify', 'command']) eng.on(ev, (e) => events.push(ev));

// 1) первый опрос: запоминаем, ничего не делаем
polls.push({ chats: [chat('1', 'old', 10)], counters: {} });
sales = [{ id: 'OLD00001', state: 'paid', desc: 'Steam ключ', peer: 'x', peerId: '7' }];
await eng.start();
await new Promise((r) => setTimeout(r, 50));
clearTimeout(eng.timer);
assert.deepEqual(sent, [], 'первый опрос ничего не отправляет');
assert.equal(eng.plugins.all().find((p) => p.id === 'echo').on, true);
assert.ok(eng.plugins.all().find((p) => p.file === 'broken.js').error, 'сломанный плагин помечен, но не мешает');

// 2) новые сообщения: старый чат (без приветствия) + новый чат (приветствие + автоответ) + плагин + чёрный список
msgs.set('1', [m(10, '7', 'old', 'x'), m(11, '7', 'old', 'эхо')]);
msgs.set('2', [m(20, '8', 'newbie', '!Помощь')]);
msgs.set('3', [m(30, '9', 'spammer', 'помощь')]);
polls.push({ chats: [chat('1', 'old', 11, 10), chat('2', 'newbie', 20, 0), chat('3', 'spammer', 30, 0)] });
await eng.tick();
assert.deepEqual(sent, [['1', '> эхо'], ['2', 'Привет, newbie!'], ['2', 'Чем помочь, newbie?']], JSON.stringify(sent));
sent.length = 0;

// 3) новый заказ: выдача 2 шт по «Количество», заказ из ЧС пропускается
sales = [
  { id: 'NEW00001', state: 'paid', desc: 'Steam ключ GTA V, 2 шт.', price: '200 ₽', peer: 'newbie', peerId: '8' },
  { id: 'BAD00001', state: 'paid', desc: 'Steam ключ', peer: 'spammer', peerId: '9' },
  ...sales,
];
polls.push({ counters: { seller: 2 } });
await eng.tick();
assert.deepEqual(sent, [['users-42-8', 'Ваш ключ:\nKEY-1\nKEY-2']], JSON.stringify(sent));
assert.deepEqual(eng.products(eng.cfg.delivery.rules[0]), ['KEY-3']);
sent.length = 0;

// 4) заказ подтверждён → спасибо; отзыв → ответ
sales[0].state = 'closed';
msgs.set('2', [m(20, '8', 'newbie', '!Помощь'), m(21, '0', 'FunPay', 'Покупатель bob написал отзыв к заказу #REV00001.')]);
polls.push({ chats: [chat('2', 'newbie', 21, 20)], counters: { seller: 1 } });
await eng.tick();
assert.deepEqual(sent, [['review:REV00001', 'Спасибо за отзыв, bob! Рад, что всё понравилось 💜'], ['users-42-8', 'Спасибо за #NEW00001']], JSON.stringify(sent));
sent.length = 0;

// 5) последний товар → лот выключается
sales.unshift({ id: 'NEW00002', state: 'paid', desc: 'Steam ключ', peer: 'z', peerId: '5' });
acc.order = async (id) => ({ id, params: [] });
polls.push({ counters: { seller: 3 } });
await eng.tick();
assert.deepEqual(sent, [['users-42-5', 'Ваш ключ:\nKEY-3'], ['lot:555', false]], JSON.stringify(sent));
sent.length = 0;

// 6) товара нет → не отправляем, событие deliveryEmpty
let empty = 0;
eng.on('deliveryEmpty', () => empty++);
sales.unshift({ id: 'NEW00003', state: 'paid', desc: 'Steam ключ', peer: 'q', peerId: '4' });
polls.push({ counters: { seller: 4 } });
await eng.tick();
assert.equal(empty, 1);
assert.deepEqual(sent, [['lot:555', false]]);

// 7) плагины: команды, хранилище, выключение
assert.equal(await eng.plugins.commands()['/ping'].fn(eng.plugins.api('echo')), 'pong');
assert.equal(eng.plugins.api('echo').storage.get('n'), 4);
await eng.plugins.setEnabled('echo', false);
assert.equal(Object.keys(eng.plugins.commands()).length, 0);

// 8) поднятие
const raised = await eng.raiseDue(true);
assert.equal(raised[0].ok, true);

assert.ok(events.includes('delivered') && events.includes('review') && events.includes('notify') && events.includes('orderStatus'));
await eng.stop();
console.log('engine: все проверки прошли');
