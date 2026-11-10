// Настройки: вид, ник, уведомления, шаблоны, автоответы, ИИ, аккаунты, система.
import { $, esc, el, avatar, copyText } from '../core/util.js';
import { icon } from '../core/icons.js';
import { S, bus, saveSettings, saveTemplates, DEFAULT_SETTINGS } from '../core/state.js';
import { seg, switchEl, confirmBox, ok, err, toast, busy } from '../ui/kit.js';
import { NICK_STYLES, nickHtml, myNick } from '../features/nicks.js';
import { fxHas } from '../features/fx.js';
import { VARS } from '../features/templates.js';
import { sound, notify, SOUNDS } from '../features/notify.js';
import { applyLook } from '../ui/look.js';
import { dndTick, dndOn, dndOff } from '../features/later.js';

const SECTIONS = [
  ['look', 'Внешний вид', 'palette'],
  ['nick', 'Редактор ника', 'sparkles'],
  ['notify', 'Уведомления', 'bell'],
  ['tpl', 'Шаблоны', 'zap'],
  ['ai', 'ИИ-помощник', 'wand'],
  ['acc', 'Аккаунты', 'users'],
  ['sys', 'Система', 'monitor'],
  ['about', 'О программе', 'info'],
];
const ACCENTS = { lumen: ['#c6f432', '#5ef0c8'], violet: ['#a78bfa', '#6366f1'], ocean: ['#22d3ee', '#3b82f6'], mint: ['#34d399', '#14b8a6'], sunset: ['#fb923c', '#ec4899'], rose: ['#fb7185', '#e11d48'], gold: ['#fcd34d', '#f59e0b'], lime: ['#bef264', '#22c55e'], mono: ['#f4f4f5', '#71717a'] };
const TPL_COLORS = { violet: '#a78bfa', ocean: '#38bdf8', mint: '#34d399', sunset: '#fb923c', rose: '#fb7185', gold: '#fbbf24' };

let root,
  page,
  cur = 'look';
const set = (fn) => {
  fn(S.settings);
  saveSettings();
  applyLook();
};

export function mountSettings(c) {
  root = c;
  root.innerHTML = `<nav class="set-nav"><h2>Настройки</h2>${SECTIONS.map(([id, n, ic]) => `<button data-s="${id}">${icon(ic, 18)}${n}</button>`).join('')}</nav><div class="set-page"></div>`;
  page = $('.set-page', root);
  $('.set-nav', root).onclick = (e) => {
    const b = e.target.closest('[data-s]');
    if (b) show(b.dataset.s);
  };
}

export function showSettings(sec) {
  show(sec || cur);
}

function row(title, desc, control) {
  const r = el(`<div class="set-row"><div class="lbl"><b>${title}</b>${desc ? `<span>${desc}</span>` : ''}</div></div>`);
  if (control) r.append(control);
  return r;
}
function group(...rows) {
  const g = el('<div class="set-group"></div>');
  g.append(...rows.filter(Boolean));
  return g;
}
function segEl(opts, value, onChange) {
  const s = el(`<div class="seg">${opts.map(([v, n]) => `<button data-v="${v}">${n}</button>`).join('')}</div>`);
  seg(s, value, onChange);
  return s;
}
const sw = (on, fn) => switchEl(on, fn);

function show(sec) {
  cur = sec;
  root.querySelectorAll('[data-s]').forEach((b) => b.classList.toggle('on', b.dataset.s === sec));
  page.innerHTML = '';
  page.scrollTop = 0;
  const wrap = el('<div class="stagger"></div>');
  page.append(wrap);
  ({ look, nick, notify: notif, tpl, ai, acc, sys, about })[sec](wrap);
}

function head(w, t, sub) {
  w.append(el(`<h1>${t}</h1>`), el(`<div class="sub">${sub}</div>`));
}

// ---------------------------------------------------------------- разделы

