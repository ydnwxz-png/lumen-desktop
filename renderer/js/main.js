// © 2026 Lumen. Все права защищены. Копирование, изменение и распространение этого кода запрещены без разрешения автора (см. LICENSE).
// Запуск, навигация, аккаунты, горячие клавиши.
import { $, $$, el, esc, avatar } from './core/util.js';
import { icon, logoSvg } from './core/icons.js';
import { S, bus, loadSettings, loadMeta, saveSettings } from './core/state.js';
import { applyLook } from './ui/look.js';
import { initTips, menu, err, toast, modal } from './ui/kit.js';
import { syncDiscord } from './features/discord.js';
import { palette } from './ui/palette.js';
import { winControls } from './ui/winctl.js';
import { closeWebPane } from './ui/webpane.js';
import { initFx } from './features/fx.js';
import { createClient } from './fp/client.js';
import { createDemo } from './fp/demo.js';
import { start as startPoll, stop as stopPoll, pollNow, CS } from './features/poller.js';
import { resetRaise } from './features/raise.js';
import { loadLater, dndTick, dndOn, dndOff } from './features/later.js';
import { myNick, nickHtml } from './features/nicks.js';
import { mountChats, chatKeys } from './views/chats.js';
import { mountHome, showHome } from './views/home.js';
import { mountStatsView, showStatsView } from './views/statsv.js';
import { openSupportPicker } from './features/support.js';
import { initBell } from './features/bell.js';
import { initClub } from './features/club.js';
import { mountDeals, showDeals } from './views/deals.js';
import { mountFinance, showFinance } from './views/finance.js';
import { mountLots, showLots } from './views/lots.js';
import { initWatch } from './features/watch.js';
import { mountAutomation, showAutomation } from './views/automation.js';
import { mountPluginPages, showPluginPage, syncPluginRail } from './features/plugpages.js';
import { mountSettings, showSettings } from './views/settings.js';
import { mountLchat, showLchat, hideLchat } from './views/lchat.js';
import { showLogin } from './views/login.js';
import { openProfile } from './views/profile.js';

const NAV = [
  ['home', 'Главная', 'home'],
  ['chats', 'Чаты', 'chat'],
  ['deals', 'Сделки', 'bag'],
  ['stats', 'Статистика', 'trend'],
  ['finance', 'Финансы', 'wallet'],
  ['lots', 'Лоты', 'box'],
  ['auto', 'Автоматика и плагины', 'bot'],
  ['lchat', 'Общий чат Lumen', 'users'],
];

