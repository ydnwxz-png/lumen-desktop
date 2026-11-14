// © 2026 Lumen. Все права защищены. Копирование, изменение и распространение этого кода запрещены без разрешения автора (см. LICENSE).
// Раздел «Статистика» (отдельная кнопка слева): показатели, динамика, когда покупают, топ товаров,
// разделы, календарь, покупатели, последние продажи. Считается из продаж FunPay (Сделки → Продажи).
import { $, esc, avatar, fmtNum, plural } from '../core/util.js';
import { icon } from '../core/icons.js';
import { S, bus } from '../core/state.js';
import { seg } from '../ui/kit.js';
import { loadSales, withTs, mainCur, calc, startOfDay, range } from './stats.js';
import { openOrder } from './order.js';
import { openProfile } from './profile.js';

const DAY = 86400e3;
const WD = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const WDL = ['понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресенье'];
const MON = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const MONF = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const PERIODS = [['1', 'Сегодня'], ['7', '7 дней'], ['30', '30 дней'], ['90', '90 дней'], ['365', 'Год'], ['0', 'Всё время']];
const V = { period: '30', metric: 'sum', goodsAll: false, gen: 0, items: null, partial: false, calM: null };
let root;
let tip;

const money = (v, cur = '₽') => `${fmtNum(Math.round(v))} ${cur}`;
const compact = (v) => (v >= 1e6 ? +(v / 1e6).toFixed(1) + 'M' : v >= 1000 ? +(v / 1000).toFixed(v >= 1e4 ? 1 : 2) + 'K' : String(Math.round(v)));
const dshort = (t) => `${new Date(t).getDate()} ${MON[new Date(t).getMonth()]}`;
const nOrders = (n) => `${n} ${plural(n, 'заказ', 'заказа', 'заказов')}`;
const cut = (t, n) => { const a = Array.from(String(t || '')); return a.length > n ? a.slice(0, n).join('').trimEnd() + '…' : a.join(''); };

/** Подсказка при наведении — одна на всё окно, никогда не вылезает за края. */
function initTip() {
  tip = document.createElement('div');
  tip.className = 'sv-tip';
  document.body.append(tip);
  root.addEventListener('pointermove', (e) => {
    const t = e.target.closest('[data-st]');
    if (!t) return (tip.style.opacity = 0);
    tip.innerHTML = t.dataset.st;
    tip.style.opacity = 1;
    const r = tip.getBoundingClientRect();
    let x = e.clientX + 16;
    let y = e.clientY - r.height - 14;
    if (x + r.width > innerWidth - 10) x = e.clientX - r.width - 16;
    if (y < 10) y = e.clientY + 18;
    tip.style.left = Math.max(10, x) + 'px';
    tip.style.top = Math.min(innerHeight - r.height - 10, y) + 'px';
  });
  root.addEventListener('pointerleave', () => (tip.style.opacity = 0));
  bus.on('nav', () => (tip.style.opacity = 0));
}

export function mountStatsView(c) {
  root = c;
  root.innerHTML = `<div class="page sv">
    <div class="page-head"><div><div class="dim" style="font-size:13px">по продажам на FunPay</div><h1>Статистика</h1></div><span class="grow"></span>
      <div class="seg" data-p>${PERIODS.map(([v, n]) => `<button data-v="${v}">${n}</button>`).join('')}</div>
      <button class="ibtn" data-reload data-tip="Загрузить заново">${icon('refresh', 18)}</button></div>
    <div data-body></div></div>`;
  initTip();
  seg($('[data-p]', root), V.period, (v) => ((V.period = v), load()));
  $('[data-reload]', root).onclick = () => load(true);
  root.addEventListener('click', (e) => {
    const o = e.target.closest('[data-o]');
    if (o?.dataset.o) return openOrder(o.dataset.o);
    const b = e.target.closest('[data-buyer]');
    if (b?.dataset.buyer) return openProfile(b.dataset.buyer);
    const m = e.target.closest('[data-metric] button');
    if (m) return;
    const c = e.target.closest('[data-cal]');
    if (c) return (V.calM = new Date(V.calM.getFullYear(), V.calM.getMonth() + +c.dataset.cal, 1)), drawCal();
    if (e.target.closest('[data-goods-all]')) return (V.goodsAll = !V.goodsAll), render();
  });
  bus.on('account', () => ((V.items = null), V.gen++));
}