function look(w) {
  head(w, 'Внешний вид', 'Тема, цвета и анимации — меняется сразу.');
  const st = S.settings;
  const cur = st.customAccent || { a1: '#c6f432', a2: '#5ef0c8' };
  const sws = el(`<div class="swatches">${Object.entries(ACCENTS).map(([k, [a, b]]) => `<button class="swatch ${st.accent === k ? 'on' : ''}" data-a="${k}" style="background:linear-gradient(135deg,${a},${b})"></button>`).join('')}<button class="swatch custom ${st.accent === 'custom' ? 'on' : ''}" data-a="custom" data-tip="Свой цвет" style="--c1:${cur.a1};--c2:${cur.a2}">${icon('plus', 14)}</button></div>`);
  const pick = (v) => el(`<input type="color" class="cpick" value="${v}">`);
  const c1 = pick(cur.a1);
  const c2 = pick(cur.a2);
  const customRow = row('Свой цвет', 'Два цвета — из них получится переход', el('<div class="row" style="gap:10px"></div>'));
  customRow.querySelector('.row').append(c1, c2);
  customRow.hidden = st.accent !== 'custom';
  const setCustom = () => {
    set((s) => {
      s.accent = 'custom';
      s.customAccent = { a1: c1.value, a2: c2.value };
    });
    const b = sws.querySelector('.custom');
    b.style.setProperty('--c1', c1.value);
    b.style.setProperty('--c2', c2.value);
  };
  c1.oninput = c2.oninput = setCustom;
  sws.onclick = (e) => {
    const b = e.target.closest('[data-a]');
    if (!b) return;
    sws.querySelectorAll('.swatch').forEach((x) => x.classList.toggle('on', x === b));
    customRow.hidden = b.dataset.a !== 'custom';
    if (b.dataset.a === 'custom') setCustom();
    else set((s) => (s.accent = b.dataset.a));
  };
  const tint = pick(st.tint || '#6366f1');
  const tintOff = el(`<button class="btn sm">Без оттенка</button>`);
  const tintBox = el('<div class="row" style="gap:10px"></div>');
  tintBox.append(tintOff, tint);
  tintOff.hidden = !st.tint;
  tint.oninput = () => {
    set((s) => (s.tint = tint.value));
    tintOff.hidden = false;
  };
  tintOff.onclick = () => {
    set((s) => (s.tint = ''));
    tintOff.hidden = true;
  };
  const fs = el(`<input type="range" class="range" min="12" max="16" step="1" value="${st.fontSize}">`);
  fs.oninput = () => set((s) => (s.fontSize = +fs.value));
  const reset = el(`<button class="btn sm">${icon('refresh', 14)}Сбросить</button>`);
  reset.onclick = () => {
    set((s) => Object.assign(s, { theme: 'dark', accent: 'lumen', bg: 'aurora', tint: '', customAccent: null }));
    show('look');
  };
  w.append(
    group(
      row('Тема', 'Светлая, тёмная или как в системе', segEl([['dark', 'Тёмная'], ['light', 'Светлая'], ['system', 'Системная']], st.theme, (v) => set((s) => (s.theme = v)))),
      row('Акцентный цвет', 'Кнопки, свои сообщения, подсветка. «+» — свой цвет', sws),
      customRow,
      row('Оттенок фона', 'Подкрасить фон и панели в свой цвет', tintBox),
      row('Фон', 'Аврора — мягкие переливы за окном', segEl([['aurora', 'Аврора'], ['solid', 'Ровный'], ['oled', 'OLED']], st.bg, (v) => set((s) => (s.bg = v)))),
      row('Размер текста', '', fs),
      row('Анимации', 'Плавные переходы, появление сообщений, ники', sw(st.animations, (v) => set((s) => (s.animations = v)))),
      row('Вернуть как было', 'Стандартная тёмная тема с зелёным цветом Lumen', reset)
    )
  );
}

function nick(w) {
  // Редактор ника Lumen FX прямо в программе: делаешь стиль → получаешь ключ → отправляешь боту.
  const has = fxHas(S.me?.userId);
  head(w, 'Редактор ника', has ? 'У тебя есть украшение Lumen FX. Сделай новый стиль, получи ключ и отправь боту — стиль сменится сразу.' : 'Собери стиль, получи ключ и отправь его боту. Украшение увидят все, у кого стоит Lumen — в браузере и в этой программе.');
  const q = S.me?.username && /^[A-Za-z0-9_\-.]{3,24}$/.test(S.me.username) ? '?n=' + encodeURIComponent(S.me.username) : '';
  const box = el(`<div class="nick-editor"><iframe src="editor/editor.html${q}" title="Редактор ника"></iframe></div>`);
  w.append(box);
}

