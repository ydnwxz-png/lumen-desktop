// Автоматика и плагины в приложении.
import { $, el, esc, fmtLeft } from '../core/util.js';
import { icon } from '../core/icons.js';
import { S, bus, saveSettings } from '../core/state.js';
import { seg, switchEl, modal, confirmBox, err, ok, toast, busy } from '../ui/kit.js';
import { notify } from '../features/notify.js';

const VARS = ['$username', '$welcome', '$order_id', '$order_link', '$lot_name', '$price', '$product', '$stars', '$my_name', '$date', '$time'];
const FEATURES = [
  ['delivery', 'Автовыдача', 'box', 'Покупатель оплатил — товар уходит сам. Ключи, аккаунты, ссылки — из списка.', editDelivery],
  ['commands', 'Автоответы', 'chat', 'Ответы на команды и частые вопросы: «!цена», «есть в наличии?»…', editCommands],
  ['greeting', 'Приветствие', 'smile', 'Первое сообщение новому покупателю.', editGreeting],
  ['reviews', 'Ответы на отзывы', 'star', 'Свой ответ на каждую оценку от 1 до 5.', editReviews],
  ['thanks', 'Спасибо за подтверждение', 'checks', 'Сообщение, когда покупатель подтвердил заказ.', (c) => editText(c, 'thanks', 'Спасибо за подтверждение')],
  ['remind', 'Напомнить подтвердить', 'clock', 'Если заказ долго не подтверждён — вежливое напоминание.', editRemind],
  ['restore', 'Включать лот после продажи', 'refresh', 'Если FunPay выключил лот после покупки — включаю обратно (для правил автовыдачи).', null],
  ['blacklist', 'Чёрный список', 'shield', 'Этим покупателям не выдаю товар и не отвечаю.', editBlacklist],
];

// window.__autoMock — подмена для тестов интерфейса в браузере
const AUTO = () => window.__autoMock || window.api?.auto;
const available = () => !!window.__autoMock || (!!window.api && !S.demo);

let root;
let data = null; // {cfg, info, plugins, events, rules}

const mode = () => (S.settings.automation?.mode === 'pc' ? 'pc' : 'off');

export function mountAutomation(c) {
  root = c;
  root.innerHTML = `<div class="page" data-page></div>`;
  window.api?.app.on('auto:event', onEvent);
  bus.on('account', () => {
    data = null;
    if (S.view === 'auto') render();
  });
}

export async function showAutomation() {
  await refresh(false);
}

// calm = обновить на месте: без анимации появления и без прыжка прокрутки
async function refresh(calm = true) {
  if (!available()) {
    data = null;
    return render(calm);
  }
  try {
    data = await AUTO().info();
  } catch (e) {
    data = null;
  }
  bus.emit('auto-info', data);
  render(calm);
}

function setData(d) {
  if (d) data = d;
  bus.emit('auto-info', data);
  render(true);
}

function onEvent(ev) {
  const d = ev.data || {};
  if (ev.type === 'delivered') toast('📦 Товар выдан', `${d.rule.name} → ${d.order.peer} (#${d.order.id})${d.left != null ? ` · осталось ${d.left}` : ''}`, { kind: 'ok', icon: 'box' });
  if (ev.type === 'deliveryEmpty') toast('⚠️ Закончился товар', `«${d.rule.name}» — заказ #${d.order.id} нужно выдать вручную`, { kind: 'err', icon: 'box', ms: 15000 });
  if (ev.type === 'notify') {
    const open = d.url ? () => S.backend?.openBrowser(d.url) : undefined;
    // окно открыто — всплывашка внутри; свёрнуто или в трее — как обычное уведомление Lumen (со звуком)
    if (S.focused) toast(d.title || d.from || 'Плагин', d.text, { icon: 'layers', ms: 8000, onClick: open });
    else notify({ title: d.title || d.from || 'Плагин', name: d.from || 'Плагин', body: d.text, raw: true, kind: d.kind === 'order' ? 'order' : 'msg', onClick: open });
  }
  if (ev.type === 'log' && data) {
    data.events.push(d);
    if (data.events.length > 60) data.events.shift();
    if (S.view === 'auto') renderLog();
  }
  if (ev.type === 'status' && data && S.view === 'auto') refresh();
}