function shell() {
  const app = el(`<div id="app" class="lx">
    <div class="mainc">
      <header class="titlebar topbar">
        <button class="tb-search" data-pal>${icon('search', 15)}<span class="grow">Поиск чатов, заказов, команд</span><span class="kbd">Ctrl K</span></button>
        <span class="tb-drag"></span>
        <button class="upd-chip hidden" data-upd></button>
        <button class="dnd-chip hidden" data-dnd data-tip="«Не беспокоить» включено. Нажми, чтобы выключить">${icon('moon', 14)}<span>Не беспокоить</span></button>
        <span class="demo-chip hidden" data-demo>ДЕМО</span>
        <button class="dnd-chip hidden" data-hidechip data-tip="Данные скрыты (для стрима). Нажми или Ctrl+Shift+H — показать">${icon('eyeOff', 14)}<span>Скрыто</span></button>
        <div class="tb-status load" data-status><span class="dot"></span><span data-st-t>Подключаюсь…</span></div>
        <button class="tb-bell" data-bell data-tip="Уведомления">${icon('bell', 18)}<span class="bdot hidden"></span></button>
        <button class="acc-chip" data-accchip><span data-acc-av></span><span class="acc-t"><b data-me-name></b><small data-me-sub></small></span>${icon('chevR', 15, 'acc-chev')}</button>
        <span data-wctl></span>
      </header>
      <main class="stage">
        <section class="view" id="v-home"></section>
        <section class="view" id="v-chats"></section>
        <section class="view" id="v-deals"></section>
        <section class="view" id="v-stats"></section>
        <section class="view" id="v-finance"></section>
        <section class="view" id="v-lots"></section>
        <section class="view" id="v-plug"></section>
        <section class="view" id="v-auto"></section>
        <section class="view" id="v-lchat"></section>
        <section class="view" id="v-settings"></section>
        <section class="view" id="v-error"></section>
      </main>
    </div>
    <nav class="rail">
      <div class="rail-logo">${logoSvg(40)}</div>
      ${NAV.map(([id, n, ic]) => `<button class="rail-btn" data-nav="${id}" data-tip="${n}">${icon(ic, 21)}${id === 'chats' ? '<span class="badge hidden" data-unread></span>' : ''}</button>`).join('')}
      <span class="rail-plugs" data-plugrail></span>
      <span class="rail-sp"></span>
      <button class="rail-btn" data-browser data-tip="FunPay во встроенном браузере">${icon('globe', 20)}</button>
      <button class="rail-btn" data-nav="settings" data-tip="Настройки">${icon('settings', 20)}</button>
    </nav>
  </div>`);
  app.querySelector('[data-wctl]').replaceWith(winControls());
  document.body.append(app);
  mountHome($('#v-home'));
  mountChats($('#v-chats'));
  mountDeals($('#v-deals'));
  mountStatsView($('#v-stats'));
  mountFinance($('#v-finance'));
  mountLots($('#v-lots'));
  mountPluginPages($('#v-plug'));
  mountAutomation($('#v-auto'));
  mountSettings($('#v-settings'));
  mountLchat($('#v-lchat'));
  $('.rail').onclick = (e) => {
    const n = e.target.closest('[data-nav]');
    if (n) go(n.dataset.nav);
    if (e.target.closest('[data-browser]')) S.backend?.openBrowser('https://funpay.com/');
  };
  $('[data-pal]').onclick = palette;
  $('[data-accchip]').onclick = (e) => accPop(e.currentTarget, true);
  $('[data-hidechip]').onclick = () => toggleHide(false);
  $('[data-dnd]').onclick = () => toggleDnd(false);
  $('[data-upd]').onclick = () => {
    const st = S.update || {};
    if (st.state === 'ready') window.api.upd.install();
    else if (st.state === 'manual' || st.state === 'available') window.api.upd.download();
  };
  addEventListener('resize', moveInd);
  applyNav();
}

/** Панель разделов: слева, сверху или снизу; скрытые разделы. */
function applyNav() {
  const n = S.settings.nav || {};
  const pos = ['top', 'bottom'].includes(n.pos) ? n.pos : 'left';
  document.documentElement.dataset.navpos = pos;
  // сверху — кнопки прямо в верхней полосе (между поиском и уведомлениями), иначе — отдельной панелью
  const rail = $('.rail');
  if (pos === 'top') $('.tb-drag').before(rail);
  else if (rail.parentElement !== $('#app')) $('#app').append(rail);
  const hide = new Set(n.hide || []);
  $$('.rail-btn[data-nav]').forEach((b) => (b.hidden = hide.has(b.dataset.nav) && b.dataset.nav !== 'settings' && b.dataset.nav !== 'home'));
  const z = S.settings.zoom === 'auto' ? 'auto' : Math.min(1.5, Math.max(0.8, +S.settings.zoom || 1));
  window.api?.app.zoom?.(z).catch?.(() => {});
  document.documentElement.dataset.contrast = S.settings.contrast === 'normal' ? 'normal' : 'high';
  // режим «для стрима»: размыть выбранное
  const h = S.settings.hide || {};
  document.documentElement.dataset.hide = h.on ? ['nick', 'balance', 'buyers', 'orders', 'lots'].filter((k) => h[k]).join(' ') : '';
  $('[data-hidechip]')?.classList.toggle('hidden', !h.on);
}

function moveInd() {
  const b = $(`.rail-btn[data-nav="${S.view}"]`);
  const ind = $('.rail-ind');
  if (!b || !ind) return;
  ind.style.transform = `translateY(${b.offsetTop}px)`;
  ind.style.opacity = '1';
}