export function showStatsView() {
  if (!V.items) load();
}

async function load(force = false) {
  const my = ++V.gen;
  const body = $('[data-body]', root);
  const R = range(V.period);
  const need = R.prevFrom ?? 0;
  const label = PERIODS.find((p) => p[0] === V.period)?.[1].toLowerCase() || '';
  const since = need ? new Date(need).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }) : '';
  const msg = (n) => `${n ? `Загружено продаж: <b>${n}</b>` : 'Загружаю продажи с FunPay…'}<br><span class="dim">${since ? `нужны все с ${esc(since)}, чтобы сравнить с прошлым периодом` : 'за всё время — это может занять минуту'}</span>`;
  // данные уже есть — показываем плашку поверх, старые цифры остаются видны
  const over = V.items && !force;
  if (over) {
    $('.sv-loading', root)?.remove();
    body.classList.add('sv-busy');
    body.insertAdjacentHTML('afterbegin', `<div class="sv-loading"><div class="spinner sm"></div><div><b>Считаю статистику за ${esc(label)}…</b><div class="sv-ln" data-note>${msg(0)}</div></div></div>`);
  } else body.innerHTML = `<div class="empty" style="padding:80px"><div class="spinner"></div><h3>Считаю статистику${label ? ' за ' + esc(label) : ''}…</h3><p data-note>${msg(0)}</p></div>`;
  const done = () => (body.classList.remove('sv-busy'), $('.sv-loading', root)?.remove());
  try {
    const raw = await loadSales(need, { force, pages: V.period === '0' ? 80 : 60, progress: (n) => my === V.gen && $('[data-note]', body) && ($('[data-note]', body).innerHTML = msg(n)) });
    if (my !== V.gen) return;
    V.items = withTs(raw);
    V.partial = !!raw.partial;
    done();
    render();
  } catch (e) {
    if (my !== V.gen) return;
    done();
    body.innerHTML = `<div class="empty" style="padding:60px"><div class="orb" style="color:var(--bad)">${icon('alert', 28)}</div><h3>Не загрузилось</h3><p>${esc(e.message)}</p></div>`;
  }
}