async function save(cfg) {
  try {
    setData(await AUTO().setCfg(cfg));
  } catch (e) {
    err('Не сохранилось', e);
  }
}

function render(calm = false) {
  const p = $('[data-page]', root);
  if (!p) return;
  const scroll = p.scrollTop;
  p.classList.toggle('calm', calm);
  draw(p);
  if (calm) p.scrollTop = scroll;
}

function draw(p) {
  const m = mode();
  p.innerHTML = `
    <div class="page-head"><h1>Автоматика</h1><span class="sub">автовыдача, автоответы, плагины — пока Lumen открыт</span></div>
    <div class="card auto-mode">
      <div class="grow"><b>Автоматика</b><div class="dim" style="font-size:12.5px;margin-top:2px">${
        m === 'pc' ? 'Работает, пока Lumen открыт (можно свернуть в трей).' : 'Выключена. Включи, когда настроишь.'
      }</div></div>
      <div class="seg" data-mode><button data-v="pc">${icon('monitor', 14)}Включена</button><button data-v="off">Выключена</button></div>
    </div>
    <div data-body></div>`;
  seg($('[data-mode]', p), m, async (v) => {
    S.settings.automation = { ...(S.settings.automation || {}), mode: v };
    saveSettings();
    try {
      setData(await AUTO()?.mode(v));
    } catch {
      render(true);
    }
  });
  const body = $('[data-body]', p);
  if (!available()) {
    body.innerHTML = `<div class="empty" style="padding:50px"><div class="orb">${icon('bot', 30)}</div><h3>В демо автоматика не работает</h3><p>Войди в аккаунт FunPay в приложении — и настраивай автовыдачу, автоответы и плагины.</p></div>`;
    return;
  }
  if (!data) {
    body.innerHTML = `<div class="empty" style="padding:50px"><div class="spinner"></div></div>`;
    return;
  }
  const cfg = data.cfg;
  const inf = data.info || {};
  const t = inf.today || {};
  const st = m !== 'pc' ? '' : inf.status === 'ok' ? '<span class="pill ok"><span class="dotc"></span>Работает</span>' : inf.status === 'error' ? `<span class="pill bad" data-tip="${esc(inf.error)}"><span class="dotc"></span>Нет связи</span>` : '<span class="pill warn"><span class="dotc"></span>Запускается</span>';
  body.innerHTML = `
    <div class="stats stagger" style="grid-template-columns:repeat(4,1fr)">
      <div class="stat hero"><div class="lbl">${icon('box', 15)}Выдано сегодня</div><div class="val">${t.delivered || 0}</div><div class="hint">${st}</div></div>
      <div class="stat"><div class="lbl">${icon('bag', 15)}Заказов сегодня</div><div class="val">${t.orders || 0}</div></div>
      <div class="stat"><div class="lbl">${icon('chat', 15)}Автоответов</div><div class="val">${t.commands || 0}</div></div>
      <div class="stat"><div class="lbl">${icon('layers', 15)}Плагинов включено</div><div class="val">${inf.plugins || 0}</div></div>
    </div>
    <div class="feat-grid stagger" data-feats></div>
    <div class="page-head" style="margin:26px 0 12px"><h2 style="margin:0;font-size:19px">Плагины</h2><span class="grow"></span>
      <button class="btn sm" data-pfolder>${icon('folder', 15)}Папка</button>
      <button class="btn sm" data-preload>${icon('refresh', 15)}Перезагрузить</button>
      <button class="btn sm pri" data-pinstall>${icon('plus', 15)}Установить</button>
      <input type="file" accept=".js,.mjs,.cjs" hidden data-pfile></div>
    <div class="plug-grid stagger" data-plugins></div>
    <div class="sec-title">Журнал</div>
    <div class="card auto-log" data-log></div>`;
  const grid = $('[data-feats]', body);
  for (const [key, name, ic, desc, edit] of FEATURES) {
    const c = cfg[key];
    const isOn = key === 'blacklist' ? (c.users || []).length > 0 : !!c.on;
    const sub = key === 'delivery' ? `${c.rules.length} ${c.rules.length === 1 ? 'правило' : 'правил'}` : key === 'commands' ? `${c.rules.length} шт.` : key === 'blacklist' ? `${(c.users || []).length} чел.` : '';
    const card = el(`<div class="feat ${isOn ? 'on' : ''}"><div class="row"><span class="feat-ic">${icon(ic, 18)}</span><div class="grow"><b>${name}</b>${sub ? `<span class="dim" style="font-size:12px;margin-left:6px">${sub}</span>` : ''}</div></div><p>${desc}</p><div class="row">${edit ? `<button class="btn sm" data-edit>${icon('settings', 14)}Настроить</button>` : ''}<span class="grow"></span></div></div>`);
    if (key !== 'blacklist')
      card.querySelector('.row:last-child').append(
        switchEl(isOn, (v) => {
          cfg[key].on = v;
          save(cfg);
        })
      );
    if (edit) card.querySelector('[data-edit]').onclick = () => edit(cfg);
    grid.append(card);
  }
  renderPlugins();
  renderLog();
  const fileIn = $('[data-pfile]', body);
  $('[data-pinstall]', body).onclick = () => fileIn.click();
  fileIn.onchange = async () => {
    const f = fileIn.files[0];
    fileIn.value = '';
    if (!f) return;
    if (!(await confirmBox('Установить плагин?', `«${f.name}» получит полный доступ к аккаунту FunPay. Ставь только плагины, которым доверяешь. После установки он будет выключен.`, { yes: 'Установить' }))) return;
    try {
      setData(await AUTO().plugin('install', f.name, await f.text()));
      ok('Плагин установлен', 'Включи его переключателем');
    } catch (e) {
      err('Не установился', e);
    }
  };
  $('[data-pfolder]', body).onclick = () => AUTO().plugin('folder');
  $('[data-preload]', body).onclick = (e) => busy(e.currentTarget, AUTO().plugin('reload').then(setData, (x) => err('Ошибка', x)));
}