// сообщения от редактора ника (iframe): скопировать ключ / отправить боту
window.addEventListener('message', async (e) => {
  const d = e.data || {};
  const key = typeof d.lumenKey === 'string' ? d.lumenKey : typeof d.lumenCopy === 'string' ? d.lumenCopy : '';
  if (!/^LMN-[A-Za-z0-9_-]{10,4000}$/.test(key)) return;
  await copyText(key);
  if (d.lumenKey) {
    const u = 'https://t.me/Lumenfx_bot';
    window.api ? window.api.app.open(u) : window.open(u);
    ok('Ключ скопирован', 'Вставь его в чат с ботом (Ctrl+V) и отправь');
  } else ok('Ключ скопирован', '');
});

function soundPick(key, def, kind) {
  const cur = S.settings.notify[key] || def;
  const box = el(`<div class="row" style="gap:6px"><select class="select" style="width:170px;height:34px">${Object.entries(SOUNDS)
    .map(([id, x]) => `<option value="${id}" ${id === cur ? 'selected' : ''}>${esc(x.name)}</option>`)
    .join('')}</select><button class="btn sm" title="Послушать">${icon('play', 14)}</button></div>`);
  const sel = box.querySelector('select');
  sel.onchange = () => {
    set((s) => (s.notify[key] = sel.value));
    sound(kind, sel.value);
  };
  box.querySelector('button').onclick = () => sound(kind, sel.value);
  return box;
}

function notif(w) {
  head(w, 'Уведомления', 'Когда окно свёрнуто — всплывают в углу экрана.');
  const n = S.settings.notify;
  const vol = el(`<input type="range" class="range" min="0" max="1" step="0.05" value="${n.volume}">`);
  vol.onchange = () => {
    set((s) => (s.notify.volume = +vol.value));
    sound();
  };
  const test = el(`<button class="btn sm">${icon('play', 14)}Проверить</button>`);
  test.onclick = () => {
    const was = S.focused;
    S.focused = false;
    notify({ title: 'darkness21', name: 'darkness21', body: 'Привет! Это тестовое уведомление Lumen ✨', avatar: '', node: null, kind: 'msg' });
    S.focused = was;
  };
  w.append(
    group(
      row('Вид', 'Lumen — красивые карточки, Системные — как у Windows', segEl([['lumen', 'Lumen'], ['system', 'Системные'], ['off', 'Выкл']], n.mode, (v) => set((s) => (s.notify.mode = v)))),
      row('Угол экрана', 'Для уведомлений Lumen', segEl([['tl', '↖'], ['tr', '↗'], ['bl', '↙'], ['br', '↘']], n.corner, (v) => set((s) => (s.notify.corner = v)))),
      row('Показывать текст', 'Иначе просто «Новое сообщение»', sw(n.preview, (v) => set((s) => (s.notify.preview = v)))),
      row('Когда окно открыто', 'Тоже показывать всплывашку внутри окна', sw(n.whenFocused, (v) => set((s) => (s.notify.whenFocused = v)))),
      row('Новые заказы', 'Отдельное уведомление со своим звуком', sw(n.orders, (v) => set((s) => (s.notify.orders = v)))),
      row('Тест', '', test)
    ),
    group(
      row('Звук', '', sw(n.sound, (v) => set((s) => (s.notify.sound = v)))),
      row('Звук сообщения', 'Нажми ▶, чтобы послушать', soundPick('msgSound', 'lumen', 'msg')),
      row('Звук заказа', 'Когда покупатель оплатил', soundPick('orderSound', 'coins', 'order')),
      row('Громкость', '', vol)
    )
  );
  // Не беспокоить
  const d = S.settings.dnd;
  const hours = (k) => {
    const sel = el(`<select class="select" style="width:90px;height:34px">${Array.from({ length: 24 }, (_, h) => `<option value="${h}" ${+d[k] === h ? 'selected' : ''}>${String(h).padStart(2, '0')}:00</option>`).join('')}</select>`);
    sel.onchange = () => (set((s) => (s.dnd[k] = +sel.value)), dndTick());
    return sel;
  };
  const span = el('<div class="row" style="gap:8px"><span class="dim">с</span></div>');
  span.append(hours('from'), el('<span class="dim">до</span>'), hours('to'));
  const txt = el(`<textarea class="textarea" rows="2">${esc(d.text)}</textarea>`);
  txt.oninput = () => set((s) => (s.dnd.text = txt.value));
  const tRow = el('<div class="set-row col"><div class="lbl"><b>Текст автоответа</b><span>Уйдёт один раз в каждый чат, пока режим включён</span></div></div>');
  tRow.append(txt);
  w.append(
    el(`<div class="sec-title">Не беспокоить</div>`),
    group(
      row('Включить сейчас', 'Без звука и всплывашек. Быстро — через аватарку слева внизу', sw(d.on, (v) => (set(() => (v ? dndOn() : dndOff())), dndTick()))),
      row('По расписанию', 'Каждый день в эти часы', sw(d.schedule, (v) => (set((s) => ((s.dnd.schedule = v), (s.dnd.snoozeUntil = 0))), dndTick()))),
      row('Часы', '', span),
      row('Отвечать покупателям', 'Один раз в чат. Если бот или автоматика уже ответили — не пишу', sw(d.reply, (v) => set((s) => (s.dnd.reply = v)))),
      tRow
    )
  );
}

