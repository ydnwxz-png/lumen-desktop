// Экран чатов: список с папками и поиском, переписка, отправка, шаблоны, картинки.
import { $, $$, el, esc, avatar, richText, debounce, flip, hhmm, dayLabel, dayKey, stripZW, findOrderIds, copyText } from '../core/util.js';
import { icon } from '../core/icons.js';
import { S, bus, meta, setMeta, saveTemplates } from '../core/state.js';
import { CS, setOpenProvider, pollNow } from '../features/poller.js';
import { fill } from '../features/templates.js';
import { peerNick, NICK_STYLES, TAG_COLORS } from '../features/nicks.js';
import { menu, menuAt, err, ok, lightbox, toast, promptBox, modal } from '../ui/kit.js';
import { openOrder } from './order.js';
import { openProfile } from './profile.js';
import { L, addLater, cancelLater, sendLaterNow, whenText, presets } from '../features/later.js';

const FOLDERS = [
  ['all', 'Все', 'chat'],
  ['unread', 'Новые', 'inbox'],
  ['pinned', 'Закреплённые', 'pin'],
  ['archive', 'Архив', 'archive'],
];

const V = { folder: 'all', q: '', open: null, page: null, msgs: [], ids: new Set(), more: false, loadingMore: false, reply: null, attach: null, pending: [], below: 0, gen: 0 };
let root, listEl, msgsEl, innerEl, chatEl, ta;
const items = new Map();

export function mountChats(container) {
  root = container;
  root.innerHTML = `
  <section class="clist">
    <div class="clist-head">
      <div class="clist-title"><h2>Чаты</h2><button class="ibtn" data-act="refresh" data-tip="Обновить">${icon('refresh', 18)}</button></div>
      <label class="search">${icon('search', 16)}<input class="input" id="chat-q" placeholder="Поиск по чатам" spellcheck="false"></label>
      <div class="folders"></div>
    </div>
    <div class="clist-items"></div>
  </section>
  <section class="chat"></section>`;
  listEl = $('.clist-items', root);
  chatEl = $('.chat', root);
  $('#chat-q', root).addEventListener(
    'input',
    debounce((e) => {
      V.q = e.target.value.trim().toLowerCase();
      renderList();
    }, 120)
  );
  $('[data-act=refresh]', root).onclick = () => pollNow();
  renderFolders();
  renderEmpty();
  renderSkeleton();

  // слушатели на постоянном контейнере чата — вешаем один раз
  chatEl.addEventListener('click', (e) => {
    const a = e.target.closest('.composer [data-act]')?.dataset.act;
    if (!a || !V.page) return;
    if (a === 'send') submit();
    if (a === 'attach') $('input[type=file]', chatEl)?.click();
    if (a === 'ai') aiRewrite(e.target.closest('[data-act]'));
    if (a === 'later') laterMenu();
  });
  let dc = 0;
  chatEl.addEventListener('dragenter', (e) => {
    if ([...(e.dataTransfer?.items || [])].some((i) => i.kind === 'file')) {
      dc++;
      chatEl.classList.add('dragging');
    }
  });
  chatEl.addEventListener('dragleave', () => {
    if (--dc <= 0) {
      dc = 0;
      chatEl.classList.remove('dragging');
    }
  });
  chatEl.addEventListener('dragover', (e) => e.preventDefault());
  chatEl.addEventListener('drop', (e) => {
    e.preventDefault();
    dc = 0;
    chatEl.classList.remove('dragging');
    if (V.page) setAttach([...e.dataTransfer.files].find((f) => f.type.startsWith('image/')));
  });

  setOpenProvider(() => ({ node: V.page ? V.open : null, lastId: V.msgs.length ? V.msgs[V.msgs.length - 1].id : 0 }));
  bus.on('chats', () => {
    renderFolders();
    renderList();
    resolveUids();
  });
  bus.on('meta', () => {
    renderFolders();
    renderList();
    if (V.page) renderHead();
  });
  bus.on('messages', (node, list) => node === V.open && V.page && innerEl?.isConnected && onMessages(list));
  bus.on('open-chat', (node) => openChat(node));
  bus.on('templates', () => V.page && renderTplBar());
  bus.on('later', () => V.page && renderLater());
  bus.on('settings', () => V.page && renderTplBar());
  bus.on('account', () => {
    V.gen++;
    V.open = null;
    V.page = null;
    items.clear();
    listEl.innerHTML = '';
    renderSkeleton();
    renderEmpty();
  });
  window.api?.app.on('nav:chat', (node) => {
    if (/^acc:/.test(String(node || ''))) return; // чат другого аккаунта — им займётся features/watch.js
    bus.emit('nav', 'chats');
    openChat(node);
  });
}

// ---------------------------------------------------------------- список

function filtered() {
  const pinned = [];
  const rest = [];
  for (const c of CS.chats) {
    const m = meta(c.id);
    if (V.q && !c.name.toLowerCase().includes(V.q) && !c.preview.toLowerCase().includes(V.q)) continue;
    if (V.folder === 'archive' ? !m.archived : m.archived && !V.q) continue;
    if (V.folder === 'unread' && !c.unread) continue;
    if (V.folder === 'pinned' && !m.pinned) continue;
    (m.pinned && V.folder !== 'archive' ? pinned : rest).push(c);
  }
  pinned.sort((a, b) => (meta(a.id).pinned || 0) - (meta(b.id).pinned || 0));
  return [...pinned, ...rest];
}

function renderFolders() {
  const f = $('.folders', root);
  const unread = CS.chats.filter((c) => c.unread && !meta(c.id).archived).length;
  f.innerHTML = FOLDERS.map(([id, name]) => `<button class="folder ${V.folder === id ? 'on' : ''}" data-f="${id}">${name}${id === 'unread' && unread ? `<span class="badge">${unread}</span>` : ''}</button>`).join('');
  f.onclick = (e) => {
    const b = e.target.closest('[data-f]');
    if (!b) return;
    V.folder = b.dataset.f;
    renderFolders();
    renderList(true);
  };
}

