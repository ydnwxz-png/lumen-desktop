// © 2026 Lumen. Все права защищены. Копирование, изменение и распространение этого кода запрещены без разрешения автора (см. LICENSE).
// Мои лоты: категории, вкл/выкл, цена на месте, поднятие и автоподнятие.
import { $, esc, el, fmtLeft, fmtNum } from '../core/util.js';
import { icon } from '../core/icons.js';
import { S, bus, saveSettings } from '../core/state.js';
import { err, ok, busy, toast, confirmBox, menu } from '../ui/kit.js';
import { R, raiseNode, raiseDue, nextAt, syncAuto, stateOfNode } from '../features/raise.js';
import { lotMenu, copyLotLink, copyLotTitle } from '../features/lotlink.js';
import { openLotEditor } from './loteditor.js';

const V = { cats: [], loaded: false, gen: 0 };
let root, tick;

export function mountLots(c) {
  root = c;
  root.innerHTML = `<div class="page">
    <div class="page-head"><h1>Лоты</h1><span class="sub" data-sub></span><span class="grow"></span>
      <button class="btn" data-reload>${icon('refresh', 16)}Обновить</button>
      <button class="btn" data-new>${icon('plus', 16)}Новый лот</button>
      <button class="btn pri" data-raise-all>${icon('rocket', 16)}Поднять всё</button>
    </div>
    <div class="card auto-card" data-auto></div>
    <div data-list></div>
  </div>`;
  $('[data-reload]', root).onclick = () => load();
  $('[data-new]', root).onclick = () => S.backend.openBrowser('https://funpay.com/lots/');
  $('[data-raise-all]', root).onclick = (e) =>
    busy(
      e.currentTarget,
      raiseDue(true)
        .then((res) => {
          const okN = res.filter((r) => r.ok).length;
          if (!res.length) toast('Нечего поднимать', 'На твоей странице нет лотов');
          else if (okN) ok(`Подняты игры: ${okN} из ${res.length}`, res.find((r) => !r.ok)?.msg || '');
          else toast('Пока рано', res[0].msg || 'FunPay просит подождать');
          renderRaiseStates();
        })
        .catch((x) => err('Не поднялись', x))
    );
  bus.on('raise', () => V.loaded && (renderAuto(), renderRaiseStates()));
  bus.on('account', () => {
    V.loaded = false;
    V.cats = [];
    V.gen++;
  });
}

export function showLots() {
  if (!V.loaded) load();
  clearInterval(tick);
  tick = setInterval(() => root.closest('.view.on') && (renderAuto(), renderRaiseStates()), 1000);
}

async function load() {
  const my = ++V.gen;
  $('[data-list]', root).innerHTML = Array.from({ length: 3 }, () => `<div class="card cat"><div class="cat-head"><div class="skel" style="width:38px;height:38px;border-radius:12px"></div><div class="skel" style="height:14px;width:200px"></div></div>${'<div class="tr"><div class="skel" style="height:12px;width:60%"></div></div>'.repeat(2)}</div>`).join('');
  renderAuto();
  try {
    const cats = await S.backend.myLots();
    if (my !== V.gen) return;
    // выключенные лоты FunPay на своей странице не показывает — оставляем их из прошлого списка
    for (const old of V.cats)
      for (const l of old.lots)
        if (!l.active) {
          const c = cats.find((x) => x.node === old.node) || (cats.push({ ...old, lots: [] }), cats[cats.length - 1]);
          if (!c.lots.some((x) => x.id === l.id)) c.lots.push(l);
        }
    V.cats = cats;
    V.loaded = true;
    render();
  } catch (e) {
    if (my !== V.gen) return;
    $('[data-list]', root).innerHTML = `<div class="empty" style="padding:50px"><div class="orb" style="color:var(--bad)">${icon('alert', 28)}</div><h3>Не загрузилось</h3><p>${esc(e.message)}</p></div>`;
  }
}

