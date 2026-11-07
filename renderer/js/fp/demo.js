// Демо-режим: выдуманные чаты, заказы и лоты — чтобы посмотреть программу без аккаунта.
const now = Date.now();
const MIN = 60e3,
  H = 3600e3,
  D = 86400e3;
const ME = { userId: '1000001', username: 'LumenSeller', avatar: '', balance: '12 480 ₽' };

const lots = [
  { cat: 'Telegram · Premium', node: '1004', items: [['Telegram Premium 1 месяц · вход в аккаунт', 249], ['Telegram Premium 12 месяцев · подарком', 2190], ['Звёзды Telegram · 100 ⭐', 159]] },
  { cat: 'ChatGPT · Подписки', node: '2031', items: [['ChatGPT Plus 1 месяц · на ваш аккаунт', 1490], ['ChatGPT Plus · общий аккаунт · 30 дней', 590]] },
  { cat: 'Steam · Аренда аккаунтов', node: '3310', items: [['Аренда CS2 Prime · 2 часа · выдача сразу', 69], ['Аренда аккаунта с Rust · 3 часа', 119], ['Аренда GTA V · 2 часа', 79]] },
  { cat: 'Discord · Nitro', node: '4120', items: [['Discord Nitro 1 месяц · подарочная ссылка', 399]] },
];

const people = [
  ['darkness21', 'Оплатил. Ключ ещё есть?'],
  ['sanych', 'спасибо, всё работает 🔥'],
  ['MoonWalker', 'А на 3 часа можно продлить?'],
  ['Alina_K', 'Добрый вечер! Подписка придёт на этот аккаунт?'],
  ['vitalya228', 'го скидку 😅'],
  ['FrostByte', 'Отзыв оставил, ещё приду'],
  ['NeoGamer', 'Норм, зашёл'],
  ['KeyMaster', 'Есть опт? Нужно штук 20'],
  ['prosto_vasya', 'а как подтвердить заказ'],
  ['Zefir', 'ок'],
  ['bloodhound', 'Пароль не подходит'],
  ['kotik_pro', 'Привет, а это навсегда?'],
];

let msgId = 900000;
const chats = people.map(([name, last], i) => {
  const id = String(500 + i);
  const uid = String(2000 + i);
  const t0 = now - i * 47 * MIN - (i > 6 ? D : 0) - (i > 9 ? 3 * D : 0);
  const order = `${'ABCDEFGHJK'[i % 10]}${(7319 + i * 37).toString(36).toUpperCase()}${'QWXZ'[i % 4]}${i}R`.slice(0, 8).toUpperCase().padEnd(8, 'X');
  const lot = lots[i % lots.length].items[i % lots[i % lots.length].items.length];
  const m = (author, text, dt, extra = {}) => ({ id: ++msgId, authorId: author === 'me' ? ME.userId : author === 'fp' ? '0' : uid, author: author === 'me' ? ME.username : author === 'fp' ? 'FunPay' : name, avatar: '', ts: t0 - dt, text, badge: author === 'fp' ? 'оповещение' : '', ...extra });
  const messages = [
    m('peer', i % 3 === 0 ? 'Привет! Ещё актуально?' : 'Здравствуйте', 38 * MIN),
    m('me', 'Привет! Да, в наличии — можно оплачивать, выдам сразу 👌', 36 * MIN),
    m('fp', `Покупатель ${name} оплатил заказ #${order}. ${lot[0]}, ${lot[1]} ₽. ${name}, не забудьте потом нажать кнопку «Подтвердить выполнение заказа».`, 30 * MIN),
    m('me', 'Данные для входа:\nЛогин: lumen_' + (100 + i) + '\nПароль: ********\n\nЕсли что-то не так — пиши сюда 🙌', 28 * MIN),
  ];
  if (i === 0) messages.push(m('peer', '', 2 * MIN, { image: demoImg('#7c3aed', '#22d3ee'), thumb: demoImg('#7c3aed', '#22d3ee') }));
  if (i === 2) messages.push(m('fp', `Покупатель ${name} подтвердил успешное выполнение заказа #${order} и отправил деньги продавцу ${ME.username}.`, 10 * MIN));
  messages.push(m('peer', last, 0));
  return {
    id,
    uid,
    name,
    order,
    lot,
    cat: lots[i % lots.length].cat,
    preview: last,
    time: i < 4 ? new Date(t0).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : i < 8 ? 'вчера' : '02.11',
    avatar: '',
    nodeMsg: msgId,
    userMsg: i < 3 ? msgId - 1 : msgId,
    unread: i < 3,
    messages,
    online: i % 3 !== 2,
  };
});