function renderSkeleton() {
  listEl.innerHTML = Array.from({ length: 9 }, (_, i) => `<div class="ci-skel" style="opacity:${1 - i * 0.09}"><div class="skel" style="width:46px;height:46px;border-radius:50%"></div><div class="grow col" style="gap:7px"><div class="skel" style="height:12px;width:${50 + ((i * 17) % 35)}%"></div><div class="skel" style="height:10px;width:${70 + ((i * 11) % 25)}%"></div></div></div>`).join('');
}

function itemHtml(c) {
  const m = meta(c.id);
  const dot = m.tag ? `<span class="ci-tagdot" style="background:${TAG_COLORS[m.tag] || m.tag}"></span>` : '';
  const uid = peerUid(c);
  return `${avatar(c.avatar, c.name, 46, '', uid)}
    <div class="ci-main">
      <div class="ci-top">${dot}${peerNick(c.id, c.name, 'ci-name', uid)}<span class="ci-time">${esc(c.time)}</span></div>
      <div class="ci-bot"><span class="ci-prev">${esc(c.preview.replace(/╭─\s*⤸[\s\S]*?╰\s?/, '↩ ') || 'Изображение')}</span>
        <span class="ci-flags">${m.muted ? icon('bellOff', 14) : ''}${m.pinned ? icon('pin', 14) : ''}${c.unread ? '<span class="udot"></span>' : ''}</span></div>
    </div>`;
}

function renderList(fromFolder) {
  if (!CS.loaded) return;
  const list = filtered();
  if (!list.length) {
    items.clear();
    listEl.innerHTML = `<div class="empty" style="padding-top:60px"><div class="orb" style="width:64px;height:64px;border-radius:20px">${icon(V.q ? 'search' : FOLDERS.find((f) => f[0] === V.folder)[2], 26)}</div><h3>${V.q ? 'Ничего не нашлось' : V.folder === 'unread' ? 'Всё прочитано' : 'Пусто'}</h3><p>${V.q ? 'Попробуй другой запрос' : V.folder === 'unread' ? 'Новых сообщений нет — можно выдохнуть ✨' : V.folder === 'pinned' ? 'Закрепи чат через правый клик' : 'Здесь появятся чаты'}</p></div>`;
    return;
  }
  if (!listEl.querySelector('.ci')) listEl.innerHTML = '';
  const keep = new Set(list.map((c) => c.id));
  for (const [id, e] of items)
    if (!keep.has(id)) {
      e.remove();
      items.delete(id);
    }
  const isNew = [];
  flip(listEl, () => {
    list.forEach((c, i) => {
      let e = items.get(c.id);
      const sig = JSON.stringify([c.name, c.preview, c.time, c.unread, c.avatar, meta(c.id)]);
      if (!e) {
        e = el(`<div class="ci" data-node="${esc(c.id)}"></div>`);
        e.onclick = () => openChat(c.id);
        e.oncontextmenu = (ev) => {
          ev.preventDefault();
          chatMenu(ev.clientX, ev.clientY, c.id);
        };
        items.set(c.id, e);
        if (!fromFolder && listEl.children.length) isNew.push(e);
      } else if (e.dataset.sig !== sig && e.dataset.sig && JSON.parse(e.dataset.sig)[1] !== c.preview && c.unread) isNew.push(e);
      if (e.dataset.sig !== sig) {
        e.innerHTML = itemHtml(c);
        e.dataset.sig = sig;
      }
      e.classList.toggle('unread', c.unread);
      e.classList.toggle('muted', !!meta(c.id).muted);
      e.classList.toggle('on', c.id === V.open);
      if (listEl.children[i] !== e) listEl.insertBefore(e, listEl.children[i] || null);
    });
  });
  for (const e of isNew) {
    e.classList.remove('new');
    void e.offsetWidth;
    e.classList.add('new');
  }
  if (fromFolder) listEl.querySelectorAll('.ci').forEach((e, i) => i < 14 && e.animate([{ opacity: 0, transform: 'translateX(-8px)' }, { opacity: 1, transform: 'none' }], { duration: 300, delay: i * 18, easing: 'ease-out', fill: 'backwards' }));
}

/** ID собеседника в личном чате (node = users-A-B) — для украшений ников Lumen FX. */
function peerUid(c) {
  const [a, b] = c.users || [];
  const me = String(S.me?.userId || '');
  if (a && b) return a === me ? b : a;
  return meta(c.id).uid || '';
}

// В списке чатов FunPay не пишет, кто собеседник. Узнаём один раз по истории чата (она не отмечает чат прочитанным)
// и запоминаем — нужно, чтобы и в списке были видны украшения ников Lumen FX.
const uidTried = new Set();
let uidBusy = false;
async function resolveUids() {
  if (uidBusy || !S.backend?.history || S.demo) return;
  uidBusy = true;
  try {
    const me = String(S.me?.userId || '');
    for (const c of CS.chats.slice(0, 60)) {
      if (!S.backend?.history || peerUid(c) || uidTried.has(c.id)) continue;
      uidTried.add(c.id);
      try {
        const h = await S.backend.history(c.id, 0);
        const m = /users-(\d+)-(\d+)/.exec(h.nodeName || '');
        let uid = m ? (m[1] === me ? m[2] : m[1]) : '';
        if (!uid) uid = (h.messages || []).map((x) => String(x.authorId || '')).find((x) => x && x !== '0' && x !== me) || '';
        if (uid) setMeta(c.id, { uid });
      } catch {}
      await new Promise((r) => setTimeout(r, 1200)); // бережно к FunPay: не чаще раза в секунду
    }
  } finally {
    uidBusy = false;
  }
}

