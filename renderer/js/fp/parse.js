// © 2026 Lumen. Все права защищены. Копирование, изменение и распространение этого кода запрещены без разрешения автора (см. LICENSE). Частично основано на стороннем коде под лицензией MIT — см. NOTICE.txt.
// Разбор страниц FunPay (DOMParser).
import { parseFpDate, stripZW } from '../core/util.js';

const BASE = 'https://funpay.com';
// DOMParser есть в браузере; в Node (бот) его подставляет linkedom через setDOMParser.
let DP = null;
export function setDOMParser(C) {
  DP = new C();
}
export const doc = (html) => (DP ||= new globalThis.DOMParser()).parseFromString(html || '<html></html>', 'text/html');

export function absUrl(u) {
  u = String(u || '').trim();
  if (u.startsWith('//')) return 'https:' + u;
  if (u.startsWith('/')) return BASE + u;
  return u;
}

const txt = (e) => (e ? e.textContent.trim() : '');
const squash = (s) => String(s || '').replace(/\s+/g, ' ').trim();
// Продавцы забивают названия «пустыми» символами (ㅤ, ⠀ и т.п.) — превращаем их в обычный пробел.
export const cleanText = (s) =>
  String(s || '')
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, '')
    .replace(/[\u00A0\u115F\u1160\u2000-\u200A\u202F\u205F\u2800\u3000\u3164\uFFA0]/g, ' ')
    .split(/\r?\n/)
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
export const cleanTitle = (s) =>
  squash(String(s || '').replace(/[\u200B-\u200D\u2060\uFEFF]/g, '').replace(/[\u00A0\u115F\u1160\u2000-\u200A\u2028\u2029\u202F\u205F\u2800\u3000\u3164\uFFA0]/g, ' '));
const userIdOf = (href) => (/\/users\/(\d+)/.exec(href || '') || [])[1] || '';

function avatarOf(e) {
  if (!e) return '';
  const img = e.matches('img') ? e : e.querySelector('img');
  if (img && img.getAttribute('src')) return absUrl(img.getAttribute('src'));
  const m = /url\(\s*['"]?([^'")]+)['"]?\s*\)/.exec(e.getAttribute('style') || '');
  return m ? absUrl(m[1]) : '';
}

function ownText(e) {
  let s = '';
  for (const n of e.childNodes) if (n.nodeType === 3) s += n.textContent;
  return s.trim();
}

/** Текст с переносами строк: <br> → \n. */
export function textWithBreaks(e) {
  if (!e) return '';
  // через innerHTML — одинаково работает и в браузере, и в linkedom
  const html = String(e.innerHTML || '').replace(/<br\s*\/?>/gi, '\n');
  const t = doc(`<body><div>${html}</div></body>`).querySelector('div');
  return (t ? t.textContent : '').replace(/[ \t]+\n/g, '\n').replace(/^[\s\n]+|[\s\n]+$/g, '');
}

// ---------------------------------------------------------------- чаты

export function parseBookmarks(html) {
  const d = doc(html);
  return [...d.querySelectorAll('a.contact-item')]
    .map((a) => ({
      id: a.getAttribute('data-id') || '',
      name: txt(a.querySelector('.media-user-name')),
      preview: stripZW(txt(a.querySelector('.contact-item-message'))),
      time: txt(a.querySelector('.contact-item-time')),
      avatar: avatarOf(a.querySelector('.avatar-photo')),
      nodeMsg: +a.getAttribute('data-node-msg') || 0,
      userMsg: +a.getAttribute('data-user-msg') || 0,
      unread: a.classList.contains('unread'),
      users: (/users-(\d+)-(\d+)/.exec(a.getAttribute('href') || '') || []).slice(1),
    }))
    .filter((c) => c.id);
}

/** ctx — «текущий автор»: FunPay не повторяет шапку у склеенных сообщений. */
export const newCtx = () => ({ authorId: '', author: '', avatar: '', dateRaw: '', names: new Map() });