function render() {
  const items = V.items;
  const body = $('[data-body]', root);
  const R = range(V.period);
  const cur = mainCur(items);
  const st = calc(items, R.from, R.to, cur);
  const pv = R.prevFrom != null ? calc(items, R.prevFrom, R.prevTo, cur) : null;
  if (!st.list.length) {
    body.innerHTML = `<div class="empty" style="padding:80px"><div class="orb">${icon('trend', 28)}</div><h3>Продаж за этот период нет</h3><p>Выбери период побольше${V.partial ? ' · FunPay попросил подождать — нажми ↻ через минуту' : ''}</p></div>`;
    return;
  }
  const from = V.period === '0' ? startOfDay(Math.min(...st.list.map((t) => t.ts))) : R.from;
  const span = `${dshort(from)} — ${dshort(Date.now())}`;
  const chip = (a, b, good = 'up') => {
    if (!pv || b == null) return '';
    if (!a && !b) return '';
    if (!b) return `<span class="sv-chip up">${icon('trend', 12)}новое</span>`;
    const d = (a - b) / b;
    const up = d >= 0;
    return `<span class="sv-chip ${(up && good === 'up') || (!up && good === 'down') ? 'up' : 'dn'}">${icon('trend', 12)}${up ? '+' : '−'}${Math.abs(Math.round(d * 100))}%</span>`;
  };
  const returning = [...st.buyers.values()].filter((b) => b.n >= 2).length;
  const kpi = (cls, ic, lbl, val, ch, sub) => `<div class="sv-k ${cls}"><div class="row"><span class="sv-ic">${icon(ic, 18)}</span><span class="grow"></span>${ch}</div><div class="l">${lbl}</div><div class="v">${val}</div><div class="s">${sub}</div></div>`;

  // календарь — месяц, где последняя продажа периода
  if (!V.calM || V.calKey !== V.period) {
    const last = Math.max(...st.list.map((t) => t.ts));
    V.calM = new Date(new Date(last).getFullYear(), new Date(last).getMonth(), 1);
    V.calKey = V.period;
  }

  const goods = [...st.goods.values()].sort((a, b) => b.sum - a.sum || b.n - a.n);
  const pgoods = pv ? pv.goods : new Map();
  const cats = [...st.cats.values()].sort((a, b) => b.sum - a.sum);
  const buyers = [...st.buyers.values()].sort((a, b) => b.sum - a.sum || b.n - a.n);
  const recent = [...st.list].sort((a, b) => b.ts - a.ts).slice(0, 10);
  const share = (v) => (st.revenue ? Math.round((v / st.revenue) * 100) : 0);
  const STATE = { paid: ['warn', 'Ждёт подтверждения'], closed: ['ok', 'Закрыт'], refunded: ['bad', 'Возврат'] };

  body.innerHTML = `
    <div class="sv-kpis">
      ${kpi('hero', 'cash', 'Выручка', money(st.revenue, cur), chip(st.revenue, pv?.revenue), span)}
      ${kpi('', 'bag', 'Заказы', fmtNum(st.orders), chip(st.orders, pv?.orders), `${st.pending ? `${st.pending} ждут подтверждения` : 'все подтверждены'}${st.refunds ? ` · возвратов ${st.refunds}` : ''}`)}
      ${kpi('', 'users', 'Покупатели', fmtNum(st.buyers.size), chip(st.buyers.size, pv?.buyers.size), returning ? `${returning} ${plural(returning, 'вернулся', 'вернулись', 'вернулись')} снова` : 'постоянных пока нет')}
      ${kpi('', 'tag', 'Средний чек', money(st.avg, cur), chip(st.avg, pv?.avg), st.max ? `самая дорогая — ${money(st.max.amount, cur)}` : '')}
    </div>
    <div class="sv-row r21">
      <div class="hc sv-card"><div class="sv-h"><div><b>Динамика</b><small data-msub>${pv ? 'пунктир — прошлый такой же период' : 'за всё время'}</small></div><span class="grow"></span>
        <div class="seg sm" data-metric><button data-v="sum" data-tip="Сумма продаж без возвратов">Выручка</button><button data-v="n" data-tip="Сколько заказов оплатили. Возвраты не считаются">Заказы</button><button data-v="b" data-tip="Сколько разных людей купило. Один человек с 3 заказами — это 1 покупатель">Покупатели</button><button data-v="avg" data-tip="Выручка ÷ заказы">Ср. чек</button></div></div>
        <div class="sv-chart" data-chart></div></div>
      <div class="hc sv-card"><div class="sv-h"><div><b>Когда покупают</b><small>время и дни недели</small></div></div><div data-heat></div></div>
    </div>
    <div class="sv-row r21">
      <div class="hc sv-card"><div class="sv-h"><div><b>Топ товаров</b><small>по выручке · ${goods.length} ${plural(goods.length, 'лот', 'лота', 'лотов')}</small></div><span class="grow"></span>${goods.length > 7 ? `<button class="btn sm" data-goods-all>${V.goodsAll ? 'Свернуть' : 'Все'}</button>` : ''}</div>
        <div class="sv-tbl goods"><div class="tr h"><span>Товар</span><span>Выручка</span><span>Продаж</span><span>Доля</span><span>Рост</span></div>
        ${goods.slice(0, V.goodsAll ? 100 : 7).map((g) => { const p = pgoods.get(g.name); const d = pv && p?.sum ? Math.round(((g.sum - p.sum) / p.sum) * 100) : null; return `<div class="tr" data-st="${esc(esc(g.name))}"><span class="ell"><b>${esc(cut(g.name, 90))}</b></span><span>${money(g.sum, cur)}</span><span>${g.n}</span><span><i class="sv-bar"><u style="width:${share(g.sum)}%"></u></i>${share(g.sum)}%</span><span class="${d == null ? 'dim' : d >= 0 ? 'up' : 'dn'}">${d == null ? (pv && !p ? 'новый' : '—') : `${d >= 0 ? '↗' : '↘'} ${Math.abs(d)}%`}</span></div>`; }).join('')}</div></div>
      <div class="hc sv-card"><div class="sv-h"><div><b>Разделы</b><small>где зарабатываешь</small></div></div>
        <div class="sv-cats">${cats.slice(0, 8).map((c) => `<div class="sv-cat" data-st="${esc(`${esc(c.name)}<br><b>${money(c.sum, cur)}</b> · ${nOrders(c.n)} · ${share(c.sum)}% выручки`)}"><span class="sv-cl">${esc(Array.from(c.name)[0] || '?')}</span><div class="ell nm">${esc(c.name)}</div><b>${compact(c.sum)} ${esc(cur)}</b><small>${nOrders(c.n)}</small></div>`).join('')}</div></div>
    </div>
    <div class="sv-row r11">
      <div class="hc sv-card"><div class="sv-h"><div><b>Календарь</b><small data-caltot></small></div><span class="grow"></span>
        <div class="mcal-nav"><button class="ibtn" data-cal="-1">${icon('chevL', 18)}</button><b data-calm></b><button class="ibtn" data-cal="1">${icon('chevR', 18)}</button></div></div>
        <div class="mcal" data-mcal></div></div>
      <div class="hc sv-card"><div class="sv-h"><div><b>Покупатели</b><small>кто принёс больше всего · нажми — профиль</small></div></div>
        <div class="sv-tbl buyers"><div class="tr h"><span>Покупатель</span><span>Заказов</span><span>Сумма</span><span>Последний</span></div>
        ${buyers.slice(0, 8).map((b) => `<div class="tr" ${b.id ? `data-buyer="${esc(b.id)}"` : ''}><span class="row" style="gap:10px;min-width:0">${avatar('', b.name, 30)}<b class="ell">${esc(b.name)}</b>${b.n >= 3 ? '<span class="pill" style="background:rgba(var(--a-rgb),.15);color:var(--a1)">VIP</span>' : b.n >= 2 ? '<span class="pill ok">постоянный</span>' : ''}</span><span>${b.n}</span><span>${money(b.sum, cur)}</span><span class="dim">${dshort(b.last)}</span></div>`).join('')}</div></div>
    </div>
    <div class="hc sv-card" style="margin-top:16px"><div class="sv-h"><div><b>Последние продажи</b><small>нажми — откроется заказ</small></div></div>
      <div class="sv-tbl recent"><div class="tr h"><span>Дата</span><span>Товар</span><span>Покупатель</span><span>Раздел</span><span>Сумма</span><span>Статус</span></div>
      ${recent.map((t) => `<div class="tr" data-o="${esc(t.id || '')}"><span class="dim">${new Date(t.ts).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })}${t.hasTime ? ' ' + new Date(t.ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : ''}</span><span class="ell">${esc(t.desc || '')}</span><span class="ell">${esc(t.peer || '')}</span><span class="ell dim">${esc(t.game || '')}</span><span class="${t.state === 'refunded' ? 'dn' : ''}"><b>${t.state === 'refunded' ? '−' : '+'}${money(t.amount || 0, t.currency || '₽')}</b></span><span><span class="pill ${STATE[t.state]?.[0] || ''}"><span class="dotc"></span>${STATE[t.state]?.[1] || esc(t.statusText || '')}</span></span></div>`).join('')}</div></div>
    <div class="sv-foot">Посчитано по ${st.list.length} ${plural(st.list.length, 'продаже', 'продажам', 'продажам')}${st.otherCur ? ` · ${st.otherCur} в другой валюте — в суммы не вошли` : ''}${V.partial ? ' · FunPay попросил подождать, загружены не все — нажми ↻ через минуту' : ''}</div>`;

  const MSUB = { sum: 'сумма продаж без возвратов', n: 'сколько заказов оплатили — возвраты не считаются', b: 'сколько разных людей купило: 3 заказа от одного = 1 покупатель', avg: 'выручка ÷ число заказов' };
  const msub = (v) => ($('[data-msub]', body).textContent = MSUB[v] + (pv ? ' · пунктир — прошлый период' : ''));
  msub(V.metric);
  seg($('[data-metric]', body), V.metric, (v) => ((V.metric = v), msub(v), drawChart(st, pv, R, from, cur)));
  drawChart(st, pv, R, from, cur);
  drawHeat(st);
  V._st = st;
  V._cur = cur;
  drawCal();
}

