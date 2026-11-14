// © 2026 Lumen. Все права защищены. Копирование, изменение и распространение этого кода запрещены без разрешения автора (см. LICENSE).
// Значок Lumen у ника: видно, кто из покупателей и продавцов тоже сидит в Lumen (Desktop, расширение, телефон).
// Свой профиль отмечаем, только если в настройках включено «Показывать, что я в Lumen».
import { S, bus, saveSettings } from '../core/state.js';
import { logoSvg } from '../core/icons.js';

const club = { all: new Set(), desk: new Set(), app: new Set() };
let hiAt = 0;
let hiFor = '';

function label(id) {
  const k = [club.desk.has(id) && 'Lumen Desktop', club.all.has(id) && !club.desk.has(id) && !club.app.has(id) && 'расширение Lumen', club.app.has(id) && 'Lumen на телефоне'].filter(Boolean);
  return 'Пользуется ' + (k.join(', ') || 'Lumen');
}

/** Поставить значки всем нужным нижам в узле. */
function mark(root) {
  if (!club.all.size) return;
  const list = root.querySelectorAll ? root.querySelectorAll('.nick[data-uid]') : [];
  for (const n of list) {
    const id = +n.dataset.uid;
    const has = n.nextElementSibling?.classList?.contains('lmb');
    if (!club.all.has(id) || has || n.closest('.no-lmb')) continue;
    const b = document.createElement('span');
    b.className = 'lmb';
    b.dataset.tip = label(id);
    b.innerHTML = logoSvg(14);
    n.after(b);
  }
}

async function load() {
  if (!window.api) {
    // демо: пара покупателей «с Lumen», чтобы было видно значок
    club.all = new Set([2000, 2002, 2004]);
    club.desk = new Set([2000, 2004]);
    return mark(document.body);
  }
  if (!window.api.app?.club) return;
  try {
    const d = await window.api.app.club();
    club.all = new Set([...d.ids, ...d.d, ...d.m]);
    club.desk = new Set(d.d);
    club.app = new Set(d.m);
    mark(document.body);
  } catch {}
}

/** Отметиться (раз в 6 часов) или убрать отметку, если выключено. */
export async function syncClub(force) {
  if (!window.api?.app?.clubHi || !S.me?.userId || S.demo) return;
  const on = S.settings.clubShow === true;
  const key = `${S.me.userId}|${on}`;
  if (!force && key === hiFor && Date.now() - hiAt < 6 * 3600e3) return;
  hiFor = key;
  hiAt = Date.now();
  await window.api.app.clubHi(S.me.userId, on);
  setTimeout(load, 3000);
}

export function initClub() {
  new MutationObserver((ms) => {
    if (!club.all.size) return;
    for (const m of ms) for (const n of m.addedNodes) if (n.nodeType === 1) (n.matches?.('.nick[data-uid]') ? mark(n.parentElement || n) : mark(n));
  }).observe(document.body, { childList: true, subtree: true });
  load();
  setInterval(load, 30 * 60e3);
  bus.on('me', () => syncClub());
  // один раз подсказать, что можно включить значок
  if (S.settings.clubShow == null || (S.settings.clubShow === false && !S.settings.clubAsked)) {
    S.settings.clubAsked = true;
    saveSettings();
    setTimeout(() => bus.emit('bell-add', { kind: 'news', title: 'Значок Lumen у ника', text: 'Включи — и другие пользователи Lumen увидят у твоего ника значок «L». Настройки → Система → Конфиденциальность.', go: 'settings' }), 4000);
  }
}
