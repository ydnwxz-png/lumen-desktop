// © 2026 Lumen. Все права защищены. Копирование, изменение и распространение этого кода запрещены без разрешения автора (см. LICENSE).
// Ctrl+K: чаты, заказы, разделы и команды в одном поиске.
import { el, esc, avatar } from '../core/util.js';
import { icon } from '../core/icons.js';
import { S, bus, saveSettings } from '../core/state.js';
import { CS, pollNow } from '../features/poller.js';
import { raiseDue } from '../features/raise.js';
import { applyLook } from './look.js';
import { openOrder } from '../views/order.js';
import { openProfile } from '../views/profile.js';
import { ok } from './kit.js';

let open = null;

export function palette() {
  if (open) return open.close();
  const wrap = el(`<div><div class="scrim" style="background:rgba(0,0,0,.25)"></div><div class="palette"><span class="pi-ic">${icon('search', 20)}</span><input placeholder="Чат, #заказ, ID или ссылка на профиль, команда…" spellcheck="false"><div class="pal-list"></div></div></div>`);
  const inp = wrap.querySelector('input');
  const list = wrap.querySelector('.pal-list');
  let sel = 0,
    items = [];
  const close = () => {
    wrap.remove();
    open = null;
  };
  open = { close };
  wrap.querySelector('.scrim').onclick = close;

  const cmds = [
    { t: 'Чаты', ic: 'chat', k: 'Ctrl 1', run: () => bus.emit('nav', 'chats') },
    { t: 'Сделки', ic: 'bag', k: 'Ctrl 2', run: () => bus.emit('nav', 'deals') },
    { t: 'Главная', ic: 'home', k: 'Ctrl 0', run: () => bus.emit('nav', 'home') },
    { t: 'Статистика', ic: 'trend', run: () => bus.emit('nav', 'stats') },
    { t: 'Поддержка FunPay: не подтвердили заказ', ic: 'alert', run: () => import('../features/support.js').then((m) => m.openSupportPicker()) },
    { t: 'Финансы', ic: 'wallet', k: 'Ctrl 3', run: () => bus.emit('nav', 'finance') },
    { t: 'Лоты', ic: 'box', k: 'Ctrl 4', run: () => bus.emit('nav', 'lots') },
    { t: 'Автоматика и плагины', ic: 'bot', k: 'Ctrl 5', run: () => bus.emit('nav', 'auto') },
    { t: 'Настройки', ic: 'settings', k: 'Ctrl 6', run: () => bus.emit('nav', 'settings') },
    { t: 'Мой профиль', ic: 'user', run: () => S.me && openProfile(S.me.userId) },
    { t: 'Поднять все лоты', ic: 'rocket', run: () => raiseDue(true).then(() => ok('Готово', 'Подробности — в разделе «Лоты»')) },
    { t: 'Обновить чаты', ic: 'refresh', run: () => pollNow() },
    { t: 'Сменить тему', ic: 'moon', run: () => ((S.settings.theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'), saveSettings(), applyLook()) },
    { t: 'Шаблоны', ic: 'zap', run: () => bus.emit('nav', 'settings', 'chat') },
    { t: 'Открыть FunPay в браузере', ic: 'globe', run: () => S.backend.openBrowser('https://funpay.com/') },
  ];

  const render = () => {
    const q = inp.value.trim().toLowerCase();
    items = [];
    const oid = /^#?([a-z0-9]{8})$/i.exec(q);
    if (oid && !/^\d+$/.test(oid[1])) items.push({ sec: 'Заказ', t: `Открыть заказ #${oid[1].toUpperCase()}`, ic: 'bag', run: () => openOrder(oid[1].toUpperCase()) });
    // пользователь: ID или ссылка на профиль FunPay
    const uid = /(?:funpay\.com\/(?:[a-z]{2}\/)?users\/)?(\d{3,12})\/?$/i.exec(inp.value.trim());
    if (uid && (/users\//i.test(inp.value) || /^\d{3,12}$/.test(q))) items.push({ sec: 'Пользователь', t: `Открыть профиль ID ${uid[1]}`, sub: 'профиль FunPay в Lumen', ic: 'user', run: () => openProfile(uid[1]) });
    const chats = CS.chats.filter((c) => !q || c.name.toLowerCase().includes(q) || c.preview.toLowerCase().includes(q)).slice(0, q ? 8 : 5);
    for (const c of chats) items.push({ sec: 'Чаты', t: c.name, sub: c.preview, av: c, run: () => (bus.emit('nav', 'chats'), bus.emit('open-chat', c.id)) });
    for (const c of cmds.filter((c) => !q || c.t.toLowerCase().includes(q))) items.push({ sec: 'Команды', ...c });
    sel = Math.min(sel, Math.max(0, items.length - 1));
    let last = '';
    list.innerHTML =
      items
        .map((it, i) => {
          const h = it.sec !== last ? `<div class="pal-sec">${it.sec}</div>` : '';
          last = it.sec;
          return `${h}<div class="pal-it ${i === sel ? 'on' : ''}" data-i="${i}">${it.av ? avatar(it.av.avatar, it.av.name, 30) : `<span class="pi">${icon(it.ic, 16)}</span>`}<div class="grow" style="min-width:0"><div class="ell">${esc(it.t)}</div>${it.sub ? `<div class="dim ell" style="font-size:12px">${esc(it.sub)}</div>` : ''}</div>${it.k ? `<span class="k">${it.k}</span>` : ''}</div>`;
        })
        .join('') || '<div class="dim" style="padding:20px;text-align:center">Ничего не найдено</div>';
    list.querySelector('.pal-it.on')?.scrollIntoView({ block: 'nearest' });
  };
  const pick = (i) => {
    const it = items[i];
    if (!it) return;
    close();
    it.run();
  };
  inp.oninput = () => ((sel = 0), render());
  inp.onkeydown = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % Math.max(1, items.length);
      render();
    } else if (e.key === 'Enter') pick(sel);
    else if (e.key === 'Escape') close();
  };
  list.onclick = (e) => {
    const it = e.target.closest('[data-i]');
    if (it) pick(+it.dataset.i);
  };
  list.onmousemove = (e) => {
    const it = e.target.closest('[data-i]');
    if (it && +it.dataset.i !== sel) {
      sel = +it.dataset.i;
      list.querySelectorAll('.pal-it').forEach((x) => x.classList.toggle('on', +x.dataset.i === sel));
    }
  };
  document.body.append(wrap);
  render();
  inp.focus();
}
