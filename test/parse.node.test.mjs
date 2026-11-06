// Разбор страниц FunPay в Node (как в движке автоматики): те же проверки, что в parse.test.html, но через linkedom.
import { ensureDOM } from '../engine/node.js';
await ensureDOM();
const P = await import('../renderer/js/fp/parse.js');
const { parseFpDate, richText, findOrderIds } = await import('../renderer/js/core/util.js');
const out = [];
const eq = (a, b, m) => { const ok = JSON.stringify(a) === JSON.stringify(b); out.push((ok ? 'ok   ' : 'FAIL ') + m + (ok ? '' : `  got ${JSON.stringify(a)} want ${JSON.stringify(b)}`)); };

// список чатов
const bm = P.parseBookmarks(`<a href="https://funpay.com/chat/?node=123" class="contact-item unread" data-id="123" data-node-msg="500" data-user-msg="400">
<div class="contact-item-photo"><div class="avatar-photo" style="background-image: url(https://sfunpay.com/s/avatar/x.jpg);"></div></div>
<div class="media-user-name">darkness21</div><div class="contact-item-message">Оплатил. Ключ ещё есть?</div><div class="contact-item-time">14:18</div></a>
<a class="contact-item" data-id="77" data-node-msg="9" data-user-msg="9"><div class="media-user-name">sanych</div><div class="contact-item-message">ok</div><div class="contact-item-time">вчера</div></a>`);
eq(bm.length, 2, 'bookmarks count');
eq([bm[0].unread, bm[1].unread], [true, false], 'bookmarks unread');
eq(bm[0].avatar, 'https://sfunpay.com/s/avatar/x.jpg', 'bookmarks avatar');
eq(bm[0].nodeMsg, 500, 'bookmarks nodeMsg');
eq(bm[1].name, 'sanych', 'bookmarks name');

// сообщения: склейка автора, картинка, оповещение FunPay
const html = `<div class="chat-message-list">
<div class="chat-msg-item chat-msg-with-head" id="message-10"><div class="chat-message">
<div class="media-left"><a href="/users/5/"><div class="avatar-photo" style="background-image: url(/img/a.jpg);"></div></a></div>
<div class="media-user-name"><a href="https://funpay.com/users/5/" class="chat-msg-author-link">bob</a>
<div class="chat-msg-date" title="28 октября, 16:24:52">16:24:52</div></div>
<div class="chat-msg-body"><div class="chat-msg-text">привет<br>как дела &amp; всё</div></div></div></div>
<div class="chat-msg-item" id="message-11"><div class="chat-message"><div class="chat-msg-body">
<a class="chat-img-link" href="https://sfunpay.com/s/chat/a/b.jpg"><img class="chat-img" src="https://sfunpay.com/s/chat/a/b_t.jpg"></a></div></div></div>
<div class="chat-msg-item chat-msg-with-head" id="message-12"><div class="chat-message">
<div class="media-user-name">FunPay <span class="chat-msg-author-label label label-primary">оповещение</span>
<div class="chat-msg-date" title="28 октября, 16:30:00">16:30:00</div></div>
<div class="chat-msg-body"><div class="chat-msg-text">Покупатель bob оплатил заказ #ABCDEF12.</div></div></div></div></div>`;
const ctx = P.newCtx();
const page = P.parseChatPage(`<html><body>${html}</body></html>`, ctx);
const m = page.messages;
eq(m.length, 3, 'messages count');
eq([m[0].author, m[0].authorId, m[0].text], ['bob', '5', 'привет\nкак дела & всё'], 'msg 1');
eq(m[0].avatar, 'https://funpay.com/img/a.jpg', 'msg avatar');
eq([m[1].author, m[1].authorId, m[1].image, m[1].thumb], ['bob', '5', 'https://sfunpay.com/s/chat/a/b.jpg', 'https://sfunpay.com/s/chat/a/b_t.jpg'], 'msg 2 inherits author + image');
eq([m[2].author, m[2].authorId, m[2].badge], ['FunPay', '0', 'оповещение'], 'msg 3 FunPay');
const d = new Date(m[0].ts);
eq([d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes()], [9, 28, 13, 24], 'date MSK → UTC');

// JSON-история с author без шапки
const ctx2 = P.newCtx();
const js = P.parseMessagesJson([
  { id: 10, author: 5, html: html.split('<div class="chat-msg-item" id="message-11"')[0].replace('<div class="chat-message-list">', '') },
  { id: 13, author: 5, html: '<div class="chat-msg-item" id="message-13"><div class="chat-msg-body"><div class="chat-msg-text">ещё</div></div></div>' },
  { id: 14, author: 42, html: '<div class="chat-msg-item" id="message-14"><div class="chat-msg-body"><div class="chat-msg-text">я</div></div></div>' },
], ctx2);
eq(js.map((x) => [x.id, x.authorId, x.author]), [[10, '5', 'bob'], [13, '5', 'bob'], [14, '42', '']], 'json authors');