export function parseMsgItem(item, hint, ctx) {
  const id = +(item.id || '').replace('message-', '');
  if (!id) return null;
  const head = item.classList.contains('chat-msg-with-head') || !!item.querySelector('.media-user-name');
  const avEl = item.querySelector('.media-left .avatar-photo');
  if (avEl) ctx.avatar = avatarOf(avEl);
  const link = item.querySelector('.chat-msg-author-link');
  const nameEl = item.querySelector('.media-user-name');
  if (link) {
    ctx.author = txt(link);
    ctx.authorId = userIdOf(link.getAttribute('href'));
  } else if (nameEl && ownText(nameEl)) {
    ctx.author = ownText(nameEl);
    ctx.authorId = '0';
  } else if (hint && String(hint) !== ctx.authorId) {
    ctx.authorId = String(hint);
    [ctx.author, ctx.avatar] = ctx.names.get(ctx.authorId) || ['', ''];
  }
  if (head && !avEl) ctx.avatar = ctx.names.get(ctx.authorId)?.[1] || '';
  if (ctx.authorId) ctx.names.set(ctx.authorId, [ctx.author, ctx.avatar]);
  const dEl = item.querySelector('.chat-msg-date');
  if (dEl) ctx.dateRaw = dEl.getAttribute('title') || txt(dEl);
  const text = stripZW(textWithBreaks(item.querySelector('.chat-msg-text')));
  const imgA = item.querySelector('.chat-img-link');
  let image = null,
    thumb = null;
  if (imgA) {
    image = absUrl(imgA.getAttribute('href'));
    const im = imgA.querySelector('img');
    thumb = im ? absUrl(im.getAttribute('src')) : image;
  }
  if (!text && !image) return null;
  return {
    id,
    authorId: ctx.authorId,
    author: ctx.author,
    avatar: ctx.avatar,
    dateRaw: ctx.dateRaw,
    ts: parseFpDate(ctx.dateRaw)?.getTime() || 0,
    head,
    text,
    image,
    thumb,
    badge: txt(item.querySelector('.chat-msg-author-label')),
  };
}

export function parseMessagesJson(arr, ctx) {
  const out = [];
  for (const m of arr || []) {
    const item = doc(m.html || '').querySelector('.chat-msg-item');
    if (!item) continue;
    const msg = parseMsgItem(item, m.author, ctx);
    if (msg) out.push(msg);
  }
  return out;
}

export function parseChatPage(html, ctx) {
  const d = doc(html);
  const p = { nodeName: '', nodeId: '', peerId: '', peerName: '', peerStatus: '', peerAvatar: '', lotName: '', lotUrl: '', messages: [] };
  const c = d.querySelector('div.chat[data-name]');
  if (c) {
    p.nodeName = c.getAttribute('data-name') || '';
    p.nodeId = c.getAttribute('data-id') || '';
  }
  const a = d.querySelector('.chat-header .media-user-name a');
  if (a) {
    p.peerName = txt(a);
    p.peerId = userIdOf(a.getAttribute('href'));
  }
  p.peerStatus = squash(txt(d.querySelector('.chat-header .media-user-status')));
  p.peerAvatar = avatarOf(d.querySelector('.chat-header .avatar-photo, .chat-header .media-left img, .chat-header .media-left [style*="background"], .chat-header img'));
  const lot = d.querySelector(".param-item.chat-panel[data-type='c-p-u'] a, .chat-panel-mobile a");
  if (lot) {
    p.lotName = cleanTitle(lot.textContent);
    p.lotUrl = absUrl(lot.getAttribute('href'));
  }
  if (p.peerId) ctx.names.set(p.peerId, [p.peerName, p.peerAvatar]);
  p.messages = [...d.querySelectorAll('.chat-msg-item')].map((it) => parseMsgItem(it, null, ctx)).filter(Boolean);
  return p;
}

// ---------------------------------------------------------------- профиль и отзывы

export function parseReviews(d) {
  return [...d.querySelectorAll('.review-container')].map((r) => {
    const rd = r.querySelector('.review-item-rating .rating > div');
    const rating = +(/rating(\d)/.exec(rd?.className || '') || [])[1] || 0;
    return {
      rating,
      text: textWithBreaks(r.querySelector('.review-item-text')),
      date: squash(txt(r.querySelector('.review-item-date'))),
      detail: squash(txt(r.querySelector('.review-item-detail'))),
      reply: textWithBreaks(r.querySelector('.review-item-answer > div') || r.querySelector('.review-item-answer')),
      photo: absUrl(r.querySelector('.review-item-photo img')?.getAttribute('src') || ''),
      author: squash(txt(r.querySelector('.review-item-user .media-user-name'))),
      order: (/\/orders\/([A-Z0-9]+)/.exec(r.querySelector('.review-item-order a')?.getAttribute('href') || '') || [])[1] || '',
    };
  });
}