function chatMenu(x, y, node) {
  const c = CS.chats.find((i) => i.id === node) || { id: node, name: V.page?.peerName || '' };
  const m = meta(node);
  const uid = peerUid(c) || (V.open === node ? V.page?.peerId : '');
  menu(x, y, [
    { header: c.name || 'Чат' },
    { label: m.pinned ? 'Открепить' : 'Закрепить сверху', icon: 'pin', run: () => setMeta(node, { pinned: m.pinned ? false : Date.now() }) },
    { label: m.muted ? 'Включить звук' : 'Без звука', icon: m.muted ? 'bell' : 'bellOff', run: () => setMeta(node, { muted: !m.muted }) },
    c.unread && { label: 'Отметить прочитанным', icon: 'checks', run: () => S.backend.markRead(node).then(pollNow).catch(err.bind(null, 'Не вышло')) },
    { label: m.archived ? 'Вернуть из архива' : 'Убрать в архив', icon: 'archive', run: () => setMeta(node, { archived: !m.archived }) },
    '-',
    { label: m.note ? 'Изменить заметку' : 'Добавить заметку', icon: 'edit', run: () => noteEdit(node, c.name) },
    { label: 'Цветная метка', icon: 'tag', run: () => nickMenu(x, y, node, c.name) },
    '-',
    uid && { label: 'Профиль покупателя', icon: 'user', run: () => openProfile(uid) },
    { label: 'Открыть на FunPay', icon: 'external', run: () => S.backend.openBrowser(`https://funpay.com/chat/?node=${node}`) },
  ]);
}

function nickMenu(x, y, node, name) {
  const m = meta(node);
  menu(x, y, [
    { header: `Метка для ${name}` },
    ...Object.entries({ '': 'Без метки', violet: 'Фиолетовая', ocean: 'Синяя', mint: 'Зелёная', sunset: 'Оранжевая', rose: 'Красная', gold: 'Жёлтая' }).map(([k, v]) => ({ label: v, icon: (m.tag || '') === k ? 'check' : 'tag', run: () => setMeta(node, { tag: k || false }) })),
  ]);
}

async function noteEdit(node, name) {
  const v = await promptBox(`Заметка: ${name}`, { text: 'Видна только тебе — в шапке чата.', value: meta(node).note || '', multiline: true, placeholder: 'Например: постоянный покупатель, просит скидку' });
  if (v !== null) setMeta(node, { note: v.trim() });
}

// ---------------------------------------------------------------- чат

function renderEmpty() {
  chatEl.innerHTML = `<div class="empty"><div class="orb">${icon('chat', 34)}</div><h3>Выбери чат</h3><p>Сообщения приходят сами. <span class="kbd" style="margin:0">Ctrl K</span> — быстрый поиск чата, заказа или действия.</p></div>`;
}

export async function openChat(node) {
  if (!node) return;
  if (V.open === node && V.page) {
    ta?.focus();
    return;
  }
  const my = ++V.gen;
  Object.assign(V, { open: node, page: null, msgs: [], ids: new Set(), more: false, reply: null, attach: null, pending: [], below: 0 });
  items.forEach((e, id) => e.classList.toggle('on', id === node));
  chatEl.innerHTML = `<div class="chat-head"><div class="skel" style="width:42px;height:42px;border-radius:50%"></div><div class="col" style="gap:6px"><div class="skel" style="width:140px;height:13px"></div><div class="skel" style="width:80px;height:10px"></div></div></div><div class="msgs"><div class="msgs-inner">${[60, 40, 70, 35, 55].map((w, i) => `<div class="skel" style="height:38px;width:${w}%;border-radius:18px;margin:6px 0;${i % 2 ? 'align-self:flex-end' : ''}"></div>`).join('')}</div></div>`;
  try {
    const page = await S.backend.openChat(node);
    if (my !== V.gen) return;
    V.page = page;
    if (page.nodeId && page.nodeId !== node) V.open = page.nodeId;
    const c = CS.chats.find((x) => x.id === V.open);
    if (c && !page.peerAvatar && c.avatar) page.peerAvatar = c.avatar;
    if (page.peerId && meta(V.open).uid !== String(page.peerId)) setMeta(V.open, { uid: String(page.peerId) });
    if (c && c.unread) {
      c.unread = false;
      renderList();
    }
    buildChat();
    setMessages(page.messages);
    V.more = page.messages.length >= 20;
    scrollBottom(false);
    ta.focus();
    pollNow();
  } catch (e) {
    if (my !== V.gen) return;
    chatEl.innerHTML = `<div class="empty"><div class="orb" style="color:var(--bad)">${icon('alert', 30)}</div><h3>Чат не открылся</h3><p>${esc(e.message)}</p><button class="btn pri" data-retry>${icon('refresh', 16)}Ещё раз</button></div>`;
    $('[data-retry]', chatEl).onclick = () => {
      V.open = null;
      openChat(node);
    };
  }
}

function buildChat() {
  chatEl.innerHTML = `
    <div class="chat-head"></div>
    <div class="lot-bar" hidden></div>
    <div class="msgs"><div class="msgs-inner"></div></div>
    <button class="to-bottom">${icon('down', 20)}</button>
    <div class="composer">
      <div class="later-bar"></div>
      <div class="tpl-bar"></div>
      <div class="extra"></div>
      <div class="cbox">
        <button class="ibtn" data-act="attach" data-tip="Картинка (или Ctrl+V)">${icon('clip', 20)}</button>
        <textarea rows="1" placeholder="Сообщение…  «/» — шаблоны" spellcheck="true"></textarea>
        ${S.settings.ai?.key ? `<button class="ibtn" data-act="ai" data-tip="Переписать вежливо (ИИ)">${icon('wand', 19)}</button>` : ''}
        <button class="ibtn" data-act="later" data-tip="Отправить позже">${icon('clock', 19)}</button>
        <button class="send idle" data-act="send">${icon('send', 18)}</button>
      </div>
    </div>
    <div class="drop-zone">${icon('image', 26)}&nbsp; Отпусти, чтобы отправить картинку</div>
    <input type="file" accept="image/*" hidden>`;
  msgsEl = $('.msgs', chatEl);
  innerEl = $('.msgs-inner', chatEl);
  ta = $('textarea', chatEl);
  renderHead();
  renderTplBar();
  renderLater();
  wireComposer();
  const fab = $('.to-bottom', chatEl);
  fab.onclick = () => scrollBottom(true);
  innerEl.addEventListener('load', () => V.stick && (msgsEl.scrollTop = msgsEl.scrollHeight), true);
  msgsEl.addEventListener('scroll', () => {
    const near = atBottom();
    V.stick = near;
    fab.classList.toggle('show', !near);
    if (near && V.below) {
      V.below = 0;
      fab.innerHTML = icon('down', 20);
    }
    if (msgsEl.scrollTop < 80) loadMore();
  });
  innerEl.addEventListener('click', onMsgClick);
}