function renderAuto() {
  const box = $('[data-auto]', root);
  const on = !!S.settings.autoRaise;
  const n = nextAt();
  const status = !on ? 'Выключено — лоты поднимаются только кнопкой' : R.running ? 'Поднимаю лоты…' : n === Infinity ? 'Скоро начну' : `Следующее поднятие через ${fmtLeft(n - Date.now())}`;
  box.classList.toggle('on', on);
  if (!box.firstChild) {
    box.innerHTML = `<span class="cat-ic">${icon('rocket', 19)}</span><div class="grow"><b>Автоподнятие лотов</b><div class="dim" style="font-size:12.5px" data-st></div></div><button class="switch"></button>`;
    $('.switch', box).onclick = () => {
      S.settings.autoRaise = !S.settings.autoRaise;
      saveSettings();
      syncAuto();
      renderAuto();
    };
  }
  $('[data-st]', box).textContent = status;
  $('.switch', box).classList.toggle('on', on);
}

function renderRaiseStates() {
  for (const e of root.querySelectorAll('[data-raise-st]')) {
    const s = stateOfNode(e.dataset.raiseSt);
    if (!s) continue;
    const left = s.nextAt - Date.now();
    e.className = 'raise-st ' + (s.ok ? 'ok' : '');
    e.innerHTML = s.ok ? `${icon('check', 14)}Подняты · снова через ${fmtLeft(left)}` : s.skip ? `${icon('info', 14)}${esc(s.msg)}` : left > 0 && /подожд|wait/i.test(s.msg || '') ? `${icon('clock', 14)}FunPay просит подождать · можно через ${fmtLeft(left)}` : `${icon('alert', 14)}${esc(s.msg || '')}`;
  }
}