export const parseContinue = (d) => (d.querySelector('input[name=continue]')?.getAttribute('value') || '').trim();

export function parseProfile(html, userId) {
  const d = doc(html);
  const p = { userId, name: txt(d.querySelector('h1 > span.mr4, h1 > span')), groups: [] };
  p.avatar = avatarOf(d.querySelector('.profile-header .avatar-photo, .profile-photo, .avatar-photo'));
  p.status = squash(txt(d.querySelector('h1 .media-user-status, .media-user-status')));
  p.online = /онлайн|online/i.test(p.status);
  p.banned = !!d.querySelector('h1 .label-danger');
  for (const it of d.querySelectorAll('.param-item')) {
    const label = txt(it.querySelector('h5')).toLowerCase();
    if (/регистрац|registration/.test(label)) {
      const v = it.querySelector('.text-nowrap');
      if (v) {
        const lines = v.textContent.split('\n').map((s) => s.trim()).filter(Boolean);
        p.regDate = lines[0] || '';
        p.regAgo = lines[1] || '';
      }
    }
  }
  p.rating = txt(d.querySelector('.rating-value .big'));
  p.reviewsCount = squash(txt(d.querySelector('.rating-full-count a, .rating-full-count')));
  for (const o of d.querySelectorAll('.offer')) {
    const t = o.querySelector('.offer-list-title a');
    if (!t) continue;
    const offers = [...o.querySelectorAll('a.tc-item')].map((row) => ({
      title: squash(txt(row.querySelector('.tc-desc-text'))) || 'Без названия',
      price: squash(txt(row.querySelector('.tc-price'))),
      server: squash(txt(row.querySelector('.tc-server'))),
      amount: squash(txt(row.querySelector('.tc-amount'))),
      url: absUrl(row.getAttribute('href')),
    }));
    if (offers.length) p.groups.push({ name: txt(t), url: absUrl(t.getAttribute('href')), offers });
  }
  p.reviews = parseReviews(d);
  p.cont = parseContinue(d);
  const c = d.querySelector('div.chat[data-name]');
  if (c && (c.getAttribute('data-name') || '').startsWith('users-')) {
    p.chatNode = c.getAttribute('data-name');
    p.chatId = c.getAttribute('data-id') || '';
  }
  return p;
}

// ---------------------------------------------------------------- заказ

export function parseOrder(html) {
  const d = doc(html);
  const o = { id: '', status: '', game: '', shortDesc: '', price: '', params: [], canRefund: false, canConfirm: false, isBuyer: false, review: null };
  const h = txt(d.querySelector('h1.page-header'));
  o.id = (h.split('#')[1] || '').trim().split(/\s+/)[0] || '';
  const st = [...d.querySelectorAll('.page-header .text-success, .page-header .text-warning, .page-header .text-danger, .page-header span')].pop();
  o.status = squash(txt(st));
  o.statusKind = st?.classList.contains('text-success') ? 'ok' : st?.classList.contains('text-warning') ? 'warn' : st?.classList.contains('text-danger') ? 'bad' : 'info';
  for (const it of d.querySelectorAll('.param-item')) {
    const label = squash(txt(it.querySelector('h5')));
    if (!label || /Действия/.test(label) || /отзыв/i.test(label)) continue;
    const divs = it.querySelectorAll('div');
    const ll = label.toLowerCase();
    // описания — с переносами строк, как на сайте; остальное — одной строкой
    const value = /описание|description/.test(ll) ? cleanText(textWithBreaks(divs[divs.length - 1])) : cleanTitle(txt(divs[divs.length - 1]));
    if (/игра|game/.test(ll)) o.game = value;
    if (/краткое описание|short description/.test(ll)) o.shortDesc = value;
    if (/сумма|amount|total/.test(ll)) {
      const big = txt(it.querySelector('span.h1'));
      const strongs = it.querySelectorAll('strong');
      o.price = squash(`${big} ${txt(strongs[strongs.length - 1])}`) || value;
      continue;
    }
    if (/продавец|seller/.test(ll)) o.isBuyer = true;
    if (value) o.params.push([label, value]);
  }
  const a = d.querySelector('.chat-float .media-user-name a, .chat-header .media-user-name a');
  if (a) {
    o.peerName = txt(a);
    o.peerId = userIdOf(a.getAttribute('href'));
  }
  o.peerAvatar = avatarOf(d.querySelector('.chat-float .avatar-photo, .chat-header .avatar-photo, .chat-float .media-left img'));
  o.canRefund = !!d.querySelector('button.btn-refund');
  o.canConfirm = !!d.querySelector('button.btn-complete');
  if (o.canConfirm || html.includes('js-balance-pay')) o.isBuyer = true;
  if ([...d.querySelectorAll('.order-review h5, .review-list h5')].some((x) => /для продавца/i.test(txt(x)))) o.isBuyer = true;
  const r = d.querySelector('.review-container');
  if (r) {
    let rating = +r.getAttribute('data-rating') || +(/rating(\d)/.exec(r.querySelector('.review-item-rating .rating > div')?.className || '') || [])[1] || 0;
    if (rating > 0) {
      const ans = r.querySelector('.review-item-answer');
      o.review = {
        rating,
        text: textWithBreaks(r.querySelector('.review-item-text')),
        reply: textWithBreaks(r.querySelector('.review-item-answer > div:first-child') || ans).replace(/\s*(Редактировать|Удалить|Edit|Delete)\s*/g, ' ').trim(),
        replyMine: !!ans && /Редактировать|Edit/.test(ans.textContent),
      };
    }
  }
  o.lotUrl = absUrl(d.querySelector("a[href*='/lots/offer'], a[href*='/chips/offer']")?.getAttribute('href') || '');
  const c = d.querySelector('div.chat[data-name]');
  if (c) o.chatNode = c.getAttribute('data-id') || '';
  return o;
}

