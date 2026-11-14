// © 2026 Lumen. Все права защищены. Копирование, изменение и распространение этого кода запрещены без разрешения автора (см. LICENSE).
// Подробная статистика продаж: показатели со сравнением с прошлым периодом, выручка по дням,
// календарь заказов, часы и дни недели, разделы, товары, покупатели.
// Всё считается из списка продаж FunPay (Сделки → Продажи). Графики — простой SVG, один цвет (акцент).
import { $, esc, fmtNum, parseFpDate, plural } from '../core/util.js';
import { icon } from '../core/icons.js';
import { S, bus } from '../core/state.js';
import { modal, seg } from '../ui/kit.js';
import { openProfile } from './profile.js';

const PERIODS = [
  ['1', 'Сегодня'],
  ['7', '7 дней'],
  ['30', '30 дней'],
  ['90', '90 дней'],
  ['0', 'Всё время'],
];
const DAY = 86400e3;
const WD = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const MON = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

let cache = null; // { acc, at, cutoff, items }

/** Продажи с даты cutoff (0 — все). Общий кэш на 5 минут — им пользуются и Главная, и Статистика. */
export async function loadSales(cutoff, { force = false, pages = 60, progress } = {}) {
  const c0 = cache;
  if (!force && c0 && c0.acc === S.accId && Date.now() - c0.at < 5 * 60e3 && !c0.items.partial && c0.cutoff <= cutoff) return c0.items;
  const be = S.backend;
  const items = await be.salesSince(cutoff, pages, progress);
  if (be === S.backend) cache = { acc: S.accId, at: Date.now(), cutoff, items };
  return items;
}
/** Продажи с временем (ts), без нераспознанных дат. */
export const withTs = (raw) => raw.map((t) => { const d = parseFpDate(t.date); return d ? { ...t, ts: d.getTime(), hasTime: /\d:\d\d/.test(t.date) } : null; }).filter(Boolean);
export { mainCur, calc, startOfDay, range };

const startOfDay = (t) => {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};
const money = (v, cur) => `${fmtNum(Math.round(v))} ${cur}`;
const dshort = (t) => {
  const d = new Date(t);
  return `${d.getDate()} ${MON[d.getMonth()]}`;
};

/** Границы периода: [from, to) и предыдущий такой же отрезок для сравнения. */
function range(days) {
  const now = Date.now();
  const today = startOfDay(now);
  if (days === '1') return { from: today, to: now + 1, prevFrom: startOfDay(today - 12 * 3600e3), prevTo: today };
  if (days === '0') return { from: 0, to: now + 1, prevFrom: null, prevTo: null };
  const n = +days;
  const t = new Date(today);
  const from = new Date(t.getFullYear(), t.getMonth(), t.getDate() - (n - 1)).getTime();
  const prevFrom = new Date(t.getFullYear(), t.getMonth(), t.getDate() - (2 * n - 1)).getTime();
  return { from, to: now + 1, prevFrom, prevTo: from };
}

/** Основная валюта — та, в которой больше всего заказов (суммы считаем только в ней). */
function mainCur(items) {
  const c = new Map();
  for (const t of items) c.set(t.currency || '₽', (c.get(t.currency || '₽') || 0) + 1);
  return [...c].sort((a, b) => b[1] - a[1])[0]?.[0] || '₽';
}

function calc(items, from, to, cur) {
  const list = items.filter((t) => t.ts >= from && t.ts < to);
  const st = { list, orders: 0, revenue: 0, earned: 0, pending: 0, pendingSum: 0, refunds: 0, refundSum: 0, buyers: new Map(), goods: new Map(), cats: new Map(), byDay: new Map(), byHour: Array(24).fill(0), byWd: Array(7).fill(0), max: null, otherCur: 0 };
  for (const t of list) {
    const same = (t.currency || '₽') === cur;
    if (!same) st.otherCur++;
    const amt = same ? t.amount || 0 : 0;
    if (t.state === 'refunded') {
      st.refunds++;
      st.refundSum += amt;
      continue;
    }
    st.orders++;
    st.revenue += amt;
    if (t.state === 'closed') st.earned += amt;
    else (st.pending++, (st.pendingSum += amt));
    if (!st.max || amt > st.max.amount) st.max = t;
    const b = st.buyers.get(t.peer) || { name: t.peer, id: t.peerId, n: 0, sum: 0, last: 0 };
    b.n++;
    b.sum += amt;
    b.last = Math.max(b.last, t.ts);
    if (t.peer) st.buyers.set(t.peer, b);
    const g = st.goods.get(t.desc) || { name: t.desc, n: 0, sum: 0 };
    g.n++;
    g.sum += amt;
    if (t.desc) st.goods.set(t.desc, g);
    const cname = t.game || 'Без раздела';
    const c = st.cats.get(cname) || { name: cname, n: 0, sum: 0 };
    c.n++;
    c.sum += amt;
    st.cats.set(cname, c);
    const dk = startOfDay(t.ts);
    const dd = st.byDay.get(dk) || { n: 0, sum: 0 };
    dd.n++;
    dd.sum += amt;
    st.byDay.set(dk, dd);
    const d = new Date(t.ts);
    if (t.hasTime) st.byHour[d.getHours()]++;
    st.byWd[(d.getDay() + 6) % 7]++;
  }
  st.avg = st.orders ? st.revenue / st.orders : 0;
  st.repeat = [...st.buyers.values()].filter((b) => b.n >= 2).length;
  return st;
}

