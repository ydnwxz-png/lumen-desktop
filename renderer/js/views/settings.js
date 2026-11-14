// © 2026 Lumen. Все права защищены. Копирование, изменение и распространение этого кода запрещены без разрешения автора (см. LICENSE).
// Настройки: вид, ник, уведомления, шаблоны, автоответы, ИИ, аккаунты, система.
import { $, esc, el, avatar, copyText } from '../core/util.js';
import { icon , logoSvg } from '../core/icons.js';
import { S, bus, saveSettings, saveTemplates, DEFAULT_SETTINGS } from '../core/state.js';
import { seg, switchEl, confirmBox, promptBox, modal, ok, err, toast, busy } from '../ui/kit.js';
import { themePreview, applyTheme, currentTheme, cleanTheme, myThemes, saveMyTheme, deleteMyTheme, downloadTheme, setBackground } from '../features/themes.js';
import { NICK_STYLES, nickHtml, myNick } from '../features/nicks.js';
import { fxHas } from '../features/fx.js';
import { VARS } from '../features/templates.js';
import { sound, notify, SOUNDS } from '../features/notify.js';
import { applyLook } from '../ui/look.js';
import { dndTick, dndOn, dndOff } from '../features/later.js';
import { syncDiscord } from '../features/discord.js';
import { syncClub } from '../features/club.js';

const SECTIONS = [
  ['look', 'Внешний вид', 'palette'],
  ['ui', 'Интерфейс', 'layers'],
  ['nick', 'Ник Lumen FX', 'sparkles'],
  ['chat', 'Чаты и шаблоны', 'chat'],
  ['notify', 'Уведомления', 'bell'],
  ['ai', 'ИИ-помощник', 'wand'],
  ['acc', 'Аккаунты', 'users'],
  ['backup', 'Бэкап и перенос', 'archive'],
  ['sys', 'Система', 'monitor'],
  ['about', 'О программе', 'info'],
];
const ACCENTS = { lumen: ['#c6f432', '#5ef0c8'], helios: ['#f2b8e4', '#b55fa8'], crimson: ['#ff6a4a', '#b8201b'], violet: ['#a78bfa', '#6366f1'], ocean: ['#22d3ee', '#3b82f6'], mint: ['#34d399', '#14b8a6'], sunset: ['#fb923c', '#ec4899'], rose: ['#fb7185', '#e11d48'], gold: ['#fcd34d', '#f59e0b'], lime: ['#bef264', '#22c55e'], mono: ['#f4f4f5', '#71717a'] };
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
  if (sec === 'tpl') sec = 'chat'; // старая ссылка на «Шаблоны»
  cur = sec;
  root.querySelectorAll('[data-s]').forEach((b) => b.classList.toggle('on', b.dataset.s === sec));
  page.innerHTML = '';
  page.scrollTop = 0;
  const wrap = el('<div class="stagger"></div>');
  page.append(wrap);
  ({ look, ui, backup: backupSec, nick, chat, notify: notif, ai, acc, sys, about })[sec](wrap);
}

function head(w, t, sub) {
  w.append(el(`<h1>${t}</h1>`), el(`<div class="sub">${sub}</div>`));
}

// ---------------------------------------------------------------- разделы

// ---------------------------------------------------------------- Внешний вид
const PRESETS = [
  ['Lumen', 'зелёный', { theme: 'dark', accent: 'lumen', tint: '', bg: 'aurora' }],
  ['Розовая', 'розовый на чёрном', { theme: 'dark', accent: 'helios', tint: '', bg: 'aurora' }],
  ['Тёмно-красная', 'красный на чёрном', { theme: 'dark', accent: 'crimson', tint: '', bg: 'aurora' }],
  ['Фиолетовая', 'фиолетовый', { theme: 'dark', accent: 'violet', tint: '', bg: 'aurora' }],
  ['Океан', 'голубой', { theme: 'dark', accent: 'ocean', tint: '', bg: 'aurora' }],
  ['Светлая', 'для дня', { theme: 'light', accent: 'lumen', tint: '', bg: 'aurora' }],
];
const DETAIL_DEF = { glow: 100, radius: 26, glass: 50, font: 'inter', fontSize: 14, bgDim: 55, bgBlur: 0, accentLevel: 100, textColor: '' };