// ---------------------------------------------------------------- продажи / покупки / финансы

export function parseTrade(html) {
  const d = doc(html);
  const items = [];
  for (const row of d.querySelectorAll('a.tc-item')) {
    let id = (/\/orders\/([A-Z0-9]+)/.exec(row.getAttribute('href') || '') || [])[1] || txt(row.querySelector('.tc-order')).replace('#', '').trim();
    if (!id) continue;
    const stEl = row.querySelector('.tc-status');
    const stText = txt(stEl);
    const state = row.classList.contains('warning') || /Возврат|refund/i.test(stText) ? 'refunded' : row.classList.contains('info') || stEl?.classList.contains('text-primary') ? 'paid' : 'closed';
    const game = txt(row.querySelector('.order-desc .text-muted'));
    let desc = txt(row.querySelector('.order-desc > div'));
    if (game && desc.endsWith(game)) desc = desc.slice(0, -game.length).trim();
    let peerId = '';
    for (const e of row.querySelectorAll('[data-href]')) {
      peerId = userIdOf(e.getAttribute('data-href'));
      if (peerId) break;
    }
    items.push({
      id,
      state,
      statusText: stText || { paid: 'Оплачен', refunded: 'Возврат', closed: 'Закрыт' }[state],
      desc: squash(desc),
      game,
      price: squash(txt(row.querySelector('.tc-price'))),
      amount: parseAmount(txt(row.querySelector('.tc-price'))).amount,
      currency: parseAmount(txt(row.querySelector('.tc-price'))).currency,
      peer: txt(row.querySelector('.media-user-name')),
      peerId,
      peerAvatar: avatarOf(row.querySelector('.avatar-photo')),
      date: squash(txt(row.querySelector('.tc-date-time'))),
    });
  }
  return { items, next: parseContinue(d) };
}

export function parseAmount(t) {
  const s = String(t || '').replace(/ /g, ' ').trim();
  const m = /([+\-−–])?\s*([\d ]+(?:[.,]\d+)?)\s*(\S*)/.exec(s);
  if (!m) return { amount: 0, currency: '' };
  let v = parseFloat(m[2].replace(/ /g, '').replace(',', '.')) || 0;
  if (m[1] && m[1] !== '+') v = -v;
  return { amount: v, currency: (m[3] || '').replace(/[^\p{Sc}A-Za-z$€₽₴]/gu, '') || '₽' };
}

