// © 2026 Lumen. Все права защищены. Копирование, изменение и распространение этого кода запрещены без разрешения автора (см. LICENSE).
// Главная: выручка с графиком, автоматика, заказы по дням недели, кошелёк, последние продажи, кто ждёт ответа.
import { $, esc, avatar, fmtNum, plural } from '../core/util.js';
import { icon } from '../core/icons.js';
import { S, bus } from '../core/state.js';
import { seg } from '../ui/kit.js';
import { parseAmount } from '../fp/parse.js';
import { loadSales, withTs, mainCur, calc, startOfDay } from './stats.js';
import { openOrder } from './order.js';
import { openSupportPicker } from '../features/support.js';

const DAY = 86400e3;
const WD = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const WDL = ['понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресенье'];
const MON = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const V = { period: '30', wd: '30', sales: null, cutoff: Infinity, frozen: null, chats: [], auto: null, gen: 0 };
let root;

const money = (v) => fmtNum(Math.round(v));
const compact = (v) => (v >= 1000 ? +(v / 1000).toFixed(v >= 10000 ? 1 : 2) + 'K' : String(Math.round(v)));
const dshort = (t) => `${new Date(t).getDate()} ${MON[new Date(t).getMonth()]}`;
const AUTO = () => window.__autoMock || window.api?.auto;
const autoOk = () => !!window.__autoMock || (!!window.api && !S.demo);

/** Отрезок [from, to) последних n дней и такой же перед ним. */
function span(days) {
  const today = startOfDay(Date.now());
  if (days === '1') return { from: today, to: Date.now() + 1, pf: today - DAY, pt: today };
  const n = days === 'y' ? 365 : +days;
  const t = new Date(today);
  const from = new Date(t.getFullYear(), t.getMonth(), t.getDate() - (n - 1)).getTime();
  const pf = new Date(t.getFullYear(), t.getMonth(), t.getDate() - (2 * n - 1)).getTime();
  return { from, to: Date.now() + 1, pf, pt: from, n };
}

export function mountHome(c) {
  root = c;
  root.innerHTML = `<div class="home">
    <div class="home-l">
      <div class="home-kpis" data-kpis></div>
      <div class="hc hc-rev">
        <div class="hd"><div><div class="lbl">Выручка</div><div class="money" data-rev><span class="skel skel-n"></span></div></div>
          <span class="grow"></span><div class="seg" data-p><button data-v="y">Год</button><button data-v="30">30 дней</button><button data-v="7">7 дней</button><button data-v="1">Сегодня</button></div></div>
        <div class="rev-body"><div class="rev-chart" data-chart></div><div class="rev-y" data-y></div></div>
        <div class="rev-x" data-x></div>
        <div class="rev-foot" data-foot></div>
      </div>
      <div class="home-row">
        <div class="hc hc-promo" data-promo></div>
        <div class="hc hc-bars">
          <div class="row" style="align-items:flex-start"><div><div class="lbl">Заказы по дням недели</div><div class="money sm" data-wdn></div></div><span class="grow"></span>
            <div class="seg" data-wdp><button data-v="30">Месяц</button><button data-v="7">Неделя</button></div></div>
          <div class="bars" data-bars></div>
        </div>
      </div>
    </div>
    <aside class="hc hc-wal">
      <div class="hc-ttl">Мой кошелёк<button data-addacc>+ Аккаунт</button></div>
      <div class="wcard"><div class="back"></div><div class="back b2"></div>
        <div class="front"><div class="fp">FunPay</div><div class="sm" data-wname></div>
          <div class="sm" style="margin-top:16px">Доступно</div><div class="val" data-bal>—</div>
          <div class="chipc"></div><div class="frz hidden" data-frz></div></div></div>
      <div class="wbtns"><button class="btn" data-hist>${icon('external', 15)}История</button><button class="btn pri" data-wd>${icon('down', 15)}Вывести</button></div>
      <div class="hc-ttl" style="margin-top:6px">Последние продажи<button data-all>Все</button></div>
      <div class="col" style="gap:8px" data-recent></div>
      <div data-wait></div>
    </aside>
  </div>`;
  seg($('[data-p]', root), V.period, (v) => ((V.period = v), ensure(v === 'y' ? 365 : 60).then(render)));
  seg($('[data-wdp]', root), V.wd, (v) => ((V.wd = v), render()));
  $('[data-hist]', root).onclick = () => bus.emit('nav', 'finance');
  $('[data-wd]', root).onclick = () => S.backend?.openBrowser('https://funpay.com/account/balance');
  $('[data-all]', root).onclick = () => bus.emit('nav', 'deals');
  $('[data-addacc]', root).onclick = () => bus.emit('add-account');
  root.addEventListener('click', (e) => {
    const r = e.target.closest('[data-order]');
    if (r?.dataset.order) return openOrder(r.dataset.order);
    const ch = e.target.closest('[data-node]');
    if (ch) return bus.emit('nav', 'chats'), bus.emit('open-chat', ch.dataset.node);
    if (e.target.closest('[data-supf],[data-sup]')) return openSupportPicker();
    const a = e.target.closest('[data-goauto]');
    if (a) bus.emit('nav', 'auto');
  });
  bus.on('account', () => ((V.sales = null), (V.cutoff = Infinity), (V.frozen = null), (V.auto = null), V.gen++));
  bus.on('me', () => S.view === 'home' && wallet());
  bus.on('chats', (list) => ((V.chats = list), S.view === 'home' && waiting()));
  bus.on('auto-info', (d) => ((V.auto = d), S.view === 'home' && promo()));
}

