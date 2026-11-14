// © 2026 Lumen. Все права защищены. Копирование, изменение и распространение этого кода запрещены без разрешения автора (см. LICENSE).
// Финансы: баланс, заморозка, доход по дням, операции.
import { $, esc, countUp, fmtNum, parseFpDate } from '../core/util.js';
import { icon } from '../core/icons.js';
import { S, bus } from '../core/state.js';
import { parseAmount } from '../fp/parse.js';
import { openOrder } from './order.js';
import { modal } from '../ui/kit.js';

const V = { items: [], next: '', loaded: false, gen: 0 };
let root;

export function mountFinance(c) {
  root = c;
  root.innerHTML = `<div class="page">
    <div class="page-head"><h1>Финансы</h1><span class="grow"></span><button class="btn" data-reload>${icon('refresh', 16)}Обновить</button><button class="btn pri" data-withdraw>${icon('wallet', 16)}Вывести</button></div>
    <div class="stats stagger" data-stats></div>
    <div class="card" style="margin-bottom:20px" data-chart></div>
    <div class="sec-title" style="margin-top:0">Операции</div>
    <div class="table txns" data-list></div>
    <div class="more-row" data-more></div>
  </div>`;
  $('[data-reload]', root).onclick = () => load();
  $('[data-withdraw]', root).onclick = () => S.backend.openBrowser('https://funpay.com/account/balance');
  bus.on('account', () => ((V.loaded = false), (V.items = []), V.gen++));
  bus.on('me', () => V.loaded && renderStats());
}

export function showFinance() {
  if (!V.loaded) load();
  else renderStats();
}

async function load(more = false) {
  const my = ++V.gen;
  if (!more) {
    $('[data-list]', root).innerHTML = Array.from({ length: 6 }, () => `<div class="tr"><div class="skel" style="width:36px;height:36px;border-radius:11px"></div><div class="skel" style="height:12px;width:60%"></div><div></div><div></div><div></div></div>`).join('');
    renderStats();
  }
  try {
    const be = S.backend;
    const [r] = await Promise.all([be.transactions(more ? V.next : ''), more ? null : be.auth(true).then((me) => be === S.backend && ((S.me = me), bus.emit('me')))]);
    if (my !== V.gen) return;
    V.items = more ? [...V.items, ...r.items] : r.items;
    V.next = r.next;
    V.loaded = true;
    render();
  } catch (e) {
    if (my !== V.gen) return;
    $('[data-list]', root).innerHTML = `<div class="empty" style="padding:50px"><div class="orb" style="color:var(--bad)">${icon('alert', 28)}</div><h3>Не загрузилось</h3><p>${esc(e.message)}</p></div>`;
  }
}

function renderStats() {
  const bal = parseAmount(S.me?.balance || '0');
  const cur = bal.currency || '₽';
  const waiting = V.items.filter((t) => t.state === 'wait' && t.amount > 0).reduce((s, t) => s + t.amount, 0);
  const since = (ms) => V.items.filter((t) => t.state !== 'cancel' && t.amount > 0 && t.orderId && t.ts > Date.now() - ms).reduce((s, t) => s + t.amount, 0);
  const st = $('[data-stats]', root);
  if (!st.children.length)
    st.innerHTML = `
    <div class="stat hero"><div class="lbl"><span class="ic-b">${icon('wallet', 15)}</span>Баланс</div><div class="val"><span data-b>0</span><small>${esc(cur)}</small></div><div class="hint">можно вывести</div></div>
    <div class="stat"><div class="lbl"><span class="ic-b">${icon('lock', 15)}</span>В заморозке</div><div class="val"><span data-w>0</span><small>${esc(cur)}</small></div><div class="hint">ещё не пролежали 48 часов</div></div>
    <div class="stat"><div class="lbl"><span class="ic-b">${icon('trend', 15)}</span>За сутки</div><div class="val"><span data-d>0</span><small>${esc(cur)}</small></div><div class="hint">по загруженным операциям</div></div>
    <div class="stat"><div class="lbl"><span class="ic-b">${icon('zap', 15)}</span>За неделю</div><div class="val"><span data-wk>0</span><small>${esc(cur)}</small></div><div class="hint">по загруженным операциям</div></div>`;
  countUp($('[data-b]', st), bal.amount, { frac: bal.amount % 1 ? 2 : 0 });
  countUp($('[data-w]', st), waiting);
  countUp($('[data-d]', st), since(86400e3));
  countUp($('[data-wk]', st), since(7 * 86400e3));
}

