// Продажи и покупки: фильтры, поиск, подгрузка, шторка заказа.
import { $, esc, avatar, debounce, countUp, fmtNum, parseFpDate, plural } from '../core/util.js';
import { icon } from '../core/icons.js';
import { S, bus } from '../core/state.js';
import { seg, modal } from '../ui/kit.js';
import { openOrder } from './order.js';
import { openSupportPicker } from '../features/support.js';

const V = { kind: 'sales', state: '', q: '', items: [], next: '', loading: false, gen: 0 };
let root;

export function mountDeals(c) {
  root = c;
  root.innerHTML = `<div class="page">
    <div class="page-head"><h1>Сделки</h1><span class="sub" data-sub></span><span class="grow"></span>
      <button class="btn" data-support data-tip="Покупатель не подтвердил заказ — обращение в поддержку">${icon('alert', 16)}В поддержку</button>
      <button class="btn" data-stats-open>${icon('trend', 16)}Статистика</button>
      <div class="seg" data-kind><button data-v="sales">${icon('trend', 15)}Продажи</button><button data-v="purchases">${icon('bag', 15)}Покупки</button></div>
    </div>
    <div class="stats stagger" data-stats></div>
    <div class="toolbar">
      <div class="seg" data-state><button data-v="">Все</button><button data-v="paid">Оплачены</button><button data-v="closed">Закрыты</button><button data-v="refunded">Возвраты</button></div>
      <span class="grow"></span>
      <label class="search">${icon('search', 16)}<input class="input" placeholder="Номер, покупатель, лот" data-q></label>
      <button class="ibtn" data-reload data-tip="Обновить">${icon('refresh', 18)}</button>
    </div>
    <div class="table deals" data-list></div>
    <div class="more-row" data-more></div>
  </div>`;
  seg($('[data-kind]', root), V.kind, (v) => ((V.kind = v), load()));
  seg($('[data-state]', root), V.state, (v) => ((V.state = v), load()));
  $('[data-q]', root).oninput = debounce((e) => ((V.q = e.target.value.trim().toLowerCase()), render()), 100);
  $('[data-reload]', root).onclick = () => load();
  $('[data-stats-open]', root).onclick = openStats;
  $('[data-support]', root).onclick = openSupportPicker;
  bus.on('account', () => {
    V.gen++;
    V.items = [];
    V.loaded = false;
  });
}

export function showDeals() {
  if (!V.loaded) load();
}

async function load(more = false) {
  const my = ++V.gen;
  V.loading = true;
  if (!more) {
    V.items = [];
    V.next = '';
    $('[data-list]', root).innerHTML = skeleton();
  }
  $('[data-more]', root).innerHTML = more ? '<div class="spinner"></div>' : '';
  try {
    const r = await S.backend.trades(V.kind, V.state, more ? V.next : '');
    if (my !== V.gen) return;
    V.items = more ? [...V.items, ...r.items] : r.items;
    V.next = r.next;
    V.loaded = true;
    render(more);
  } catch (e) {
    if (my !== V.gen) return;
    $('[data-list]', root).innerHTML = `<div class="empty" style="padding:50px"><div class="orb" style="color:var(--bad)">${icon('alert', 28)}</div><h3>Не загрузилось</h3><p>${esc(e.message)}</p></div>`;
    $('[data-more]', root).innerHTML = '';
  } finally {
    V.loading = false;
  }
}

const skeleton = () => Array.from({ length: 7 }, () => `<div class="tr"><div class="skel" style="height:12px;width:70px"></div><div class="col" style="gap:6px"><div class="skel" style="height:12px;width:70%"></div><div class="skel" style="height:10px;width:40%"></div></div><div class="skel" style="height:28px;width:120px;border-radius:99px"></div><div></div><div></div><div></div></div>`).join('');