/** Загрузить продажи хотя бы за days дней назад (с запасом на сравнение). */
async function ensure(days) {
  const cutoff = startOfDay(Date.now()) - days * DAY * 2;
  if (V.sales && V.cutoff <= cutoff) return;
  const my = V.gen;
  const raw = await loadSales(cutoff, { pages: days > 100 ? 80 : 40 });
  if (my !== V.gen) return;
  V.sales = withTs(raw);
  V.cutoff = cutoff;
}

export async function showHome() {
  wallet();
  waiting();
  promo();
  if (V.sales) render();
  const my = ++V.gen;
  if (autoOk()) AUTO().info().then((d) => my === V.gen && ((V.auto = d), promo())).catch(() => {});
  try {
    const [, tx] = await Promise.all([ensure(V.period === 'y' ? 365 : 60), V.frozen == null ? S.backend.transactions('').catch(() => null) : null]);
    if (my !== V.gen) return;
    if (tx) V.frozen = tx.items.filter((t) => t.state === 'wait' && t.amount > 0).reduce((s, t) => s + t.amount, 0);
    render();
    wallet();
  } catch (e) {
    if (my === V.gen && !V.sales) $('[data-chart]', root).innerHTML = `<div class="empty" style="padding:30px"><p>Продажи не загрузились: ${esc(e.message)}</p></div>`;
  }
}

function wallet() {
  const bal = parseAmount(S.me?.balance || '0');
  $('[data-bal]', root).textContent = `${fmtNum(bal.amount, 2)} ${bal.currency || '₽'}`;
  $('[data-wname]', root).textContent = S.me ? `${S.me.username} · ${S.demo ? 'демо' : 'этот аккаунт'}` : '';
  const f = $('[data-frz]', root);
  f.classList.toggle('hidden', !V.frozen);
  f.textContent = V.frozen ? `в заморозке ${money(V.frozen)} ₽` : '';
}