export function go(view, sub) {
  if (!S.me && view !== 'error') return;
  closeWebPane();
  S.view = view;
  const sec = view.startsWith('plug:') ? 'plug' : view; // страницы плагинов живут в одной секции
  $$('.view').forEach((v) => v.classList.toggle('on', v.id === 'v-' + sec));
  $$('.rail-btn[data-nav]').forEach((b) => b.classList.toggle('on', b.dataset.nav === view));
  moveInd();
  if (view === 'home') showHome();
  if (view === 'deals') showDeals();
  if (view === 'stats') showStatsView();
  if (view === 'finance') showFinance();
  if (view === 'lots') showLots();
  if (view === 'auto') showAutomation();
  if (view === 'settings') showSettings(sub);
  if (view === 'lchat') showLchat();
  else hideLchat();
  if (sec === 'plug') showPluginPage(view.slice(5));
}

function renderMe() {
  const me = S.me;
  $('[data-acc-av]').innerHTML = me ? avatar(me.avatar, me.username, 34) : '';
  $('[data-me-name]').innerHTML = me ? myNick(me.username) : '';
  $('[data-me-sub]').textContent = me ? `@${me.username}${me.balance ? ' · ' + me.balance : ''}` : '';
  $('[data-accchip]').classList.toggle('hidden', !me);
  $('[data-demo]').classList.toggle('hidden', !S.demo);
}

// Аккаунт: кто сейчас, переключение, добавить, профиль, «Не беспокоить», выход
let accOpen = null;
async function accPop(btn, top = false) {
  if (accOpen) return accOpen();
  const me = S.me;
  const dnd = dndTick();
  let list = [];
  let active = '';
  if (window.api) ({ list, active } = await window.api.acc.list());
  const p = el(`<div class="pop2" style="width:330px">
    <h4>Аккаунты FunPay</h4>
    <div class="acc-it on">${avatar(me?.avatar, me?.username, 42)}<div style="min-width:0"><b class="ell">${me ? myNick(me.username) : '—'}</b><span>${S.demo ? 'демо' : 'сейчас открыт'}${me?.balance ? ' · ' + esc(me.balance) : ''}</span></div><span class="r" style="color:var(--a1)">${icon('check', 18)}</span></div>
    ${list.filter((a) => a.id !== active || S.demo).map((a) => `<button class="acc-it" data-acc="${esc(a.id)}">${avatar(a.avatar || '', a.username, 42)}<div style="min-width:0"><b class="ell">${nickHtml(a.username, 'none', '', '', '', a.userId)}</b><span>переключиться</span></div></button>`).join('')}
    ${window.api ? `<button class="acc-add" data-add>${icon('plus', 17)}Добавить аккаунт FunPay</button>` : ''}
    <div class="sepl"></div>
    <button class="row-it" data-prof>${icon('user', 17)}Мой профиль</button>
    <button class="row-it" data-nick>${icon('sparkles', 17)}Стиль ника</button>
    <button class="row-it" data-sup>${icon('alert', 17)}Поддержка FunPay: не подтвердили заказ</button>
    <button class="row-it" data-hidet>${icon(S.settings.hide?.on ? 'eye' : 'eyeOff', 17)}${S.settings.hide?.on ? 'Показать скрытые данные' : 'Скрыть данные (для стрима)'}</button>
    <button class="row-it" data-dndt>${icon(dnd ? 'bell' : 'moon', 17)}${dnd ? 'Выключить «Не беспокоить»' : 'Не беспокоить'}</button>
    <div class="sepl"></div>
    ${window.api ? `<button class="row-it bad" data-quit>${icon('power', 17)}Выйти из программы</button>` : `<button class="row-it bad" data-demoexit>${icon('logout', 17)}Выйти из демо</button>`}
  </div>`);
  document.body.append(p);
  const r = btn.getBoundingClientRect();
  if (top) {
    p.style.left = Math.max(8, r.right - p.offsetWidth) + 'px';
    p.style.top = r.bottom + 10 + 'px';
  } else {
    p.style.left = r.right + 12 + 'px';
    p.style.top = Math.max(8, Math.min(innerHeight - p.offsetHeight - 8, r.bottom - p.offsetHeight + 6)) + 'px';
  }
  const close = () => {
    p.remove();
    accOpen = null;
    removeEventListener('mousedown', out, true);
    removeEventListener('keydown', esc_, true);
  };
  const out = (e) => !p.contains(e.target) && !e.target.closest('[data-accchip]') && close();
  const esc_ = (e) => e.key === 'Escape' && close();
  setTimeout(() => (addEventListener('mousedown', out, true), addEventListener('keydown', esc_, true)));
  accOpen = close;
  p.onclick = (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    close();
    if (t.dataset.acc) startAccount(t.dataset.acc);
    else if (t.hasAttribute('data-add')) addAccount();
    else if (t.hasAttribute('data-prof')) openProfile(S.me.userId);
    else if (t.hasAttribute('data-nick')) go('settings', 'nick');
    else if (t.hasAttribute('data-dndt')) toggleDnd(!dnd);
    else if (t.hasAttribute('data-sup')) openSupportPicker();
    else if (t.hasAttribute('data-hidet')) toggleHide();
    else if (t.hasAttribute('data-quit')) window.api.app.quit();
    else if (t.hasAttribute('data-demoexit')) location.reload();
  };
}