function demoImg(a, b) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="640" height="400" fill="url(#g)"/><text x="320" y="210" font-family="Inter,Arial" font-size="34" fill="white" text-anchor="middle" opacity=".9">скрин оплаты.png</text></svg>`;
  return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
}

const incoming = ['А можно ещё один?', 'Спасибо большое!', 'Оплатил, жду 🙏', 'Подскажите, сколько ждать?', 'Всё пришло, топ продавец', 'Есть скидка если возьму два?'];
let lastPush = Date.now();
const wait = (ms = 250 + Math.random() * 350) => new Promise((r) => setTimeout(r, ms));
const pub = (c) => ({ id: c.id, name: c.name, preview: c.preview, time: c.time, avatar: c.avatar, nodeMsg: c.nodeMsg, userMsg: c.userMsg, unread: c.unread, users: [ME.userId, c.uid] });

function push(c, msg) {
  c.messages.push(msg);
  c.nodeMsg = msg.id;
  c.preview = msg.text || 'Изображение';
  c.time = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  chats.splice(chats.indexOf(c), 1);
  chats.unshift(c);
}

const orders = chats.map((c, i) => ({
  id: c.order,
  state: i < 2 ? 'paid' : i === 6 ? 'refunded' : 'closed',
  statusText: i < 2 ? 'Оплачен' : i === 6 ? 'Возврат' : 'Закрыт',
  desc: c.lot[0],
  game: lots[i % lots.length].cat,
  price: `${c.lot[1]} ₽`,
  amount: c.lot[1],
  currency: '₽',
  peer: c.name,
  peerId: c.uid,
  peerAvatar: '',
  date: i < 4 ? `Сегодня, ${chats[i].time}` : i < 8 ? 'Вчера, 18:2' + i : `${2 + (i % 3)} ноября, 1${i % 10}:05`,
  chat: c.id,
}));

const txns = [];
for (let i = 0; i < 26; i++) {
  const t = now - i * 9 * H - (i % 3) * H;
  const o = orders[i % orders.length];
  const out = i % 9 === 4;
  txns.push({
    id: 't' + i,
    title: out ? 'Вывод денег на карту' : `Заказ #${o.id}`,
    state: i < 3 ? 'wait' : i === 11 ? 'cancel' : 'done',
    amount: out ? -2500 : Math.round(o.amount * 0.92),
    currency: '₽',
    amountText: '',
    date: new Date(t).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }),
    ts: t,
    payment: '',
    orderId: out ? '' : o.id,
  });
}

let lotId = 70000;
const myLots = lots.map((g) => ({ node: g.node, name: g.cat, url: '#', chips: false, lots: g.items.map(([title, price], j) => ({ id: String(++lotId), node: g.node, title, price: `${price} ₽`, priceNum: price, unit: '₽', amount: j === 1 ? '∞' : String(3 + j * 4), server: '', active: !(g.node === '4120'), auto: j === 0, url: '#' })) }));