function lastOrderId() {
  for (let i = V.msgs.length - 1; i >= 0; i--) {
    const ids = findOrderIds(V.msgs[i].text);
    if (ids.length) return ids[ids.length - 1];
  }
  return '';
}

function renderHead() {
  const p = V.page;
  if (!p) return;
  const head = $('.chat-head', chatEl);
  const online = /онлайн|online/i.test(p.peerStatus);
  const oid = lastOrderId();
  const mt = meta(V.open);
  const note = mt.note;
  const pinned = !!mt.pinned;
  const muted = !!mt.muted;
  head.innerHTML = `
    <div class="who" data-act="profile">
      <span class="av-wrap">${avatar(p.peerAvatar, p.peerName || p.nodeName, 42, '', p.peerId)}${online ? '<span class="on-dot"></span>' : ''}</span>
      <div style="min-width:0"><div class="nm ell">${peerNick(V.open, p.peerName || p.nodeName, '', p.peerId)}</div><div class="st ${online ? 'online' : ''}">${esc(p.peerStatus || ' ')}${note ? `<span class="dim ell" style="max-width:240px">· ${esc(note)}</span>` : ''}</div></div>
    </div>
    <div class="grow"></div>
    ${oid ? `<button class="btn sm" data-act="order" data-tip="Последний заказ в этом чате">${icon('bag', 15)}#${oid}</button>` : ''}
    <button class="ibtn ${pinned ? 'on' : ''}" data-act="pin" data-tip="${pinned ? 'Открепить чат' : 'Закрепить чат сверху'}">${icon('pin', 18)}</button>
    <button class="ibtn ${muted ? 'on' : ''}" data-act="mute" data-tip="${muted ? 'Включить звук' : 'Без звука'}">${icon(muted ? 'bellOff' : 'bell', 18)}</button>
    <button class="ibtn" data-act="browser" data-tip="Открыть на FunPay">${icon('external', 18)}</button>
    <button class="ibtn" data-act="more" data-tip="Ещё">${icon('more', 18)}</button>`;
  head.onclick = (e) => {
    const a = e.target.closest('[data-act]')?.dataset.act;
    if (a === 'profile' && p.peerId) openProfile(p.peerId);
    if (a === 'lot' && p.lotUrl) S.backend.openBrowser(p.lotUrl);
    if (a === 'order') openOrder(oid);
    if (a === 'pin') {
      setMeta(V.open, { pinned: pinned ? false : Date.now() });
      ok(pinned ? 'Чат откреплён' : 'Чат закреплён', pinned ? '' : 'Он теперь всегда сверху списка', { ms: 2200 });
    }
    if (a === 'mute') {
      setMeta(V.open, { muted: !muted });
      ok(muted ? 'Звук включён' : 'Без звука', muted ? '' : 'Уведомлений от этого чата не будет', { ms: 2200 });
    }
    if (a === 'browser') S.backend.openBrowser(`https://funpay.com/chat/?node=${V.open}`);
    if (a === 'more') {
      const r = e.target.closest('[data-act]').getBoundingClientRect();
      chatMenu(r.left - 170, r.bottom + 6, V.open);
    }
  };
  renderLot();
}

/** Полоска под шапкой: какой лот смотрит покупатель — полное название. */
function renderLot() {
  const p = V.page;
  const bar = $('.lot-bar', chatEl);
  if (!bar) return;
  if (!p?.lotName) {
    bar.hidden = true;
    bar.dataset.k = '';
    return;
  }
  if (bar.dataset.k === p.lotName && !bar.hidden) return;
  bar.dataset.k = p.lotName;
  bar.hidden = false;
  bar.classList.remove('open');
  bar.innerHTML = `
    <span class="lb-ic">${icon('box', 16)}</span>
    <div class="lb-txt" data-act="toggle" title="Нажми, чтобы показать целиком">
      <div class="lb-k">Смотрит лот</div>
      <div class="lb-v">${esc(p.lotName)}</div>
    </div>
    <button class="ibtn" data-act="copy" data-tip="Скопировать название">${icon('copy', 16)}</button>
    ${p.lotUrl ? `<button class="btn sm" data-act="open">${icon('external', 14)}Открыть</button>` : ''}`;
  const v = $('.lb-v', bar);
  requestAnimationFrame(() => bar.classList.toggle('long', v.scrollHeight > v.clientHeight + 1));
  bar.onclick = (e) => {
    const a = e.target.closest('[data-act]')?.dataset.act;
    if (a === 'toggle' && (bar.classList.contains('long') || bar.classList.contains('open'))) bar.classList.toggle('open');
    if (a === 'copy') copyText(p.lotName);
    if (a === 'open' && p.lotUrl) S.backend.openBrowser(p.lotUrl);
  };
}

// ---------------------------------------------------------------- сообщения

const isSys = (m) => m.authorId === '0';
const isMine = (m) => S.me && m.authorId === String(S.me.userId);
const sameGroup = (a, b) => a && b && !isSys(a) && !isSys(b) && a.authorId === b.authorId && Math.abs((b.ts || 0) - (a.ts || 0)) < 6 * 60e3 && dayKey(new Date(a.ts)) === dayKey(new Date(b.ts));