/** Режим «для стрима»: размыть ник, баланс, покупателей, номера заказов. */
function toggleHide(on = !S.settings.hide?.on) {
  S.settings.hide = { ...(S.settings.hide || {}), on };
  saveSettings();
  applyNav();
  toast(on ? 'Данные скрыты' : 'Данные снова видны', on ? 'Ник, баланс, покупатели и заказы размыты. Ctrl+Shift+H — показать' : '', { kind: 'ok', ms: 2200 });
}

function toggleDnd(on) {
  on ? dndOn() : dndOff();
  saveSettings();
  dndTick();
  toast(on ? 'Не беспокоить — включено' : 'Уведомления снова включены', on ? 'Звука и всплывашек не будет' : '', { icon: on ? 'moon' : 'bell', ms: 2500 });
}

// Обновления: значок в шапке + одно уведомление, когда всё готово
let updToasted = '';
function onUpdate(st) {
  S.update = st;
  bus.emit('update', st);
  if (st.state === 'installing') return showInstalling(st.latest);
  const b = $('[data-upd]');
  const show = { ready: `${icon('refresh', 14)}Обновить до ${st.latest}`, manual: `${icon('down', 14)}Вышла версия ${st.latest}`, available: `${icon('down', 14)}Скачать ${st.latest}`, downloading: `${icon('down', 14)}Обновление ${st.percent || 0}%` }[st.state];
  b.classList.toggle('hidden', !show);
  if (show) b.innerHTML = show;
  b.dataset.tip = st.state === 'ready' ? 'Lumen перезапустится с новой версией' : st.state === 'manual' ? 'Откроется страница загрузки' : '';
  if ((st.state === 'ready' || st.state === 'manual') && updToasted !== st.latest) {
    updToasted = st.latest;
    toast(st.state === 'ready' ? `Lumen ${st.latest} готов` : `Вышел Lumen ${st.latest}`, st.state === 'ready' ? 'Нажми — обновится за пару секунд, без установщика. Или само при выходе.' : 'Нажми, чтобы скачать', {
      kind: 'ok',
      icon: 'sparkles',
      ms: 9000,
      onClick: () => (st.state === 'ready' ? window.api.upd.install() : window.api.upd.download()),
    });
  }
}

/** Экран «Обновляю…» — в прошлый раз обновление скачалось, но не встало; ставим тихо при запуске. */
function showInstalling(v) {
  if ($('#upd-installing')) return;
  document.body.append(el(`<div id="upd-installing" class="upd-installing"><div class="upd-box">
    <div class="upd-spin"></div><b>Обновляю Lumen до ${esc(v || 'новой версии')}…</b>
    <span>Пара секунд — Lumen откроется сам</span></div></div>`));
}