export function createDemo() {
  return {
    demo: true,
    accId: 'demo',
    url: (p) => 'https://funpay.com' + p,
    async auth() {
      await wait(500);
      return { ...ME };
    },
    async chats() {
      await wait();
      return chats.map(pub);
    },
    async poll(openNode, lastId) {
      // примерно раз в 25 секунд «пишет» покупатель
      if (Date.now() - lastPush > 25000 + Math.random() * 15000) {
        lastPush = Date.now();
        const c = chats[Math.floor(Math.random() * 6)];
        push(c, { id: ++msgId, authorId: c.uid, author: c.name, avatar: '', ts: Date.now(), text: incoming[Math.floor(Math.random() * incoming.length)], badge: '' });
        if (c.id !== openNode) c.unread = true;
      }
      const c = chats.find((x) => x.id === openNode);
      if (c) {
        c.unread = false;
        c.userMsg = c.nodeMsg;
      }
      return { chats: chats.map(pub), messages: c ? c.messages.filter((m) => m.id > (lastId || 0)) : null };
    },
    async openChat(node) {
      await wait(350);
      const c = chats.find((x) => x.id === node);
      if (!c) throw new Error('Чат не найден');
      return { nodeName: `users-${ME.userId}-${c.uid}`, nodeId: c.id, peerId: c.uid, peerName: c.name, peerStatus: c.online ? 'Онлайн' : 'Был 2 часа назад', peerAvatar: '', lotName: `${c.cat}, ${c.lot[0]}`, lotUrl: '#', messages: c.messages.map((m) => ({ ...m })) };
    },
    async history() {
      await wait();
      return { messages: [], more: false };
    },
    async send(node, text) {
      await wait(300);
      const c = chats.find((x) => x.id === node);
      push(c, { id: ++msgId, authorId: ME.userId, author: ME.username, avatar: '', ts: Date.now(), text, badge: '' });
      c.userMsg = c.nodeMsg;
      if (Math.random() < 0.6)
        setTimeout(() => {
          push(c, { id: ++msgId, authorId: c.uid, author: c.name, avatar: '', ts: Date.now(), text: ['Ок, спасибо!', 'Понял 👍', 'Супер'][Math.floor(Math.random() * 3)], badge: '' });
        }, 3500);
    },
    async sendImage(node, file) {
      const url = URL.createObjectURL(file);
      const c = chats.find((x) => x.id === node);
      await wait(600);
      push(c, { id: ++msgId, authorId: ME.userId, author: ME.username, avatar: '', ts: Date.now(), text: '', image: url, thumb: url, badge: '' });
    },
    async markRead(node) {
      const c = chats.find((x) => x.id === node);
      if (c) c.unread = false;
    },
    async order(id) {
      await wait(400);
      const o = orders.find((x) => x.id === id) || orders[0];
      const c = chats.find((x) => x.order === o.id);
      return {
        id: o.id,
        status: o.statusText,
        statusKind: o.state === 'paid' ? 'info' : o.state === 'refunded' ? 'warn' : 'ok',
        game: o.game,
        shortDesc: o.desc,
        price: o.price,
        params: [['Категория', o.game], ['Краткое описание', o.desc], ['Количество', '1 шт.'], ['Способ получения', 'Автовыдача']],
        canRefund: o.state === 'paid',
        canConfirm: false,
        isBuyer: false,
        peerName: o.peer,
        peerId: o.peerId,
        peerAvatar: '',
        review: o.state === 'closed' ? { rating: 5, text: 'Всё быстро и чётко, рекомендую продавца!', reply: o.id.endsWith('R') ? '' : 'Спасибо, заходи ещё 🙌', replyMine: true } : null,
        lotUrl: '#',
        chatNode: c?.id,
      };
    },
    async refund(id) {
      await wait();
      const o = orders.find((x) => x.id === id);
      Object.assign(o, { state: 'refunded', statusText: 'Возврат' });
    },
    async confirm() {},
    async review() {
      await wait();
    },
    async reviewDelete() {
      await wait();
    },
    async trades(kind, state) {
      await wait(450);
      if (kind !== 'sales') return { items: orders.slice(4, 7).map((o) => ({ ...o, peer: 'ShopKeeper', state: 'closed', statusText: 'Закрыт' })), next: '' };
      return { items: orders.filter((o) => !state || o.state === state), next: '' };
    },
    async transactions() {
      await wait(450);
      return { items: txns, next: '' };
    },
    async profile(id) {
      await wait(450);
      const c = chats.find((x) => x.uid === id);
      const mine = id === ME.userId;
      return {
        userId: id,
        name: mine ? ME.username : c?.name || 'user' + id,
        avatar: '',
        status: mine || c?.online ? 'Онлайн' : 'Был 2 часа назад',
        online: mine || !!c?.online,
        regDate: '14 марта 2024',
        regAgo: '1 год назад',
        rating: mine ? '4.9' : '5',
        reviewsCount: mine ? '1 284 отзыва' : '12 отзывов',
        groups: mine ? myLots.map((g) => ({ name: g.name, url: '#', offers: g.lots.filter((l) => l.active).map((l) => ({ title: l.title, price: l.price, server: '', amount: l.amount, url: '#' })) })) : [],
        reviews: chats.slice(0, 6).map((x, i) => ({ rating: i === 4 ? 4 : 5, text: ['Всё супер, быстро!', 'Лучший продавец, беру не первый раз', 'Выдал за минуту 🔥', 'Рекомендую', 'Немного подождал, но всё ок', 'Топ'][i], date: ['сегодня', 'вчера', '3 дня назад', 'неделю назад', '2 недели назад', 'месяц назад'][i], detail: `${x.lot[0].split('·')[0]}, ${x.lot[1]} ₽`, reply: i % 2 ? '' : 'Спасибо! 💜', author: x.name, order: x.order })),
        cont: '',
        chatNode: mine ? '' : `users-${ME.userId}-${id}`,
        chatId: c?.id,
      };
    },
    async moreReviews() {
      return { reviews: [], next: '' };
    },
    async myLots() {
      await wait(500);
      return structuredClone(myLots);
    },
    async raiseGames() {
      await wait(300);
      return myLots.map((g, i) => ({ game: String(40 + i), title: g.name, nodes: [g.node] }));
    },
    async raiseGame(game) {
      await wait(700);
      if (game === '42') return { ok: false, msg: 'Подождите 2 часа.', wait: 1.5 * H };
      return { ok: true, msg: 'Предложения подняты', wait: H };
    },
    async txnInfo(id) {
      await wait(400);
      const t = txns.find((x) => x.id === id) || txns[0];
      return { title: t.title, rows: [['Дата операции', t.date], ['Описание', t.title], ['Сумма', `${t.amount > 0 ? '+' : '−'} ${Math.abs(t.amount)} ₽`], ['Статус', t.state === 'wait' ? 'Ожидает' : t.state === 'cancel' ? 'Отменено' : 'Выполнено'], ...(t.amount < 0 ? [['Внешняя транзакция', '104148b2e2']] : [])], link: t.amount < 0 ? 'https://tronscan.org/' : '' };
    },
    async salesSince(cutoff, maxPages, progress) {
      await wait(500);
      const now = Date.now();
      const items = [];
      for (let i = 0; i < 60; i++) {
        const o = orders[i % orders.length];
        items.push({ ...o, state: i % 11 === 6 ? 'refunded' : i < 2 ? 'paid' : 'closed', ts: now - i * 11 * H });
      }
      progress?.(items.length);
      return items.filter((x) => !cutoff || x.ts >= cutoff).map((x) => ({ ...x, date: new Date(x.ts).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) }));
    },
    async lotDelete(lot) {
      await wait();
      for (const g of myLots) g.lots = g.lots.filter((l) => l.id !== lot.id);
    },
    async lotSetActive(lot, on) {
      await wait();
      const l = myLots.flatMap((g) => g.lots).find((x) => x.id === lot.id);
      if (l) l.active = on;
    },
    async lotSetPrice(lot, price) {
      await wait();
      const l = myLots.flatMap((g) => g.lots).find((x) => x.id === lot.id);
      if (l) Object.assign(l, { priceNum: +price, price: `${price} ₽` });
    },
    async lotNewForm(node) {
      await wait(400);
      return {
        form: [['node_id', String(node)], ['offer_id', '0'], ['fields[summary][ru]', ''], ['fields[summary][en]', ''], ['fields[desc][ru]', ''], ['fields[desc][en]', ''], ['price', ''], ['amount', '']],
        selects: [
          { name: 'fields[type]', label: 'Тип пополнения', value: '', options: [{ value: '', text: '' }, { value: '1', text: 'С заходом на аккаунт' }, { value: '2', text: 'Кодом' }] },
          { name: 'fields[country]', label: 'Страна', value: '', options: [{ value: '', text: '' }, { value: 'ua', text: 'Украина' }, { value: 'tr', text: 'Турция' }, { value: 'gb', text: 'Великобритания' }] },
          { name: 'fields[gbp]', label: 'Количество GBP', value: '', options: [{ value: '', text: '' }, ...[5, 10, 20].map((n) => ({ value: 'g' + n, text: String(n) }))] },
          { name: 'fields[uah]', label: 'Количество UAH', value: '', options: [{ value: '', text: '' }, ...[50, 100, 175, 250, 400, 600, 1000, 2000].map((n) => ({ value: 'u' + n, text: String(n) }))] },
          { name: 'fields[try]', label: 'Количество TRY', value: '', options: [{ value: '', text: '' }, ...[100, 250, 500].map((n) => ({ value: 't' + n, text: String(n) }))] },
        ],
      };
    },
    async lotCreate(f) {
      await wait(900);
      let g = myLots.find((x) => x.node === String(f.node));
      if (!g) myLots.push((g = { node: String(f.node), name: 'Новый раздел', url: '#', chips: false, lots: [] }));
      const id = String(++lotId);
      g.lots.unshift({ id, node: g.node, title: f.title.ru, price: `${f.price} ₽`, priceNum: +f.price, unit: '₽', amount: String(f.amount), server: '', active: true, auto: false, url: `https://funpay.com/lots/offer?id=${id}` });
      return { id, url: `https://funpay.com/lots/offer?id=${id}` };
    },
    async withdrawRate() {
      await wait(500);
      return { rate: 80.12, fee: 6, min: 150, info: 'Комиссия 6%, но не менее 150 ₽, курс 80.12' };
    },
    async openBrowser(url) {
      window.open(url || 'https://funpay.com/', '_blank');
    },
  };
}