function render(appendOnly) {
  const list = V.items.filter((o) => !V.q || [o.id, o.desc, o.game, o.peer].join(' ').toLowerCase().includes(V.q));
  const tbl = $('[data-list]', root);
  const head = `<div class="tr th"><span>Заказ</span><span>Описание</span><span>${V.kind === 'sales' ? 'Покупатель' : 'Продавец'}</span><span>Сумма</span><span>Статус</span><span>Дата</span></div>`;
  tbl.innerHTML = list.length
    ? head +
      list
        .map((o, i) => {
          const cls = o.state === 'paid' ? 'info' : o.state === 'refunded' ? 'warn' : 'ok';
          return `<div class="tr" data-id="${esc(o.id)}" style="animation:rise .4s var(--ease) ${Math.min(i, 14) * 0.025}s backwards">
            <span class="oid">#${esc(o.id)}</span>
            <div class="deal-desc"><div class="t">${esc(o.desc || '—')}</div><div class="g">${esc(o.game)}</div></div>
            <div class="row" style="gap:8px;min-width:0">${avatar(o.peerAvatar, o.peer, 26)}<span class="ell">${esc(o.peer)}</span></div>
            <span class="price ${V.kind === 'sales' && o.state !== 'refunded' ? 'plus' : 'minus'}">${esc(o.price)}</span>
            <span><span class="pill ${cls}"><span class="dotc"></span>${esc(o.statusText)}</span></span>
            <span class="dim" style="font-size:12.5px">${esc(o.date)}</span></div>`;
        })
        .join('')
    : `<div class="empty" style="padding:60px"><div class="orb">${icon('bag', 30)}</div><h3>${V.q ? 'Ничего не нашлось' : 'Сделок нет'}</h3><p>${V.q ? 'Попробуй другой запрос' : 'Здесь появятся заказы'}</p></div>`;
  tbl.onclick = (e) => {
    const r = e.target.closest('[data-id]');
    if (r) openOrder(r.dataset.id, { onChange: () => load() });
  };
  $('[data-more]', root).innerHTML = V.next ? `<button class="btn">Показать ещё</button>` : '';
  const mb = $('[data-more] .btn', root);
  if (mb) mb.onclick = () => load(true);

  // сводка по загруженному
  const paid = V.items.filter((o) => o.state === 'paid');
  const closed = V.items.filter((o) => o.state === 'closed');
  const sum = (a) => a.reduce((s, o) => s + (o.amount || 0), 0);
  const cur = V.items.find((o) => o.currency)?.currency || '₽';
  $('[data-sub]', root).textContent = V.items.length ? `${V.items.length} загружено` : '';
  const st = $('[data-stats]', root);
  if (!appendOnly) {
    st.innerHTML = `
    <div class="stat hero"><div class="lbl"><span class="ic-b">${icon('clock', 15)}</span>Ждут выполнения</div><div class="val"><span data-c1>0</span></div><div class="hint">на <span data-c1s>0</span> ${cur}</div></div>
    <div class="stat"><div class="lbl"><span class="ic-b">${icon('checks', 15)}</span>Закрыто</div><div class="val"><span data-c2>0</span></div><div class="hint">на <span data-c2s>0</span> ${cur}</div></div>
    <div class="stat"><div class="lbl"><span class="ic-b">${icon('undo', 15)}</span>Возвраты</div><div class="val"><span data-c3>0</span></div><div class="hint">из загруженных</div></div>`;
  }
  countUp($('[data-c1]', st), paid.length);
  countUp($('[data-c1s]', st), sum(paid));
  countUp($('[data-c2]', st), closed.length);
  countUp($('[data-c2s]', st), sum(closed));
  countUp($('[data-c3]', st), V.items.filter((o) => o.state === 'refunded').length);
}

export const dealsFmt = fmtNum;

// ---------------------------------------------------------------- статистика продаж

const PERIODS = [
  ['1', 'Сегодня'],
  ['7', '7 дней'],
  ['30', '30 дней'],
  ['0', 'Всё время'],
];

function top(map) {
  let best = null;
  for (const [k, v] of map) if (!best || v > best[1]) best = [k, v];
  return best;
}

export function salesStats(items, cutoff) {
  const list = items.filter((t) => !cutoff || (parseFpDate(t.date)?.getTime() || 0) >= cutoff);
  const st = { orders: list.length, closed: 0, pending: 0, refunds: 0, earned: 0, pendingSum: 0, max: 0, buyers: new Map(), goods: new Map(), games: new Map(), cur: '₽' };
  for (const t of list) {
    st.cur = t.currency || st.cur;
    if (t.state === 'closed') (st.closed++, (st.earned += t.amount || 0));
    else if (t.state === 'paid') (st.pending++, (st.pendingSum += t.amount || 0));
    else st.refunds++;
    if (t.state !== 'refunded') st.max = Math.max(st.max, t.amount || 0);
    if (t.peer) st.buyers.set(t.peer, (st.buyers.get(t.peer) || 0) + 1);
    if (t.desc) st.goods.set(t.desc, (st.goods.get(t.desc) || 0) + 1);
    if (t.game) st.games.set(t.game, (st.games.get(t.game) || 0) + 1);
  }
  const paidN = st.closed + st.pending;
  st.avg = paidN ? (st.earned + st.pendingSum) / paidN : 0;
  return st;
}