/** «Что нового» — один раз после обновления. */
function mdLite(t) {
  return t.split('\n').filter((l) => l.trim()).map((l) => {
    if (/^\*\*[^*]+\*\*$/.test(l.trim())) return `<li class="hd">${esc(l.trim().slice(2, -2))}</li>`;
    const sub = /^\s{2,}[-*]\s/.test(l);
    const txt = esc(l.replace(/^\s*[-*]\s/, '')).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
    return `<li class="${sub ? 'sub' : ''}">${txt}</li>`;
  }).join('');
}
async function whatsNew() {
  try {
    const w = await window.api?.app?.whatsNew?.();
    if (!w) return;
    const m = modal(`<h3 class="wn-title">${icon('sparkles', 18)}Что нового в Lumen ${esc(w.version)}</h3>
      <ul class="whatsnew">${mdLite(w.notes)}</ul>
      <div class="modal-acts"><button class="btn pri" data-close>Понятно</button></div>`);
    m.el.style.width = 'min(520px, 100%)';
    return m;
  } catch {}
}

function addAccount() {
  showLogin((acc) => acc && startAccount(acc === 'demo' ? 'demo' : acc.id), { cancelable: true });
}

let retryTimer = null;
let startGen = 0;
async function startAccount(id) {
  const my = ++startGen;
  clearTimeout(retryTimer);
  stopPoll();
  S.demo = id === 'demo';
  S.accId = S.demo ? null : id;
  S.backend = S.demo ? createDemo() : createClient(id);
  S.me = null;
  if (!S.demo) window.api.acc.setActive(id).catch(() => {});
  await loadMeta();
  if (my !== startGen) return;
  bus.emit('account');
  setStatus('load');
  let me;
  try {
    me = await S.backend.auth(false);
  } catch (e) {
    if (my === startGen) showError(e, id);
    return;
  }
  if (my !== startGen) return;
  S.me = me;
  renderMe();
  bus.emit('me');
  syncDiscord();
  startPoll();
  loadLater();
  syncPluginRail(null);
  if (!S.demo && window.api?.auto) window.api.auto.attach(id, S.settings.automation?.mode === 'pc' ? 'pc' : 'off').then(syncPluginRail, (e) => console.warn('автоматика:', e));
  resetRaise();
  go(S.view && S.view !== 'error' ? S.view : 'home');
}

function showError(e, id) {
  setStatus('err', e.message);
  const v = $('#v-error');
  v.innerHTML = `<div class="empty"><div class="orb" style="color:var(--bad)">${icon('alert', 32)}</div><h3>Не получилось подключиться</h3><p>${esc(e.message)}</p><div class="row" style="margin-top:6px"><button class="btn pri" data-r>${icon('refresh', 16)}Ещё раз</button><button class="btn" data-o>Другой аккаунт</button></div><p class="dim" style="font-size:12px;margin-top:8px">Попробую сам через 20 секунд</p></div>`;
  S.view = 'error';
  $$('.view').forEach((x) => x.classList.toggle('on', x === v));
  $('[data-r]', v).onclick = () => startAccount(id);
  $('[data-o]', v).onclick = addAccount;
  retryTimer = setTimeout(() => S.view === 'error' && startAccount(id), 20000);
}

function setStatus(s, msg = '') {
  const st = $('[data-status]');
  // «На связи» не показываем — значок появляется только когда подключаемся или связи нет
  st.className = 'tb-status ' + (s === 'ok' ? 'ok-quiet' : s);
  $('[data-st-t]').textContent = s === 'ok' ? (S.demo ? 'Демо' : 'На связи') : s === 'load' ? 'Подключаюсь…' : 'Нет связи';
  st.dataset.tip = msg || (s === 'ok' ? 'Сообщения обновляются автоматически' : '');
}

function keys(e) {
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.code === 'KeyH') return e.preventDefault(), toggleHide();
  // Escape — убрать фокус с кнопки, чтобы не оставалась рамка
  if (e.key === 'Escape' && document.activeElement?.matches?.('button, summary, a')) document.activeElement.blur();
  if (document.querySelector('#login')) return;
  const k = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && (k === 'k' || k === 'л')) {
    e.preventDefault();
    palette();
  } else if ((e.ctrlKey || e.metaKey) && /^Digit[1-6]$/.test(e.code)) {
    e.preventDefault();
    go(['chats', 'deals', 'finance', 'lots', 'auto', 'settings'][+e.code.slice(5) - 1]);
  } else if ((e.ctrlKey || e.metaKey) && e.code === 'Digit0') {
    e.preventDefault();
    go('home');
  } else if ((e.ctrlKey || e.metaKey) && (k === 'f' || k === 'а') && S.view === 'chats') {
    e.preventDefault();
    $('#chat-q')?.focus();
  } else if (S.view === 'chats') chatKeys(e);
}

