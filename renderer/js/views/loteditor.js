// Редактор лота: все поля формы FunPay в окне Lumen.
// Тип и поля категории, название и описание RU/EN с переводом, цена (и цена для покупателя
// по способам оплаты), наличие, автовыдача, вкл/выкл. Шлём на FunPay ровно ту форму, что он прислал.
import { $, esc, el, fmtNum } from '../core/util.js';
import { icon } from '../core/icons.js';
import { S } from '../core/state.js';
import { modal, err, ok, toast, busy } from '../ui/kit.js';
import { copyLotLink } from '../features/lotlink.js';

const LANG = { ru: 'Русский', en: 'English' };
const num = (v) => parseFloat(String(v ?? '').replace(/\s/g, '').replace(',', '.'));
const r2 = (v) => Math.round(v * 100) / 100;
const PRICE_KEY = 'lotPriceMethod';

const CSS = `<style>
.le-head{display:flex;align-items:center;gap:12px;padding:18px 22px;border-bottom:1px solid var(--line);position:sticky;top:0;background:var(--surface);z-index:2}
.le-head h3{margin:0;font-size:17px}
.le-head .sub{color:var(--text-3);font-size:12.5px}
.le-body{padding:6px 22px 18px}
.le-sec{margin-top:18px}
.le-sec>.t{font-size:11.5px;font-weight:700;color:var(--text-3);text-transform:uppercase;letter-spacing:.07em;margin-bottom:10px;display:flex;align-items:center;gap:8px}
.le-sec>.t .grow{flex:1}
.le-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px 14px}
.le-f>label{display:block;font-size:12.5px;color:var(--text-2);margin-bottom:6px}
.le-f .help{font-size:11.5px;color:var(--text-3);margin-top:5px}
.le-pair{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px}
.le-pair .lg{font-size:11px;color:var(--text-3);margin-bottom:4px}
.le-row{display:flex;align-items:center;gap:12px;padding:10px 12px;border:1px solid var(--line);border-radius:12px;margin-bottom:8px;background:var(--surface-2)}
.le-row .grow{flex:1}
.le-price{display:grid;grid-template-columns:1fr 1fr;gap:12px 14px}
.le-unit{position:relative}
.le-unit .input{padding-right:34px}
.le-unit i{position:absolute;right:12px;top:50%;transform:translateY(-50%);font-style:normal;color:var(--text-3);font-size:13px}
.le-buyer{margin-top:12px;padding:12px 14px;border-radius:14px;border:1px solid rgba(var(--a-rgb),.35);background:rgba(var(--a-rgb),.06)}
.le-buyer .h{display:flex;align-items:center;gap:8px;font-size:13px;margin-bottom:10px}
.le-buyer .h span{color:var(--text-3);font-size:12px}
.le-buyer .row2{display:grid;grid-template-columns:180px 1fr;gap:10px}
.le-buyer .le-note{font-size:12.5px;color:var(--text-2);margin-top:8px}
.le-tbl{display:grid;grid-template-columns:auto auto;justify-content:start;gap:4px 18px;font-size:12.5px;margin-top:10px;color:var(--text-2)}
.le-tbl b{color:var(--text);font-weight:600}
.le-foot{display:flex;align-items:center;gap:10px;padding:14px 22px;border-top:1px solid var(--line);position:sticky;bottom:0;background:var(--surface)}
.le-cnt{font-size:11.5px;color:var(--text-3);margin-top:5px}
@media (max-width:700px){.le-grid,.le-pair,.le-price{grid-template-columns:1fr}}
</style>`;