function sysKind(t) {
  if (/оплатил заказ|paid for order/i.test(t)) return ['paid', 'cash', 'Новый заказ'];
  if (/подтвердил успешное выполнение|confirmed/i.test(t)) return ['done', 'checks', 'Заказ выполнен'];
  if (/вернул деньги|возврат|refund/i.test(t)) return ['refund', 'undo', 'Возврат'];
  if (/отзыв|review/i.test(t)) return ['done', 'star', 'Отзыв'];
  return ['', 'info', 'FunPay'];
}

function sysHtml(m) {
  const [k, ic, t] = sysKind(m.text);
  const id = findOrderIds(m.text)[0];
  return `<div class="sys ${k}" data-id="${m.id}"><span class="sys-ic">${icon(ic, 18)}</span><div class="grow"><div class="sys-t">${t}<span class="dim" style="font-weight:500">${hhmm(m.ts ? new Date(m.ts) : null)}</span></div><div class="sys-txt">${richText(m.text)}</div>${id ? `<button class="btn sm" data-order="${id}">${icon('bag', 14)}Открыть заказ</button>` : ''}</div></div>`;
}

function bubbleHtml(m, anim) {
  const mine = isMine(m);
  let body = '';
  const rq = /^╭─\s*⤸\s?([\s\S]*?)\n╰\s?([\s\S]*)$/.exec(m.text || '');
  if (rq) body = `<div class="quote">${esc(rq[1])}</div>${richText(rq[2])}`;
  else body = richText(m.text || '');
  const img = m.image ? `<div class="bub-img" data-img="${esc(m.image)}"><img src="${esc(m.thumb || m.image)}" alt="" loading="lazy"></div>` : '';
  const st = m.pending ? icon('clock', 12) : mine ? icon('checks', 13) : '';
  const full = m.ts ? new Date(m.ts).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';
  const meta_ = `<span class="meta" title="${esc(full)}">${hhmm(m.ts ? new Date(m.ts) : null)}${st}</span>`;
  const onlyImg = m.image && !m.text;
  return `<div class="bub ${anim ? 'in' : ''} ${m.pending ? 'pending' : ''} ${onlyImg ? 'img-only' : ''}" data-id="${m.id}">${img}${body}${meta_}<div class="acts"><div class="acts-in"><button data-a="reply" title="Ответить">${icon('reply', 15)}</button><button data-a="copy" title="Копировать">${icon('copy', 14)}</button></div></div></div>`;
}

function groupEl(m) {
  const mine = isMine(m);
  if (!m.author && V.page && m.authorId === V.page.peerId) m.author = V.page.peerName;
  const name = !mine ? `<div class="grp-name">${peerNick(V.open, m.author, '', m.authorId !== '0' ? m.authorId : '')}${m.badge ? `<span class="pill acc">${esc(m.badge)}</span>` : ''}</div>` : '';
  const g = el(`<div class="grp ${mine ? 'mine' : ''}" data-author="${esc(m.authorId)}">${!mine ? avatar(m.avatar || (m.authorId === V.page?.peerId ? V.page.peerAvatar : ''), m.author, 32, '', m.authorId !== '0' ? m.authorId : '') : ''}<div class="grp-body">${name}</div></div>`);
  return g;
}

function setMessages(list) {
  V.msgs = list.slice().sort((a, b) => a.id - b.id);
  V.ids = new Set(V.msgs.map((m) => m.id));
  innerEl.innerHTML = '';
  appendDom(V.msgs, false);
  renderHead();
}

function appendDom(list, anim) {
  // с чем склеивать — только с тем, что реально стоит последним в ленте (не «самым поздним по времени»:
  // часы компьютера и FunPay могут расходиться, и своё сообщение прилипало к группе покупателя — слева)
  let prev = innerEl.lastElementChild?._m || null;
  // какой день уже подписан последним — берём из самой ленты, чтобы «Сегодня» не повторялось (иначе плашки слипаются стопкой)
  const days = innerEl.querySelectorAll('.day');
  let lastDay = days.length ? days[days.length - 1].dataset.k : '';
  for (const m of list) {
    const d = m.ts ? new Date(m.ts) : null;
    if (d && dayKey(d) !== lastDay) {
      lastDay = dayKey(d);
      innerEl.append(el(`<div class="day" data-k="${esc(String(lastDay))}">${dayLabel(d)}</div>`));
    }
    if (isSys(m)) innerEl.append(el(sysHtml(m)));
    else {
      let g = innerEl.lastElementChild;
      if (!sameGroup(prev, m) || !g?.classList.contains('grp') || g.dataset.author !== String(m.authorId)) {
        g = groupEl(m);
        innerEl.append(g);
      }
      g.querySelector('.grp-body').insertAdjacentHTML('beforeend', bubbleHtml(m, anim));
    }
    innerEl.lastElementChild._m = m;
    prev = m;
  }
}

function onMessages(list) {
  const fresh = list.filter((m) => !V.ids.has(m.id)).sort((a, b) => a.id - b.id);
  if (!fresh.length) return;
  const bottom = atBottom();
  const toAppend = [];
  const confirmed = [];
  for (const m of fresh) {
    V.ids.add(m.id);
    V.msgs.push(m);
    if (isMine(m)) {
      const i = V.pending.findIndex((p) => (m.image ? p.m.image : !p.m.image && stripZW(p.m.text).trim() === stripZW(m.text).trim()));
      if (i >= 0) {
        const p = V.pending.splice(i, 1)[0];
        const b = innerEl.querySelector(`[data-id="${p.m.id}"]`);
        if (b) {
          b.dataset.id = m.id;
          b.classList.remove('pending');
          const mt = b.querySelector('.meta');
          if (mt) mt.innerHTML = `${hhmm(new Date(m.ts || Date.now()))}${icon('checks', 13)}`;
          confirmed.push(m.id);
          continue;
        }
      }
    }
    toAppend.push(m);
  }
  // FunPay ставит сообщения строго по порядку. Если покупатель написал, пока наше сообщение было «в пути»,
  // его сообщение должно стоять выше нашего — перерисовываем ленту (раньше наше оставалось выше до перезахода)
  const outOfOrder = toAppend.length && (V.pending.length || confirmed.some((id) => toAppend.some((t) => t.id < id)));
  if (outOfOrder) rebuild();
  else appendDom(toAppend, true);
  if (toAppend.some(isSys) || toAppend.some((m) => findOrderIds(m.text).length)) renderHead();
  if (bottom || toAppend.some(isMine)) scrollBottom(true);
  else if (toAppend.length) {
    V.below += toAppend.length;
    const fab = $('.to-bottom', chatEl);
    fab.innerHTML = `${icon('down', 20)}<span class="badge">${V.below}</span>`;
    fab.classList.add('show');
  }
}