// форма лота
const f = P.parseOfferForm(`<form class="form-offer-editor" action="/lots/offerSave" method="post">
<input type="hidden" name="csrf_token" value="tok"><input type="hidden" name="offer_id" value="0"><input type="hidden" name="node_id" value="2046">
<select name="fields[type]"><option value="">Выберите</option><option value="a" selected>A</option></select>
<select name="server_id"><option value="11">S1</option><option value="12">S2</option></select>
<textarea name="fields[desc][ru]">старое
описание</textarea>
<input type="text" name="price" value="">
<input type="hidden" name="active" value=""><input type="checkbox" name="active" checked><input type="checkbox" name="auto_delivery">
<button type="submit" name="go">Сохранить</button></form>`);
const g = (k) => f.filter((x) => x[0] === k).map((x) => x[1]);
eq(g('csrf_token'), ['tok'], 'form csrf');
eq(g('fields[type]'), ['a'], 'form select selected');
eq(g('server_id'), ['11'], 'form select first');
eq(g('fields[desc][ru]'), ['старое\nописание'], 'form textarea');
eq(g('active'), ['', 'on'], 'form checkbox + hidden twin');
eq([g('auto_delivery').length, g('go').length], [0, 0], 'form skips unchecked/buttons');

// мои лоты
const lots = P.parseMyLots(`<div class="offer"><div class="offer-list-title"><h3><a href="https://funpay.com/lots/1004/">Telegram, Premium</a></h3></div>
<a href="https://funpay.com/lots/offer?id=555" class="tc-item"><div class="tc-desc-text">Премиум 1 мес</div><div class="tc-amount">5</div><div class="tc-price" data-s="249"><div>249 <span class="unit">₽</span></div></div><i class="auto-dlv-icon"></i></a>
<a href="https://funpay.com/lots/offer?id=556" class="tc-item warning"><div class="tc-desc-text">Премиум 12</div><div class="tc-price" data-s="2190.5"><div>2 190.5 <span class="unit">₽</span></div></div></a></div>`);
eq([lots[0].node, lots[0].lots.length, lots[0].lots[0].id, lots[0].lots[0].priceNum, lots[0].lots[0].auto, lots[0].lots[1].active, lots[0].lots[1].priceNum], ['1004', 2, '555', 249, true, false, 2190.5], 'my lots');

// продажи
const tr = P.parseTrade(`<a href="https://funpay.com/orders/ABCD1234/" class="tc-item info"><div class="tc-date-time">Сегодня, 12:00</div><div class="tc-order">#ABCD1234</div><div class="order-desc"><div>Премиум 1 мес Telegram</div><div class="text-muted">Telegram</div></div><div class="media-user-name"><span data-href="https://funpay.com/users/77/">sanych</span></div><div class="tc-status text-primary">Оплачен</div><div class="tc-price">249 <span class="unit">₽</span></div></a><input name="continue" value="xyz">`);
eq([tr.items[0].id, tr.items[0].state, tr.items[0].desc, tr.items[0].game, tr.items[0].peerId, tr.items[0].amount, tr.next], ['ABCD1234', 'paid', 'Премиум 1 мес', 'Telegram', '77', 249, 'xyz'], 'trade');

eq(P.parseAmount('− 2 500,50 ₽'), { amount: -2500.5, currency: '₽' }, 'amount minus');
eq(P.parseAmount('+ 1 250 $'), { amount: 1250, currency: '$' }, 'amount plus');
eq([P.parseWait('Подождите 2 часа.'), P.parseWait('Подождите 15 минут.')], [7200000, 900000], 'raise wait');
eq(findOrderIds('заказ #ABCD1234 и #QWERTY99'), ['ABCD1234', 'QWERTY99'], 'order ids');
eq(richText('<b> https://funpay.com/x #ABCD1234').includes('&lt;b&gt;'), true, 'richText escapes');
eq(!!parseFpDate('вчера, 10:00') && !!parseFpDate('12.03.25, 10:00') && !!parseFpDate('16:24'), true, 'dates parse');


const bad = out.filter((x) => x.startsWith('FAIL'));
if (bad.length) {
  console.error(bad.join('\n'));
  process.exit(1);
}
console.log('parse (linkedom): все проверки прошли — ' + out.length);
