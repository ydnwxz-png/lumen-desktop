// Обращение в поддержку FunPay: «покупатель не подтвердил заказ».
// Выбираешь оплаченные заказы, которые уже выполнил (или все сразу) → Lumen сам создаёт обращения
// на support.funpay.com (по N заказов в каждом). Если отправка не прошла — можно открыть форму и отправить руками.
import { $, $$, esc, parseFpDate, plural, copyText } from '../core/util.js';
import { icon } from '../core/icons.js';
import { S, persist } from '../core/state.js';
import { modal, ok, err, toast, confirmBox } from '../ui/kit.js';
import { openWebPane } from '../ui/webpane.js';

const SUPPORT_URL = 'https://support.funpay.com/tickets/new';
const DEF_TEXT = `Здравствуйте!
Покупатели не подтверждают выполненные заказы. Все заказы ниже выполнены полностью, товар/услуга переданы покупателю, претензий в чате нет.
Прошу подтвердить заказы:
{orders}
Спасибо!`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const hoursAgo = (o) => {
  const d = parseFpDate(o.date);
  return d ? (Date.now() - d.getTime()) / 3600e3 : 0;
};
const ago = (h) => (h < 1 ? 'меньше часа' : h < 24 ? `${Math.floor(h)} ч` : `${Math.floor(h / 24)} ${plural(Math.floor(h / 24), 'день', 'дня', 'дней')}`);