/** Перерисовать ленту по порядку id; неотправленные/«в пути» — в самом низу. */
function rebuild() {
  const top = msgsEl.scrollTop;
  const pending = V.pending.slice();
  setMessages(V.msgs);
  V.pending = [];
  for (const p of pending) {
    V.pending.push(p);
    appendDom([p.m], false);
    if (p.failed) {
      const b = innerEl.querySelector(`[data-id="${p.m.id}"]`);
      if (b) Object.assign(b, { _p: p, title: 'Не отправлено: ' + p.failed + '. Нажми, чтобы повторить' }).classList.add('failed');
    }
  }
  msgsEl.scrollTop = top;
}

async function loadMore() {
  if (!V.more || V.loadingMore || !V.msgs.length) return;
  V.loadingMore = true;
  const node = V.open;
  const spin = el('<div class="loading-more"><div class="spinner"></div></div>');
  innerEl.prepend(spin);
  try {
    const r = await S.backend.history(node, V.msgs[0].id);
    if (node !== V.open) return;
    const older = r.messages.filter((m) => !V.ids.has(m.id));
    V.more = r.more && older.length > 0;
    if (older.length) {
      const h = msgsEl.scrollHeight - msgsEl.scrollTop;
      const pending = V.pending.slice();
      setMessages([...older, ...V.msgs]);
      V.pending = [];
      for (const p of pending) {
        V.pending.push(p);
        appendDom([p.m], false);
      }
      msgsEl.scrollTop = msgsEl.scrollHeight - h;
    }
  } catch (e) {
    V.more = false;
  } finally {
    spin.remove();
    V.loadingMore = false;
  }
}

const atBottom = () => !msgsEl || msgsEl.scrollHeight - msgsEl.scrollTop - msgsEl.clientHeight < 90;
function scrollBottom(smooth) {
  if (!msgsEl) return;
  V.stick = true;
  requestAnimationFrame(() => msgsEl.scrollTo({ top: msgsEl.scrollHeight, behavior: smooth && document.documentElement.dataset.anim !== 'off' ? 'smooth' : 'auto' }));
}

function onMsgClick(e) {
  const o = e.target.closest('[data-order]');
  if (o) return openOrder(o.dataset.order);
  const x = e.target.closest('[data-ext]');
  if (x) {
    e.preventDefault();
    const u = x.dataset.ext;
    return /^https:\/\/funpay\.com\//.test(u) ? S.backend.openBrowser(u) : window.api ? window.api.app.open(u) : window.open(u);
  }
  const im = e.target.closest('[data-img]');
  if (im) return lightbox(im.dataset.img);
  const a = e.target.closest('[data-a]');
  if (a) {
    const b = a.closest('.bub');
    const m = V.msgs.find((x) => String(x.id) === b.dataset.id) || V.pending.find((p) => String(p.m.id) === b.dataset.id)?.m;
    if (!m) return;
    if (a.dataset.a === 'copy') copyText(m.text).then(() => ok('Скопировано'));
    if (a.dataset.a === 'reply') setReply(m);
  }
  const f = e.target.closest('.bub.failed');
  if (f) retry(f);
}

// ---------------------------------------------------------------- ввод

function tplCtx() {
  return { username: V.page?.peerName, myName: S.me?.username, orderId: lastOrderId(), lotName: V.page?.lotName };
}

const TPL_COLORS = { violet: '#a78bfa', ocean: '#38bdf8', mint: '#34d399', sunset: '#fb923c', rose: '#fb7185', gold: '#fbbf24' };
function renderTplBar() {
  const bar = $('.tpl-bar', chatEl);
  if (!bar) return;
  if (!S.settings.templatesBar) {
    bar.innerHTML = '';
    return;
  }
  bar.innerHTML =
    S.templates.map((t, i) => `<button class="tpl" data-i="${i}" style="--tc:${TPL_COLORS[t.color] || t.color || 'var(--a1)'}" data-tip="${esc(t.text.slice(0, 120))}"><i></i>${esc(t.name)}${i < 9 ? `<kbd>Alt+${i + 1}</kbd>` : ''}</button>`).join('') + `<button class="tpl add" data-add data-tip="Новый шаблон">${icon('plus', 15)}</button>`;
  bar.onclick = (e) => {
    const b = e.target.closest('[data-i]');
    if (b) useTemplate(S.templates[+b.dataset.i]);
    if (e.target.closest('[data-add]')) addTemplateFromDraft();
  };
}

async function addTemplateFromDraft() {
  const text = await promptBox('Новый шаблон', { text: 'Можно использовать $username, $welcome, $order_id, $lot_name.', value: ta.value, multiline: true, placeholder: 'Текст шаблона' });
  if (!text?.trim()) return;
  const name = (await promptBox('Название кнопки', { value: text.trim().split(/\s+/).slice(0, 2).join(' ').slice(0, 18) })) || 'Шаблон';
  S.templates.push({ id: 't' + Date.now(), name, text, color: 'violet', send: false });
  saveTemplates();
  ok('Шаблон добавлен');
}