function renderPlugins() {
  const box = $('[data-plugins]', root);
  if (!box) return;
  const list = data.plugins || [];
  box.innerHTML = list.length ? '' : `<div class="dim" style="padding:10px 2px">Плагинов нет. Нажми «Установить» и выбери файл .js — или положи его в папку.</div>`;
  for (const p of list) {
    const card = el(`<div class="plug ${p.on ? 'on' : ''} ${p.error ? 'bad' : ''}">
      <div class="row"><span class="feat-ic">${icon(p.error ? 'alert' : 'layers', 17)}</span><div class="grow" style="min-width:0"><b class="ell" style="display:block">${esc(p.name)}</b><span class="dim" style="font-size:11.5px">${esc(p.version)}${p.author ? ' · ' + esc(p.author) : ''}</span></div></div>
      <p>${esc(p.error ? 'Ошибка: ' + p.error : p.description || 'Без описания')}</p>
      <div class="row">${p.settings.length ? `<button class="btn sm" data-set>${icon('settings', 14)}Настройки</button>` : ''}<button class="ibtn" data-del data-tip="Удалить">${icon('trash', 15)}</button><span class="grow"></span></div></div>`);
    if (!p.error)
      card.querySelector('.row:last-child').append(
        switchEl(p.on, async (v) => {
          try {
            setData(await AUTO().plugin('toggle', p.id, v));
          } catch (e) {
            err('Не получилось', e);
            refresh(true);
          }
        })
      );
    card.querySelector('[data-set]') && (card.querySelector('[data-set]').onclick = () => pluginSettings(p));
    card.querySelector('[data-del]').onclick = async () => {
      if (!(await confirmBox('Удалить плагин?', p.name, { yes: 'Удалить', danger: true }))) return;
      card.classList.add('gone');
      try {
        const d = await AUTO().plugin('remove', p.id);
        setTimeout(() => setData(d), 180);
      } catch (e) {
        card.classList.remove('gone');
        err('Не удалился', e);
      }
    };
    box.append(card);
  }
}

