// Шторка заказа: детали, возврат, подтверждение, отзыв и ответ на него.
import { esc, avatar, el, $ } from '../core/util.js';
import { icon } from '../core/icons.js';
import { S, bus } from '../core/state.js';
import { drawer, confirmBox, err, ok, stars, busy } from '../ui/kit.js';
import { nickHtml } from '../features/nicks.js';
import { openProfile } from './profile.js';

export async function openOrder(id, { onChange } = {}) {
  const d = drawer(`Заказ #${id}`, { actions: `<button class="ibtn" data-tip="Открыть на FunPay" data-ext>${icon('external', 18)}</button>` });
  d.head.querySelector('[data-ext]').onclick = () => S.backend.openBrowser(`https://funpay.com/orders/${id}/`);
  const load = async () => {
    d.body.innerHTML = `<div class="empty"><div class="spinner"></div></div>`;
    try {
      render(await S.backend.order(id));
    } catch (e) {
      d.body.innerHTML = `<div class="empty"><div class="orb" style="color:var(--bad)">${icon('alert', 28)}</div><h3>Заказ не открылся</h3><p>${esc(e.message)}</p></div>`;
    }
  };

  function render(o) {
    const kind = o.statusKind || 'info';
    const rv = o.review;
    d.body.innerHTML = `
      <div class="stagger">
        <div class="row" style="justify-content:space-between;align-items:flex-start">
          <div><div class="dim" style="font-size:12px;font-weight:600;margin-bottom:4px">${esc(o.game || 'Заказ')}</div><div class="big-price mono">${esc(o.price || '—')}</div></div>
          <span class="pill ${kind}"><span class="dotc"></span>${esc(o.status || '—')}</span>
        </div>
        ${o.shortDesc ? `<div style="margin-top:12px;font-size:14px;font-weight:550" class="sel">${esc(o.shortDesc)}</div>` : ''}
        ${o.peerName ? `<div class="peer-card" style="margin-top:16px" data-peer>${avatar(o.peerAvatar, o.peerName, 40, '', o.peerId)}<div class="grow"><div class="dim" style="font-size:12px">${o.isBuyer ? 'Продавец' : 'Покупатель'}</div><b>${nickHtml(o.peerName, 'none', '', '', '', o.peerId)}</b></div>${o.chatNode ? `<button class="btn sm" data-chat>${icon('chat', 15)}Чат</button>` : ''}${icon('chevR', 18, 'dim')}</div>` : ''}
        <dl class="kv">${o.params.map(([k, v]) => (v.includes('\n') || v.length > 70 ? `<dt class="wide">${esc(k)}</dt><dd class="wide text">${esc(v)}</dd>` : `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`)).join('')}</dl>
        <div class="sec-title">Отзыв</div>
        <div class="review-slot"></div>
      </div>`;
    const slot = $('.review-slot', d.body);
    if (rv) {
      slot.innerHTML = `<div class="review">${stars(rv.rating)}<div style="margin-top:8px" class="sel">${esc(rv.text) || '<span class="dim">Без текста</span>'}</div>${rv.reply ? `<div class="reply-box sel"><b style="font-size:12px">Твой ответ</b><br>${esc(rv.reply)}</div>` : ''}</div>`;
      if (!o.isBuyer) {
        slot.append(
          el(`<div class="col" style="margin-top:12px"><textarea class="textarea" rows="3" placeholder="Ответ на отзыв — его увидят все покупатели">${esc(rv.reply || '')}</textarea><div class="row"><button class="btn pri sm" data-reply>${icon('reply', 15)}${rv.reply ? 'Изменить ответ' : 'Ответить'}</button>${rv.reply ? `<button class="btn danger sm" data-del>${icon('trash', 15)}Удалить ответ</button>` : ''}<span class="grow"></span><button class="btn ghost sm" data-ty>${icon('sparkles', 15)}Шаблон</button></div></div>`)
        );
        const ta = $('textarea', slot);
        $('[data-ty]', slot).onclick = () => {
          ta.value = rv.rating >= 4 ? `Спасибо за отзыв, ${o.peerName}! Рад, что всё понравилось — заходи ещё 💜` : `${o.peerName}, жаль, что что-то пошло не так. Напиши в чат — разберёмся и всё исправим.`;
        };
        $('[data-reply]', slot).onclick = (e) =>
          busy(
            e.currentTarget,
            S.backend
              .review(o.id, ta.value.trim(), 5)
              .then(() => (ok('Ответ сохранён'), load()))
              .catch((x) => err('Не сохранилось', x))
          );
        $('[data-del]', slot) &&
          ($('[data-del]', slot).onclick = (e) =>
            busy(
              e.currentTarget,
              S.backend
                .reviewDelete(o.id)
                .then(() => (ok('Ответ удалён'), load()))
                .catch((x) => err('Не удалилось', x))
            ));
      }
    } else if (o.isBuyer) {
      let rating = 5;
      slot.innerHTML = `<div class="review col"><div class="stars pick">${[1, 2, 3, 4, 5].map((i) => `<button data-s="${i}" class="on">${icon('star', 22)}</button>`).join('')}</div><textarea class="textarea" rows="3" placeholder="Как всё прошло?"></textarea><div><button class="btn pri sm" data-send>${icon('send', 15)}Оставить отзыв</button></div></div>`;
      slot.querySelectorAll('[data-s]').forEach(
        (b) =>
          (b.onclick = () => {
            rating = +b.dataset.s;
            slot.querySelectorAll('[data-s]').forEach((x) => x.classList.toggle('on', +x.dataset.s <= rating));
          })
      );
      $('[data-send]', slot).onclick = (e) =>
        busy(
          e.currentTarget,
          S.backend
            .review(o.id, $('textarea', slot).value.trim(), rating)
            .then(() => (ok('Отзыв отправлен'), load()))
            .catch((x) => err('Не отправилось', x))
        );
    } else slot.innerHTML = `<div class="dim" style="font-size:13px">Покупатель пока не оставил отзыв</div>`;

    $('[data-peer]', d.body)?.addEventListener('click', (e) => {
      if (e.target.closest('[data-chat]')) {
        d.close();
        bus.emit('nav', 'chats');
        bus.emit('open-chat', o.chatNode);
      } else if (o.peerId) openProfile(o.peerId);
    });

    const foot = d.el.querySelector('.drawer-foot') || d.el.appendChild(el('<div class="drawer-foot"></div>'));
    foot.innerHTML = '';
    if (o.canRefund) {
      const b = el(`<button class="btn danger">${icon('undo', 16)}Вернуть деньги</button>`);
      b.onclick = async () => {
        if (!(await confirmBox('Вернуть деньги?', `Покупатель ${o.peerName || ''} получит ${o.price} обратно. Отменить это нельзя.`, { yes: 'Вернуть', danger: true }))) return;
        busy(
          b,
          S.backend
            .refund(o.id)
            .then(() => {
              ok('Деньги возвращены');
              onChange?.();
              load();
            })
            .catch((x) => err('Возврат не прошёл', x))
        );
      };
      foot.append(b);
    }
    if (o.canConfirm) {
      const b = el(`<button class="btn pri">${icon('check', 16)}Подтвердить выполнение</button>`);
      b.onclick = async () => {
        if (!(await confirmBox('Подтвердить заказ?', 'Деньги уйдут продавцу. Подтверждай, только если всё получил.', { yes: 'Подтвердить' }))) return;
        busy(
          b,
          S.backend
            .confirm(o.id)
            .then(() => {
              ok('Заказ подтверждён');
              onChange?.();
              load();
            })
            .catch((x) => err('Не вышло', x))
        );
      };
      foot.append(b);
    }
    if (o.lotUrl) {
      const b = el(`<button class="btn ghost">${icon('box', 16)}Лот</button>`);
      b.onclick = () => S.backend.openBrowser(o.lotUrl);
      foot.append(b);
    }
    if (!foot.children.length) foot.remove();
  }
  load();
}