function tpl(w) {
  head(w, 'Шаблоны', 'Кнопки над полем ввода. Alt+1…9 — быстрая вставка, «/» в начале сообщения — поиск.');
  const vars = el(`<div class="vars">${VARS.map(([v, d]) => `<span class="var" data-tip="${d}">${v}</span>`).join('')}</div>`);
  const g = el('<div class="set-group"></div>');
  let lastTa = null;
  vars.onclick = (e) => {
    const v = e.target.closest('.var');
    if (v && lastTa) {
      lastTa.setRangeText(v.textContent, lastTa.selectionStart, lastTa.selectionEnd, 'end');
      lastTa.dispatchEvent(new Event('input'));
      lastTa.focus();
    }
  };
  const render = () => {
    g.innerHTML = '';
    S.templates.forEach((t, i) => {
      const r = el(`<div class="tpl-edit">
        <div class="row"><input class="input" style="max-width:220px" value="${esc(t.name)}" placeholder="Название" data-f="name">
          <div class="color-dots">${Object.entries(TPL_COLORS).map(([k, c]) => `<button data-c="${k}" class="${t.color === k ? 'on' : ''}" style="background:${c};color:${c}"></button>`).join('')}</div>
          <span class="grow"></span>
          <label class="row dim" style="gap:8px;font-size:12.5px" data-tip="Отправлять сразу по клику, без правки">Сразу отправлять</label>
          <button class="ibtn" data-up data-tip="Выше">${icon('up', 16)}</button>
          <button class="ibtn" data-del data-tip="Удалить">${icon('trash', 16)}</button></div>
        <textarea class="textarea" data-f="text" placeholder="Текст шаблона">${esc(t.text)}</textarea></div>`);
      r.querySelector('label').append(
        switchEl(t.send, (v) => {
          t.send = v;
          saveTemplates();
        })
      );
      r.querySelectorAll('[data-f]').forEach((f) => {
        f.oninput = () => {
          t[f.dataset.f] = f.value;
          saveTemplates();
        };
        f.onfocus = () => f.tagName === 'TEXTAREA' && (lastTa = f);
      });
      r.querySelector('.color-dots').onclick = (e) => {
        const b = e.target.closest('[data-c]');
        if (!b) return;
        t.color = b.dataset.c;
        saveTemplates();
        r.querySelectorAll('[data-c]').forEach((x) => x.classList.toggle('on', x === b));
      };
      r.querySelector('[data-up]').onclick = () => {
        if (!i) return;
        [S.templates[i - 1], S.templates[i]] = [S.templates[i], S.templates[i - 1]];
        saveTemplates();
        render();
      };
      r.querySelector('[data-del]').onclick = async () => {
        if (await confirmBox('Удалить шаблон?', t.name, { yes: 'Удалить', danger: true })) {
          S.templates.splice(i, 1);
          saveTemplates();
          render();
        }
      };
      g.append(r);
    });
    if (!S.templates.length) g.append(el('<div class="set-row dim">Шаблонов нет</div>'));
  };
  render();
  const add = el(`<button class="btn pri">${icon('plus', 16)}Добавить шаблон</button>`);
  add.onclick = () => {
    S.templates.push({ id: 't' + Date.now(), name: 'Новый', text: '', color: 'violet', send: false });
    saveTemplates();
    render();
    g.lastElementChild.querySelector('input').focus();
  };
  const bar = el('<div class="row" style="margin-bottom:14px"></div>');
  bar.append(add, el('<span class="grow"></span>'), el(`<label class="row muted" style="font-size:13px">Показывать кнопки в чате</label>`));
  bar.lastChild.append(sw(S.settings.templatesBar, (v) => set((s) => (s.templatesBar = v))));
  w.append(bar, el('<div class="sec-title" style="margin-top:0">Переменные — нажми, чтобы вставить</div>'), vars, el('<div style="height:14px"></div>'), g);
}