function useTemplate(t) {
  if (!t) return;
  const text = fill(t.text, tplCtx());
  if (t.send) return sendText(text);
  const s = ta.selectionStart,
    e = ta.selectionEnd;
  ta.setRangeText(text, s, e, 'end');
  ta.dispatchEvent(new Event('input'));
  ta.focus();
}

function setReply(m) {
  V.reply = m;
  renderExtra();
  ta.focus();
}

function setAttach(file) {
  if (!file || !file.type.startsWith('image/')) return;
  V.attach = file;
  renderExtra();
  updateSend();
}

function renderExtra() {
  const x = $('.extra', chatEl);
  let h = '';
  if (V.reply) {
    const t = (V.reply.text || 'Изображение').replace(/^╭─[\s\S]*?╰\s?/, '');
    h += `<div class="reply-bar">${icon('reply', 16)}<div class="ell"><b>${esc(V.reply.author)}</b> <span class="muted">${esc(t)}</span></div><button class="ibtn" data-x="reply">${icon('x', 16)}</button></div>`;
  }
  if (V.attach) h += `<div class="attach-bar"><img src="${URL.createObjectURL(V.attach)}"><div class="grow ell">${esc(V.attach.name || 'картинка')}<div class="dim" style="font-size:12px">${Math.round(V.attach.size / 1024)} КБ · Enter — отправить</div></div><button class="ibtn" data-x="attach">${icon('x', 16)}</button></div>`;
  x.innerHTML = h;
  x.onclick = (e) => {
    const b = e.target.closest('[data-x]');
    if (!b) return;
    V[b.dataset.x] = null;
    renderExtra();
    updateSend();
  };
}

function updateSend() {
  $('.send', chatEl)?.classList.toggle('idle', !ta.value.trim() && !V.attach);
}

let slash = null;
function wireComposer() {
  const fileIn = $('input[type=file]', chatEl);
  const autosize = () => {
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 180) + 'px';
  };
  ta.addEventListener('input', () => {
    autosize();
    updateSend();
    slashUpdate();
  });
  ta.addEventListener('keydown', (e) => {
    if (slash && slashKey(e)) return;
    if (e.key === 'Enter' && !e.shiftKey && (S.settings.sendOnEnter || e.ctrlKey)) {
      e.preventDefault();
      submit();
    }
    if (e.key === 'Escape' && V.reply) {
      V.reply = null;
      renderExtra();
    }
  });
  ta.addEventListener('paste', (e) => {
    const f = [...(e.clipboardData?.files || [])].find((x) => x.type.startsWith('image/'));
    if (f) {
      e.preventDefault();
      setAttach(f);
    }
  });
  fileIn.onchange = () => {
    setAttach(fileIn.files[0]);
    fileIn.value = '';
  };
}

function slashUpdate() {
  const v = ta.value;
  if (!v.startsWith('/') || v.includes('\n')) return slashClose();
  const q = v.slice(1).toLowerCase();
  const list = S.templates.map((t, i) => ({ t, i })).filter(({ t }) => !q || t.name.toLowerCase().includes(q) || t.text.toLowerCase().includes(q));
  if (!list.length) return slashClose();
  slash ||= { sel: 0, el: null };
  slash.list = list;
  slash.sel = Math.min(slash.sel, list.length - 1);
  slash.el?.remove();
  slash.el = el(`<div class="slash">${list.map(({ t }, j) => `<div class="slash-it ${j === slash.sel ? 'on' : ''}" data-j="${j}"><b>${esc(t.name)}</b><span class="ell">${esc(fill(t.text, tplCtx()))}</span></div>`).join('')}</div>`);
  slash.el.onmousedown = (e) => {
    const it = e.target.closest('[data-j]');
    if (it) {
      e.preventDefault();
      slashPick(+it.dataset.j);
    }
  };
  $('.composer', chatEl).append(slash.el);
}
function slashClose() {
  slash?.el?.remove();
  slash = null;
}
function slashPick(j) {
  const t = slash.list[j].t;
  slashClose();
  ta.value = '';
  useTemplate(t);
  ta.dispatchEvent(new Event('input'));
}
function slashKey(e) {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    slash.sel = (slash.sel + (e.key === 'ArrowDown' ? 1 : -1) + slash.list.length) % slash.list.length;
    slashUpdate();
    return true;
  }
  if (e.key === 'Enter' || e.key === 'Tab') {
    e.preventDefault();
    slashPick(slash.sel);
    return true;
  }
  if (e.key === 'Escape') {
    slashClose();
    return true;
  }
  return false;
}

function submit() {
  const text = ta.value.trim();
  if (V.attach) {
    const f = V.attach;
    V.attach = null;
    renderExtra();
    sendImage(f);
  }
  if (text) {
    let out = text;
    if (V.reply) {
      const q = (V.reply.text || 'Изображение').replace(/^╭─[\s\S]*?╰\s?/, '').replace(/\s+/g, ' ');
      out = `╭─ ⤸ ${q.length > 70 ? q.slice(0, 67) + '…' : q}\n╰ ${text}`;
      V.reply = null;
      renderExtra();
    }
    ta.value = '';
    ta.dispatchEvent(new Event('input'));
    sendText(out);
  }
  const s = $('.send', chatEl);
  s.classList.remove('fly');
  void s.offsetWidth;
  s.classList.add('fly');
}

let pid = 0;
function addPending(m) {
  const p = { m: { id: 'p' + ++pid, authorId: String(S.me.userId), author: S.me.username, ts: Date.now(), pending: true, ...m } };
  V.pending.push(p);
  appendDom([p.m], true);
  scrollBottom(true);
  return p;
}

async function sendText(text, p) {
  const node = V.open;
  p ||= addPending({ text });
  try {
    await S.backend.send(node, text);
    const b = innerEl?.querySelector(`[data-id="${p.m.id}"] .meta`);
    if (b) b.innerHTML = `${hhmm(new Date())}${icon('check', 13)}`;
    pollNow();
  } catch (e) {
    markFailed(p, e);
  }
}

