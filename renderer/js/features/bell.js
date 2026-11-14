// © 2026 Lumen. Все права защищены. Копирование, изменение и распространение этого кода запрещены без разрешения автора (см. LICENSE).
// Колокольчик в шапке: новости Lumen (пишет админ в боте), обновления и проблемы автоматики.
import { $, el, esc } from '../core/util.js';
import { icon } from '../core/icons.js';
import { S, bus, saveSettings } from '../core/state.js';
import { toast } from '../ui/kit.js';

const local = []; // события этой сессии: { kind, title, text, ts, go }
let news = [];
let pop = null;

const seenNews = () => S.settings.bell?.news || 0;
const seenAt = () => S.settings.bell?.at || 0;

function unread() {
  return news.filter((n) => n.id > seenNews()).length + local.filter((x) => x.ts > seenAt()).length;
}
function dot() {
  $('[data-bell] .bdot')?.classList.toggle('hidden', !unread());
}

async function loadNews(first) {
  if (!window.api) {
    // демо: пример новости, чтобы было видно, как это выглядит
    news = [{ id: 1, title: 'Lumen 1.9 — новый дизайн', text: 'Главная со статистикой, кошелёк, календарь продаж и этот колокольчик. Новости сюда пишет разработчик.', url: '', ts: Math.floor(Date.now() / 1000) - 3600 }];
    if (first && !local.length) {
      const now = Date.now();
      local.push({ kind: 'order', title: 'Новый заказ · 364 ₽', text: 'sanych оплатил Telegram Premium', ts: now - 12 * 60e3, go: 'deals' }, { kind: 'review', title: 'Новый отзыв 5★', text: 'vitalya228: «Быстро и чётко, спасибо!»', ts: now - 3600e3, go: 'deals' }, { kind: 'stock', title: 'Мало товара', text: 'Аренда CS2 — осталось 2 шт. в автовыдаче', ts: now - 3 * 3600e3, go: 'auto' });
    }
    return dot();
  }
  if (!window.api.app?.news) return;
  try {
    const items = await window.api.app.news();
    const fresh = items.filter((n) => n.id > seenNews() && !news.some((o) => o.id === n.id));
    news = items;
    dot();
    // новая новость, пока человек в программе — показываем всплывашкой (кроме самого первого запуска)
    if (!first && fresh.length && S.settings.bell?.news) {
      const n = fresh[0];
      toast(n.title, n.text.slice(0, 140), { icon: 'bell', ms: 9000, onClick: () => openBell() });
    }
    // первый запуск после установки — старые новости не считаем непрочитанными, кроме последней
    if (first && !S.settings.bell?.news && items.length) {
      S.settings.bell = { ...(S.settings.bell || {}), news: items[0].id - 1 };
      saveSettings();
      dot();
    }
  } catch {}
}

export function initBell() {
  const b = $('[data-bell]');
  b.onclick = () => (pop ? closeBell() : openBell());
  bus.on('bell-add', (x) => {
    local.unshift({ ts: Date.now(), ...x });
    if (local.length > 30) local.pop();
    dot();
  });
  bus.on('update', (st) => {
    if ((st.state === 'ready' || st.state === 'manual') && !local.some((x) => x.kind === 'upd' && x.v === st.latest))
      bus.emit('bell-add', { kind: 'upd', v: st.latest, title: `Вышел Lumen ${st.latest}`, text: st.state === 'ready' ? 'Уже скачан — нажми, чтобы обновиться за пару секунд.' : 'Нажми, чтобы скачать.', run: () => (st.state === 'ready' ? window.api.upd.install() : window.api.upd.download()) });
  });
  loadNews(true);
  setInterval(loadNews, 10 * 60e3);
  dot();
}

function ago(ts) {
  const m = Math.round((Date.now() - ts) / 60e3);
  if (m < 1) return 'только что';
  if (m < 60) return `${m} мин назад`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} ч назад`;
  return new Date(ts).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

function openBell() {
  closeBell();
  const all = [
    ...local.map((x, i) => ({ ...x, key: 'l' + i, isNew: x.ts > seenAt() })),
    ...news.map((n) => ({ kind: 'news', title: n.title, text: n.text, url: n.url, ts: n.ts * 1000, key: 'n' + n.id, isNew: n.id > seenNews() })),
  ].sort((a, b) => b.ts - a.ts);
  const ic = { news: 'send', upd: 'down', plug: 'alert', order: 'cash', review: 'star', stock: 'box' };
  pop = el(`<div class="pop2"><h4>Уведомления${all.length ? '<button data-read>Прочитать все</button>' : ''}</h4>
    <div class="nt-list">${
      all.length
        ? all.map((x) => `<button class="nt ${x.isNew ? 'new' : ''}" data-k="${x.key}"><span class="ico ${x.kind === 'news' ? 'acc' : ''}" style="${x.kind === 'plug' ? 'color:var(--bad)' : x.kind === 'stock' ? 'color:var(--warn)' : x.kind === 'order' ? 'color:var(--ok)' : x.kind === 'review' ? 'color:#fbbf24' : ''}">${icon(ic[x.kind] || 'bell', 18)}</span>
          <span style="min-width:0;flex:1"><b>${esc(x.title)}</b>${x.text ? `<p>${esc(x.text)}</p>` : ''}<small>${x.kind === 'news' ? 'от разработчика · ' : ''}${ago(x.ts)}${x.url ? ' · открыть ссылку' : ''}</small></span></button>`).join('')
        : `<div class="nt-empty">${icon('bell', 26)}<br>Пока тихо. Здесь будут новости Lumen,<br>обновления и проблемы автоматики</div>`
    }</div></div>`);
  document.body.append(pop);
  const r = $('[data-bell]').getBoundingClientRect();
  pop.style.top = r.bottom + 10 + 'px';
  pop.style.left = Math.max(8, Math.min(innerWidth - 368, r.right - 360)) + 'px';
  pop.onclick = (e) => {
    if (e.target.closest('[data-read]')) return markRead(), closeBell();
    const b = e.target.closest('[data-k]');
    if (!b) return;
    const x = all.find((y) => y.key === b.dataset.k);
    closeBell();
    if (x.run) x.run();
    else if (x.url) window.api ? window.api.app.open(x.url) : window.open(x.url);
    else if (x.node) (bus.emit('nav', 'chats'), bus.emit('open-chat', x.node));
    else if (x.go) bus.emit('nav', x.go);
  };
  setTimeout(() => {
    addEventListener('mousedown', outside, true);
    addEventListener('keydown', escKey, true);
  });
  // открыли — значит увидели
  setTimeout(markRead, 1500);
}
function markRead() {
  S.settings.bell = { news: Math.max(seenNews(), ...news.map((n) => n.id), 0), at: Date.now() };
  saveSettings();
  dot();
}
const outside = (e) => pop && !pop.contains(e.target) && !e.target.closest('[data-bell]') && closeBell();
const escKey = (e) => e.key === 'Escape' && closeBell();
function closeBell() {
  pop?.remove();
  pop = null;
  removeEventListener('mousedown', outside, true);
  removeEventListener('keydown', escKey, true);
}