function look(w) {
  head(w, 'Внешний вид', 'Готовые темы и свои темы. Всё меняется сразу.');
  const st = S.settings;
  const presetTheme = ([name, , l]) => ({ lumenTheme: 1, name, look: { ...DETAIL_DEF, ...l } });
  const isCur = (l) => st.accent === l.accent && (st.tint || '') === (l.tint || '') && st.theme === l.theme && st.bg !== 'custom';

  // темы: готовые + мои
  const themes = el(`<div class="th-grid">${PRESETS.map((p, i) => `<button class="th-card ${isCur(p[2]) ? 'on' : ''}" data-pre="${i}">${themePreview(presetTheme(p))}<b>${p[0]}</b><small>${p[1]}</small></button>`).join('')}</div>`);
  themes.onclick = async (e) => {
    const b = e.target.closest('[data-pre]');
    if (!b) return;
    await applyTheme(presetTheme(PRESETS[+b.dataset.pre]));
    show('look');
  };
  const mine = el(`<div class="th-grid" data-mine><div class="dim" style="font-size:13px">Загружаю…</div></div>`);
  const fileIn = el(`<input type="file" accept=".lumen-theme,.json" hidden>`);
  const actions = el(`<div class="row" style="gap:8px;flex-wrap:wrap">
    <button class="btn sm pri" data-save>${icon('plus', 14)}Сохранить текущий вид как тему</button>
    <button class="btn sm" data-load>${icon('down', 14)}Загрузить из файла</button></div>`);
  actions.append(fileIn);
  const drawMine = async () => {
    const l = await myThemes();
    mine.innerHTML = l.length
      ? l.map((t, i) => `<div class="th-card" data-my="${i}">${themePreview(t)}<b class="ell">${esc(t.name)}</b><span class="th-acts"><button class="ibtn sm" data-file="${i}" data-tip="Скачать файлом">${icon('down', 14)}</button><button class="ibtn sm" data-del="${i}" data-tip="Удалить">${icon('trash', 14)}</button></span></div>`).join('')
      : `<div class="dim" style="font-size:13px">Своих тем пока нет. Настрой цвета и фон ниже — и нажми «Сохранить текущий вид как тему».</div>`;
    mine.onclick = async (e) => {
      const f = e.target.closest('[data-file]');
      const d = e.target.closest('[data-del]');
      const c = e.target.closest('[data-my]');
      if (f) return downloadTheme(l[+f.dataset.file]);
      if (d) return (await deleteMyTheme(l[+d.dataset.del].name), drawMine());
      if (c) (await applyTheme(l[+c.dataset.my]), show('look'));
    };
  };
  drawMine();
  actions.querySelector('[data-save]').onclick = async () => {
    const name = await promptBox('Название темы', { value: st.themeName && !PRESETS.some((p) => p[0] === st.themeName) ? st.themeName : '', placeholder: 'Например: Ночной розовый', yes: 'Сохранить' });
    if (!name?.trim()) return;
    const t = await currentTheme(name.trim());
    await saveMyTheme(t);
    ok('Тема сохранена', t.bgImage || st.bg !== 'custom' ? '' : 'Видео-фон в тему не попадает — только картинка до 3 МБ');
    drawMine();
  };
  actions.querySelector('[data-load]').onclick = () => fileIn.click();
  fileIn.onchange = async () => {
    const f = fileIn.files[0];
    fileIn.value = '';
    if (!f) return;
    try {
      if (f.size > 6 * 1024 * 1024) throw new Error('Файл слишком большой');
      const t = cleanTheme(JSON.parse(await f.text()));
      await saveMyTheme(t);
      await applyTheme(t);
      ok('Тема поставлена', t.name);
      show('look');
    } catch (e) {
      err('Не получилось', e.message.includes('JSON') ? 'Это не тема Lumen' : e);
    }
  };


  // цвет
  const cur = st.customAccent || { a1: '#c6f432', a2: '#5ef0c8' };
  const sws = el(`<div class="swatches">${Object.entries(ACCENTS).map(([k, [a, b]]) => `<button class="swatch ${st.accent === k ? 'on' : ''}" data-a="${k}" style="background:linear-gradient(135deg,${a},${b})"></button>`).join('')}<button class="swatch custom ${st.accent === 'custom' ? 'on' : ''}" data-a="custom" data-tip="Свой цвет" style="--c1:${cur.a1};--c2:${cur.a2}">${icon('plus', 14)}</button></div>`);
  const pick = (v) => el(`<input type="color" class="cpick" value="${v}">`);
  const c1 = pick(cur.a1);
  const c2 = pick(cur.a2);
  const customRow = row('Свой цвет', 'Два цвета — из них получится переход', el('<div class="row" style="gap:10px"></div>'));
  customRow.querySelector('.row').append(c1, c2);
  customRow.hidden = st.accent !== 'custom';
  const setCustom = () => {
    set((s) => ((s.accent = 'custom'), (s.customAccent = { a1: c1.value, a2: c2.value })));
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

  // фон
  const bgIn = el(`<input type="file" accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm" hidden>`);
  const bgSeg = segEl([['aurora', 'Свечение'], ['solid', 'Ровный'], ['oled', 'Чёрный'], ['custom', 'Своя картинка']], st.bg || 'aurora', async (v) => {
    if (v === 'custom') {
      const has = window.api?.app?.bgGet ? await window.api.app.bgGet().catch(() => null) : null;
      if (!has) return bgIn.click();
    }
    set((s) => (s.bg = v));
    show('look');
  });
  bgIn.onchange = async () => {
    const f = bgIn.files[0];
    bgIn.value = '';
    if (!f) return show('look');
    try {
      await setBackground(new Uint8Array(await f.arrayBuffer()), f.type);
      set((s) => (s.bg = 'custom'));
      ok('Фон поставлен', f.type.startsWith('video/') ? 'Видео крутится по кругу без звука' : '');
    } catch (e) {
      err('Не получилось', e);
    }
    show('look');
  };
  const bgBox = el('<div class="row" style="gap:8px;flex-wrap:wrap;justify-content:flex-end"></div>');
  bgBox.append(bgSeg, bgIn);
  const range = (k, min, max, step = 1) => {
    const r = el(`<input type="range" class="range" min="${min}" max="${max}" step="${step}" value="${st[k] ?? DETAIL_DEF[k]}">`);
    r.oninput = () => set((s) => (s[k] = +r.value));
    return r;
  };
  const custom = st.bg === 'custom';
  const bgRows = custom
    ? [
        row('Картинка или видео', 'PNG, JPG, GIF, WEBP или MP4/WEBM до 60 МБ', (() => {
          const b = el(`<div class="row" style="gap:8px"><button class="btn sm" data-ch>${icon('image', 14)}Сменить</button><button class="btn sm ghost" data-rm>Убрать</button></div>`);
          b.querySelector('[data-ch]').onclick = () => bgIn.click();
          b.querySelector('[data-rm]').onclick = async () => {
            await window.api?.app?.bgClear?.();
            set((s) => ((s.bg = 'aurora'), (s.bgVer = Date.now())));
            show('look');
          };
          return b;
        })()),
        row('Затемнение', 'Чтобы текст читался поверх картинки', range('bgDim', 0, 90)),
        row('Размытие', '', range('bgBlur', 0, 30)),
      ]
    : [];

  // подробно
  const fontSeg = segEl([['inter', 'Inter'], ['system', 'Системный'], ['rounded', 'Округлый'], ['mono', 'Моно']], st.font || 'inter', (v) => set((s) => (s.font = v)));
  const tint = pick(st.tint || '#6366f1');
  const tintOff = el(`<button class="btn sm">Без оттенка</button>`);
  const tintBox = el('<div class="row" style="gap:10px"></div>');
  tintBox.append(tintOff, tint);
  tintOff.hidden = !st.tint;
  tint.oninput = () => (set((s) => (s.tint = tint.value)), (tintOff.hidden = false));
  tintOff.onclick = () => (set((s) => (s.tint = '')), (tintOff.hidden = true));
  const TXT = [['', 'Белый'], ['#f3ead8', 'Тёплый'], ['#dfe9f5', 'Холодный']];
  const tcur = st.textColor || '';
  const tpick = pick(tcur && !TXT.some((x) => x[0] === tcur) ? tcur : '#e8e8ef');
  const txtBox = el(`<div class="row" style="gap:8px;flex-wrap:wrap;justify-content:flex-end"></div>`);
  const txtSeg = segEl([...TXT, ['own', 'Свой']], TXT.some((x) => x[0] === tcur) ? tcur : 'own', (v) => (v === 'own' ? tpick.click() : set((s) => (s.textColor = v))));
  tpick.oninput = () => set((s) => (s.textColor = tpick.value));
  txtBox.append(txtSeg, tpick);
  const details = el(`<details class="set-details"><summary><span class="sd-ic">${icon('settings', 16)}</span><span class="grow"><b>Настроить подробно</b><small>Шрифт, цвет текста, яркость, скругления, прозрачность, свечение, оттенок</small></span><span class="sd-btn">Открыть ${icon('chevR', 14)}</span></summary></details>`);
  details.append(
    group(
      row('Шрифт', '', fontSeg),
      row('Размер текста', '', range('fontSize', 12, 16)),
      row('Цвет текста', 'Основной цвет надписей', txtBox),
      row('Яркость цвета', 'Если кнопки и переключатели режут глаза — сделай спокойнее', range('accentLevel', 55, 100)),
      row('Скругление углов', 'Меньше — строже, больше — мягче', range('radius', 6, 34)),
      row('Прозрачность карточек', 'Насколько карточки видны поверх фона', range('glass', 0, 100)),
      row('Яркость свечения', 'Цветной свет по углам окна', range('glow', 0, 150)),
      row('Оттенок фона', 'Подкрасить тёмные панели в свой цвет', tintBox)
    )
  );
  const reset = el(`<button class="btn sm">${icon('refresh', 14)}Сбросить вид</button>`);
  reset.onclick = () => (set((s) => Object.assign(s, { theme: 'dark', accent: 'lumen', bg: 'aurora', tint: '', customAccent: null, themeName: '' }, DETAIL_DEF)), show('look'));

  w.append(
    el(`<div class="sec-title">Готовые темы</div>`),
    themes,
    el(`<div class="sec-title">Мои темы</div>`),
    mine,
    actions,
    el(`<div class="sec-title">Цвета и фон</div>`),
    group(
      row('Тема', 'Тёмная, светлая или как в Windows', segEl([['dark', 'Тёмная'], ['light', 'Светлая'], ['system', 'Как в системе']], st.theme, (v) => set((s) => (s.theme = v)))),
      row('Цвет', 'Кнопки, свои сообщения, логотип. «+» — свой цвет', sws),
      customRow,
      row('Фон окна', 'Свечение — цветной свет по углам · Ровный — без света · Чёрный — полностью чёрный, для OLED-экранов · Своя картинка — фото, GIF или видео', bgBox),
      ...bgRows,
      row('Анимации', 'Плавные переходы, появление сообщений, ники', sw(st.animations, (v) => set((s) => (s.animations = v))))
    ),
    details,
    group(row('Вернуть как было', 'Стандартный тёмный вид с зелёным цветом Lumen', reset))
  );
}

/** Галерея тем из бота. */
// ---------------------------------------------------------------- Интерфейс
function ui(w) {
  head(w, 'Интерфейс', 'Размер окна и где стоят кнопки разделов.');
  const st = S.settings;
  const zoom = segEl([['auto', 'Авто'], ['0.9', '90%'], ['1', '100%'], ['1.1', '110%'], ['1.25', '125%'], ['1.4', '140%']], String(st.zoom || 'auto'), (v) => set((s) => (s.zoom = v === 'auto' ? 'auto' : +v)));
  const contrast = segEl([['normal', 'Обычная'], ['high', 'Повышенная']], st.contrast === 'normal' ? 'normal' : 'high', (v) => set((s) => (s.contrast = v)));
  const nv = st.nav || { pos: 'left', hide: [] };
  const NAVS = [['chats', 'Чаты'], ['deals', 'Сделки'], ['stats', 'Статистика'], ['finance', 'Финансы'], ['lots', 'Лоты'], ['auto', 'Автоматика'], ['lchat', 'Общий чат']];
  const hideBox = el(`<div class="nav-hide">${NAVS.map(([k, n]) => `<button class="folder ${(nv.hide || []).includes(k) ? '' : 'on'}" data-k="${k}">${n}</button>`).join('')}</div>`);
  hideBox.onclick = (e) => {
    const b = e.target.closest('[data-k]');
    if (!b) return;
    const h = new Set(S.settings.nav?.hide || []);
    h.has(b.dataset.k) ? h.delete(b.dataset.k) : h.add(b.dataset.k);
    b.classList.toggle('on', !h.has(b.dataset.k));
    set((s) => (s.nav = { ...(s.nav || {}), hide: [...h] }));
  };
  w.append(
    group(
      row('Масштаб окна', 'Авто — на большом мониторе (2K, 27") чуть крупнее. Если мелко — поставь 110–125%', zoom),
      row('Чёткость текста', 'Повышенная — серые подписи светлее и чуть жирнее, лучше видно на ярком мониторе', contrast),
      row('Кнопки разделов', 'Слева — колонкой, сверху — в верхней полосе, снизу — плавающей панелью', segEl([['left', 'Слева'], ['top', 'Сверху'], ['bottom', 'Снизу']], nv.pos || 'left', (v) => set((s) => (s.nav = { ...(s.nav || {}), pos: v })))),
      row('Какие разделы показывать', 'Нажми, чтобы скрыть или вернуть. Главная и Настройки — всегда', hideBox)
    )
  );
}

// ---------------------------------------------------------------- Бэкап и перенос
const BK_PARTS = [
  ['look', 'Внешний вид', 'цвета, тема, свой фон, масштаб, панель', true],
  ['settings', 'Настройки', 'уведомления, чаты, ИИ, система, Discord', true],
  ['templates', 'Шаблоны', 'быстрые ответы', true],
  ['chats', 'Метки чатов', 'закрепы, заметки, архив, страницы плагинов', true],
  ['automation', 'Автоматика', 'автовыдача и товары, автоответы, приветствие', true],
  ['plugins', 'Плагины', 'файлы плагинов и их настройки', true],
  ['accounts', 'Аккаунты FunPay', 'golden_key — с ним можно войти в аккаунт!', false],
];
function backupSec(w) {
  head(w, 'Бэкап и перенос', 'Сохрани всё в один файл — и загрузи на новом компьютере или после переустановки.');
  if (!window.api?.app?.backupMake) {
    w.append(el(`<div class="empty" style="padding:40px"><p>В демо бэкап недоступен.</p></div>`));
    return;
  }
  const sel = new Set(BK_PARTS.filter((p) => p[3]).map((p) => p[0]));
  const list = el(`<div class="bk-list">${BK_PARTS.map(([k, n, d, on]) => `<label class="bk-it ${k === 'accounts' ? 'warn' : ''}"><input type="checkbox" data-k="${k}" ${on ? 'checked' : ''}><span><b>${n}</b><small>${d}</small></span></label>`).join('')}</div>`);
  list.onchange = (e) => {
    const c = e.target.closest('[data-k]');
    if (c) c.checked ? sel.add(c.dataset.k) : sel.delete(c.dataset.k);
  };
  const go = el(`<button class="btn pri">${icon('down', 15)}Сохранить в файл</button>`);
  go.onclick = async () => {
    if (!sel.size) return err('Ничего не выбрано', 'Отметь, что сохранить');
    if (sel.has('accounts') && !(await confirmBox('Сохранить аккаунты?', 'В файле будет golden_key — с ним любой войдёт в твой аккаунт FunPay. Никому не отправляй этот файл и не публикуй.', { yes: 'Да, сохранить', danger: true }))) return;
    try {
      const r = await busy(go, window.api.app.backupMake([...sel]));
      if (r) ok('Бэкап сохранён', `${r.file} · ${(r.size / 1024 / 1024).toFixed(1)} МБ`);
    } catch (e) {
      err('Не сохранилось', e);
    }
  };
  const load = el(`<button class="btn">${icon('up', 15)}Загрузить из файла</button>`);
  load.onclick = async () => {
    let r;
    try {
      r = await window.api.app.backupOpen();
    } catch (e) {
      return err('Не открылось', e);
    }
    if (!r) return;
    const keys = BK_PARTS.filter(([k]) => r.info[k]);
    const m = modal(`<h3>Что загрузить?</h3><p class="dim" style="margin:4px 0 12px">Бэкап от ${esc(new Date(r.made).toLocaleString('ru-RU'))}${r.app ? ` · Lumen ${esc(r.app)}` : ''}. То, что отметишь, заменит текущее.</p>
      <div class="bk-list">${keys.map(([k, n]) => `<label class="bk-it"><input type="checkbox" data-k="${k}" checked><span><b>${n}</b><small>${esc(r.info[k])}</small></span></label>`).join('')}</div>
      ${r.info.plugins ? '<p class="dim" style="font-size:12px;margin-top:10px">Плагины — это код. Загружай их, только если доверяешь этому файлу.</p>' : ''}
      <div class="modal-acts"><button class="btn" data-close>Отмена</button><button class="btn pri" data-ok>Загрузить</button></div>`);
    m.el.querySelector('[data-ok]').onclick = async (e) => {
      const parts = [...m.el.querySelectorAll('[data-k]:checked')].map((x) => x.dataset.k);
      if (!parts.length) return;
      try {
        const res = await busy(e.currentTarget, window.api.app.backupApply(r.token, parts));
        m.close();
        toast('Загружено', `${res.done.join(', ')}. Lumen перезапускает окно…`, { kind: 'ok', ms: 2500 });
        setTimeout(() => location.reload(), 1600);
      } catch (x) {
        err('Не загрузилось', x);
      }
    };
  };
  const acts = el('<div class="row" style="gap:10px;margin-top:14px"></div>');
  acts.append(go, load);
  w.append(el(`<div class="sec-title">Что сохранить</div>`), list, acts);
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
  test.onclick = () => notify({ title: 'darkness21', name: 'darkness21', body: 'Привет! Это тестовое уведомление Lumen ✨', avatar: '', node: null, kind: 'msg', test: true });
  w.append(
    group(
      row('Вид', 'Lumen — красивые карточки, Системные — как у Windows', segEl([['lumen', 'Lumen'], ['system', 'Системные'], ['off', 'Выкл']], n.mode, (v) => set((s) => (s.notify.mode = v)))),
      row('Угол экрана', 'Для уведомлений Lumen', segEl([['tl', '↖'], ['tr', '↗'], ['bl', '↙'], ['br', '↘']], n.corner, (v) => set((s) => (s.notify.corner = v)))),
      row('Показывать текст', 'Иначе просто «Новое сообщение»', sw(n.preview, (v) => set((s) => (s.notify.preview = v)))),
      row('Всплывашка и в «Чатах»', 'В других разделах Lumen всплывашка приходит всегда. Включи — будет и когда сидишь в «Чатах»', sw(n.whenFocused, (v) => set((s) => (s.notify.whenFocused = v)))),
      row('Новые заказы', 'Отдельное уведомление со своим звуком', sw(n.orders, (v) => set((s) => (s.notify.orders = v)))),
      row('Со всех аккаунтов', 'Сообщения и заказы на других добавленных аккаунтах — даже когда сидишь на одном', sw(n.allAccounts !== false, (v) => set((s) => (s.notify.allAccounts = v)))),
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

// Чаты: как отправлять, как часто проверять + шаблоны ответов
function chat(w) {
  head(w, 'Чаты и шаблоны', 'Отправка сообщений, проверка новых и готовые ответы.');
  const iv = el(`<div class="seg">${[2, 3, 5, 8].map((v) => `<button data-v="${v}">${v} с</button>`).join('')}</div>`);
  seg(iv, String(S.settings.pollInterval), (v) => set((s) => (s.pollInterval = +v)));
  w.append(
    group(
      row('Enter — отправить', 'Иначе Ctrl+Enter, а Enter — новая строка', sw(S.settings.sendOnEnter, (v) => set((s) => (s.sendOnEnter = v)))),
      row('Как часто проверять сообщения', 'Чаще — быстрее, но больше запросов к FunPay', iv)
    )
  );
  w.append(el(`<div class="sec-title">Шаблоны</div>`), el(`<div class="dim" style="font-size:12.5px;margin:-4px 2px 10px">Кнопки над полем ввода. Alt+1…9 — быстрая вставка, «/» в начале сообщения — поиск.</div>`));
  tpl(w, true);
}

function tpl(w, inChat = false) {
  if (!inChat) head(w, 'Шаблоны', 'Кнопки над полем ввода. Alt+1…9 — быстрая вставка, «/» в начале сообщения — поиск.');
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
  head(w, 'Система', 'Запуск, трей, конфиденциальность, игры и Discord.');
  const auto = window.api ? await window.api.app.autostart().catch(() => false) : false;
  w.append(
    group(
      row('Запускать вместе с Windows', 'Сразу в трей, сообщения приходят в фоне', sw(auto, (v) => window.api?.app.autostart(v))),
      row('Крестик сворачивает в трей', 'Чтобы закрыть совсем — правый клик по значку в трее', sw(S.settings.tray, (v) => set((s) => (s.tray = v)))),
      row('Запускать свёрнутым', '', sw(S.settings.startMinimized, (v) => set((s) => (s.startMinimized = v))))
    )
  );
  // конфиденциальность
  const hd = () => (S.settings.hide ||= { on: false, nick: true, balance: true, buyers: true, orders: true, lots: false });
  const HID = [['nick', 'Мой ник'], ['balance', 'Баланс и суммы'], ['buyers', 'Покупатели и аватарки'], ['orders', 'Номера заказов'], ['lots', 'Названия лотов']];
  const hideBox = el(`<div class="nav-hide">${HID.map(([k, n]) => `<button class="folder ${hd()[k] ? 'on' : ''}" data-k="${k}">${n}</button>`).join('')}</div>`);
  hideBox.onclick = (e) => {
    const b = e.target.closest('[data-k]');
    if (!b) return;
    const v = !hd()[b.dataset.k];
    b.classList.toggle('on', v);
    set((s) => (s.hide = { ...hd(), [b.dataset.k]: v }));
  };
  w.append(
    el(`<div class="sec-title">Конфиденциальность</div>`),
    group(
      row('Скрыть данные (для стрима и скринов)', 'Размывает выбранное ниже. Быстро — Ctrl+Shift+H или в меню аккаунта', sw(hd().on, (v) => set((s) => (s.hide = { ...hd(), on: v })))),
      row('Что размывать', 'Нажми, чтобы включить или выключить', hideBox),
      row('Значок Lumen у моего ника', 'Другие пользователи Lumen увидят, что ты тоже в Lumen. Отправляется только ID профиля FunPay', sw(S.settings.clubShow === true, (v) => (set((s) => (s.clubShow = v)), syncClub(true))))
    )
  );
  // Discord
  const dc = () => (S.settings.discord ||= { on: false, nick: false });
  const dcOk = window.api?.app?.discordAvailable ? await window.api.app.discordAvailable().catch(() => false) : false;
  w.append(
    el(`<div class="sec-title">Discord</div>`),
    group(
      row('Активность в Discord', dcOk ? 'В профиле Discord будет «Играет в Lumen» с кнопкой «Скачать». Discord должен быть запущен на этом компьютере' : 'Скоро — функция ещё настраивается',
        dcOk ? sw(dc().on, (v) => (set((s) => (dc().on = v)), syncDiscord())) : el('<span class="dim">—</span>')),
      ...(dcOk ? [row('Показывать мой ник FunPay', 'Иначе просто «Lumen Desktop — помощник продавца»', sw(dc().nick, (v) => (set((s) => (dc().nick = v)), syncDiscord())))] : [])
    )
  );
  w.append(
    el(`<div class="sec-title">Игры</div>`),
    group(
      row('Не нагружать видеокарту (для игр)', 'Если в играх падает FPS — включи: Lumen будет рисоваться процессором, вся видеокарта остаётся игре. Сработает после перезапуска Lumen',
        sw(S.settings.noGpu, (v) => {
          set((s) => (s.noGpu = v));
          toast('Перезапусти Lumen', 'Настройка видеокарты применится после перезапуска', { kind: 'info', ms: 4000 });
        }))
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
    el(`<div class="empty" style="padding:30px 0 10px"><div class="login-logo" style="width:72px;height:72px;border-radius:18px;margin:0 0 6px">${logoSvg(72)}</div><h3 style="font-size:22px">Lumen <span class="dim" style="font-weight:500;font-size:14px">${esc(info.version || '')}</span></h3><p>Красивый десктопный клиент FunPay. Golden Key и куки лежат только на этом компьютере.</p></div>`),
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