function render() {
  const list = $('[data-list]', root);
  const total = V.cats.reduce((s, c) => s + c.lots.length, 0);
  $('[data-sub]', root).textContent = total ? `${total} ${total % 10 === 1 && total % 100 !== 11 ? 'лот' : 'лотов'} в ${V.cats.length} категориях` : '';
  if (!V.cats.length) {
    list.innerHTML = `<div class="empty" style="padding:60px"><div class="orb">${icon('box', 30)}</div><h3>Лотов пока нет</h3><p>Создай первый лот на FunPay — он появится здесь.</p></div>`;
    return;
  }
  list.innerHTML = '';
  list.className = 'stagger';
  for (const c of V.cats) {
    const card = el(`<div class="card cat lots">
      <div class="cat-head"><span class="cat-ic">${icon(c.chips ? 'cash' : 'layers', 18)}</span><div class="grow"><h3>${esc(c.name)}</h3><span class="raise-st" data-raise-st="${c.node}">${c.lots.filter((l) => l.active).length} активных из ${c.lots.length}</span></div>
        ${!c.chips ? `<button class="btn sm" data-raise="${c.node}">${icon('rocket', 15)}Поднять</button>` : ''}
        <button class="ibtn" data-open="${esc(c.url)}" data-tip="Категория на FunPay">${icon('external', 17)}</button></div>
      <div class="tr th"><span>Лот</span><span>Наличие</span><span>Цена</span><span>Вкл</span><span></span></div>
      ${c.lots
        .map(
          (l) => `<div class="tr ${l.active ? '' : 'off'}" data-lot="${esc(l.id)}">
        <div class="lot-t" data-edit data-tip="Нажми — редактировать · правый клик — скопировать">${esc(l.title)}${l.server || l.auto ? `<small>${esc([l.server, l.auto ? '⚡ автовыдача' : ''].filter(Boolean).join(' · '))}</small>` : ''}</div>
        <span class="dim mono">${esc(l.amount || '—')}</span>
        <span class="price price-edit mono" data-price data-tip="Нажми, чтобы изменить">${esc(l.price)}</span>
        <button class="switch ${l.active ? 'on' : ''}" data-toggle></button>
        <button class="ibtn" data-more>${icon('more', 16)}</button></div>`
        )
        .join('')}
    </div>`);
    list.append(card);
  }
  renderRaiseStates();
  const lotOf = (row) => {
    for (const c of V.cats) {
      const l = c.lots.find((x) => x.id === row.dataset.lot);
      if (l) return Object.assign(l, { chips: c.chips, catName: c.name });
    }
    return null;
  };
  const edit = (lot) =>
    openLotEditor(lot, {
      onSaved: (upd) => {
        Object.assign(lot, upd);
        render();
      },
    });
  // правый клик по лоту: скопировать ссылку / название, редактировать
  list.oncontextmenu = (e) => {
    const row = e.target.closest('[data-lot]');
    if (!row) return;
    e.preventDefault();
    const lot = lotOf(row);
    if (!lot) return;
    lotMenu(e.clientX, e.clientY, lot, [
      '-',
      { label: 'Редактировать', icon: 'edit', run: () => edit(lot) },
      { label: 'Открыть лот', icon: 'external', run: () => S.backend.openBrowser(lot.url) },
    ]);
  };
  list.onclick = async (e) => {
    const t = e.target;
    const rb = t.closest('[data-raise]');
    if (rb) {
      return busy(
        rb,
        raiseNode(rb.dataset.raise)
          .then((r) => (r.ok ? ok('Лоты подняты', r.msg) : toast('Пока рано', r.msg)))
          .catch((x) => err('Не поднялись', x))
      );
    }
    const op = t.closest('[data-open]');
    if (op) return S.backend.openBrowser(op.dataset.open);
    const row = t.closest('[data-lot]');
    if (!row) return;
    const lot = lotOf(row);
    if (!lot) return;
    if (t.closest('[data-edit]')) return edit(lot);
    const mb = t.closest('[data-more]');
    if (mb) {
      const r = mb.getBoundingClientRect();
      return menu(r.left - 190, r.bottom + 4, [
        { label: 'Редактировать', icon: 'edit', run: () => edit(lot) },
        { label: 'Скопировать ссылку', icon: 'link', run: () => copyLotLink(lot) },
        { label: 'Скопировать название', icon: 'copy', run: () => copyLotTitle(lot) },
        { label: 'Открыть лот', icon: 'external', run: () => S.backend.openBrowser(lot.url) },
        { label: 'Редактировать на сайте FunPay', icon: 'globe', run: () => S.backend.openBrowser(`https://funpay.com/lots/offerEdit?offer=${lot.id}`) },
        '-',
        {
          label: 'Удалить лот',
          icon: 'trash',
          danger: true,
          run: async () => {
            if (!(await confirmBox('Удалить лот?', `«${lot.title}» удалится с FunPay насовсем.`, { yes: 'Удалить', danger: true }))) return;
            try {
              await S.backend.lotDelete(lot);
              for (const c of V.cats) c.lots = c.lots.filter((l) => l.id !== lot.id);
              V.cats = V.cats.filter((c) => c.lots.length);
              render();
              ok('Лот удалён', lot.title);
            } catch (x) {
              err('Не удалился', x);
            }
          },
        },
      ]);
    }
    const sw = t.closest('[data-toggle]');
    if (sw) {
      const on = !lot.active;
      sw.classList.toggle('on', on);
      row.classList.toggle('off', !on);
      try {
        await S.backend.lotSetActive(lot, on);
        lot.active = on;
        ok(on ? 'Лот включён' : 'Лот выключен', lot.title);
      } catch (x) {
        sw.classList.toggle('on', !on);
        row.classList.toggle('off', on);
        err('Не сохранилось', x);
      }
      return;
    }
    const pe = t.closest('[data-price]');
    if (pe && !pe.querySelector('input')) {
      const inp = el(`<input class="input price-in mono" value="${lot.priceNum}" inputmode="decimal">`);
      pe.replaceChildren(inp);
      inp.focus();
      inp.select();
      const finish = async (save) => {
        const v = parseFloat(inp.value.replace(',', '.'));
        pe.textContent = lot.price;
        if (!save || !(v > 0) || v === lot.priceNum) return;
        pe.textContent = `${fmtNum(v, v % 1 ? 2 : 0)} ${lot.unit}`;
        try {
          await S.backend.lotSetPrice(lot, v);
          lot.priceNum = v;
          lot.price = pe.textContent;
          ok('Цена обновлена', `${lot.title}: ${lot.price}`);
        } catch (x) {
          pe.textContent = lot.price;
          err('Цена не сохранилась', x);
        }
      };
      inp.onkeydown = (ev) => {
        if (ev.key === 'Enter') inp.blur();
        if (ev.key === 'Escape') {
          inp.dataset.cancel = 1;
          inp.blur();
        }
      };
      inp.onblur = () => finish(!inp.dataset.cancel);
    }
  };
}