function txnState(e) {
  const cls = [...e.classList].map((c) => c.toLowerCase());
  let texts = '';
  for (const x of e.querySelectorAll(".tc-status, [class*='status']")) {
    cls.push(...[...x.classList].map((c) => c.toLowerCase()));
    texts += x.textContent.toLowerCase() + ' ';
  }
  const has = (n) => cls.some((c) => c.includes('status') && c.includes(n));
  if (has('cancel') || has('refund') || /отмен|cancel/.test(texts)) return 'cancel';
  if (has('wait') || has('pending') || has('process') || has('hold') || /ожида|обработ|заморож|waiting|pending/.test(texts)) return 'wait';
  return 'done';
}

export function parseTransactions(html) {
  const d = doc(html);
  const items = [...d.querySelectorAll('.tc-item[data-transaction]')].map((e) => {
    const title = squash(txt(e.querySelector('.tc-title')));
    const amountText = squash(txt(e.querySelector('.tc-price')));
    const { amount, currency } = parseAmount(amountText);
    const date = squash(txt(e.querySelector('.tc-date-time')));
    return {
      id: e.getAttribute('data-transaction'),
      title,
      state: txnState(e),
      amount,
      currency,
      amountText,
      date,
      ts: parseFpDate(date)?.getTime() || 0,
      payment: squash(txt(e.querySelector('.tc-payment-number'))),
      orderId: (/#([A-Z0-9]{6,10})/.exec(title) || [])[1] || '',
    };
  });
  return { items, next: parseContinue(d) };
}

// ---------------------------------------------------------------- лоты

export function parseMyLots(html) {
  const d = doc(html);
  const cats = [];
  for (const block of d.querySelectorAll('.offer')) {
    const cat = block.querySelector('.offer-list-title a');
    if (!cat) continue;
    const href = cat.getAttribute('href') || '';
    const node = (/\/(?:lots|chips)\/(\d+)/.exec(href) || [])[1];
    if (!node) continue;
    const chips = href.includes('/chips/');
    const lots = [];
    for (const row of block.querySelectorAll('a.tc-item')) {
      const id = (/(?:offer=|id=)([0-9A-Za-z-]+)/.exec(row.getAttribute('href') || '') || [])[1];
      if (!id) continue;
      const pe = row.querySelector('.tc-price');
      const unit = txt(pe?.querySelector('.unit'));
      const raw = pe?.getAttribute('data-s') || txt(pe).replace(unit, '').trim();
      const pn = parseFloat(String(raw).replace(/\s/g, '').replace(',', '.'));
      // FunPay отдаёт цену с кучей знаков (638.01936) — показываем по-человечески: 638.02
      const num = Number.isFinite(pn) ? String(Math.round(pn * 100) / 100) : raw;
      lots.push({
        id,
        node,
        title: squash(txt(row.querySelector('.tc-desc-text'))) || 'Без названия',
        price: squash(`${num} ${unit}`),
        priceNum: Number.isFinite(pn) ? Math.round(pn * 100) / 100 : 0,
        unit: unit || '₽',
        amount: squash(txt(row.querySelector('.tc-amount'))),
        server: [txt(row.querySelector('.tc-server')), txt(row.querySelector('.tc-side'))].filter(Boolean).join(', '),
        active: !row.classList.contains('warning'),
        auto: !!row.querySelector('.auto-dlv-icon'),
        url: absUrl(row.getAttribute('href')),
      });
    }
    const game = cat.closest('.offer-list-title-container')?.getAttribute('data-game-id') || '';
    cats.push({ node, chips, game, name: squash(txt(cat)), url: absUrl(href), lots });
  }
  return cats;
}

/** Поля формы лота так, как их отправил бы браузер. */
export function parseOfferForm(html) {
  const d = doc(html);
  const form = d.querySelector('form.form-offer-editor') || [...d.querySelectorAll('form')].find((f) => f.querySelector('[name=node_id]'));
  if (!form) return null;
  const out = [];
  for (const e of form.querySelectorAll('input[name], textarea[name], select[name]')) {
    const name = e.getAttribute('name');
    if (!name) continue;
    const tag = e.tagName.toLowerCase();
    if (tag === 'textarea') out.push([name, e.textContent]);
    else if (tag === 'select') {
      const opts = [...e.querySelectorAll('option')];
      const o = opts.find((x) => x.hasAttribute('selected')) || opts[0];
      out.push([name, o ? (o.getAttribute('value') ?? o.textContent) : '']);
    } else {
      const ty = (e.getAttribute('type') || 'text').toLowerCase();
      if (['submit', 'button', 'file', 'image', 'reset'].includes(ty)) continue;
      if (ty === 'checkbox' || ty === 'radio') {
        if (!e.hasAttribute('checked')) continue;
        out.push([name, e.getAttribute('value') ?? 'on']);
      } else out.push([name, e.getAttribute('value') ?? '']);
    }
  }
  return out;
}

/** Выпадающие списки формы нового лота с подписями: [{name, label, options:[{value,text}], value}] */
export function parseOfferSelects(html) {
  const d = doc(html);
  const form = d.querySelector('form.form-offer-editor') || [...d.querySelectorAll('form')].find((f) => f.querySelector('[name=node_id]'));
  if (!form) return [];
  return [...form.querySelectorAll('select[name]')].map((e) => {
    const g = e.closest('.form-group') || e.parentElement;
    const label = squash(txt(g?.querySelector('label, .control-label')));
    const options = [...e.querySelectorAll('option')].map((o) => ({ value: o.getAttribute('value') ?? o.textContent, text: squash(o.textContent) }));
    const sel = [...e.querySelectorAll('option')].find((o) => o.hasAttribute('selected'));
    return { name: e.getAttribute('name'), label, options, value: sel ? sel.getAttribute('value') ?? sel.textContent : options[0]?.value ?? '' };
  });
}

/* ---------------------------------------------------------------- редактор лота
   Вся форма лота как есть: каждое поле с подписью, типом и значением.
   Ничего не выдумываем — шлём обратно ровно те поля, что прислал FunPay (как браузер). */
const SYS_FIELDS = new Set(['csrf_token', 'form_created_at', 'offer_id', 'node_id', 'location', 'deleted']);
const FIELD_NAMES = {
  price: 'Цена',
  amount: 'Наличие',
  active: 'Активный — показывать покупателям',
  auto_delivery: 'Автовыдача',
  secrets: 'Товары для автовыдачи — по одному на строку',
  'fields[summary]': 'Краткое описание (название лота)',
  'fields[desc]': 'Подробное описание',
  'fields[payment_msg]': 'Сообщение покупателю после оплаты',
};
const isHiddenEl = (e, form) => {
  for (let x = e; x && x !== form; x = x.parentElement) {
    if (x.classList?.contains('hidden') || x.hasAttribute?.('hidden') || /display\s*:\s*none/i.test(x.getAttribute?.('style') || '')) return true;
  }
  return false;
};
/** → { ctrls:[{name,base,lang,kind,value,checked,options,label,help,hidden,sys,disabled}], node, offerId, unit } | null */
export function parseOfferEditor(html) {
  const d = doc(html);
  const form = d.querySelector('form.form-offer-editor') || [...d.querySelectorAll('form')].find((f) => f.querySelector('[name=node_id]'));
  if (!form) return null;
  const ctrls = [];
  for (const e of form.querySelectorAll('input[name], textarea[name], select[name]')) {
    const name = e.getAttribute('name');
    const tag = e.tagName.toLowerCase();
    const ty = tag === 'input' ? (e.getAttribute('type') || 'text').toLowerCase() : tag;
    if (['submit', 'button', 'file', 'image', 'reset'].includes(ty)) continue;
    const m = /^(.*)\[(ru|en)\]$/.exec(name);
    const base = m ? m[1] : name;
    const g = e.closest('.form-group, .lot-field') || e.parentElement;
    let label = squash(txt(g?.querySelector('label.control-label, .control-label, label:not(.checkbox):not(.radio)')));
    if (ty === 'checkbox' || ty === 'radio') label = squash(txt(e.closest('label'))) || label;
    label = label.replace(/\s*\*\s*$/, '') || FIELD_NAMES[base] || FIELD_NAMES[name] || name;
    const help = squash(txt(g?.querySelector('.help-block, .form-text')));
    const c = { name, base, lang: m ? m[2] : '', kind: ty === 'hidden' ? 'hidden' : ty === 'checkbox' || ty === 'radio' ? ty : tag === 'select' ? 'select' : tag === 'textarea' ? 'textarea' : 'text', label, help, sys: SYS_FIELDS.has(name), hidden: ty === 'hidden' || isHiddenEl(e, form), disabled: e.hasAttribute('disabled') };
    if (tag === 'textarea') c.value = e.textContent;
    else if (tag === 'select') {
      c.options = [...e.querySelectorAll('option')].map((o) => ({ value: o.getAttribute('value') ?? o.textContent, text: squash(o.textContent) || squash(o.getAttribute('data-content') || '').replace(/<[^>]+>/g, '') }));
      const o = [...e.querySelectorAll('option')].find((x) => x.hasAttribute('selected'));
      c.value = o ? (o.getAttribute('value') ?? o.textContent) : (c.options[0]?.value ?? '');
    } else {
      c.value = e.getAttribute('value') ?? (c.kind === 'checkbox' || c.kind === 'radio' ? 'on' : '');
      if (c.kind === 'checkbox' || c.kind === 'radio') c.checked = e.hasAttribute('checked');
    }
    if (FIELD_NAMES[base] && (label === name || /^fields\[/.test(label))) c.label = FIELD_NAMES[base];
    ctrls.push(c);
  }
  const price = form.querySelector('[name=price]');
  const pg = price?.closest('.form-group, .input-group') || price?.parentElement;
  const unit = (/₽|\$|€|руб/i.exec(txt(pg?.querySelector('.input-group-addon, .input-group-text, .unit')) || txt(pg)) || ['₽'])[0].replace(/руб/i, '₽');
  return { ctrls, node: form.querySelector('[name=node_id]')?.getAttribute('value') || '', offerId: form.querySelector('[name=offer_id]')?.getAttribute('value') || '', unit };
}

/** Поля редактора → пары для /lots/offerSave (как отправил бы браузер). */
export function offerEditorPairs(ctrls) {
  const out = [];
  for (const c of ctrls) {
    if (c.disabled || c.name === 'csrf_token') continue;
    if (c.kind === 'checkbox' || c.kind === 'radio') {
      if (c.name === 'active') continue;
      if (c.checked) out.push([c.name, c.value || 'on']);
    } else out.push([c.name, c.value ?? '']);
  }
  // «Активный»: как в lotSetActive — пустое поле всегда, «on», если включён
  const act = ctrls.find((c) => c.name === 'active' && c.kind === 'checkbox');
  if (act) {
    if (!out.some(([k]) => k === 'active')) out.push(['active', '']);
    if (act.checked) out.push(['active', 'on']);
  }
  return out;
}

/** Публичная страница категории (/lots/123/ или /chips/123/): кто продаёт и кто в закрепе.
    FunPay: offer-promo — продавец в закрепе (стоит на своём месте с 📌),
    offer-promoted — копия закреплённого лота в самом верху списка. */
export function parseCatOffers(html) {
  const d = doc(html);
  const by = new Map();
  for (const a of d.querySelectorAll('a.tc-item')) {
    const id = (/[?&]id=([0-9A-Za-z-]+)/.exec(a.getAttribute('href') || '') || [])[1];
    if (!id) continue;
    const u = a.querySelector('.tc-user [data-href*="/users/"], .tc-user a[href*="/users/"], [data-href*="/users/"]');
    const uid = a.getAttribute('data-user') || (/users\/(\d+)/.exec(u?.getAttribute('data-href') || u?.getAttribute('href') || '') || [])[1] || '';
    const top = a.classList.contains('offer-promoted');
    const promo = top || a.classList.contains('offer-promo') || !!a.querySelector('.promo-offer-icon');
    const prev = by.get(id);
    if (prev) {
      prev.top ||= top;
      prev.promo ||= promo;
      continue;
    }
    by.set(id, { id, uid: String(uid), name: squash(txt(a.querySelector('.media-user-name'))), title: squash(txt(a.querySelector('.tc-desc-text') || a.querySelector('.tc-desc'))).slice(0, 140), price: squash(txt(a.querySelector('.tc-price'))), promo, top });
  }
  return { title: squash(txt(d.querySelector('h1'))), rows: [...by.values()] };
}

/** Курс вывода в USDT (TRC20) со страницы баланса: { rate, fee, min, info } */
export function parseWithdrawRate(html) {
  const dec = String(html || '').replace(/&quot;|&#34;/g, '"').replace(/&amp;/g, '&');
  for (const m of dec.matchAll(/\{[^{}]{10,800}\}/g)) {
    const b = m[0];
    if (!/usdt_trc/i.test(b) || !/feeInfo/.test(b)) continue;
    const info = (/"feeInfo"\s*:\s*"([^"]*)"/.exec(b) || [])[1];
    if (!info) continue;
    const rate = parseFloat(((/курс\s+([\d.,]+)/i.exec(info) || [])[1] || '').replace(',', '.'));
    if (!(rate > 10)) continue;
    const fee = parseFloat((/Комиссия\s+([\d.,]+)\s*%/i.exec(info) || [])[1]?.replace(',', '.') || '0') || 0;
    const min = parseFloat((/не менее\s+([\d.,]+)\s*₽/i.exec(info) || [])[1]?.replace(',', '.') || '0') || 0;
    return { rate, fee, min, info: info.replace(/\\u([0-9a-f]{4})/gi, (_, h) => String.fromCharCode(parseInt(h, 16))) };
  }
  return null;
}

export function parseWait(msg) {
  const s = String(msg || '').toLowerCase();
  const n = +(/(\d+)/.exec(s) || [])[1] || 1;
  if (/секунд|second/.test(s)) return n * 1000;
  if (/минут|minute/.test(s)) return n * 60e3;
  if (/час|hour/.test(s)) return n * 3600e3;
  return 0;
}

// ---------------------------------------------------------------- поднятие

/** Разделы на своей странице: [{node, game, title}] (кроме валюты /chips/). */
export function parseRaiseGroups(html) {
  const d = doc(html);
  const out = [];
  for (const div of d.querySelectorAll('div.offer-list-title-container')) {
    const a = div.querySelector('h3 a');
    const href = a?.getAttribute('href') || '';
    if (!a || href.includes('/chips/')) continue;
    const node = (/\/lots\/(\d+)/.exec(href) || [])[1];
    if (node) out.push({ node, game: div.getAttribute('data-game-id') || '', title: squash(txt(a)) });
  }
  return out;
}

/** Главная страница: раздел → игра. */
export function parseNodeGames(html) {
  const d = doc(html);
  const map = {};
  for (const it of d.querySelectorAll('.promo-game-item')) {
    const game = it.querySelector('.game-title')?.getAttribute('data-id');
    if (!game) continue;
    for (const a of it.querySelectorAll('ul.list-inline li a')) {
      const id = (a.getAttribute('href') || '').split('/').filter(Boolean).pop();
      if (/^\d+$/.test(id || '')) map[id] = game;
    }
  }
  return map;
}

/** Окно «Информация об операции»: {title, rows:[[k,v]], link}. */
export function parseTxnInfo(html) {
  const d = doc(html);
  const rows = [];
  let title = '',
    link = '';
  for (const tr of d.querySelectorAll('tr')) {
    const th = tr.querySelector('th'),
      td = tr.querySelector('td');
    if (!th || !td) continue;
    const k = txt(th),
      v = squash(td.textContent);
    const href = td.querySelector('a[href]')?.getAttribute('href') || '';
    if (!link && href.startsWith('http')) link = href;
    if (k === 'Описание' || k === 'Description') title = v;
    if (k) rows.push([k, v]);
  }
  return { title, rows, link };
}

export function isWaitMsg(msg) {
  return /подождите|please wait|зачекайте|почекайте/i.test(String(msg || ''));
}

/** Сколько ждать до следующего поднятия, мс (с запасом, как в 4.5). */
export function waitMs(msg) {
  const l = String(msg || '').toLowerCase();
  const n = parseInt(String(msg).replace(/\D+/g, ''), 10);
  if (/секунд|second/.test(l)) return (n || 2) * 1000;
  if (/минут|хвилин|minute/.test(l)) return Math.max(1, (n || 2) - 1) * 60e3;
  if (/час|годин|hour/.test(l)) return Math.max(60e3, ((n || 1) - 0.5) * 3600e3);
  return 10e3;
}

/** Все игры с главной FunPay: ['Counter-Strike 2', 'Telegram', ...] */
export function parseAllGames(html) {
  const d = doc(html);
  const out = new Set();
  for (const t of d.querySelectorAll('.promo-game-item .game-title, .promo-games .game-title, .game-title')) {
    const n = squash(txt(t.querySelector('a') || t));
    if (n && n.length < 60) out.add(n);
  }
  return [...out];
}
