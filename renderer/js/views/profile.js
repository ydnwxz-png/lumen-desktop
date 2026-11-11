// Профиль любого пользователя: баннер, рейтинг, лоты, отзывы.
import { esc, avatar, hash, el, $ } from '../core/util.js';
import { icon } from '../core/icons.js';
import { S, bus } from '../core/state.js';
import { modal, err, stars } from '../ui/kit.js';
import { myNick, nickHtml } from '../features/nicks.js';
import { lotMenu } from '../features/lotlink.js';

export async function openProfile(userId) {
  const m = modal(`<button class="ibtn x" data-close>${icon('x', 18)}</button><div class="pbody"><div class="empty" style="height:420px"><div class="spinner"></div></div></div>`, { wide: true });
  const box = $('.pbody', m.el);
  let p;
  try {
    p = await S.backend.profile(userId);
  } catch (e) {
    box.innerHTML = `<div class="empty" style="height:300px"><div class="orb" style="color:var(--bad)">${icon('alert', 28)}</div><h3>Профиль не открылся</h3><p>${esc(e.message)}</p></div>`;
    return;
  }
  const mine = S.me && String(S.me.userId) === String(userId);
  const h = hash(p.name) % 360;
  const reviews = (list) => list.map((r) => `<div class="review"><div class="row">${stars(r.rating, 13)}<span class="dim" style="font-size:12px">${esc(r.date)}</span><span class="grow"></span>${r.order ? `<span class="oid">#${esc(r.order)}</span>` : ''}</div><div class="dim" style="font-size:12px;margin-top:6px">${esc(r.detail)}</div>${r.text ? `<div style="margin-top:6px" class="sel">${esc(r.text)}</div>` : ''}${r.reply ? `<div class="reply-box sel">${esc(r.reply)}</div>` : ''}</div>`).join('');
  box.innerHTML = `
    <div class="prof-banner" style="--h1:${h};--h2:${(h + 60) % 360}"><i></i><i></i></div>
    <div class="prof-top">${avatar(p.avatar, p.name, 96, '', userId)}
      <div class="grow" style="padding-bottom:6px"><div class="prof-name">${mine ? myNick(p.name) : nickHtml(p.name, 'none', '', '', '', userId)}</div><div class="${p.online ? '' : 'dim'}" style="font-size:13px;${p.online ? 'color:var(--ok)' : ''}">${esc(p.status || '')}</div></div>
      <div class="row" style="padding-bottom:10px">
        ${!mine && (p.chatId || p.chatNode) ? `<button class="btn pri" data-write>${icon('chat', 16)}Написать</button>` : ''}
        <button class="btn" data-fp>${icon('external', 16)}FunPay</button>
      </div>
    </div>
    <div class="prof-body">
      <div class="prof-stats stagger">
        <div class="stat"><div class="lbl">${icon('star', 14)}Рейтинг</div><div class="val">${esc(p.rating || '—')}<small>/ 5</small></div></div>
        <div class="stat"><div class="lbl">${icon('chat', 14)}Отзывы</div><div class="val" style="font-size:17px;margin-top:10px">${esc(p.reviewsCount || 'нет')}</div></div>
        <div class="stat"><div class="lbl">${icon('clock', 14)}На FunPay</div><div class="val" style="font-size:17px;margin-top:10px">${esc(p.regAgo || p.regDate || '—')}</div></div>
      </div>
      ${p.groups.length ? `<div class="sec-title">Лоты</div>${p.groups.map((g) => `<div class="card" style="margin-bottom:10px;padding:6px"><div class="row" style="padding:8px 10px"><b class="grow">${esc(g.name)}</b><span class="pill">${g.offers.length}</span></div><div style="max-height:380px;overflow-y:auto">${g.offers.map((o) => `<div class="offer-row" data-url="${esc(o.url)}" data-title="${esc(o.title)}" data-tip="Правый клик — скопировать ссылку"><span class="grow ell">${esc(o.title)}</span>${o.amount ? `<span class="dim" style="font-size:12px">${esc(o.amount)} шт</span>` : ''}<b class="price">${esc(o.price)}</b></div>`).join('')}</div></div>`).join('')}` : ''}
      <div class="sec-title">Отзывы</div>
      <div class="revs">${p.reviews.length ? reviews(p.reviews) : '<div class="dim">Отзывов пока нет</div>'}</div>
      ${p.cont ? '<div class="more-row"><button class="btn" data-more>Показать ещё</button></div>' : ''}
    </div>`;
  // правый клик по лоту — скопировать ссылку / название
  box.oncontextmenu = (e) => {
    const o = e.target.closest('.offer-row[data-url]');
    if (!o) return;
    e.preventDefault();
    const lot = { url: o.dataset.url, title: o.dataset.title };
    lotMenu(e.clientX, e.clientY, lot, ['-', { label: 'Открыть лот', icon: 'external', run: () => S.backend.openBrowser(o.dataset.url) }]);
  };
  box.onclick = async (e) => {
    if (e.target.closest('[data-write]')) {
      m.close();
      bus.emit('nav', 'chats');
      bus.emit('open-chat', p.chatId || p.chatNode);
    }
    if (e.target.closest('[data-fp]')) S.backend.openBrowser(`https://funpay.com/users/${userId}/`);
    const o = e.target.closest('[data-url]');
    if (o) S.backend.openBrowser(o.dataset.url);
    const more = e.target.closest('[data-more]');
    if (more) {
      more.classList.add('busy');
      try {
        const r = await S.backend.moreReviews(userId, p.cont);
        p.cont = r.next;
        $('.revs', box).insertAdjacentHTML('beforeend', reviews(r.reviews));
        if (!p.cont) more.parentNode.remove();
      } catch (x) {
        err('Не загрузилось', x);
      } finally {
        more.classList.remove('busy');
      }
    }
  };
}