/** lot: { id, node, title, chips, catName, url }. onSaved(upd) — что поменялось для списка. */
export async function openLotEditor(lot, { onSaved } = {}) {
  if (lot.chips) {
    toast('Валюта редактируется на FunPay', 'Для лотов с валютой FunPay использует другую форму — открываю её');
    return S.backend.openBrowser(`https://funpay.com/chips/${lot.node}/trade`);
  }
  if (!S.backend?.lotEditor) return S.backend.openBrowser(`https://funpay.com/lots/offerEdit?offer=${lot.id}`);
  const m = modal(`${CSS}<div class="le"><div class="le-head"><div class="grow"><h3>Редактор лота</h3><div class="sub ell">${esc(lot.catName || '')}</div></div><button class="ibtn x" data-close>${icon('x', 18)}</button></div><div class="le-body"><div class="empty" style="height:340px"><div class="spinner"></div></div></div></div>`, { wide: true });
  const body = $('.le-body', m.el);
  let f;
  try {
    f = await S.backend.lotEditor(lot);
  } catch (e) {
    body.innerHTML = `<div class="empty" style="height:280px"><div class="orb" style="color:var(--bad)">${icon('alert', 28)}</div><h3>Лот не открылся</h3><p>${esc(e.message)}</p><button class="btn" data-site>${icon('external', 15)}Открыть на сайте FunPay</button></div>`;
    $('[data-site]', body).onclick = () => (m.close(), S.backend.openBrowser(`https://funpay.com/lots/offerEdit?offer=${lot.id}`));
    return;
  }
  render(m, body, f, lot, onSaved);
}