// ---------------------------------------------------------------- маленькие SVG-графики

/** Столбики снизу вверх (HTML, тянутся по ширине без искажений). data: [{ label, value, tip }]. */
function columns(data, { h = 170, labelsEvery = 1, highlight = -1 } = {}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const nice = niceMax(max);
  const grid = [1, 0.5, 0].map((k) => `<div class="st-gl" style="bottom:${k * 100}%"><span>${esc(compact(nice * k))}</span></div>`).join('');
  const bars = data
    .map((d, i) => `<div class="st-col" data-st="${esc(d.tip || `${d.label}: ${fmtNum(d.value)}`)}"><i class="${i === highlight ? 'hi' : ''}" style="height:${d.value > 0 ? Math.max(1.5, (d.value / nice) * 100) : 0}%"></i></div>`)
    .join('');
  const labels = data.map((d, i) => `<span>${i % labelsEvery === 0 ? esc(d.label) : ''}</span>`).join('');
  return `<div class="st-cols-wrap"><div class="st-cols" style="height:${h - 22}px">${grid}${bars}</div><div class="st-cols-l">${labels}</div></div>`;
}
const niceMax = (m) => {
  const p = Math.pow(10, Math.floor(Math.log10(m)));
  for (const k of [1, 2, 2.5, 5, 10]) if (m <= k * p) return k * p;
  return 10 * p;
};
const compact = (v) => (v >= 10000 ? fmtNum(Math.round(v / 1000)) + 'K' : fmtNum(Math.round(v)));

/** Календарь: недели столбцами, дни недели строками; цвет — сколько заказов в день (один оттенок). */
function calendar(st, from, to) {
  const endD = new Date(startOfDay(to - 1));
  const s0 = new Date(startOfDay(Math.max(from, endD.getTime() - 52 * 7 * DAY)));
  const start = new Date(s0.getFullYear(), s0.getMonth(), s0.getDate() - ((s0.getDay() + 6) % 7)); // с понедельника
  const dayAt = (k) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + k).getTime();
  let weeks = 0;
  while (dayAt(weeks * 7) <= endD.getTime()) weeks++;
  const max = Math.max(1, ...[...st.byDay.values()].map((d) => d.n));
  const cell = weeks <= 8 ? 26 : weeks <= 20 ? 18 : 13;
  const gap = 3;
  const W = 30 + weeks * (cell + gap);
  const H = 18 + 7 * (cell + gap);
  let out = '';
  let lastMon = -1;
  for (let w = 0; w < weeks; w++) {
    for (let r = 0; r < 7; r++) {
      const t = dayAt(w * 7 + r);
      if (t > endD.getTime()) continue;
      const d = st.byDay.get(t);
      const n = d?.n || 0;
      const lv = n ? 0.22 + 0.78 * (n / max) : 0;
      const x = 30 + w * (cell + gap);
      const y = 18 + r * (cell + gap);
      const inRange = t >= startOfDay(from);
      out += `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="${cell > 16 ? 5 : 3}" class="st-cal${n ? '' : ' z'}" style="${n ? `fill:rgba(var(--a-rgb),${lv.toFixed(2)})` : inRange ? '' : 'opacity:.35'}" data-st="${esc(`${dshort(t)}, ${WD[r].toLowerCase()} — ${n ? `${n} ${plural(n, 'заказ', 'заказа', 'заказов')} · ${money(d.sum, st.cur)}` : 'заказов нет'}`)}"/>`;
      const m = new Date(t).getMonth();
      if (r === 0 && m !== lastMon) {
        out += `<text x="${x}" y="11" class="st-ax">${MON[m]}</text>`;
        lastMon = m;
      }
    }
  }
  const rows = [0, 2, 4, 6].map((r) => `<text x="0" y="${18 + r * (cell + gap) + cell / 2 + 4}" class="st-ax">${WD[r]}</text>`).join('');
  return `<div style="overflow-x:auto"><svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" style="display:block">${rows}${out}</svg></div>
    <div class="st-legend"><span>меньше</span>${[0.22, 0.45, 0.7, 1].map((a) => `<i style="background:rgba(var(--a-rgb),${a})"></i>`).join('')}<span>больше</span></div>`;
}