function waiting() {
  const list = V.chats.filter((c) => c.unread).slice(0, 3);
  $('[data-wait]', root).innerHTML = list.length
    ? `<div class="hc-ttl" style="margin:16px 0 8px">Ждут ответа<span class="ub">${V.chats.filter((c) => c.unread).length}</span></div>
      ${list.map((c) => `<div class="tx" data-node="${esc(c.id)}">${avatar(c.avatar, c.name, 38)}<div style="min-width:0;flex:1"><div class="nm ell">${esc(c.name)}</div><div class="dt">${esc(c.preview || '')}</div></div><span class="dim" style="font-size:11.5px;flex:none">${esc(c.time || '')}</span></div>`).join('')}`
    : '';
}

function promo() {
  const box = $('[data-promo]', root);
  const d = V.auto;
  const on = autoOk() && S.settings.automation?.mode === 'pc' && d;
  const recent = V.sales ? [...new Set([...V.sales].sort((a, b) => b.ts - a.ts).map((t) => t.peer).filter(Boolean))].slice(0, 3) : [];
  const avs = `<div class="pr-avs">${recent.map((n) => avatar('', n, 30)).join('')}<span class="pr-plus">+</span></div>`;
  if (on) {
    const t = d.info?.today || {};
    box.innerHTML = `<div class="pr-txt"><h2>Автоматика работает<br><span>выдаёт и отвечает за тебя</span></h2>
      <p>Сегодня: выдано ${t.delivered || 0}, автоответов ${t.commands || 0}, заказов ${t.orders || 0}. Можно свернуть Lumen в трей.</p>${avs}</div>
      <div class="orb3d"></div><div class="ring3d"></div><button class="go" data-goauto>Открыть автоматику</button>`;
  } else {
    box.innerHTML = `<div class="pr-txt"><h2>Отвечай быстрее —<br><span>получай больше заказов</span></h2>
      <p>Автоответы и автовыдача работают, пока ты в игре или спишь.</p>${avs}</div>
      <div class="orb3d"></div><div class="ring3d"></div><button class="go" data-goauto>${autoOk() ? 'Включить автоматику' : 'Посмотреть автоматику'}</button>`;
  }
}