function openStats() {
  const m = modal(`<div style="padding:22px"><div class="row" style="margin-bottom:16px"><h3 class="grow" style="margin:0">Статистика продаж</h3><div class="seg" data-p>${PERIODS.map(([v, n]) => `<button data-v="${v}">${n}</button>`).join('')}</div><button class="ibtn" data-close>${icon('x', 18)}</button></div><div data-body></div></div>`, { wide: true });
  const body = $('[data-body]', m.el);
  let gen = 0;
  const run = async (days) => {
    const my = ++gen;
    body.innerHTML = `<div class="empty" style="padding:50px"><div class="spinner"></div><p data-note>Загружаю продажи…</p></div>`;
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    const cutoff = days === '1' ? d.getTime() : days === '0' ? 0 : Date.now() - +days * 86400e3;
    try {
      const items = await S.backend.salesSince(cutoff, days === '0' ? 60 : 40, (n) => my === gen && $('[data-note]', body) && ($('[data-note]', body).textContent = `Загружено продаж: ${n}`));
      if (my !== gen) return;
      const st = salesStats(items, cutoff);
      const c = st.cur;
      const tb = top(st.buyers),
        tg = top(st.goods),
        tc = top(st.games);
      const tile = (label, val, sub = '', wide = false, hero = false) => `<div class="stat ${hero ? 'hero' : ''}" style="${wide ? 'grid-column:span 2' : ''}"><div class="lbl">${label}</div><div class="val" style="${wide ? 'font-size:17px;margin-top:10px' : ''}">${val}</div>${sub ? `<div class="hint">${sub}</div>` : ''}</div>`;
      body.innerHTML = st.orders
        ? `<div class="stats stagger" style="grid-template-columns:repeat(4,1fr);margin:0">
          ${tile('Заработано', `${fmtNum(st.earned)}<small>${esc(c)}</small>`, `${st.closed} ${plural(st.closed, 'закрытый заказ', 'закрытых заказа', 'закрытых заказов')}`, false, true)}
          ${tile('Заказов', st.orders)}
          ${tile('Средний чек', `${fmtNum(st.avg)}<small>${esc(c)}</small>`)}
          ${tile('Ждут подтверждения', st.pending, st.pending ? `на ${fmtNum(st.pendingSum)} ${esc(c)}` : '')}
          ${tile('Возвраты', st.refunds)}
          ${tile('Покупателей', st.buyers.size)}
          ${tile('Самая дорогая продажа', `${fmtNum(st.max)}<small>${esc(c)}</small>`, '', true)}
          ${tile('Самый активный покупатель', tb ? esc(tb[0]) : '—', tb ? `${tb[1]} ${plural(tb[1], 'заказ', 'заказа', 'заказов')}` : '', true)}
          ${tile('Популярный товар', tg ? esc(tg[0]) : '—', tg ? `${tg[1]} ${plural(tg[1], 'продажа', 'продажи', 'продаж')}` : '', true)}
          ${tile('Популярная категория', tc ? esc(tc[0]) : '—', '', true)}
        </div><div class="dim" style="font-size:12px;margin-top:12px">Посчитано по ${items.length} загруженным продажам</div>`
        : `<div class="empty" style="padding:50px"><div class="orb">${icon('trend', 28)}</div><h3>Продаж за этот период нет</h3></div>`;
    } catch (e) {
      if (my === gen) body.innerHTML = `<div class="empty" style="padding:50px"><div class="orb" style="color:var(--bad)">${icon('alert', 28)}</div><h3>Не загрузилось</h3><p>${esc(e.message)}</p></div>`;
    }
  };
  seg($('[data-p]', m.el), '30', run);
  run('30');
}