function render(m, body, f, lot, onSaved) {
  const C = f.ctrls;
  const visible = (c) => !c.sys && !c.hidden;
  const byName = (n, kind) => C.findIndex((c) => c.name === n && (!kind || c.kind === kind));
  const iPrice = byName('price');
  const iAmount = byName('amount');
  const iActive = byName('active', 'checkbox');
  const iAuto = byName('auto_delivery', 'checkbox');
  const iSecrets = byName('secrets');
  const special = new Set([iPrice, iAmount, iActive, iAuto, iSecrets].filter((i) => i >= 0));

  // поля по группам
  const langBases = [];
  const langMap = new Map();
  C.forEach((c, i) => {
    if (!c.lang || !visible(c) || special.has(i)) return;
    if (!langMap.has(c.base)) (langMap.set(c.base, {}), langBases.push(c.base));
    langMap.get(c.base)[c.lang] = i;
  });
  const mainIdx = C.map((c, i) => i).filter((i) => visible(C[i]) && !C[i].lang && !special.has(i) && ['select', 'text', 'textarea'].includes(C[i].kind));
  const checkIdx = C.map((c, i) => i).filter((i) => visible(C[i]) && !special.has(i) && (C[i].kind === 'checkbox' || C[i].kind === 'radio'));
  const hiddenIdx = C.map((c, i) => i).filter((i) => !C[i].sys && C[i].hidden && C[i].kind !== 'hidden');

  const fieldHtml = (i) => {
    const c = C[i];
    let ctl;
    if (c.kind === 'select') ctl = `<select class="select" data-i="${i}">${(c.options || []).map((o) => `<option value="${esc(o.value)}" ${String(o.value) === String(c.value) ? 'selected' : ''}>${esc(o.text || '—')}</option>`).join('')}</select>`;
    else if (c.kind === 'textarea') ctl = `<textarea class="textarea" rows="4" data-i="${i}">${esc(c.value)}</textarea>`;
    else if (c.kind === 'checkbox' || c.kind === 'radio') return `<div class="le-row"><span class="grow">${esc(c.label)}</span><button type="button" class="switch ${c.checked ? 'on' : ''}" data-sw="${i}"></button></div>`;
    else ctl = `<input class="input" data-i="${i}" value="${esc(c.value)}">`;
    return `<div class="le-f"><label>${esc(c.label)}</label>${ctl}${c.help ? `<div class="help">${esc(c.help)}</div>` : ''}</div>`;
  };
  const langHtml = (base) => {
    const g = langMap.get(base);
    const any = C[g.ru ?? g.en];
    const ctl = (i, lg) => {
      if (i == null) return '';
      const c = C[i];
      return `<div><div class="lg">${LANG[lg]}</div>${c.kind === 'textarea' ? `<textarea class="textarea" rows="${base.includes('desc') ? 6 : 3}" data-i="${i}">${esc(c.value)}</textarea>` : `<input class="input" data-i="${i}" value="${esc(c.value)}">`}</div>`;
    };
    return `<div class="le-f"><label>${esc(any.label)}</label><div class="le-pair">${ctl(g.ru, 'ru')}${ctl(g.en, 'en')}</div></div>`;
  };

  const unit = f.unit || '₽';
  body.innerHTML = `
    ${
      mainIdx.length
        ? `<div class="le-sec"><div class="t">${icon('layers', 14)}Категория и параметры</div><div class="le-grid">${mainIdx.map(fieldHtml).join('')}</div></div>`
        : ''
    }
    ${
      langBases.length
        ? `<div class="le-sec"><div class="t">${icon('edit', 14)}Название и описание<span class="grow"></span>
            <button class="btn sm" data-tr="ru-en">${icon('langs', 14)}Перевести RU → EN</button>
            <button class="btn sm" data-tr="en-ru">${icon('langs', 14)}EN → RU</button></div>
          ${langBases.map(langHtml).join('')}</div>`
        : ''
    }
    ${
      iPrice >= 0 || iAmount >= 0 || iActive >= 0
        ? `<div class="le-sec"><div class="t">${icon('cash', 14)}Цена и наличие</div>
          <div class="le-price">
            ${iPrice >= 0 ? `<div class="le-f"><label>Твоя цена — сколько получишь</label><div class="le-unit"><input class="input mono" data-i="${iPrice}" inputmode="decimal" value="${esc(C[iPrice].value)}"><i>${esc(unit)}</i></div></div>` : ''}
            ${iAmount >= 0 ? `<div class="le-f"><label>${esc(C[iAmount].label || 'Наличие')}</label><input class="input mono" data-i="${iAmount}" inputmode="numeric" value="${esc(C[iAmount].value)}"></div>` : ''}
          </div>
          ${iPrice >= 0 ? `<div class="le-buyer" data-buyer hidden><div class="h">${icon('sparkles', 14)}<b>Цена для покупателя</b><span>впиши, сколько он заплатит — твоя цена посчитается</span></div>
            <div class="row2"><div class="le-unit"><input class="input mono" data-bp inputmode="decimal" placeholder="0"><i data-bu>${esc(unit)}</i></div><select class="select" data-bm></select></div>
            <div class="le-note" data-bn></div><div class="le-tbl" data-bt></div></div>` : ''}
          ${iActive >= 0 ? `<div class="le-row" style="margin-top:12px"><span class="grow"><b>Активный</b><div class="dim" style="font-size:12px">Выключенный лот покупатели не видят</div></span><button type="button" class="switch ${C[iActive].checked ? 'on' : ''}" data-sw="${iActive}"></button></div>` : ''}
        </div>`
        : ''
    }
    ${
      iAuto >= 0 || iSecrets >= 0
        ? `<div class="le-sec"><div class="t">${icon('zap', 14)}Автовыдача</div>
          ${iAuto >= 0 ? `<div class="le-row"><span class="grow"><b>Автовыдача</b><div class="dim" style="font-size:12px">FunPay сам отдаст товар покупателю сразу после оплаты</div></span><button type="button" class="switch ${C[iAuto].checked ? 'on' : ''}" data-sw="${iAuto}"></button></div>` : ''}
          ${iSecrets >= 0 ? `<div class="le-f" data-secrets><label>${esc(C[iSecrets].label)}</label><textarea class="textarea mono" rows="6" data-i="${iSecrets}">${esc(C[iSecrets].value)}</textarea><div class="le-cnt" data-cnt></div></div>` : ''}
        </div>`
        : ''
    }
    ${checkIdx.length ? `<div class="le-sec"><div class="t">${icon('settings', 14)}Ещё</div>${checkIdx.map(fieldHtml).join('')}</div>` : ''}
    ${
      hiddenIdx.length
        ? `<div class="le-sec"><div class="t">${icon('eye', 14)}Скрытые поля<span class="grow"></span><button class="btn sm" data-showh>Показать (${hiddenIdx.length})</button></div>
          <div class="dim" style="font-size:12px">FunPay показывает их только при определённом типе лота. Обычно трогать не нужно.</div>
          <div class="le-grid" data-hid hidden style="margin-top:10px">${hiddenIdx.map(fieldHtml).join('')}</div></div>`
        : ''
    }`;

  const foot = el(`<div class="le-foot">
      <button class="btn" data-link>${icon('link', 15)}Скопировать ссылку</button>
      <button class="btn" data-site>${icon('external', 15)}На сайте FunPay</button>
      <span class="grow"></span>
      <button class="btn" data-cancel>Отмена</button>
      <button class="btn pri" data-save>${icon('check', 16)}Сохранить</button></div>`);
  body.after(foot);

  // ---------- привязка полей ----------
  let dirty = false;
  const onField = (e) => {
    const t = e.target.closest('[data-i]');
    if (!t) return;
    C[+t.dataset.i].value = t.value;
    dirty = true;
    if (+t.dataset.i === iPrice) fromSeller();
    if (+t.dataset.i === iSecrets) countSecrets();
  };
  m.el.addEventListener('input', onField);
  m.el.addEventListener('change', onField);
  m.el.addEventListener('click', (e) => {
    const sw = e.target.closest('[data-sw]');
    if (sw) {
      const c = C[+sw.dataset.sw];
      c.checked = !c.checked;
      sw.classList.toggle('on', c.checked);
      dirty = true;
      if (+sw.dataset.sw === iAuto) syncAuto();
    }
    const sh = e.target.closest('[data-showh]');
    if (sh) {
      const g = $('[data-hid]', m.el);
      g.hidden = !g.hidden;
      sh.textContent = g.hidden ? `Показать (${hiddenIdx.length})` : 'Скрыть';
    }
  });

  // автовыдача: счётчик товаров
  const countSecrets = () => {
    const c = $('[data-cnt]', m.el);
    if (!c) return;
    const n = String(C[iSecrets].value || '').split('\n').filter((s) => s.trim()).length;
    c.textContent = n ? `Товаров: ${n}` : 'Пусто — при автовыдаче покупателю нечего будет выдать';
  };
  const syncAuto = () => {
    const box = $('[data-secrets]', m.el);
    if (box && iAuto >= 0) box.style.opacity = C[iAuto].checked ? '' : '.55';
  };
  if (iSecrets >= 0) countSecrets();
  syncAuto();

  // ---------- перевод RU ⇄ EN ----------
  m.el.querySelectorAll('[data-tr]').forEach((b) => {
    b.onclick = () => {
      const [sl, tl] = b.dataset.tr.split('-');
      const jobs = langBases
        .map((base) => langMap.get(base))
        .filter((g) => g[sl] != null && g[tl] != null && String(C[g[sl]].value || '').trim());
      if (!jobs.length) return toast('Нечего переводить', sl === 'ru' ? 'Заполни русские поля' : 'Заполни английские поля');
      if (!window.api?.trx) return err('Перевод недоступен', new Error('Переводчик работает только в программе'));
      busy(
        b,
        (async () => {
          for (const g of jobs) {
            const out = await window.api.trx(C[g[sl]].value, sl, tl);
            C[g[tl]].value = out;
            const inp = m.el.querySelector(`[data-i="${g[tl]}"]`);
            if (inp) inp.value = out;
          }
          dirty = true;
          ok('Переведено', sl === 'ru' ? 'Английские поля заполнены' : 'Русские поля заполнены');
        })().catch((x) => err('Не перевелось', x))
      );
    };
  });

  // ---------- цена для покупателя ----------
  let methods = [];
  let mi = 0;
  const bp = $('[data-bp]', m.el);
  const bm = $('[data-bm]', m.el);
  const bn = $('[data-bn]', m.el);
  const bt = $('[data-bt]', m.el);
  const bu = $('[data-bu]', m.el);
  let lock = false;
  function fromSeller() {
    if (!methods.length || lock) return;
    const me = methods[mi];
    const p = num(C[iPrice].value);
    bu.textContent = me.unit;
    bp.value = p > 0 ? String(r2(p * me.k)) : '';
    note(p);
  }
  function note(p) {
    const me = methods[mi];
    bn.textContent = p > 0 ? `Ты получишь ${fmtNum(r2(p), p % 1 ? 2 : 0)} ${unit} · комиссия ≈ ${Math.round((me.k - 1) * 100)}%` : 'Впиши любую из цен — вторая посчитается сама';
    bt.innerHTML = p > 0 ? methods.slice(1).map((x) => `<span>${esc(x.name)}</span><b>${fmtNum(r2(p * x.k), 2)} ${esc(x.unit)}</b>`).join('') : '';
  }
  if (iPrice >= 0 && S.backend.lotCalc && f.node) {
    S.backend
      .lotCalc(f.node)
      .then((list) => {
        if (!list.length) return;
        const same = list.filter((x) => x.unit.includes(unit));
        const pool = same.length ? same : list;
        const best = pool.reduce((a, b) => (b.k < a.k ? b : a));
        methods = [{ name: 'Как в списке FunPay (минимум)', unit: best.unit, k: best.k }, ...list];
        let saved = '';
        try {
          saved = localStorage.getItem(PRICE_KEY) || '';
        } catch {}
        mi = Math.max(0, methods.findIndex((x) => x.name + x.unit === saved));
        bm.innerHTML = methods.map((x, i) => `<option value="${i}" ${i === mi ? 'selected' : ''}>${esc(x.name)} (${esc(x.unit)})</option>`).join('');
        $('[data-buyer]', m.el).hidden = false;
        fromSeller();
      })
      .catch(() => {});
    bm.onchange = () => {
      mi = +bm.value;
      try {
        localStorage.setItem(PRICE_KEY, methods[mi].name + methods[mi].unit);
      } catch {}
      fromSeller();
    };
    bp.oninput = () => {
      const b = num(bp.value);
      if (!(b > 0) || !methods.length) return;
      lock = true;
      const sp = r2(b / methods[mi].k);
      C[iPrice].value = String(sp);
      const pi = m.el.querySelector(`[data-i="${iPrice}"]`);
      if (pi) pi.value = String(sp);
      dirty = true;
      note(sp);
      lock = false;
    };
  }

  // ---------- кнопки ----------
  $('[data-link]', foot).onclick = () => copyLotLink(lot);
  $('[data-site]', foot).onclick = () => (m.close(), S.backend.openBrowser(`https://funpay.com/lots/offerEdit?offer=${lot.id}`));
  $('[data-cancel]', foot).onclick = () => m.close();
  $('[data-save]', foot).onclick = (e) => {
    if (iPrice >= 0 && !(num(C[iPrice].value) > 0)) return err('Проверь цену', new Error('Цена должна быть больше нуля'));
    busy(
      e.currentTarget,
      S.backend
        .lotSaveEditor(C)
        .then(() => {
          dirty = false;
          const title = iTitle() >= 0 ? C[iTitle()].value : lot.title;
          const p = iPrice >= 0 ? num(C[iPrice].value) : lot.priceNum;
          const upd = { title: title || lot.title };
          if (iPrice >= 0) Object.assign(upd, { priceNum: p, price: `${fmtNum(p, p % 1 ? 2 : 0)} ${unit}` });
          if (iAmount >= 0) upd.amount = C[iAmount].value;
          if (iActive >= 0) upd.active = !!C[iActive].checked;
          if (iAuto >= 0) upd.auto = !!C[iAuto].checked;
          ok('Лот сохранён', upd.title);
          onSaved?.(upd);
          m.close();
        })
        .catch((x) => err('Не сохранилось', x))
    );
  };
  const iTitle = () => C.findIndex((c) => /summary\]\[ru\]$/.test(c.name)) ;
  void dirty;
}