/** Значение показателя по набору продаж. */
function metricOf(list, mk) {
  let n = 0, sum = 0;
  const b = new Set();
  for (const t of list) {
    if (t.state === 'refunded') continue;
    n++;
    sum += t.amount || 0;
    if (t.peer) b.add(t.peer);
  }
  return mk === 'sum' ? sum : mk === 'n' ? n : mk === 'b' ? b.size : n ? sum / n : 0;
}

function drawChart(st, pv, R, from, cur) {
  const box = $('[data-chart]', root);
  const mk = V.metric;
  const fmt = (v) => (mk === 'sum' || mk === 'avg' ? money(v, cur) : mk === 'n' ? nOrders(Math.round(v)) : `${Math.round(v)} ${plural(Math.round(v), 'покупатель', 'покупателя', 'покупателей')}`);
  // корзины: часы (сегодня), дни, недели или месяцы
  const spanD = Math.round((startOfDay(Date.now()) - from) / DAY) + 1;
  const kind = V.period === '1' ? 'hour' : spanD > 400 ? 'month' : spanD > 100 ? 'week' : 'day';
  const B = [];
  if (kind === 'hour') for (let h = 0; h <= new Date().getHours(); h++) B.push([from + h * 3600e3, from + (h + 1) * 3600e3, `${h}:00`]);
  else {
    let t = from;
    if (kind === 'week') { const d = new Date(t); t = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7)).getTime(); }
    if (kind === 'month') { const d = new Date(t); t = new Date(d.getFullYear(), d.getMonth(), 1).getTime(); }
    while (t <= Date.now()) {
      const d = new Date(t);
      const nx = kind === 'month' ? new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime() : new Date(d.getFullYear(), d.getMonth(), d.getDate() + (kind === 'week' ? 7 : 1)).getTime();
      B.push([t, nx, kind === 'month' ? `${MON[d.getMonth()]} ${String(d.getFullYear()).slice(2)}` : dshort(t)]);
      t = nx;
    }
  }
  const shift = pv ? R.from - R.prevFrom : 0;
  const cur1 = B.map(([a, b]) => metricOf(st.list.filter((t) => t.ts >= a && t.ts < b), mk));
  const prev1 = pv ? B.map(([a, b]) => metricOf(pv.list.filter((t) => t.ts >= a - shift && t.ts < b - shift), mk)) : null;
  const W = 1000, H = 260;
  const top = Math.max(1, ...cur1, ...(prev1 || []));
  const p10 = Math.pow(10, Math.floor(Math.log10(top)));
  const max = [1, 2, 2.5, 5, 10].map((k) => k * p10).find((v) => v >= top * 1.08) || 10 * p10;
  const X = (i) => (B.length === 1 ? W / 2 : (i / (B.length - 1)) * W);
  const Y = (v) => H - (v / max) * H;
  const smooth = (vals) => {
    const pts = vals.map((v, i) => [X(i), Y(v)]);
    let d = `M${pts[0][0]},${pts[0][1]}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const [a, b, c, e] = [pts[i - 1] || pts[i], pts[i], pts[i + 1], pts[i + 2] || pts[i + 1]];
      d += ` C${(b[0] + (c[0] - a[0]) / 6).toFixed(1)},${Math.min(H, b[1] + (c[1] - a[1]) / 6).toFixed(1)} ${(c[0] - (e[0] - b[0]) / 6).toFixed(1)},${Math.min(H, c[1] - (e[1] - b[1]) / 6).toFixed(1)} ${c[0].toFixed(1)},${c[1].toFixed(1)}`;
    }
    return d;
  };
  const line = smooth(cur1);
  const step = Math.max(1, Math.ceil(B.length / 8));
  box.innerHTML = `<div class="sv-ch"><div class="sv-y">${[1, 0.75, 0.5, 0.25, 0].map((k) => `<span style="top:${(1 - k) * 100}%">${mk === 'n' || mk === 'b' ? Math.round(max * k) : compact(max * k)}</span>`).join('')}</div>
    <div class="sv-plot"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
      <defs><linearGradient id="svg1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="rgb(var(--a-rgb))" stop-opacity=".45"/><stop offset="1" stop-color="rgb(var(--a-rgb))" stop-opacity="0"/></linearGradient></defs>
      ${[0.25, 0.5, 0.75].map((k) => `<line class="gl" x1="0" x2="${W}" y1="${H * k}" y2="${H * k}"/>`).join('')}
      ${prev1 ? `<path d="${smooth(prev1)}" class="prev"/>` : ''}
      <path d="${line} L${W},${H} L0,${H} Z" fill="url(#svg1)"/>
      <path d="${line}" class="cur"/>
      <line class="vl" data-vl x1="0" x2="0" y1="0" y2="${H}" opacity="0"/>
    </svg><span class="sv-dot" data-dot></span><div class="sv-ctip" data-ctip></div></div></div>
    <div class="sv-x">${B.map((b, i) => `<span>${i % step === 0 ? esc(b[2]) : ''}</span>`).join('')}</div>`;
  const plot = $('.sv-plot', box);
  const svg = $('svg', box);
  const ct = $('[data-ctip]', box);
  const dot = $('[data-dot]', box);
  const vl = $('[data-vl]', box);
  plot.onpointermove = (e) => {
    const r = svg.getBoundingClientRect();
    const i = Math.max(0, Math.min(B.length - 1, Math.round(((e.clientX - r.left) / r.width) * (B.length - 1))));
    const x = (X(i) / W) * r.width;
    const y = (Y(cur1[i]) / H) * r.height;
    vl.setAttribute('x1', X(i));
    vl.setAttribute('x2', X(i));
    vl.setAttribute('opacity', 1);
    const d = prev1 && prev1[i] ? Math.round(((cur1[i] - prev1[i]) / prev1[i]) * 100) : null;
    const head = kind === 'hour' ? `сегодня, ${B[i][2]}` : kind === 'day' ? `${dshort(B[i][0])}, ${WDL[(new Date(B[i][0]).getDay() + 6) % 7]}` : kind === 'week' ? `неделя с ${dshort(B[i][0])}` : B[i][2];
    ct.innerHTML = `<small>${head}</small><div class="row" style="gap:8px"><b>${fmt(cur1[i])}</b>${d == null ? '' : `<span class="sv-chip ${d >= 0 ? 'up' : 'dn'}">${d >= 0 ? '+' : '−'}${Math.abs(d)}%</span>`}</div>${prev1 ? `<small>прошлый период: ${fmt(prev1[i])}</small>` : ''}`;
    const w = ct.offsetWidth;
    ct.style.left = Math.max(0, Math.min(r.width - w, x - w / 2)) + 'px';
    ct.style.top = Math.max(0, y - ct.offsetHeight - 18) + 'px';
    ct.style.opacity = 1;
    dot.style.left = x + 'px';
    dot.style.top = y + 'px';
    dot.style.opacity = 1;
  };
  plot.onpointerleave = () => ((ct.style.opacity = 0), (dot.style.opacity = 0), vl.setAttribute('opacity', 0));
}

/** Тепловая карта: 8 отрезков по 3 часа × 7 дней недели. */
function drawHeat(st) {
  const g = Array.from({ length: 8 }, () => Array(7).fill(0));
  let any = false;
  for (const t of st.list) {
    if (t.state === 'refunded' || !t.hasTime) continue;
    const d = new Date(t.ts);
    g[Math.floor(d.getHours() / 3)][(d.getDay() + 6) % 7]++;
    any = true;
  }
  const box = $('[data-heat]', root);
  if (!any) return (box.innerHTML = '<div class="dim" style="padding:30px 0;text-align:center;font-size:13px">FunPay не показал время у этих продаж</div>');
  const max = Math.max(1, ...g.flat());
  const lv = (n) => (!n ? 0 : n / max > 0.75 ? 4 : n / max > 0.5 ? 3 : n / max > 0.25 ? 2 : 1);
  let best = [0, 0];
  g.forEach((r, i) => r.forEach((n, j) => n > g[best[0]][best[1]] && (best = [i, j])));
  box.innerHTML = `<div class="sv-legend">${[1, 2, 3, 4].map((l) => `<span><i class="hl l${l}"></i>${['мало', 'средне', 'много', 'пик'][l - 1]}</span>`).join('')}</div>
    <div class="sv-heat">${g.map((r, i) => `<span class="hh">${String(i * 3).padStart(2, '0')}–${String(i * 3 + 3).padStart(2, '0')}</span>${r.map((n, j) => `<i class="hl l${lv(n)}" data-st="${esc(`${WDL[j]}, ${i * 3}:00–${i * 3 + 3}:00<br><b>${nOrders(n)}</b>`)}"></i>`).join('')}`).join('')}<span></span>${WD.map((w) => `<span class="hd">${w}</span>`).join('')}</div>
    <div class="sv-note">${icon('zap', 14)}Чаще всего — ${WDL[best[1]]}, ${best[0] * 3}:00–${best[0] * 3 + 3}:00. В это время будь на связи и поднимай лоты</div>`;
}

function drawCal() {
  const box = $('[data-mcal]', root);
  if (!box || !V._st) return;
  const st = V._st;
  const cur = V._cur;
  const y = V.calM.getFullYear();
  const m = V.calM.getMonth();
  const info = new Map();
  for (const t of V.items) {
    if (t.state === 'refunded') continue;
    const d = new Date(t.ts);
    if (d.getFullYear() !== y || d.getMonth() !== m) continue;
    const k = d.getDate();
    const x = info.get(k) || { n: 0, sum: 0, b: new Set(), g: new Map() };
    x.n++;
    x.sum += (t.currency || '₽') === cur ? t.amount || 0 : 0;
    if (t.peer) x.b.add(t.peer);
    if (t.desc) x.g.set(t.desc, (x.g.get(t.desc) || 0) + 1);
    info.set(k, x);
  }
  const dim = new Date(y, m + 1, 0).getDate();
  const lead = (new Date(y, m, 1).getDay() + 6) % 7;
  const mx = Math.max(1, ...[...info.values()].map((x) => x.sum));
  const today = new Date();
  let tot = { n: 0, sum: 0 };
  let h = WD.map((w) => `<div class="wd">${w}</div>`).join('') + '<div></div>'.repeat(lead);
  for (let d = 1; d <= dim; d++) {
    const x = info.get(d);
    if (x) (tot.n += x.n), (tot.sum += x.sum);
    const isToday = today.getFullYear() === y && today.getMonth() === m && today.getDate() === d;
    const fut = new Date(y, m, d) > today;
    const a = x ? 0.12 + 0.6 * (x.sum / mx) : 0;
    const top = x ? [...x.g].sort((p, q) => q[1] - p[1])[0] : null;
    const t = x ? `${d} ${MON[m]}, ${WDL[(new Date(y, m, d).getDay() + 6) % 7]}<br><b>${nOrders(x.n)} · ${money(x.sum, cur)}</b><br>${x.b.size} ${plural(x.b.size, 'покупатель', 'покупателя', 'покупателей')}${top ? `<br><span class="dim">чаще всего: ${esc(cut(top[0], 60))}</span>` : ''}` : `${d} ${MON[m]} — продаж нет`;
    h += `<div class="d ${fut ? 'fut' : ''} ${isToday ? 'today' : ''}" style="${x ? `background:rgba(var(--a-rgb),${a.toFixed(2)});border-color:rgba(var(--a-rgb),${(a + 0.1).toFixed(2)})` : ''}" data-st="${esc(t)}"><span class="n">${d}</span>${x ? `<span class="c">${compact(x.sum)}</span>` : ''}</div>`;
  }
  box.innerHTML = h;
  $('[data-calm]', root).textContent = `${MONF[m]} ${y}`;
  $('[data-caltot]', root).textContent = tot.n ? `${nOrders(tot.n)} на ${money(tot.sum, cur)}` : 'продаж нет';
  const first = Math.min(...V.items.map((t) => t.ts));
  $('[data-cal="-1"]', root).disabled = new Date(y, m, 1) <= new Date(new Date(first).getFullYear(), new Date(first).getMonth(), 1);
  $('[data-cal="1"]', root).disabled = y === today.getFullYear() && m === today.getMonth();
  void st;
}