function renderLog() {
  const box = $('[data-log]', root);
  if (!box || !data) return;
  const ic = { warn: '⚠️', error: '❌' };
  const ev = data.events.slice(-30).reverse();
  box.innerHTML = ev.length ? ev.map((x) => `<div class="log-row"><span class="dim mono">${new Date(x.t).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</span><span>${ic[x.level] || '•'}</span><span class="grow">${esc(x.text)}</span></div>`).join('') : '<div class="dim" style="padding:14px">Здесь будет видно, что сделала автоматика.</div>';
}

// ---------------------------------------------------------------- редакторы

function varsRow(target) {
  const v = el(`<div class="vars">${VARS.map((x) => `<span class="var">${x}</span>`).join('')}</div>`);
  v.onclick = (e) => {
    const s = e.target.closest('.var');
    const ta = typeof target === 'function' ? target() : target;
    if (s && ta) {
      ta.setRangeText(s.textContent, ta.selectionStart, ta.selectionEnd, 'end');
      ta.focus();
    }
  };
  return v;
}

function editorModal(title, bodyEl, onSave, { wide = true } = {}) {
  const m = modal(`<div style="padding:${wide ? 22 : 0}px"><div class="row" style="margin-bottom:14px"><h3 class="grow" style="margin:0">${title}</h3><button class="ibtn" data-close>${icon('x', 18)}</button></div><div data-b></div><div class="modal-acts"><button class="btn ghost" data-close>Отмена</button><button class="btn pri" data-save>Сохранить</button></div></div>`, { wide });
  m.el.querySelector('[data-b]').append(bodyEl);
  m.el.querySelectorAll('[data-close]').forEach((b) => (b.onclick = () => m.close()));
  m.el.querySelector('[data-save]').onclick = async (e) => {
    try {
      await busy(e.currentTarget, onSave());
      m.close();
      ok('Сохранено');
    } catch (x) {
      err('Не сохранилось', x);
    }
  };
  return m;
}

function editText(cfg, key, title) {
  const b = el(`<div class="col"><textarea class="textarea" rows="5">${esc(cfg[key].text)}</textarea></div>`);
  const ta = b.querySelector('textarea');
  b.append(varsRow(ta));
  editorModal(title, b, () => ((cfg[key].text = ta.value), save(cfg)), { wide: false });
}

function editGreeting(cfg) {
  const g = cfg.greeting;
  const b = el(`<div class="col"><textarea class="textarea" rows="5">${esc(g.text)}</textarea><div class="vars-slot"></div><label class="row" style="gap:10px">Снова приветствовать того же покупателя через <input class="input" type="number" min="0" style="width:80px" value="${g.cooldownDays}"> дн.</label><div class="dim" style="font-size:12px">Старым покупателям (кто писал до включения) приветствие не уходит.</div></div>`);
  const ta = b.querySelector('textarea');
  b.querySelector('.vars-slot').replaceWith(varsRow(ta));
  editorModal('Приветствие', b, () => ((g.text = ta.value), (g.cooldownDays = +b.querySelector('input').value || 0), save(cfg)), { wide: false });
}

function editRemind(cfg) {
  const r = cfg.remind;
  const b = el(`<div class="col"><label class="row" style="gap:10px">Напомнить через <input class="input" type="number" min="1" style="width:80px" value="${r.hours}"> ч после оплаты, если заказ не подтверждён</label><textarea class="textarea" rows="5">${esc(r.text)}</textarea></div>`);
  const ta = b.querySelector('textarea');
  b.append(varsRow(ta));
  editorModal('Напомнить подтвердить', b, () => ((r.hours = +b.querySelector('input').value || 12), (r.text = ta.value), save(cfg)), { wide: false });
}