/** Список «на подтверждение» и отправка в поддержку */
export async function openSupportPicker() {
  const sent = (await persist.get('supportSent', {})) || {}; // id заказа → когда отправляли
  const st = { items: [], sel: new Set(), text: (await persist.get('supportText', '')) || DEF_TEXT, batch: +(await persist.get('supportBatch', 5)) || 5, busy: false };
  const m = modal(
    `<div class="sp">
      <div class="row" style="gap:12px;align-items:flex-start"><div class="ic-b big">${icon('alert', 20)}</div>
        <div class="grow"><h3>Покупатель не подтвердил заказ</h3>
        <p class="dim" style="margin-top:4px">Отметь заказы, которые ты <b>уже выполнил</b>, или выбери все. Lumen сам отправит обращения в поддержку FunPay — заходить на сайт не нужно.</p></div></div>
      <div class="row sp-tools"><button class="btn sm" data-old>${icon('clock', 14)}Выбрать старше суток</button><button class="btn sm ghost" data-all>Выбрать все</button><button class="btn sm ghost" data-none>Снять все</button><span class="grow"></span><span class="dim" data-cnt></span></div>
      <div class="sp-list" data-list><div class="spinner" style="margin:30px auto"></div></div>
      <details class="sp-text"><summary>${icon('edit', 14)} Текст обращения</summary>
        <textarea class="textarea" rows="7" data-text></textarea>
        <div class="dim" style="font-size:12px;margin-top:6px">{orders} — сюда подставятся номера и названия заказов</div>
        <label class="row sp-batch">Заказов в одном обращении <input class="input" type="number" min="1" max="20" data-batch></label></details>
      <div class="sp-res" data-res hidden></div>
      <div class="modal-acts"><button class="btn ghost" data-close>Закрыть</button><button class="btn ghost" data-form title="Открыть форму поддержки и отправить вручную">${icon('globe', 15)}Вручную</button><button class="btn" data-copy>${icon('copy', 15)}Текст</button><button class="btn pri" data-go>${icon('send', 15)}Отправить в поддержку</button></div>
    </div>`,
    { wide: true }
  );
  const box = m.el;
  const ta = $('[data-text]', box);
  ta.value = st.text;
  ta.oninput = () => ((st.text = ta.value), persist.set('supportText', ta.value === DEF_TEXT ? '' : ta.value));
  const bi = $('[data-batch]', box);
  bi.value = st.batch;
  bi.onchange = () => {
    st.batch = Math.min(20, Math.max(1, Math.round(+bi.value) || 5));
    bi.value = st.batch;
    persist.set('supportBatch', st.batch);
    draw();
  };

  const draw = () => {
    const list = $('[data-list]', box);
    if (!st.items.length) {
      list.innerHTML = `<div class="empty" style="padding:30px"><div class="orb">${icon('checks', 26)}</div><h3>Нет неподтверждённых заказов</h3><p>Все оплаченные заказы уже закрыты</p></div>`;
    } else {
      list.innerHTML = st.items
        .map((o) => {
          const h = hoursAgo(o);
          const was = sent[o.id];
          return `<label class="sp-row ${st.sel.has(o.id) ? 'on' : ''}">
            <input type="checkbox" data-id="${esc(o.id)}" ${st.sel.has(o.id) ? 'checked' : ''}>
            <span class="oid">#${esc(o.id)}</span>
            <span class="sp-d"><b class="ell">${esc(o.desc || '—')}</b><span class="dim ell">${esc(o.peer)} · ${esc(o.price)}</span></span>
            <span class="sp-age ${h >= 24 ? 'old' : ''}">${ago(h)}</span>
            ${was ? `<span class="pill" title="Уже отправлял в поддержку">${icon('send', 11)} ${ago((Date.now() - was) / 3600e3)} назад</span>` : '<span></span>'}
          </label>`;
        })
        .join('');
    }
    const n = st.sel.size;
    const t = Math.ceil(n / st.batch);
    $('[data-cnt]', box).textContent = st.items.length ? `выбрано ${n} из ${st.items.length}` + (n ? ` · ${t} ${plural(t, 'обращение', 'обращения', 'обращений')}` : '') : '';
    for (const b of ['[data-go]', '[data-copy]', '[data-form]']) $(b, box).disabled = !n || st.busy;
  };
  box.onchange = (e) => {
    const c = e.target.closest('[data-id]');
    if (!c) return;
    c.checked ? st.sel.add(c.dataset.id) : st.sel.delete(c.dataset.id);
    c.closest('.sp-row').classList.toggle('on', c.checked);
    draw();
  };
  $('[data-old]', box).onclick = () => (st.items.forEach((o) => hoursAgo(o) >= 24 && st.sel.add(o.id)), draw());
  $('[data-all]', box).onclick = () => (st.items.forEach((o) => st.sel.add(o.id)), draw());
  $('[data-none]', box).onclick = () => (st.sel.clear(), draw());

  const chosen = () => st.items.filter((o) => st.sel.has(o.id));
  const textFor = (list) => String(st.text || DEF_TEXT).replace('{orders}', list.map((o) => `#${o.id} — ${o.desc || 'заказ'} (покупатель ${o.peer}, ${o.price}, ${o.date})`).join('\n'));
  const mark = (list) => {
    for (const o of list) sent[o.id] = Date.now();
    persist.set('supportSent', sent);
  };
  const res = $('[data-res]', box);
  const say = (html) => ((res.hidden = false), (res.innerHTML = html));
  const manual = (list) => {
    copyText(textFor(list)).catch(() => {});
    m.close();
    if (S.demo || !window.api) return toast('Демо-режим', 'Текст обращения скопирован.');
    openWebPane(S.accId, SUPPORT_URL, { fill: { text: textFor(list), order: list[0].id } });
    toast('Форма поддержки', 'Заполняю обращение. Выбери тему и нажми «Отправить». Текст уже в буфере — если поле пустое, вставь Ctrl+V.');
  };

  $('[data-copy]', box).onclick = () => copyText(textFor(chosen())).then(() => ok('Текст скопирован', 'Вставь его в форму поддержки'));
  $('[data-form]', box).onclick = () => manual(chosen());
  $('[data-go]', box).onclick = async () => {
    const list = chosen();
    const again = list.filter((o) => sent[o.id] && Date.now() - sent[o.id] < 24 * 3600e3);
    if (again.length && !(await confirmBox('Уже отправлял', `${again.length} ${plural(again.length, 'заказ', 'заказа', 'заказов')} из выбранных уже уходили в поддержку за последние сутки. Отправить ещё раз?`, { yes: 'Отправить' }))) return;
    const groups = [];
    for (let i = 0; i < list.length; i += st.batch) groups.push(list.slice(i, i + st.batch));
    st.busy = true;
    draw();
    const done = [];
    let fail = null;
    for (let i = 0; i < groups.length; i++) {
      say(`<div class="row" style="gap:10px"><div class="spinner sm"></div>Отправляю обращение ${i + 1} из ${groups.length}…</div>`);
      try {
        const t = S.demo || !window.api ? (await sleep(700), { id: String(4810000 + Math.floor(Math.random() * 9999)), url: '' }) : await window.api.fp.support(S.accId, { orders: groups[i].map((o) => o.id), text: textFor(groups[i]) });
        done.push({ ...t, list: groups[i] });
        mark(groups[i]);
      } catch (e) {
        fail = { e, list: groups.slice(i).flat() };
        break;
      }
      if (i < groups.length - 1) await sleep(2500);
    }
    st.busy = false;
    for (const d of done) for (const o of d.list) st.sel.delete(o.id);
    draw();
    const rows = done
      .map((d) => `<div class="sp-tk">${icon('checks', 14)}<b>Обращение №${esc(d.id)}</b><span class="dim ell">${d.list.map((o) => '#' + esc(o.id)).join(', ')}</span>${d.url ? `<button class="btn sm ghost" data-tk="${esc(d.url)}">Открыть</button>` : ''}</div>`)
      .join('');
    say(
      rows +
        (fail
          ? `<div class="sp-tk bad">${icon('alert', 14)}<span class="grow">${esc(fail.e.message)}</span><button class="btn sm" data-manual>Отправить вручную</button></div>`
          : '')
    );
    $$('[data-tk]', res).forEach((b) => (b.onclick = () => openWebPane(S.accId, b.dataset.tk)));
    const mb = $('[data-manual]', res);
    if (mb) mb.onclick = () => manual(fail.list);
    if (done.length) ok('Отправлено в поддержку', `${done.length} ${plural(done.length, 'обращение', 'обращения', 'обращений')} · ${done.reduce((n, d) => n + d.list.length, 0)} ${plural(done.reduce((n, d) => n + d.list.length, 0), 'заказ', 'заказа', 'заказов')}`);
    else if (fail) err('Не отправилось', fail.e.message);
    draw();
  };

  // оплаченные продажи (до 3 страниц)
  try {
    let r = await S.backend.trades('sales', 'paid', '');
    let items = r.items;
    for (let i = 0; i < 2 && r.next; i++) {
      r = await S.backend.trades('sales', 'paid', r.next);
      items = items.concat(r.items);
    }
    st.items = items.filter((o) => o.state === 'paid').sort((a, b) => hoursAgo(b) - hoursAgo(a));
  } catch (e) {
    $('[data-list]', box).innerHTML = `<div class="empty" style="padding:30px"><div class="orb" style="color:var(--bad)">${icon('alert', 26)}</div><h3>Заказы не загрузились</h3><p>${esc(e.message)}</p></div>`;
    return;
  }
  draw();
}

