// Страницы плагинов: плагин с полем page получает кнопку слева и свою вкладку.
// Страница работает в отдельном iframe (lumen-plugin://id/) и общается с приложением через window.lumen.
import { $, $$, el, esc, copyText } from '../core/util.js';
import { icon, hasIcon } from '../core/icons.js';
import { S, bus, persist } from '../core/state.js';
import { toast, confirmBox } from '../ui/kit.js';
import { CS, openNode } from './poller.js';

let root;
let pages = []; // [{id, name, title, icon}]
const frames = new Map(); // id -> iframe
const AUTO = () => window.__autoMock || window.api?.auto;
const pageUrl = (id) => AUTO()?.pageUrl?.(id) || `lumen-plugin://${id}/`;

export function mountPluginPages(c) {
  root = c;
  root.innerHTML = '';
  bus.on('auto-info', syncPluginRail);
  bus.on('account', () => syncPluginRail(null));
  addEventListener('message', onMessage);
  // тема поменялась — перекрашиваем страницы плагинов
  new MutationObserver(() => frames.forEach(sendTheme)).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-accent', 'style'] });
}

export function syncPluginRail(info) {
  const list = (info?.plugins || []).filter((p) => p.on && p.page && !p.error).map((p) => ({ id: p.id, name: p.name, title: p.page.title, icon: p.page.icon }));
  const same = JSON.stringify(list) === JSON.stringify(pages);
  pages = list;
  // выключенные плагины — убираем их страницы
  for (const [id, f] of frames) if (!pages.some((p) => p.id === id)) (f.remove(), frames.delete(id));
  const rail = $('[data-plugrail]');
  if (!rail) return;
  if (!same)
    rail.innerHTML = pages
      .map((p) => {
        const ic = /^[a-z0-9-]+$/.test(p.icon) ? icon(hasIcon(p.icon) ? p.icon : 'layers', 22) : `<span class="rail-emoji">${esc(p.icon)}</span>`;
        return `<button class="rail-btn" data-nav="plug:${esc(p.id)}" data-tip="${esc(p.title)}">${ic}</button>`;
      })
      .join('');
  $$('.rail-btn[data-nav]', rail).forEach((b) => b.classList.toggle('on', b.dataset.nav === S.view));
  if (S.view?.startsWith('plug:') && !pages.some((p) => 'plug:' + p.id === S.view)) showPluginPage(S.view.slice(5));
}

export function showPluginPage(id) {
  const p = pages.find((x) => x.id === id);
  root.querySelector('.plug-empty')?.remove();
  frames.forEach((f, fid) => (f.hidden = fid !== id));
  if (!p) {
    root.append(el(`<div class="empty plug-empty" style="height:100%"><div class="orb">${icon('layers', 30)}</div><h3>Плагин выключен</h3><p>Включи его во вкладке «Автоматика и плагины».</p></div>`));
    return;
  }
  if (!frames.has(id)) {
    const f = el(`<iframe class="plug-frame" sandbox="allow-scripts allow-forms allow-modals" title="${esc(p.title)}"></iframe>`);
    f.onload = () => sendTheme(f);
    f.src = pageUrl(id);
    frames.set(id, f);
    root.append(f);
  }
}

const THEME_VARS = ['--a1', '--a2', '--a-rgb', '--on-accent', '--grad', '--text', '--text-2', '--text-3', '--surface', '--surface-2', '--surface-3', '--line', '--line-2', '--hover', '--press', '--ok', '--bad', '--warn', '--info'];
function sendTheme(f) {
  const cs = getComputedStyle(document.documentElement);
  const vars = Object.fromEntries(THEME_VARS.map((k) => [k, cs.getPropertyValue(k).trim()]).filter(([, v]) => v));
  f.contentWindow?.postMessage({ lumen: 1, type: 'theme', vars, theme: document.documentElement.dataset.theme }, '*');
}

const pick = (c) => ({ id: c.id, name: c.name, preview: c.preview, unread: c.unread, time: c.time });

// что страница плагина может попросить у приложения
const METHODS = {
  hello: () => true,
  me: () => (S.me ? { userId: S.me.userId, username: S.me.username, balance: S.me.balance } : null),
  chats: () => (CS.chats || []).map(pick),
  openChat: () => {
    const id = openNode();
    const c = (CS.chats || []).find((x) => x.id === id);
    return id ? { id, name: c?.name || '' } : null;
  },
  send: (_, chat, text) => S.backend.send(String(chat), String(text)),
  toast: (_, title, body, kind) => (toast(String(title), String(body || ''), { kind: kind === 'ok' || kind === 'err' ? kind : '' }), true),
  confirm: (_, title, text, yes) => confirmBox(String(title), String(text || ''), { yes: String(yes || 'Да') }),
  copy: (_, text) => copyText(String(text)).then(() => true),
  open: (_, url) => {
    url = String(url);
    if (/^https:\/\/(www\.)?funpay\.com\//.test(url)) return S.backend.openBrowser(url);
    if (/^https?:\/\//.test(url)) return window.api ? window.api.app.open(url) : window.open(url);
  },
  translate: (_, text) => (window.api?.tr ? window.api.tr(String(text)) : Promise.reject(new Error('Переводчик доступен только в приложении'))),
  'storage.get': (id, k, d) => persist.get(`plugpage:${id}:${k}`, d),
  'storage.set': (id, k, v) => (persist.set(`plugpage:${id}:${k}`, v), true),
  'fp.myLots': () => S.backend.myLots(),
  'fp.lotNewForm': (_, node) => S.backend.lotNewForm(String(node)),
  'fp.lotCreate': (_, f) => S.backend.lotCreate(f),
  'fp.withdrawRate': () => S.backend.withdrawRate(),
};

async function onMessage(e) {
  const d = e.data;
  if (!d || d.lumen !== 1 || !d.method) return;
  const id = [...frames].find(([, f]) => f.contentWindow === e.source)?.[0];
  if (!id) return;
  const fn = METHODS[d.method];
  const reply = (m) => e.source.postMessage({ lumen: 1, id: d.id, ...m }, '*');
  if (!fn) return reply({ ok: false, error: 'Нет такой команды: ' + d.method });
  if (!S.backend && d.method.startsWith('fp.')) return reply({ ok: false, error: 'Сначала войди в FunPay' });
  try {
    const data = await fn(id, ...(Array.isArray(d.args) ? d.args : []));
    reply({ ok: true, data: data === undefined ? null : JSON.parse(JSON.stringify(data)) });
  } catch (err) {
    reply({ ok: false, error: err?.message || String(err) });
  }
}