/** Горизонтальные полоски для разделов/товаров: имя, полоска доли, количество и сумма. */
const cut = (t, n) => { const a = Array.from(String(t || '')); return a.length > n ? a.slice(0, n).join('').trimEnd() + '…' : a.join(''); };

function hbars(rows, cur, total, { click = '', lines = 1 } = {}) {
  const max = Math.max(1, ...rows.map((r) => r.sum || r.n));
  return rows
    .map(
      (r) => `<div class="st-hr" ${click && r.id ? `${click}="${esc(r.id)}"` : ''} data-st="${esc(`${r.name}: ${r.n} ${plural(r.n, 'заказ', 'заказа', 'заказов')} · ${money(r.sum, cur)}${total ? ` · ${Math.round((r.sum / total) * 100)}% выручки` : ''}`)}">
        <div class="st-hr-t"><span class="${lines > 1 ? 'l2' : 'ell'}">${esc(r.name)}</span><b>${money(r.sum, cur)}</b></div>
        <div class="st-hr-b"><i style="width:${Math.max(2, ((r.sum || r.n) / max) * 100)}%"></i></div>
        <div class="st-hr-s">${r.n} ${plural(r.n, 'заказ', 'заказа', 'заказов')}${r.last ? ` · последний ${dshort(r.last)}` : ''}</div></div>`
    )
    .join('');
}

function delta(cur, prev, { good = 'up', pct = true } = {}) {
  if (prev == null || !isFinite(prev)) return '';
  if (!prev && !cur) return '<span class="st-d">как и раньше</span>';
  if (!prev) return '<span class="st-d up">новое</span>';
  const d = (cur - prev) / prev;
  if (Math.abs(d) < 0.005) return '<span class="st-d">без изменений</span>';
  const up = d > 0;
  const ok = (up && good === 'up') || (!up && good === 'down');
  return `<span class="st-d ${ok ? 'up' : 'down'}">${up ? '▲' : '▼'} ${pct ? Math.abs(Math.round(d * 100)) + '%' : ''}</span>`;
}