function editReviews(cfg) {
  const r = cfg.reviews;
  const b = el(`<div class="col">${[5, 4, 3, 2, 1].map((n) => `<label class="col" style="gap:6px"><b>${'★'.repeat(n)}<span class="dim">${'★'.repeat(5 - n)}</span></b><textarea class="textarea" rows="2" data-n="${n}" placeholder="Пусто — не отвечать">${esc(r.texts[n] || '')}</textarea></label>`).join('')}<label class="row"><input type="checkbox" ${r.overwrite ? 'checked' : ''} data-ow> Менять ответ, если он уже есть</label></div>`);
  let last = b.querySelector('textarea');
  b.querySelectorAll('textarea').forEach((t) => (t.onfocus = () => (last = t)));
  b.append(varsRow(() => last));
  editorModal('Ответы на отзывы', b, () => {
    b.querySelectorAll('[data-n]').forEach((t) => (r.texts[t.dataset.n] = t.value.trim()));
    r.overwrite = b.querySelector('[data-ow]').checked;
    return save(cfg);
  });
}

function editBlacklist(cfg) {
  const bl = cfg.blacklist;
  const b = el(`<div class="col"><div class="dim" style="font-size:12.5px">Ники FunPay, по одному в строке.</div><textarea class="textarea" rows="8">${esc((bl.users || []).join('\n'))}</textarea><label class="row"><input type="checkbox" ${bl.skipDelivery !== false ? 'checked' : ''} data-d> Не выдавать товар</label><label class="row"><input type="checkbox" ${bl.skipReplies !== false ? 'checked' : ''} data-r> Не отвечать автоматически</label></div>`);
  editorModal('Чёрный список', b, () => {
    bl.users = b.querySelector('textarea').value.split('\n').map((x) => x.trim()).filter(Boolean);
    bl.skipDelivery = b.querySelector('[data-d]').checked;
    bl.skipReplies = b.querySelector('[data-r]').checked;
    return save(cfg);
  }, { wide: false });
}

function editCommands(cfg) {
  const rules = structuredClone(cfg.commands.rules);
  const b = el('<div class="col"><div class="dim" style="font-size:12.5px">Покупатель пишет одно из слов — Lumen отвечает сам. Слова через запятую.</div><div class="col" data-list></div><div><button class="btn sm" data-add>' + icon('plus', 14) + 'Добавить</button></div></div>');
  let last = null;
  const draw = () => {
    const list = b.querySelector('[data-list]');
    list.innerHTML = '';
    rules.forEach((r, i) => {
      const row = el(`<div class="rule-ed"><div class="row"><input class="input" placeholder="!цена, цена, сколько стоит" value="${esc(r.triggers)}" data-f="triggers"><label class="row nowrap" style="gap:6px;font-size:12.5px"><input type="checkbox" ${r.contains ? 'checked' : ''} data-c> содержит</label><button class="ibtn" data-x>${icon('trash', 15)}</button></div><textarea class="textarea" rows="2" placeholder="Ответ" data-f="text">${esc(r.text)}</textarea></div>`);
      row.querySelectorAll('[data-f]').forEach((f) => {
        f.oninput = () => (r[f.dataset.f] = f.value);
        if (f.tagName === 'TEXTAREA') f.onfocus = () => (last = f);
      });
      row.querySelector('[data-c]').onchange = (e) => (r.contains = e.target.checked);
      row.querySelector('[data-x]').onclick = () => (rules.splice(i, 1), draw());
      list.append(row);
    });
    if (!rules.length) list.innerHTML = '<div class="dim">Пусто</div>';
  };
  b.querySelector('[data-add]').onclick = () => {
    rules.push({ id: Math.random().toString(36).slice(2, 8), triggers: '', text: '', contains: false, on: true });
    draw();
    b.querySelector('[data-list] .rule-ed:last-child input')?.focus();
  };
  draw();
  b.append(varsRow(() => last));
  editorModal('Автоответы', b, () => ((cfg.commands.rules = rules.filter((r) => r.triggers.trim() && r.text.trim())), save(cfg)));
}