function render() {
  if (!V.sales) return;
  const items = V.sales;
  const cur = mainCur(items);
  const R = span(V.period);
  const st = calc(items, R.from, R.to, cur);
  const pv = calc(items, R.pf, R.pt, cur);
  const d = pv.revenue ? (st.revenue - pv.revenue) / pv.revenue : null;
  $('[data-rev]', root).innerHTML = `${money(st.revenue)}<small>${esc(cur)}</small>${d == null ? '' : `<span class="dlt ${d >= 0 ? 'up' : 'dn'}">${d >= 0 ? '↑' : '↓'} ${Math.abs(Math.round(d * 100))}%</span>`}`;
  const vs = { y: 'прошлым годом', 30: 'прошлыми 30 днями', 7: 'прошлой неделей', 1: 'вчера' }[V.period];
  $('[data-foot]', root).innerHTML = `<span>Средний чек <b>${money(st.avg)} ${esc(cur)}</b></span><span><i class="lg"></i>Выручка</span><span><i class="lg best"></i>Лучший день</span>${d == null ? '' : `<span class="dim">↑↓ — в сравнении с ${vs}</span>`}<span class="grow"></span><span data-supf data-tip="Не подтверждают долго — Lumen напишет в поддержку FunPay">Ждут подтверждения: <b>${st.pending} · ${money(st.pendingSum)} ${esc(cur)}</b></span>`;

  // строка показателей (видна на высоком экране)
  const today = calc(items, startOfDay(Date.now()), Date.now() + 1, cur);
  const ret = [...st.buyers.values()].filter((b) => b.n >= 2).length;
  const k = (ic, l, v, sub, attr = '', hero = '') => `<div class="sv-k ${hero}" ${attr}><span class="sv-ic">${icon(ic, 17)}</span><div class="l">${l}</div><div class="v">${v}</div><div class="s">${sub}</div></div>`;
  $('[data-kpis]', root).innerHTML =
    k('cash', 'Сегодня', `${money(today.revenue)} ${esc(cur)}`, `${today.orders} ${plural(today.orders, 'заказ', 'заказа', 'заказов')}`, '', 'hero') +
    k('bag', 'Заказов за период', String(st.orders), st.refunds ? `возвратов ${st.refunds}` : 'без возвратов') +
    k('users', 'Покупатели', String(st.buyers.size), ret ? `${ret} ${plural(ret, 'вернулся', 'вернулись', 'вернулись')} снова` : 'новые') +
    k('clock', 'Ждут подтверждения', String(st.pending), st.pending ? `на ${money(st.pendingSum)} ${esc(cur)} · нажми — поддержка` : 'всё подтверждено', st.pending ? 'data-sup' : '');

  // точки графика: по часам (сегодня), по неделям (год) или по дням
  let pts = [];
  if (V.period === '1') {
    const h = new Date().getHours();
    for (let i = 0; i <= h; i++) pts.push({ t: R.from + i * 3600e3, n: 0, sum: 0, lab: `${i}:00`, tip: `${i}:00–${i}:59` });
    for (const t of st.list) if (t.state !== 'refunded' && t.hasTime) { const p = pts[new Date(t.ts).getHours()]; if (p) (p.n++, (p.sum += (t.currency || '₽') === cur ? t.amount || 0 : 0)); }
  } else if (V.period === 'y') {
    for (let t = R.from; t < R.to; t += 7 * DAY) pts.push({ t, n: 0, sum: 0, lab: dshort(t), tip: `неделя с ${dshort(t)}` });
    for (const [k, v] of st.byDay) { const p = pts[Math.floor((k - R.from) / (7 * DAY))]; if (p) (p.n += v.n, (p.sum += v.sum)); }
  } else {
    for (let i = 0; i < R.n; i++) {
      const t = new Date(R.from); t.setDate(t.getDate() + i);
      const k = startOfDay(t.getTime());
      const v = st.byDay.get(k) || { n: 0, sum: 0 };
      pts.push({ t: k, n: v.n, sum: v.sum, lab: dshort(k), tip: `${dshort(k)} · ${WDL[(new Date(k).getDay() + 6) % 7]}` });
    }
  }
  chart(pts, cur);
  const step = Math.max(1, Math.ceil(pts.length / 7));
  $('[data-x]', root).innerHTML = pts.filter((_, i) => i % step === 0).map((x) => `<span>${esc(x.lab)}</span>`).join('');

  // дни недели
  const W = span(V.wd);
  const ws = calc(items, W.from, W.to, cur);
  const wp = calc(items, W.pf, W.pt, cur);
  const wd = wp.orders ? (ws.orders - wp.orders) / wp.orders : null;
  $('[data-wdn]', root).innerHTML = `${ws.orders}<small>${plural(ws.orders, 'заказ', 'заказа', 'заказов')}</small>${wd == null ? '' : `<span class="dlt ${wd >= 0 ? 'up' : 'dn'}">${wd >= 0 ? '↑' : '↓'} ${Math.abs(Math.round(wd * 100))}%</span>`}`;
  const mx = Math.max(1, ...ws.byWd);
  const hi = ws.byWd.indexOf(Math.max(...ws.byWd));
  $('[data-bars]', root).innerHTML = ws.byWd.map((v, i) => `<div class="bc"><span class="bv ${i === hi && v ? 'hi' : ''}">${v}</span><div class="bar ${i === hi && v ? 'hi' : ''}" style="height:${Math.max(3, (v / mx) * 100)}%" data-tip="${WD[i]}: ${v} ${plural(v, 'заказ', 'заказа', 'заказов')}"></div><span class="bd ${i === hi && v ? 'hi' : ''}">${WD[i]}</span></div>`).join('');

  // последние продажи
  const recent = [...items].sort((a, b) => b.ts - a.ts).slice(0, 4);
  const when = (ts) => { const dd = new Date(ts); return startOfDay(ts) === startOfDay(Date.now()) ? dd.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : startOfDay(ts) === startOfDay(Date.now()) - DAY ? 'вчера' : dshort(ts); };
  $('[data-recent]', root).innerHTML = recent.length
    ? recent.map((t) => { const back = t.state === 'refunded'; return `<div class="tx" data-order="${esc(t.id || '')}">${avatar('', t.peer || '?', 38)}<div style="min-width:0;flex:1"><div class="nm ell">${esc(t.peer || 'Покупатель')}</div><div class="dt">${back ? 'Возврат' : esc(t.desc || '')} · ${when(t.ts)}</div></div><span class="am ${back ? 'neg' : 'pos'}">${back ? '−' : '+'}${money(t.amount || 0)} ${esc(t.currency || '₽')}</span></div>`; }).join('')
    : '<div class="dim" style="font-size:13px;padding:10px">Продаж пока нет</div>';
  promo();
}