const CSS = `<style>
.st-wrap{padding:22px 24px 26px}
.st-kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:12px}
.st-k{padding:14px 16px;border-radius:16px;background:var(--surface-2);border:1px solid var(--line)}
.st-k .l{font-size:12px;color:var(--text-3);display:flex;align-items:center;gap:6px}
.st-k .v{font-size:22px;font-weight:700;margin-top:6px;letter-spacing:-.02em}
.st-k .s{font-size:12px;color:var(--text-3);margin-top:3px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.st-k.hero{background:linear-gradient(135deg,rgba(var(--a-rgb),.16),rgba(var(--a-rgb),.04));border-color:rgba(var(--a-rgb),.35)}
.st-d{font-size:11.5px;font-weight:700;color:var(--text-3)}
.st-d.up{color:var(--ok)} .st-d.down{color:var(--bad)}
.st-card{padding:14px 16px 12px;border-radius:16px;background:var(--surface-2);border:1px solid var(--line);margin-top:12px}
.st-card h4{margin:0 0 2px;font-size:13.5px}
.st-card .sub{font-size:12px;color:var(--text-3);margin-bottom:10px}
.st-two{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px}
.st-two>*{min-width:0}
.st-wrap{overflow-x:hidden}
.st-two .st-card{margin-top:12px}
.st-cols-wrap{padding-left:40px}
.st-cols{position:relative;display:flex;align-items:flex-end;gap:3px}
.st-gl{position:absolute;left:0;right:0;border-top:1px solid var(--line);pointer-events:none}
.st-gl span{position:absolute;right:calc(100% + 8px);top:-7px;font-size:11px;color:var(--text-3);white-space:nowrap}
.st-col{flex:1;height:100%;display:flex;align-items:flex-end;justify-content:center;position:relative;z-index:1}
.st-col i{display:block;width:100%;max-width:24px;border-radius:4px 4px 0 0;background:var(--a1);transition:filter .12s}
.st-col i.hi{background:var(--a2)}
.st-col:hover i{filter:brightness(1.18)}
.st-cols-l{display:flex;gap:3px;margin-top:6px}
.st-cols-l span{flex:1;text-align:center;font-size:11px;color:var(--text-3);white-space:nowrap;overflow:visible}
.st-ax{fill:var(--text-3);font-size:11px}
.st-cal{fill:var(--a1)} .st-cal.z{fill:var(--surface-3)}
.st-cal:hover{stroke:var(--text);stroke-width:1.5}
.st-legend{display:flex;align-items:center;gap:4px;font-size:11px;color:var(--text-3);margin-top:6px;justify-content:flex-end}
.st-legend i{width:12px;height:12px;border-radius:3px;display:inline-block}
.st-hr{padding:7px 0;border-top:1px solid var(--line)}
.st-hr:first-child{border-top:0}
.st-hr[data-buyer]{cursor:pointer}
.st-hr[data-buyer]:hover .st-hr-t span{text-decoration:underline}
.st-hr-t{display:flex;gap:10px;font-size:13px}
.st-hr-t span{flex:1;min-width:0}
.st-hr-t span.l2{white-space:normal;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;line-height:1.35}
.st-hr-t b{flex:none;white-space:nowrap}
.st-hr-b{height:6px;border-radius:99px;background:var(--surface-3);margin:5px 0 3px;overflow:hidden}
.st-hr-b i{display:block;height:100%;border-radius:99px;background:var(--a1)}
.st-hr-s{font-size:11.5px;color:var(--text-3)}
.st-tip{position:fixed;z-index:200;pointer-events:none;padding:7px 10px;border-radius:10px;background:var(--surface);border:1px solid var(--line-2);box-shadow:var(--shadow-lg);font-size:12.5px;max-width:320px;opacity:0;transition:opacity .1s}
.st-foot{font-size:12px;color:var(--text-3);margin-top:12px}
.st-tbl{display:flex;flex-direction:column}
.st-tr{display:grid;grid-template-columns:minmax(0,1fr) 80px 120px 90px;gap:10px;padding:9px 6px;border-top:1px solid var(--line);font-size:13px;align-items:center}
.st-tr.h{border-top:0;color:var(--text-3);font-size:12px}
.st-tr[data-buyer]{cursor:pointer;border-radius:10px}
.st-tr[data-buyer]:hover{background:var(--hover)}
.st-k .v{font-weight:400;font-size:24px;letter-spacing:-.03em}
.st-k{border-radius:18px;background:linear-gradient(180deg,rgba(255,255,255,.05),rgba(255,255,255,.015));border-color:rgba(255,255,255,.07)}
.st-card{border-radius:20px}
@media (max-width:900px){.st-kpis{grid-template-columns:repeat(2,1fr)}.st-two{grid-template-columns:1fr}}
</style>`;

