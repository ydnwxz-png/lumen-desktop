// © 2026 Lumen. Все права защищены. Копирование, изменение и распространение этого кода запрещены без разрешения автора (см. LICENSE).
// Панель покупателя справа в чатах: кто он, сколько покупал у тебя, текущий заказ, какой лот смотрит.
import { esc, avatar, fmtNum, plural } from '../core/util.js';
import { icon } from '../core/icons.js';
import { S } from '../core/state.js';
import { loadSales, withTs, startOfDay } from '../views/stats.js';
import { openOrder } from '../views/order.js';
import { openProfile } from '../views/profile.js';

const MON = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const DAY = 86400e3;
let gen = 0;

const when = (ts) => {
  const d = startOfDay(ts);
  const t = startOfDay(Date.now());
  if (d === t) return 'сегодня';
  if (d === t - DAY) return 'вчера';
  const x = new Date(ts);
  return `${x.getDate()} ${MON[x.getMonth()]}`;
};
const STATE = { paid: ['warn', 'Оплачен · ждёт подтверждения'], closed: ['ok', 'Закрыт'], refunded: ['bad', 'Возврат'] };

/** box — элемент панели; p — страница чата (peerName, peerId, peerAvatar, peerStatus, lotName, lotUrl). */
export async function renderBuyer(box, p, orderId) {
  if (!box) return;
  const my = ++gen;
  if (!p) {
    box.innerHTML = `<div class="ci-empty">${icon('user', 26)}<p>Открой чат — здесь будет покупатель: сколько купил, на какую сумму, что смотрит</p></div>`;
    return;
  }
  const name = p.peerName || p.nodeName || '';
  const online = /онлайн|online/i.test(p.peerStatus || '');
  const head = `<div class="bi-top">${avatar(p.peerAvatar, name, 84, '', p.peerId)}<b class="ell">${esc(name)}</b><span class="${online ? 'on' : ''}">${online ? '● в сети' : esc(p.peerStatus || '')}</span></div>`;
  const foot = `<div class="bi-foot">${p.peerId ? `<button class="btn" data-prof>${icon('user', 15)}Профиль</button><button class="btn" data-fp>${icon('globe', 15)}На FunPay</button>` : ''}</div>`;
  box.innerHTML = `${head}<div class="bi-grid" data-g>${['Заказов у тебя', 'Потратил', 'Последний', 'Статус'].map((k) => `<div class="bi-s"><small>${k}</small><b><span class="skel" style="display:inline-block;width:46px;height:16px"></span></b></div>`).join('')}</div><div data-paid></div><div data-ord></div><span class="grow"></span>${foot}`;
  box.onclick = (e) => {
    if (e.target.closest('[data-prof]')) openProfile(p.peerId);
    if (e.target.closest('[data-fp]')) S.backend.openBrowser(`https://funpay.com/users/${p.peerId}/`);
    const o = e.target.closest('[data-o]');
    if (o) openOrder(o.dataset.o);
  };
  paidNow(box, p, name, my);
  let list = [];
  try {
    const raw = await loadSales(startOfDay(Date.now()) - 120 * DAY, { pages: 40 });
    if (my !== gen) return;
    list = withTs(raw).filter((t) => t.peer === name || (p.peerId && String(t.peerId) === String(p.peerId))).sort((a, b) => b.ts - a.ts);
  } catch {
    if (my !== gen) return;
  }
  const done = list.filter((t) => t.state !== 'refunded');
  const sum = done.reduce((s, t) => s + (t.amount || 0), 0);
  const cur = list[0]?.currency || '₽';
  const status = done.length >= 3 ? ['vip', 'VIP'] : done.length >= 2 ? ['ok', 'постоянный'] : done.length ? ['', 'купил раз'] : ['', 'новый'];
  box.querySelector('[data-g]').innerHTML = `
    <div class="bi-s"><small>Заказов у тебя</small><b>${done.length}</b></div>
    <div class="bi-s"><small>Потратил</small><b>${fmtNum(Math.round(sum))} ${esc(cur)}</b></div>
    <div class="bi-s"><small>Последний</small><b>${list[0] ? when(list[0].ts) : '—'}</b></div>
    <div class="bi-s"><small>Статус</small><b class="st-${status[0]}">${status[1]}</b></div>`;
  const past = list.filter((t) => t.state !== 'paid').slice(0, 4);
  box.querySelector('[data-ord]').innerHTML = past.length
    ? `<div class="bi-sec">Раньше покупал</div><div class="bi-more">${past.map((t) => `<button data-o="${esc(t.id)}"><span class="ell">${esc(t.desc || '#' + t.id)}</span><b class="${t.state === 'refunded' ? 'neg' : ''}">${t.state === 'refunded' ? 'возврат' : `${fmtNum(t.amount || 0)} ${esc(t.currency || '₽')}`}</b></button>`).join('')}</div>`
    : list.length ? '' : `<div class="bi-card muted"><div class="dim" style="font-size:12.5px">Раньше у тебя не покупал${S.demo ? '' : ' (за 4 месяца)'}</div></div>`;
  void orderId;
}
export const _p = plural;

// «Оплачено сейчас»: заказы этого покупателя, которые оплачены и ждут выдачи (свежий список с FunPay, кэш 30 сек)
let paidCache = { at: 0, acc: null, items: [] };
async function paidNow(box, p, name, my) {
  const el = box.querySelector('[data-paid]');
  el.innerHTML = `<div class="bi-sec">Оплачено сейчас</div><div class="bi-card"><span class="skel" style="width:70%;height:13px"></span></div>`;
  try {
    if (Date.now() - paidCache.at > 30e3 || paidCache.acc !== S.backend) {
      const r = await S.backend.trades('sales', 'paid', '');
      paidCache = { at: Date.now(), acc: S.backend, items: r.items || [] };
    }
  } catch {}
  if (my !== gen) return;
  const mine = paidCache.items.filter((o) => o.state === 'paid' && (o.peer === name || (p.peerId && String(o.peerId) === String(p.peerId))));
  const sum = mine.reduce((s, o) => s + (o.amount || 0), 0);
  el.innerHTML = mine.length
    ? `<div class="bi-sec">Оплачено сейчас <span class="ub">${mine.length}</span>${mine.length > 1 ? `<span class="dim" style="margin-left:auto;font-weight:500">${fmtNum(sum)} ${esc(mine[0].currency || '₽')}</span>` : ''}</div>
      ${mine.map((o) => `<div class="bi-card bi-ord paid" data-o="${esc(o.id)}"><span class="pill warn"><span class="dotc"></span>Оплачен — выдай товар</span><div class="bi-t">${esc(o.desc || '')}</div><div class="dim" style="font-size:12px"><span class="oid">#${esc(o.id)}</span> · <b class="price" style="color:var(--text)">${esc(o.price || fmtNum(o.amount || 0) + ' ₽')}</b> · ${esc(o.date || '')}</div></div>`).join('')}`
    : `<div class="bi-sec">Оплачено сейчас</div><div class="bi-card muted"><div class="dim" style="font-size:12.5px">${icon('check', 14)} Ничего не ждёт выдачи</div></div>`;
}