function editDelivery(cfg) {
  const rules = cfg.delivery.rules;
  const b = el(`<div class="col"><div class="dim" style="font-size:12.5px">Правило срабатывает, если его название есть в описании заказа. В тексте выдачи <code>$product</code> — сам товар.</div><div class="col" data-list></div><div class="row"><button class="btn sm pri" data-add>${icon('plus', 14)}Новое правило</button><button class="btn sm" data-from>${icon('box', 14)}Из моих лотов</button></div></div>`);
  const list = b.querySelector('[data-list]');
  const draw = () => {
    list.innerHTML = rules.length ? '' : '<div class="dim">Правил пока нет</div>';
    const counts = Object.fromEntries((data?.rules || []).map((r) => [r.id, r.count]));
    for (const r of data?.cfg.delivery.rules || rules) {
      const n = counts[r.id];
      const row = el(`<div class="rule-row"><span class="feat-ic">${icon('box', 16)}</span><div class="grow" style="min-width:0"><b class="ell" style="display:block">${esc(r.name)}</b><span class="dim" style="font-size:12px">${n == null ? 'один текст всем' : `${n} шт. в наличии`}${r.on === false ? ' · выключено' : ''}</span></div><button class="btn sm" data-e>${icon('edit', 14)}Изменить</button></div>`);
      row.querySelector('[data-e]').onclick = () => editRule(data.cfg, r, () => draw());
      list.append(row);
    }
  };
  b.querySelector('[data-add]').onclick = () => {
    const r = { id: Math.random().toString(36).slice(2, 8), name: '', text: 'Спасибо за покупку, $username! 🎉\nТвой товар:\n$product', byAmount: true, on: true };
    editRule(data.cfg, r, () => draw(), true);
  };
  b.querySelector('[data-from]').onclick = async (e) => {
    const btn = e.currentTarget;
    let cats;
    try {
      cats = await busy(btn, S.backend.myLots());
    } catch (x) {
      return err('Лоты не загрузились', x);
    }
    const lots = cats.flatMap((c) => c.lots.map((l) => ({ ...l, cat: c.name })));
    const pick = modal(`<h3>Выбери лот</h3><div class="col" style="max-height:420px;overflow:auto;gap:4px;margin-top:10px">${lots.map((l, i) => `<button class="offer-row" data-i="${i}" style="text-align:left"><span class="grow ell">${esc(l.title)}</span><span class="dim">${esc(l.price)}</span></button>`).join('') || '<div class="dim">Нет активных лотов</div>'}</div>`);
    pick.el.onclick = (ev) => {
      const it = ev.target.closest('[data-i]');
      if (!it) return;
      const l = lots[+it.dataset.i];
      pick.close();
      editRule(data.cfg, { id: Math.random().toString(36).slice(2, 8), name: l.title, lotId: l.id, node: l.node, text: 'Спасибо за покупку, $username! 🎉\nТвой товар:\n$product', byAmount: true, on: true }, () => draw(), true);
    };
  };
  draw();
  const m = modal(`<div style="padding:22px"><div class="row" style="margin-bottom:14px"><h3 class="grow" style="margin:0">Автовыдача</h3><button class="ibtn" data-close>${icon('x', 18)}</button></div><div data-b></div></div>`, { wide: true, onClose: refresh });
  m.el.querySelector('[data-b]').append(b);
}