function ai(w) {
  head(w, 'ИИ-помощник', 'Кнопка ✨ в чате перепишет твой черновик вежливо и грамотно. Подойдёт любой OpenAI-совместимый сервис (OpenAI, OpenRouter, Groq…).');
  const f = (k, ph, type = 'text') => {
    const i = el(`<input class="input" type="${type}" placeholder="${ph}" value="${esc(S.settings.ai[k] || '')}">`);
    i.oninput = () => set((s) => (s.ai[k] = i.value.trim()));
    return i;
  };
  const r = (t, d, c) => {
    const x = el(`<div class="set-row col"><div class="lbl"><b>${t}</b><span>${d}</span></div></div>`);
    x.append(c);
    return x;
  };
  w.append(group(r('Адрес API', 'Например https://openrouter.ai/api/v1', f('base', 'https://api.openai.com/v1')), r('Ключ', 'Хранится только у тебя на компьютере', f('key', 'sk-…', 'password')), r('Модель', 'Например gpt-4o-mini', f('model', 'gpt-4o-mini'))));
  if (!window.api) w.append(el('<div class="dim">В демо-режиме в браузере ИИ недоступен.</div>'));
}

async function acc(w) {
  head(w, 'Аккаунты', 'Несколько аккаунтов FunPay — переключение в один клик.');
  if (!window.api) {
    w.append(el(`<div class="note">${icon('info', 18)}<div>Это демо-режим. Аккаунты добавляются в приложении.</div></div>`));
    return;
  }
  const g = el('<div class="set-group"></div>');
  const render = async () => {
    const { list, active } = await window.api.acc.list();
    g.innerHTML = '';
    for (const a of list) {
      const r = el(`<div class="set-row acc-row">${avatar(a.avatar, a.username, 42)}<div class="lbl"><b>${esc(a.username)}</b><span>ID ${esc(a.userId)}${a.id === active && !S.demo ? ' · сейчас' : ''}</span></div></div>`);
      if (a.id !== active || S.demo) {
        const b = el(`<button class="btn sm">Переключиться</button>`);
        b.onclick = () => bus.emit('switch-account', a.id);
        r.append(b);
      } else r.append(el(`<span class="pill ok"><span class="dotc"></span>Активен</span>`));
      const k = el(`<button class="ibtn" data-tip="Скопировать golden_key">${icon('key', 16)}</button>`);
      k.onclick = async () => {
        await navigator.clipboard.writeText(await window.api.acc.key(a.id));
        ok('golden_key скопирован', 'Никому его не отправляй');
      };
      const d = el(`<button class="ibtn" data-tip="Удалить из программы">${icon('logout', 16)}</button>`);
      d.onclick = async () => {
        if (!(await confirmBox('Выйти из аккаунта?', `${a.username} удалится из Lumen. На самом FunPay ничего не изменится.`, { yes: 'Выйти', danger: true }))) return;
        await window.api.acc.remove(a.id);
        if (a.id === active) bus.emit('logout');
        else render();
      };
      r.append(k, d);
      g.append(r);
    }
  };
  await render();
  const add = el(`<button class="btn pri">${icon('plus', 16)}Добавить аккаунт</button>`);
  add.onclick = () => bus.emit('add-account');
  w.append(g, add);
}

async function sys(w) {
  head(w, 'Система', 'Запуск, трей и опрос FunPay.');
  const auto = window.api ? await window.api.app.autostart().catch(() => false) : false;
  const iv = el(`<div class="seg">${[2, 3, 5, 8].map((v) => `<button data-v="${v}">${v} с</button>`).join('')}</div>`);
  seg(iv, String(S.settings.pollInterval), (v) => set((s) => (s.pollInterval = +v)));
  w.append(
    group(
      row('Запускать вместе с Windows', 'Сразу в трей, сообщения приходят в фоне', sw(auto, (v) => window.api?.app.autostart(v))),
      row('Крестик сворачивает в трей', 'Чтобы закрыть совсем — правый клик по значку в трее', sw(S.settings.tray, (v) => set((s) => (s.tray = v)))),
      row('Запускать свёрнутым', '', sw(S.settings.startMinimized, (v) => set((s) => (s.startMinimized = v)))),
      row('Enter — отправить', 'Иначе Ctrl+Enter, а Enter — новая строка', sw(S.settings.sendOnEnter, (v) => set((s) => (s.sendOnEnter = v)))),
      row('Как часто проверять сообщения', 'Чаще — быстрее, но больше запросов к FunPay', iv)
    )
  );
  const reset = el(`<button class="btn danger sm">Сбросить</button>`);
  reset.onclick = async () => {
    if (!(await confirmBox('Сбросить настройки?', 'Шаблоны и аккаунты останутся.', { yes: 'Сбросить', danger: true }))) return;
    S.settings = structuredClone(DEFAULT_SETTINGS);
    saveSettings();
    applyLook();
    show('sys');
  };
  w.append(group(row('Сбросить настройки', 'Вернуть всё как было', reset)));
}