async function boot() {
  if (/Mac/.test(navigator.platform)) document.body.classList.add('mac');
  else if (/Linux/.test(navigator.platform) && window.api) document.body.classList.add('linux');
  else if (/Win/.test(navigator.platform) && window.api) document.body.classList.add('win');
  await loadSettings();
  applyLook();
  initTips();
  // окно свернули или ушли в другое приложение — ставим анимации на паузу (меньше нагрузка и нагрев)
  const idle = () => (document.hidden || !document.hasFocus() ? (document.documentElement.dataset.idle = '1') : delete document.documentElement.dataset.idle);
  addEventListener('blur', idle);
  addEventListener('focus', idle);
  document.addEventListener('visibilitychange', idle);
  shell();
  initFx();
  initWatch();
  initBell();
  initClub();
  bus.on('nav', (v, sub) => go(v, sub));
  bus.on('status', setStatus);
  bus.on('switch-account', startAccount);
  bus.on('add-account', addAccount);
  bus.on('settings', () => (renderMe(), dndTick(), applyNav()));
  bus.on('dnd', (a) => $('[data-dnd]').classList.toggle('hidden', !a));
  bus.on('me', renderMe);
  bus.on('auto-sent', () => toast('Автоответ отправлен', '', { kind: 'ok', icon: 'bot', ms: 2500 }));
  bus.on('chats', (list) => {
    const n = list.filter((c) => c.unread).length;
    const b = $('[data-unread]');
    b.classList.toggle('hidden', !n);
    b.textContent = n > 99 ? '99+' : n;
  });
  bus.on('logout', async () => {
    const { list } = await window.api.acc.list();
    window.api.auto?.detach().catch(() => {});
    if (list.length) startAccount(list[0].id);
    else {
      stopPoll();
      S.me = null;
      showLogin((acc) => startAccount(acc === 'demo' ? 'demo' : acc.id));
    }
  });
  S.focused = document.hasFocus();
  const focus = (f) => {
    S.focused = f;
    if (f) pollNow();
  };
  if (window.api) window.api.app.on('app:focus', focus);
  addEventListener('focus', () => focus(true));
  addEventListener('blur', () => focus(false));
  addEventListener('keydown', keys);
  // картинки, которые не загрузились: аватар → инициалы, в сообщении — подпись
  document.addEventListener(
    'error',
    (e) => {
      const t = e.target;
      if (t.tagName !== 'IMG') return;
      if (t.closest('.av')) t.remove();
      else if (t.closest('.bub-img')) t.closest('.bub-img').innerHTML = '<div style="padding:14px;font-size:12px">Картинка недоступна</div>';
    },
    true
  );

  let started = false;
  if (window.api) {
    const { list, active } = await window.api.acc.list();
    const id = list.find((a) => a.id === active)?.id || list[0]?.id;
    if (id) {
      started = true;
      startAccount(id);
    }
  }
  dndTick();
  if (window.api?.upd) {
    window.api.app.on('upd:state', onUpdate);
    window.api.upd.state().then(onUpdate).catch(() => {});
  }
  setTimeout(whatsNew, 1200);
  if (!started) showLogin((acc) => startAccount(acc === 'demo' ? 'demo' : acc.id));
  if (new URLSearchParams(location.search).has('demo') && !started) {
    document.querySelector('#login')?.remove();
    startAccount('demo');
  }
  setTimeout(() => $('#splash')?.classList.add('gone'), 250);
  setTimeout(() => $('#splash')?.remove(), 900);
}

boot().catch((e) => {
  console.error(e);
  err('Ошибка запуска', e);
});
export const _cs = CS;