async function editRule(cfg, r, after, isNew = false) {
  let lines = [];
  try {
    if (!isNew) lines = await AUTO().products(r.id);
  } catch {}
  const b = el(`<div class="col">
    <label class="col" style="gap:6px"><b>Название (часть описания лота)</b><input class="input" data-name value="${esc(r.name)}" placeholder="Steam ключ GTA V"></label>
    <label class="col" style="gap:6px"><b>Текст выдачи</b><textarea class="textarea" rows="4" data-text>${esc(r.text)}</textarea></label>
    <div class="vars-slot"></div>
    <label class="col" style="gap:6px"><b>Товары — по одному в строке <span class="dim" data-cnt></span></b><textarea class="textarea mono" rows="8" data-prod placeholder="KEY-AAAA-BBBB\nKEY-CCCC-DDDD">${esc(lines.join('\n'))}</textarea></label>
    <label class="row"><input type="checkbox" ${r.byAmount !== false ? 'checked' : ''} data-amt> Выдавать столько, сколько купили (поле «Количество» в заказе)</label>
    <label class="row"><input type="checkbox" ${r.disableWhenEmpty ? 'checked' : ''} data-dis ${r.lotId ? '' : 'disabled'}> Выключать лот, когда товар закончился${r.lotId ? '' : ' <span class="dim">(только для правил из моих лотов)</span>'}</label>
    <label class="row"><input type="checkbox" ${r.on !== false ? 'checked' : ''} data-on> Правило включено</label>
    ${isNew ? '' : `<div><button class="btn sm danger" data-del>${icon('trash', 14)}Удалить правило</button></div>`}</div>`);
  const ta = b.querySelector('[data-text]');
  b.querySelector('.vars-slot').replaceWith(varsRow(ta));
  const prod = b.querySelector('[data-prod]');
  const cnt = () => (b.querySelector('[data-cnt]').textContent = `· ${prod.value.split('\n').filter((x) => x.trim()).length} шт.`);
  prod.oninput = cnt;
  cnt();
  const m = editorModal(isNew ? 'Новое правило' : 'Правило автовыдачи', b, async () => {
    const name = b.querySelector('[data-name]').value.trim();
    if (!name) throw new Error('Укажи название');
    Object.assign(r, { name, text: ta.value, byAmount: b.querySelector('[data-amt]').checked, disableWhenEmpty: b.querySelector('[data-dis]').checked, on: b.querySelector('[data-on]').checked });
    if (isNew) cfg.delivery.rules.push(r);
    await save(cfg);
    await AUTO().setProducts(r.id, prod.value.split('\n'));
    await refresh();
    after?.();
  });
  b.querySelector('[data-del]') &&
    (b.querySelector('[data-del]').onclick = async () => {
      if (!(await confirmBox('Удалить правило?', r.name, { yes: 'Удалить', danger: true }))) return;
      cfg.delivery.rules = cfg.delivery.rules.filter((x) => x.id !== r.id);
      await save(cfg);
      m.close();
      after?.();
    });
}

function pluginSettings(p) {
  const b = el('<div class="col"></div>');
  for (const s of p.settings) {
    const v = p.values[s.key];
    const f =
      s.type === 'bool'
        ? el(`<label class="row"><input type="checkbox" ${v ? 'checked' : ''} data-k="${esc(s.key)}"> ${esc(s.label || s.key)}</label>`)
        : el(`<label class="col" style="gap:6px"><b>${esc(s.label || s.key)}</b>${s.type === 'textarea' ? `<textarea class="textarea" rows="4" data-k="${esc(s.key)}">${esc(v ?? '')}</textarea>` : `<input class="input" ${s.type === 'number' ? 'type="number"' : ''} data-k="${esc(s.key)}" value="${esc(v ?? '')}">`}</label>`);
    b.append(f);
  }
  editorModal(`${p.name} — настройки`, b, async () => {
    let d;
    for (const s of p.settings) {
      const f = b.querySelector(`[data-k="${CSS.escape(s.key)}"]`);
      const val = s.type === 'bool' ? f.checked : s.type === 'number' ? +f.value : f.value;
      d = await AUTO().plugin('setting', p.id, s.key, val);
    }
    setData(d);
  }, { wide: false });
}

export const _left = fmtLeft;