function render() {
  renderStats();
  // доход по дням за 14 дней
  const days = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (let i = 13; i >= 0; i--) days.push({ t: today.getTime() - i * 86400e3, v: 0 });
  for (const t of V.items) {
    if (t.amount <= 0 || t.state === 'cancel' || !t.ts) continue;
    const d = days.find((x) => t.ts >= x.t && t.ts < x.t + 86400e3);
    if (d) d.v += t.amount;
  }
  const max = Math.max(1, ...days.map((d) => d.v));
  $('[data-chart]', root).innerHTML = `<div class="row" style="padding:16px 18px 0"><b>Доход по дням</b><span class="dim" style="font-size:12px">последние 2 недели</span></div>
    <div class="chart">${days.map((d, i) => `<div class="bar ${d.v ? '' : 'zero'}" style="height:${Math.max(3, (d.v / max) * 100)}%;animation-delay:${i * 0.03}s" data-tip="${new Date(d.t).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}: ${fmtNum(d.v)} ₽"></div>`).join('')}</div>
    <div class="chart-lbl">${days.map((d) => `<span>${new Date(d.t).getDate()}</span>`).join('')}</div>`;

  const tbl = $('[data-list]', root);
  tbl.innerHTML = V.items.length
    ? V.items
        .map((t, i) => {
          const inc = t.amount > 0;
          const pill = t.state === 'wait' ? '<span class="pill warn"><span class="dotc"></span>Ожидает</span>' : t.state === 'cancel' ? '<span class="pill bad"><span class="dotc"></span>Отменено</span>' : '<span class="pill ok"><span class="dotc"></span>Готово</span>';
          return `<div class="tr" style="cursor:pointer;animation:rise .4s var(--ease) ${Math.min(i, 14) * 0.02}s backwards" data-txn="${esc(t.id)}">
            <span class="txn-ic ${inc ? 'in' : 'out'}">${icon(inc ? 'down' : 'up', 17)}</span>
            <div style="min-width:0"><div class="ell" style="font-weight:550">${esc(t.title)}</div>${t.payment ? `<div class="dim ell" style="font-size:12px">${esc(t.payment)}</div>` : ''}</div>
            <span class="dim" style="font-size:12.5px">${esc(t.date)}</span>
            <span>${pill}</span>
            <span class="price ${inc ? 'plus' : 'minus'}" style="text-align:right">${inc ? '+' : '−'}${fmtNum(Math.abs(t.amount), Math.abs(t.amount) % 1 ? 2 : 0)} ${esc(t.currency)}</span></div>`;
        })
        .join('')
    : `<div class="empty" style="padding:60px"><div class="orb">${icon('wallet', 30)}</div><h3>Операций нет</h3></div>`;
  tbl.onclick = (e) => {
    const r = e.target.closest('[data-txn]');
    if (r) openTxn(V.items.find((t) => t.id === r.dataset.txn));
  };
  $('[data-more]', root).innerHTML = V.next ? '<button class="btn">Показать ещё</button>' : '';
  const mb = $('[data-more] .btn', root);
  if (mb) mb.onclick = () => ((mb.classList.add('busy'), load(true)));
}

export const _p = parseFpDate;

// Подробности операции, как окно на сайте
async function openTxn(t) {
  if (!t) return;
  const m = modal(`<button class="ibtn x" data-close>${icon('x', 18)}</button><h3>${esc(t.title)}</h3><p class="price ${t.amount > 0 ? 'plus' : 'minus'}" style="font-size:22px;margin:4px 0 14px">${t.amount > 0 ? '+' : '−'}${fmtNum(Math.abs(t.amount), Math.abs(t.amount) % 1 ? 2 : 0)} ${esc(t.currency)}</p><div data-b><div class="empty" style="padding:20px"><div class="spinner"></div></div></div>`);
  const b = $('[data-b]', m.el);
  try {
    const info = await S.backend.txnInfo(t.id);
    b.innerHTML = `<dl class="kv" style="grid-template-columns:150px 1fr;margin:0">${info.rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
      <div class="modal-acts">${info.link ? `<button class="btn" data-link>${icon('external', 15)}Транзакция</button>` : ''}${t.orderId ? `<button class="btn pri" data-order>${icon('bag', 15)}Заказ #${esc(t.orderId)}</button>` : ''}</div>`;
    $('[data-link]', b) && ($('[data-link]', b).onclick = () => (window.api ? window.api.app.open(info.link) : window.open(info.link)));
    $('[data-order]', b) && ($('[data-order]', b).onclick = () => (m.close(), openOrder(t.orderId)));
  } catch (e) {
    b.innerHTML = `<div class="dim">${esc(e.message)}</div>${t.orderId ? `<div class="modal-acts"><button class="btn pri" data-order>Заказ #${esc(t.orderId)}</button></div>` : ''}`;
    $('[data-order]', b) && ($('[data-order]', b).onclick = () => (m.close(), openOrder(t.orderId)));
  }
}