/** Статистика теперь отдельный раздел слева. */
export function openStats() {
  bus.emit('nav', 'stats');
}
function _oldStats() {
  const m = modal(`${CSS}<div class="st-wrap"><div class="row" style="margin-bottom:16px;gap:10px"><h3 class="grow" style="margin:0">Статистика продаж</h3><div class="seg" data-p>${PERIODS.map(([v, n]) => `<button data-v="${v}">${n}</button>`).join('')}</div><button class="ibtn" data-reload data-tip="Загрузить заново">${icon('refresh', 17)}</button><button class="ibtn" data-close>${icon('x', 18)}</button></div><div data-body></div></div><div class="st-tip"></div>`, { wide: true });
  m.el.style.width = 'min(1080px, 100%)';
  const body = $('[data-body]', m.el);
  const tip = $('.st-tip', m.el);
  m.el.addEventListener('pointermove', (e) => {
    const t = e.target.closest("[data-st]");
    if (!t || !body.contains(t)) return (tip.style.opacity = 0);
    tip.textContent = t.dataset.st;
    tip.style.opacity = 1;
    const r = tip.getBoundingClientRect();
    tip.style.left = Math.min(innerWidth - r.width - 8, e.clientX + 14) + 'px';
    tip.style.top = Math.max(8, e.clientY - r.height - 12) + 'px';
  });
  m.el.addEventListener('pointerleave', () => (tip.style.opacity = 0));
  body.addEventListener('click', (e) => {
    const b = e.target.closest('[data-buyer]');
    if (b) openProfile(b.dataset.buyer);
  });
  let gen = 0;
  let period = '30';
  let tab = 'all';
  let metric = 'sum';
  const run = async (days, force) => {
    period = days;
    const my = ++gen;
    const R = range(days);
    const need = R.prevFrom ?? 0; // грузим и прошлый период — для сравнения
    body.innerHTML = `<div class="empty" style="padding:60px"><div class="spinner"></div><p data-note>Загружаю продажи…</p></div>`;
    try {
      const raw = await loadSales(need, { force, pages: days === '0' ? 80 : 60, progress: (n) => my === gen && $('[data-note]', body) && ($('[data-note]', body).textContent = `Загружено продаж: ${n}`) });
      if (my !== gen) return;
      render(raw, R, days);
    } catch (e) {
      if (my === gen) body.innerHTML = `<div class="empty" style="padding:50px"><div class="orb" style="color:var(--bad)">${icon('alert', 28)}</div><h3>Не загрузилось</h3><p>${esc(e.message)}</p></div>`;
    }
  };
  $('[data-reload]', m.el).onclick = () => run(period, true);
  seg($('[data-p]', m.el), '30', (v) => run(v));
  run('30');

  function render(raw, R, days) {
    const items = raw
      .map((t) => {
        const d = parseFpDate(t.date);
        return d ? { ...t, ts: d.getTime(), hasTime: /\d:\d\d/.test(t.date) } : null;
      })
      .filter(Boolean);
    const cur = mainCur(items);
    const st = calc(items, R.from, R.to, cur);
    st.cur = cur;
    const pv = R.prevFrom != null ? calc(items, R.prevFrom, R.prevTo, cur) : null;
    if (!st.list.length) {
      body.innerHTML = `<div class="empty" style="padding:60px"><div class="orb">${icon('trend', 28)}</div><h3>Продаж за этот период нет</h3>${raw.partial ? '<p>FunPay попросил подождать — загружены не все продажи. Нажми ↻ через минуту</p>' : ''}</div>`;
      return;
    }
    const vs = days === '1' ? 'чем вчера' : days === '0' ? '' : `чем прошлые ${days} дн.`;
    const k = (label, val, sub, d, hero) => `<div class="st-k ${hero ? 'hero' : ''}"><div class="l">${label}</div><div class="v">${val}</div><div class="s">${d || ''}${sub ? `<span>${sub}</span>` : ''}</div></div>`;
    const refundPct = st.orders + st.refunds ? Math.round((st.refunds / (st.orders + st.refunds)) * 100) : 0;
    const best = [...st.byDay].sort((a, b) => b[1].sum - a[1].sum)[0];

    // выручка по дням (или по неделям/месяцам, если период длинный)
    const firstTs = Math.min(...st.list.map((t) => t.ts));
    const from = days === '0' ? startOfDay(firstTs) : R.from;
    const spanDays = Math.max(1, Math.round((startOfDay(R.to - 1) - startOfDay(from)) / DAY) + 1);
    const bucket = spanDays > 400 ? 'month' : spanDays > 120 ? 'week' : 'day';
    const buckets = new Map();
    const keyOf = (t) => {
      const d = new Date(t);
      if (bucket === 'month') return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
      if (bucket === 'week') return new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7)).getTime();
      return startOfDay(t);
    };
    for (let t = keyOf(from); t <= R.to; ) {
      buckets.set(t, { n: 0, sum: 0 });
      const d = new Date(t);
      t = bucket === 'month' ? new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime() : new Date(d.getFullYear(), d.getMonth(), d.getDate() + (bucket === 'week' ? 7 : 1)).getTime();
    }
    for (const [dk, v] of st.byDay) {
      const b = buckets.get(keyOf(dk));
      if (b) (b.n += v.n, (b.sum += v.sum));
    }
    const bl = [...buckets];
    const lab = (t) => (bucket === 'month' ? `${MON[new Date(t).getMonth()]} ${String(new Date(t).getFullYear()).slice(2)}` : dshort(t));
    const revData = bl.map(([t, v]) => ({ label: lab(t), value: v.sum, tip: `${bucket === 'week' ? 'Неделя с ' : ''}${lab(t)}: ${money(v.sum, cur)} · ${v.n} ${plural(v.n, 'заказ', 'заказа', 'заказов')}` }));
    const bestI = revData.reduce((bi, d, i, a) => (d.value > a[bi].value ? i : bi), 0);

    const hours = st.byHour.map((n, h) => ({ label: String(h), value: n, tip: `${h}:00–${h}:59 — ${n} ${plural(n, 'заказ', 'заказа', 'заказов')}` }));
    const hourMax = st.byHour.indexOf(Math.max(...st.byHour));
    const wds = st.byWd.map((n, i) => ({ label: WD[i], value: n, tip: `${WD[i]} — ${n} ${plural(n, 'заказ', 'заказа', 'заказов')}` }));
    const wdMax = st.byWd.indexOf(Math.max(...st.byWd));
    const cats = [...st.cats.values()].sort((a, b) => b.sum - a.sum).slice(0, 8);
    const goods = [...st.goods.values()].sort((a, b) => b.sum - a.sum || b.n - a.n).slice(0, 8);
    const buyers = [...st.buyers.values()].sort((a, b) => b.sum - a.sum || b.n - a.n).slice(0, 8);
    const hasHours = st.byHour.some(Boolean);

    // по дням: заказы, выручка, покупатели, товары — для графика и календаря
    const dayInfo = new Map();
    for (const t of st.list) {
      if (t.state === 'refunded') continue;
      const dk = startOfDay(t.ts);
      const x = dayInfo.get(dk) || { n: 0, sum: 0, buyers: new Set(), goods: new Map() };
      x.n++;
      x.sum += (t.currency || '₽') === cur ? t.amount || 0 : 0;
      if (t.peer) x.buyers.add(t.peer);
      if (t.desc) x.goods.set(t.desc, (x.goods.get(t.desc) || 0) + 1);
      dayInfo.set(dk, x);
    }
    const METRICS = { sum: ['Выручка', (x) => x.sum, (v) => money(v, cur)], n: ['Заказы', (x) => x.n, (v) => `${v} ${plural(v, 'заказ', 'заказа', 'заказов')}`], b: ['Покупатели', (x) => x.buyers.size, (v) => `${v} ${plural(v, 'покупатель', 'покупателя', 'покупателей')}`], avg: ['Средний чек', (x) => (x.n ? x.sum / x.n : 0), (v) => money(v, cur)] };
    const bucketInfo = (t0, t1) => {
      const r = { n: 0, sum: 0, buyers: new Set() };
      for (const [dk, x] of dayInfo) if (dk >= t0 && dk < t1) (r.n += x.n), (r.sum += x.sum), x.buyers.forEach((b) => r.buyers.add(b));
      return r;
    };
    const nextKey = (t) => { const d = new Date(t); return bucket === 'month' ? new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime() : new Date(d.getFullYear(), d.getMonth(), d.getDate() + (bucket === 'week' ? 7 : 1)).getTime(); };
    const chartFor = (mk) => {
      const [nm, fn, fmt] = METRICS[mk];
      const data = bl.map(([t]) => { const x = bucketInfo(t, nextKey(t)); const v = fn(x); return { label: lab(t), value: v, tip: `${bucket === 'week' ? 'Неделя с ' : ''}${lab(t)}: ${fmt(Math.round(v))}${mk !== 'n' ? ` · ${x.n} ${plural(x.n, 'заказ', 'заказа', 'заказов')}` : ''}` }; });
      const hi = data.reduce((bi, d, i, a) => (d.value > a[bi].value ? i : bi), 0);
      return `<div class="sub">${nm} ${bucket === 'day' ? 'по дням' : bucket === 'week' ? 'по неделям' : 'по месяцам'}. Наведи на столбик — подробности. Ярче — лучший ${bucket === 'day' ? 'день' : bucket === 'week' ? 'неделя' : 'месяц'}</div>${columns(data, { labelsEvery: Math.ceil(data.length / 10), highlight: hi })}`;
    };

    // календарь: обычный месяц, листается стрелками; в клетке — выбранный показатель
    const lastTs = Math.max(...st.list.map((t) => t.ts));
    let calM = new Date(new Date(Math.min(Date.now(), lastTs)).getFullYear(), new Date(Math.min(Date.now(), lastTs)).getMonth(), 1);
    const minM = new Date(new Date(firstTs).getFullYear(), new Date(firstTs).getMonth(), 1).getTime();
    const MONF = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
    const monthCal = (mk) => {
      const [, fn, fmt] = METRICS[mk];
      const y = calM.getFullYear();
      const m = calM.getMonth();
      const first = new Date(y, m, 1);
      const lead = (first.getDay() + 6) % 7;
      const dim = new Date(y, m + 1, 0).getDate();
      const today = startOfDay(Date.now());
      let mx = 1;
      for (let d = 1; d <= dim; d++) { const x = dayInfo.get(new Date(y, m, d).getTime()); if (x) mx = Math.max(mx, fn(x)); }
      let h = WD.map((w) => `<div class="wd">${w}</div>`).join('') + '<div></div>'.repeat(lead);
      let tot = { n: 0, sum: 0 };
      for (let d = 1; d <= dim; d++) {
        const t = new Date(y, m, d).getTime();
        const x = dayInfo.get(t);
        const v = x ? fn(x) : 0;
        if (x) (tot.n += x.n), (tot.sum += x.sum);
        const lv = v ? 0.1 + 0.55 * (v / mx) : 0;
        const top = x ? [...x.goods].sort((a, b) => b[1] - a[1])[0] : null;
        const tip = x ? `${d} ${MON[m]}, ${WD[(new Date(t).getDay() + 6) % 7].toLowerCase()} — ${x.n} ${plural(x.n, 'заказ', 'заказа', 'заказов')} · ${money(x.sum, cur)} · ${x.buyers.size} ${plural(x.buyers.size, 'покупатель', 'покупателя', 'покупателей')}${top ? ` · чаще всего: ${cut(top[0], 50)}` : ''}` : `${d} ${MON[m]} — заказов нет`;
        h += `<div class="d ${t > today ? 'fut' : ''} ${t === today ? 'today' : ''}" style="${v ? `background:rgba(var(--a-rgb),${lv.toFixed(2)});border-color:rgba(var(--a-rgb),${(lv + 0.1).toFixed(2)})` : ''}" data-st="${esc(tip)}"><span class="n">${d}</span>${v ? `<span class="c">${esc(mk === 'n' || mk === 'b' ? String(Math.round(v)) : compact(v))}</span>` : ''}</div>`;
      }
      return { html: h, tot };
    };

    const allGoods = [...st.goods.values()].sort((a, b) => b.sum - a.sum || b.n - a.n);
    const allCats = [...st.cats.values()].sort((a, b) => b.sum - a.sum);
    const allBuyers = [...st.buyers.values()].sort((a, b) => b.sum - a.sum || b.n - a.n);
    const foot = `<div class="st-foot">Посчитано по ${st.list.length} ${plural(st.list.length, 'продаже', 'продажам', 'продажам')} за период${st.otherCur ? ` · ${st.otherCur} в другой валюте — в суммы не вошли` : ''}${raw.partial ? ' · FunPay попросил подождать, поэтому загружены не все — нажми ↻ через минуту' : ''}</div>`;

    const TABS = {
      all: () => `
      <div class="st-kpis">
        ${k('Выручка', money(st.revenue, cur), `${st.orders} ${plural(st.orders, 'заказ', 'заказа', 'заказов')}`, pv && delta(st.revenue, pv.revenue), true)}
        ${k('Заработано', money(st.earned, cur), 'подтверждённые заказы', pv && delta(st.earned, pv.earned))}
        ${k('Средний чек', money(st.avg, cur), '', pv && delta(st.avg, pv.avg))}
        ${k('Ждут подтверждения', String(st.pending), st.pending ? `на ${money(st.pendingSum, cur)}` : 'всё подтверждено')}
        ${k('Покупателей', String(st.buyers.size), st.repeat ? `${st.repeat} ${plural(st.repeat, 'купил', 'купили', 'купили')} больше одного раза` : '', pv && delta(st.buyers.size, pv.buyers.size))}
        ${k('Возвраты', String(st.refunds), st.refunds ? `${refundPct}% заказов · ${money(st.refundSum, cur)}` : 'нет', pv && delta(st.refunds, pv.refunds, { good: 'down' }))}
        ${k('Лучший день', best ? money(best[1].sum, cur) : '—', best ? `${dshort(best[0])} · ${best[1].n} ${plural(best[1].n, 'заказ', 'заказа', 'заказов')}` : '')}
        ${k('Самая дорогая продажа', st.max ? money(st.max.amount, cur) : '—', st.max ? esc(cut(st.max.desc, 40)) : '')}
      </div>
      ${vs && pv ? `<div class="st-foot" style="margin:-4px 0 4px">▲▼ — ${vs}</div>` : ''}
      <div class="st-card"><div class="row" style="gap:10px;margin-bottom:4px"><h4 class="grow">График</h4><div class="seg" data-metric>${Object.entries(METRICS).map(([v, [n]]) => `<button data-v="${v}">${n}</button>`).join('')}</div></div><div data-chart>${bl.length > 1 ? chartFor(metric) : '<div class="sub">Для графика нужен период длиннее одного дня</div>'}</div></div>
      <div class="st-card"><div class="row" style="gap:10px;margin-bottom:10px"><h4>Календарь</h4><span class="dim" style="font-size:12px" data-caltot></span><div class="mcal-nav"><button class="ibtn" data-cal="-1">${icon('chevL', 18)}</button><b data-calm></b><button class="ibtn" data-cal="1">${icon('chevR', 18)}</button></div></div><div class="mcal" data-mcal></div><div class="sub" style="margin:10px 0 0">В клетке — ${'выбранный выше показатель'}. Наведи на день — заказы, выручка, покупатели и что покупали</div></div>
      <div class="st-two">
        ${hasHours ? `<div class="st-card"><h4>Время покупок</h4><div class="sub">Чаще всего — с ${hourMax}:00 до ${hourMax + 1}:00. Будь на связи и поднимай лоты в это время</div>${columns(hours, { h: 150, labelsEvery: 3, highlight: hourMax })}</div>` : ''}
        <div class="st-card"><h4>Дни недели</h4><div class="sub">Больше всего заказов — ${['в понедельник', 'во вторник', 'в среду', 'в четверг', 'в пятницу', 'в субботу', 'в воскресенье'][wdMax]}</div>${columns(wds, { h: 150, highlight: wdMax })}</div>
      </div>
      <div class="st-two">
        <div class="st-card"><h4>Топ товаров</h4><div class="sub">Самые прибыльные лоты · все — во вкладке «Товары»</div>${hbars(goods.slice(0, 5), cur, st.revenue, { lines: 2 })}</div>
        <div class="st-card"><h4>Топ разделов</h4><div class="sub">Где больше всего зарабатываешь</div>${hbars(cats.slice(0, 5), cur, st.revenue)}</div>
      </div>${foot}`,
      goods: () => `<div class="st-card" style="margin-top:0"><h4>Товары · ${allGoods.length}</h4><div class="sub">Все лоты, которые покупали за период — по выручке. Наведи — полное название и доля</div>${hbars(allGoods.slice(0, 60), cur, st.revenue, { lines: 2 })}</div>${foot}`,
      cats: () => `<div class="st-card" style="margin-top:0"><h4>Разделы · ${allCats.length}</h4><div class="sub">Игры и категории FunPay — где больше всего заказов и денег</div>${hbars(allCats, cur, st.revenue)}</div>${foot}`,
      buyers: () => `<div class="st-kpis" style="grid-template-columns:repeat(3,1fr)">${k('Покупателей', String(st.buyers.size), '', pv && delta(st.buyers.size, pv.buyers.size), true)}${k('Вернулись снова', String(st.repeat), st.buyers.size ? `${Math.round((st.repeat / st.buyers.size) * 100)}% покупателей` : '')}${k('В среднем на покупателя', money(st.buyers.size ? st.revenue / st.buyers.size : 0, cur), '')}</div>
        <div class="st-card"><h4>Покупатели</h4><div class="sub">Кто принёс больше всего. Нажми — профиль</div>
        <div class="st-tbl"><div class="st-tr h"><span>Покупатель</span><span>Заказов</span><span>Сумма</span><span>Последний</span></div>
        ${allBuyers.slice(0, 80).map((b) => `<div class="st-tr" ${b.id ? `data-buyer="${esc(b.id)}"` : ''}><span class="ell"><b>${esc(b.name)}</b>${b.n >= 2 ? ' <span class="pill ok" style="height:20px;font-size:11px">постоянный</span>' : ''}</span><span>${b.n}</span><span>${money(b.sum, cur)}</span><span class="dim">${dshort(b.last)}</span></div>`).join('')}</div></div>${foot}`,
    };
    body.innerHTML = `<div class="seg" data-tab style="margin-bottom:14px"><button data-v="all">Обзор</button><button data-v="goods">Товары</button><button data-v="cats">Разделы</button><button data-v="buyers">Покупатели</button></div><div data-tb></div>`;
    const tb = $('[data-tb]', body);
    const drawCal = () => {
      const c = $('[data-mcal]', tb);
      if (!c) return;
      const r = monthCal(metric);
      c.innerHTML = r.html;
      $('[data-calm]', tb).textContent = `${MONF[calM.getMonth()]} ${calM.getFullYear()}`;
      $('[data-caltot]', tb).textContent = r.tot.n ? `· ${r.tot.n} ${plural(r.tot.n, 'заказ', 'заказа', 'заказов')} на ${money(r.tot.sum, cur)}` : '· заказов нет';
      $('[data-cal="-1"]', tb).disabled = calM.getTime() <= minM;
      $('[data-cal="1"]', tb).disabled = calM.getTime() >= new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
    };
    const showTab = (v) => {
      tab = v;
      tb.innerHTML = TABS[v]();
      tb.querySelectorAll('[data-buyer=""]').forEach((x) => x.removeAttribute('data-buyer'));
      const ms = $('[data-metric]', tb);
      if (ms) seg(ms, metric, (mv) => { metric = mv; if (bl.length > 1) $('[data-chart]', tb).innerHTML = chartFor(mv); drawCal(); });
      tb.querySelectorAll('[data-cal]').forEach((b) => (b.onclick = () => { calM = new Date(calM.getFullYear(), calM.getMonth() + +b.dataset.cal, 1); drawCal(); }));
      drawCal();
    };
    seg($('[data-tab]', body), tab, showTab);
    showTab(tab);
  }
}
