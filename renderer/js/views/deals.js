// © 2026 Lumen. Все права защищены. Копирование, изменение и распространение этого кода запрещены без разрешения автора (см. LICENSE).
// Продажи и покупки: фильтры, поиск, подгрузка, шторка заказа.
import { $, el, esc, avatar, debounce, countUp, fmtNum, parseFpDate, plural } from '../core/util.js';
import { icon } from '../core/icons.js';
import { S, bus, persist } from '../core/state.js';
import { seg, modal } from '../ui/kit.js';
import { openOrder } from './order.js';
import { openQuickChat } from '../features/quickchat.js';
import { openSupportPicker } from '../features/support.js';

const V = { kind: 'sales', state: '', q: '', game: '', cat: '', items: [], next: '', loading: false, gen: 0 };
// «Counter-Strike 2, Аккаунты» → игра «Counter-Strike 2», раздел «Аккаунты»
const gsplit = (o) => String(o.game || '').split(/\s*(?:,|·)\s*/);
const gameOf = (o) => gsplit(o)[0].trim();
const catOf = (o) => gsplit(o).slice(1).join(', ').trim();
let root;

export function mountDeals(c) {
  root = c;
  root.innerHTML = `<div class="page">
    <div class="page-head"><h1>Сделки</h1><span class="sub" data-sub></span><span class="grow"></span>
      <div class="seg" data-kind><button data-v="sales">${icon('trend', 15)}Продажи</button><button data-v="purchases">${icon('bag', 15)}Покупки</button></div>
    </div>
    <div class="stats stagger" data-stats></div>
    <div class="sup-banner" data-supb hidden></div>
    <div class="toolbar">
      <div class="seg" data-state><button data-v="">Все</button><button data-v="paid">Оплачены</button><button data-v="closed">Закрыты</button><button data-v="refunded">Возвраты</button></div>
      <button class="btn game-btn" data-game></button>
      <select class="select" data-cat style="width:auto;max-width:190px;height:36px" hidden></select>
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
  $('[data-game]', root).onclick = (e) => gamePicker(e.currentTarget);
  $('[data-cat]', root).onchange = (e) => ((V.cat = e.target.value), render());
  $('[data-supb]', root).onclick = (e) => e.target.closest('button') && openSupportPicker();
  bus.on('account', () => {
    V.gen++;
    V.items = [];
    V.loaded = false;
    myGames = null;
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

// игры из своих лотов — их показываем сверху, даже если сделок по ним ещё не загружено
let myGames = null;
async function loadMyGames() {
  if (myGames) return myGames;
  try {
    const cats = await S.backend.myLots();
    myGames = [...new Set(cats.map((c) => String(c.name || '').split(/\s*(?:,|·)\s*/)[0].trim()).filter(Boolean))];
  } catch {
    myGames = [];
  }
  return myGames;
}

// полный список игр FunPay (с главной страницы) — кэш на сутки
async function loadAllGames() {
  const c = await persist.get('allGames', null);
  if (c && Date.now() - c.at < 86400e3 && Array.isArray(c.list) && c.list.length) return c.list;
  try {
    const list = (await S.backend.allGames()).sort((a, b) => a.localeCompare(b, 'ru'));
    if (list.length) await persist.set('allGames', { at: Date.now(), list });
    return list;
  } catch {
    return c?.list || [];
  }
}

/** Выбор игры: поиск, сверху — то, что продаёшь, ниже — остальное. Если сделок по игре мало — догружает. */
async function gamePicker(btn) {
  document.querySelector('.pop2.gp')?.remove();
  const [mine, every] = await Promise.all([loadMyGames(), loadAllGames()]);
  const cnt = new Map();
  for (const o of V.items) { const g = gameOf(o); if (g) cnt.set(g, (cnt.get(g) || 0) + 1); }
  for (const g of mine) if (!cnt.has(g)) cnt.set(g, 0);
  for (const g of every) if (!cnt.has(g)) cnt.set(g, 0);
  const all = [...cnt].sort((a, b) => (mine.includes(b[0]) - mine.includes(a[0])) || b[1] - a[1] || a[0].localeCompare(b[0]));
  const p = el(`<div class="pop2 gp"><input class="input" placeholder="Найти игру…" data-gq><div class="gp-list" data-gl></div></div>`);
  document.body.append(p);
  const r = btn.getBoundingClientRect();
  p.style.left = r.left + 'px';
  p.style.top = r.bottom + 8 + 'px';
  const list = $('[data-gl]', p);
  const draw = (q = '') => {
    const f = all.filter(([g]) => g.toLowerCase().includes(q));
    const sec = (title, arr) => (arr.length ? `<div class="gp-sec">${title}</div>` + arr.map(([g, n]) => `<button data-g="${esc(g)}" class="${g === V.game ? 'on' : ''}"><span class="ell">${esc(g)}</span><small>${n || '—'}</small></button>`).join('') : '');
    const sold = f.filter(([g, n]) => !mine.includes(g) && n > 0);
    const rest = f.filter(([g, n]) => !mine.includes(g) && !n);
    list.innerHTML = (q ? '' : `<button data-g="" class="${!V.game ? 'on' : ''}"><span>Все игры</span><small>${V.items.length}</small></button>`) + sec('Твои лоты', f.filter(([g]) => mine.includes(g))) + sec('Были сделки', sold) + sec('Все игры FunPay', q ? rest : rest.slice(0, 80)) + (!q && rest.length > 80 ? `<div class="dim" style="padding:8px 10px;font-size:12px">ещё ${rest.length - 80} — начни писать название</div>` : '') || '<div class="dim" style="padding:12px">Не нашлось</div>';
  };
  draw();
  const q = $('[data-gq]', p);
  q.oninput = () => draw(q.value.trim().toLowerCase());
  setTimeout(() => q.focus());
  const close = () => (p.remove(), removeEventListener('mousedown', out, true));
  const out = (e) => !p.contains(e.target) && !btn.contains(e.target) && close();
  setTimeout(() => addEventListener('mousedown', out, true));
  list.onclick = async (e) => {
    const b = e.target.closest('[data-g]');
    if (!b) return;
    close();
    V.game = b.dataset.g;
    V.cat = '';
    render();
    // по выбранной игре мало сделок среди загруженных — догружаем ещё (до 5 страниц)
    for (let i = 0; i < 5 && V.game && V.next && V.items.filter((o) => gameOf(o) === V.game).length < 15; i++) await load(true);
  };
}

// фильтры «Игра» и «Раздел» — из загруженных сделок (как на FunPay)
function fillFilters() {
  const gs = $('[data-game]', root);
  const cs = $('[data-cat]', root);
  const cnt = (arr) => arr.reduce((m, k) => (k && m.set(k, (m.get(k) || 0) + 1), m), new Map());
  const games = [...cnt(V.items.map(gameOf))].sort((a, b) => b[1] - a[1]);
  if (V.game && !games.some(([g]) => g === V.game)) V.game = '';
  gs.innerHTML = `${icon('gamepad', 15)}<span class="ell">${esc(V.game || 'Все игры')}</span>${icon('chevR', 14, 'acc-chev')}`;
  gs.classList.toggle('on', !!V.game);
  const cats = V.game ? [...cnt(V.items.filter((o) => gameOf(o) === V.game).map(catOf))].sort((a, b) => b[1] - a[1]) : [];
  if (V.cat && !cats.some(([c]) => c === V.cat)) V.cat = '';
  cs.innerHTML = `<option value="">Все разделы</option>` + cats.map(([c, n]) => `<option value="${esc(c)}" ${c === V.cat ? 'selected' : ''}>${esc(c)} · ${n}</option>`).join('');
  cs.hidden = cats.length < 2 && !V.cat;
}

const skeleton = () => Array.from({ length: 7 }, () => `<div class="tr"><div class="skel" style="height:12px;width:70px"></div><div class="col" style="gap:6px"><div class="skel" style="height:12px;width:70%"></div><div class="skel" style="height:10px;width:40%"></div></div><div class="skel" style="height:28px;width:120px;border-radius:99px"></div><div></div><div></div><div></div></div>`).join('');

function render(appendOnly) {
  fillFilters();
  const list = V.items.filter((o) => (!V.q || [o.id, o.desc, o.game, o.peer].join(' ').toLowerCase().includes(V.q)) && (!V.game || gameOf(o) === V.game) && (!V.cat || catOf(o) === V.cat));
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
            <div class="row peer" style="gap:8px;min-width:0">${avatar(o.peerAvatar, o.peer, 26)}<span class="ell">${esc(o.peer)}</span></div>
            <span class="price ${V.kind === 'sales' && o.state !== 'refunded' ? 'plus' : 'minus'}">${esc(o.price)}</span>
            <span><span class="pill ${cls}"><span class="dotc"></span>${esc(o.statusText)}</span></span>
            <span class="dim" style="font-size:12.5px">${esc(o.date)}</span></div>`;
        })
        .join('')
    : `<div class="empty" style="padding:60px"><div class="orb">${icon('bag', 30)}</div><h3>${V.q || V.game ? 'Ничего не нашлось' : 'Сделок нет'}</h3><p>${V.q || V.game ? (V.next ? 'Среди загруженных нет — нажми «Показать ещё» ниже' : 'Попробуй другой фильтр') : 'Здесь появятся заказы'}</p></div>`;
  // нажал на заказ — сбоку мини-чат с покупателем (стрелками — следующий/предыдущий заказ)
  tbl.onclick = (e) => {
    const r = e.target.closest('[data-id]');
    if (!r) return;
    const i = list.findIndex((o) => o.id === r.dataset.id);
    if (e.target.closest('.oid')) return openOrder(r.dataset.id, { onChange: () => load() });
    openQuickChat(list, Math.max(0, i), { onChange: () => load() });
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
  // покупатели не подтвердили заказ больше суток — предложить поддержку
  const stale = V.kind === 'sales' ? paid.filter((o) => { const d = parseFpDate(o.date); return d && Date.now() - d.getTime() > 24 * 3600e3; }) : [];
  const sb = $('[data-supb]', root);
  sb.hidden = !stale.length;
  if (stale.length) sb.innerHTML = `<span class="ic-b">${icon('alert', 16)}</span><div class="grow"><b>${stale.length} ${plural(stale.length, 'заказ', 'заказа', 'заказов')} не подтверждены больше суток</b><div class="dim" style="font-size:12.5px">Lumen сам напишет в поддержку FunPay, чтобы их закрыли</div></div><button class="btn sm pri">${icon('send', 14)}В поддержку</button>`;
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