function chart(days, cur) {
  const box = $('[data-chart]', root);
  const W = 1000;
  const H = 200;
  const top = Math.max(1, ...days.map((d) => d.sum));
  const p10 = Math.pow(10, Math.floor(Math.log10(top)));
  const max = [1, 2, 2.5, 5, 10].map((k) => k * p10).find((v) => v >= top * 1.05) || 10 * p10;
  $('[data-y]', root).innerHTML = [1, 0.75, 0.5, 0.25].map((k) => `<span style="top:${(1 - k) * 100}%">${compact(max * k)}</span>`).join('');
  const pts = days.map((d, i) => [days.length === 1 ? W / 2 : (i / (days.length - 1)) * W, H - (d.sum / max) * H]);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const best = days.reduce((bi, d, i, a) => (d.sum > a[bi].sum ? i : bi), 0);
  const grid = [0.25, 0.5, 0.75].map((k) => `<line class="gl" x1="0" x2="${W}" y1="${H * k}" y2="${H * k}"/>`).join('');
  box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
    <defs><linearGradient id="hg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="rgb(var(--a-rgb))" stop-opacity=".5"/><stop offset="1" stop-color="rgb(var(--a-rgb))" stop-opacity=".02"/></linearGradient></defs>
    ${grid}<path d="${line} L${W},${H} L0,${H} Z" fill="url(#hg)"/>
    <path d="${line}" fill="none" stroke="var(--a1)" stroke-width="2.2" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>
    <line data-vl x1="0" x2="0" y1="0" y2="${H}" class="vl" opacity="0"/>
  </svg><span class="rev-best" style="left:${(pts[best][0] / W) * 100}%;top:${(pts[best][1] / H) * 100}%"></span><span class="rev-dot" data-dot></span><div class="rev-tip" data-tip2></div>`;
  const svg = $('svg', box);
  const tip = $('[data-tip2]', box);
  const dot = $('[data-dot]', box);
  const vl = $('[data-vl]', box);
  box.onpointermove = (e) => {
    const r = svg.getBoundingClientRect();
    const i = Math.max(0, Math.min(days.length - 1, Math.round(((e.clientX - r.left) / r.width) * (days.length - 1))));
    const d = days[i];
    const x = (pts[i][0] / W) * r.width;
    const y = (pts[i][1] / H) * r.height;
    vl.setAttribute('x1', pts[i][0]);
    vl.setAttribute('x2', pts[i][0]);
    vl.setAttribute('opacity', 1);
    tip.innerHTML = `<small>${esc(d.tip)}</small><b>${money(d.sum)} ${esc(cur)} · ${d.n} ${plural(d.n, 'заказ', 'заказа', 'заказов')}</b>`;
    tip.style.left = Math.max(80, Math.min(r.width - 80, x)) + 'px';
    tip.style.top = y + 'px';
    tip.style.opacity = 1;
    dot.style.left = x + 'px';
    dot.style.top = y + 'px';
    dot.style.opacity = 1;
  };
  box.onpointerleave = () => ((tip.style.opacity = 0), (dot.style.opacity = 0), vl.setAttribute('opacity', 0));
}