async function about(w) {
  const info = window.api ? await window.api.app.info().catch(() => ({})) : { version: 'демо' };
  w.append(
    el(`<div class="empty" style="padding:30px 0 10px"><div class="login-logo" style="width:72px;height:72px;border-radius:18px;margin:0 0 6px"><img src="../assets/icon.png" alt=""></div><h3 style="font-size:22px">Lumen <span class="dim" style="font-weight:500;font-size:14px">${esc(info.version || '')}</span></h3><p>Красивый десктопный клиент FunPay. Golden Key и куки лежат только на этом компьютере.</p></div>`),
    group(
      ...[
        ['Ctrl K', 'Поиск чатов, заказов и команд'],
        ['Ctrl 1…6', 'Чаты · Сделки · Финансы · Лоты · Автоматика · Настройки'],
        ['Alt 1…9', 'Вставить шаблон'],
        ['/', 'Поиск шаблона в поле ввода'],
        ['Ctrl V', 'Вставить картинку из буфера'],
        ['Esc', 'Закрыть окно / отменить ответ'],
      ].map(([k, d]) => row(d, '', el(`<span class="kbd" style="margin:0">${k}</span>`)))
    )
  );
  if (window.api?.upd) {
    const stEl = el('<span></span>');
    const btn = el(`<button class="btn sm">${icon('refresh', 14)}Проверить</button>`);
    const act = el(`<button class="btn pri sm hidden"></button>`);
    const paint = (st) => {
      const t = {
        off: 'Выключены: эта сборка сделана не через GitHub Releases',
        dev: 'В режиме разработки не проверяются',
        checking: 'Проверяю…',
        none: 'У тебя последняя версия',
        downloading: `Скачиваю ${st.latest || ''}… ${st.percent || 0}%`,
        available: `Есть версия ${st.latest}`,
        ready: `Версия ${st.latest} скачана — осталось перезапустить`,
        manual: `Вышла версия ${st.latest}`,
        error: `Не получилось проверить: ${st.error || ''}`,
        idle: 'Проверю через несколько секунд после запуска',
      }[st.state] || '';
      stEl.textContent = t;
      act.classList.toggle('hidden', !['ready', 'manual', 'available'].includes(st.state));
      act.textContent = st.state === 'ready' ? 'Перезапустить' : 'Скачать';
    };
    btn.onclick = () => busy(btn, window.api.upd.check().then(paint));
    act.onclick = () => (S.update?.state === 'ready' ? window.api.upd.install() : window.api.upd.download());
    const ctl = el('<div class="row"></div>');
    ctl.append(act, btn);
    const r1 = row('Обновления', '', ctl);
    r1.querySelector('.lbl span')?.remove();
    r1.querySelector('.lbl').append(stEl);
    stEl.style.cssText = 'font-size:12.5px;color:var(--text-3);display:block';
    const rel = el(`<button class="btn sm ghost">${icon('external', 14)}Все версии</button>`);
    rel.onclick = () => window.api.upd.releases();
    w.append(
      group(
        r1,
        row('Скачивать сами', 'Установленная версия обновится тихо, при следующем запуске', sw(S.settings.autoUpdate !== false, (v) => set((s) => (s.autoUpdate = v)))),
        row('Список изменений', '', rel)
      )
    );
    window.api.upd.state().then(paint);
    const off = bus.on('update', paint);
    const obs = new MutationObserver(() => !document.body.contains(stEl) && (off(), obs.disconnect()));
    obs.observe(document.body, { childList: true, subtree: true });
  }
  if (info.dataDir) w.append(el(`<div class="dim" style="font-size:12px;margin-top:8px">Данные: ${esc(info.dataDir)}</div>`));
}

export const _unused = { toast, err, busy };