async function sendImage(file, p) {
  const node = V.open;
  const url = URL.createObjectURL(file);
  p ||= addPending({ text: '', image: url, thumb: url, file });
  try {
    await S.backend.sendImage(node, file);
    pollNow();
  } catch (e) {
    markFailed(p, e);
  }
}

function markFailed(p, e) {
  p.failed = e.message;
  const b = innerEl?.querySelector(`[data-id="${p.m.id}"]`);
  if (b) {
    b.classList.add('failed');
    b.title = 'Не отправлено: ' + e.message + '. Нажми, чтобы повторить';
    b._p = p;
  }
  err('Сообщение не ушло', e);
}

function retry(b) {
  const p = b._p;
  if (!p) return;
  p.failed = '';
  b.classList.remove('failed');
  if (p.m.file) sendImage(p.m.file, p);
  else sendText(p.m.text, p);
}

async function aiRewrite(btn) {
  const draft = ta.value.trim();
  if (!draft) return toast('Сначала напиши черновик', 'ИИ перепишет его вежливо и грамотно');
  btn.classList.add('on');
  try {
    const hist = V.msgs.slice(-10).map((m) => `${isMine(m) ? 'Продавец' : isSys(m) ? 'FunPay' : 'Покупатель'}: ${m.text}`).join('\n');
    const out = await window.api.ai(S.settings.ai, [
      { role: 'system', content: 'Ты помогаешь продавцу на FunPay отвечать покупателям. Перепиши черновик продавца вежливо, коротко и грамотно, на языке переписки. Без лишних приветствий, если разговор уже идёт. Верни только текст ответа.' },
      { role: 'user', content: `Переписка:\n${hist}\n\nЧерновик продавца:\n${draft}` },
    ]);
    if (out) {
      ta.value = out;
      ta.dispatchEvent(new Event('input'));
    }
  } catch (e) {
    err('ИИ не ответил', e);
  } finally {
    btn.classList.remove('on');
  }
}

export function chatKeys(e) {
  if (e.altKey && /^Digit[1-9]$/.test(e.code) && ta && document.body.contains(ta)) {
    e.preventDefault();
    useTemplate(S.templates[+e.code.slice(5) - 1]);
    return true;
  }
  return false;
}

// ---------------------------------------------------------------- отложенные сообщения

function laterMenu() {
  // Окно «Отправить позже»: текст можно написать прямо здесь, время — одной кнопкой
  const node = V.open,
    name = V.page?.peerName || '';
  if (!node) return;
  const pad = (n) => String(n).padStart(2, '0');
  const local = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const ps = presets();
  const m = modal(`<button class="ibtn x" data-close>${icon('x', 18)}</button>
    <h3 style="display:flex;align-items:center;gap:8px">${icon('clock', 20)}Отправить позже</h3>
    <p>Сообщение уйдёт само в выбранное время. Lumen должен быть открыт (можно свернуть в трей).</p>
    <textarea class="input later-text" rows="3" placeholder="Текст сообщения для ${esc(name || 'покупателя')}"></textarea>
    <div class="later-when">${ps.map(([label], i) => `<button class="chip-btn ${i === 1 ? 'on' : ''}" data-p="${i}">${esc(label)}</button>`).join('')}<button class="chip-btn" data-p="c">${icon('edit', 13)}Своё время</button></div>
    <input class="input later-dt" type="datetime-local" hidden value="${local(new Date(Date.now() + 3600e3))}">
    <div class="later-sum dim"></div>
    <div class="modal-acts"><button class="btn ghost" data-close>Отмена</button><button class="btn pri" data-ok>${icon('clock', 15)}Отложить</button></div>`);
  const t = m.el.querySelector('.later-text');
  const dt = m.el.querySelector('.later-dt');
  const sum = m.el.querySelector('.later-sum');
  t.value = ta.value.trim();
  let pick = '1';
  const at = () => (pick === 'c' ? new Date(dt.value).getTime() : ps[+pick][1]);
  const upd = () => (sum.textContent = at() > Date.now() ? `Уйдёт ${whenText(at())}` : 'Это время уже прошло');
  m.el.querySelector('.later-when').onclick = (e) => {
    const b = e.target.closest('[data-p]');
    if (!b) return;
    pick = b.dataset.p;
    m.el.querySelectorAll('.chip-btn').forEach((x) => x.classList.toggle('on', x === b));
    dt.hidden = pick !== 'c';
    if (pick === 'c') dt.focus();
    upd();
  };
  dt.oninput = upd;
  upd();
  setTimeout(() => (t.value ? m.el.querySelector('[data-ok]') : t).focus(), 50);
  m.el.querySelector('[data-ok]').onclick = () => {
    const text = t.value.trim();
    if (!text) {
      t.focus();
      t.classList.add('nudge');
      setTimeout(() => t.classList.remove('nudge'), 400);
      return;
    }
    const when = at();
    if (!(when > Date.now())) return upd();
    addLater(node, name, text, when);
    if (ta.value.trim() === text) {
      ta.value = '';
      ta.dispatchEvent(new Event('input'));
    }
    m.close();
    ok('Сообщение отложено', `Уйдёт ${whenText(when)}`);
  };
}

function renderLater() {
  const bar = $('.later-bar', chatEl);
  if (!bar) return;
  const mine = L.list.filter((x) => x.chat === String(V.open));
  bar.innerHTML = mine
    .map((x) => `<div class="later-it" data-id="${x.id}">${icon('clock', 15)}<b>${esc(whenText(x.at))}</b><span class="ell grow">${esc(x.text)}</span><button class="btn sm ghost" data-now>Отправить сейчас</button><button class="ibtn" data-cancel data-tip="Отменить">${icon('x', 15)}</button></div>`)
    .join('');
  bar.onclick = (e) => {
    const it = e.target.closest('[data-id]');
    if (!it) return;
    if (e.target.closest('[data-now]')) sendLaterNow(it.dataset.id);
    if (e.target.closest('[data-cancel]')) cancelLater(it.dataset.id);
  };
}