/** Скрипт, который заполняет форму обращения на support.funpay.com (подбирает поля по подписям). */
export function supportFillScript({ text, order }) {
  return `(() => {
    const vis = (e) => e && e.offsetParent !== null;
    const fire = (e) => { e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); };
    const label = (e) => ((e.closest('.form-group, .field, label, div')?.textContent || '') + ' ' + (e.placeholder || '') + ' ' + (e.name || '') + ' ' + (e.id || '')).toLowerCase();
    let done = false;
    const msg = ${JSON.stringify(text)};
    const ta = [...document.querySelectorAll('textarea')].filter(vis).sort((a, b) => b.offsetHeight - a.offsetHeight)[0];
    if (ta && !ta.value.trim()) { ta.focus(); ta.value = msg; fire(ta); done = true; }
    const ce = [...document.querySelectorAll('[contenteditable="true"]')].filter(vis)[0];
    if (ce && !ce.textContent.trim()) { ce.focus(); ce.innerHTML = msg.split('\\n').map((l) => '<p>' + l.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]) + '</p>').join(''); fire(ce); done = true; }
    for (const i of document.querySelectorAll('input[type=text], input:not([type])')) {
      if (vis(i) && !i.value && /заказ|order/.test(label(i))) { i.value = ${JSON.stringify(String(order))}; fire(i); break; }
    }
    return done;
  })()`;
}
