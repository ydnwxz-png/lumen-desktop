// © 2026 Lumen. Все права защищены. Копирование, изменение и распространение этого кода запрещены без разрешения автора (см. LICENSE).
// Мини-чат из «Сделок»: нажал на заказ — сбоку переписка с покупателем по этому заказу.
// Видно, выдал ли товар, можно ответить, листать заказы стрелками и сразу отправить в поддержку.
import { esc, avatar, richText } from '../core/util.js';
import { icon } from '../core/icons.js';
import { S, bus } from '../core/state.js';
import { drawer, ok, err } from '../ui/kit.js';
import { openOrder } from '../views/order.js';
import { openSupportPicker } from './support.js';

const STATE = { paid: ['info', 'Оплачен'], closed: ['ok', 'Закрыт'], refunded: ['warn', 'Возврат'] };

/** list — заказы из таблицы (для стрелок вверх/вниз), i — какой открыть. */
export function openQuickChat(list, i, { onChange } = {}) {
  let idx = i;
  const d = drawer('', {
    actions: `<button class="ibtn" data-prev data-tip="Предыдущий заказ (↑)">${icon('chevL', 18)}</button><button class="ibtn" data-next data-tip="Следующий заказ (↓)">${icon('chevR', 18)}</button>`,
  });
  d.el.classList.add('qc');
  let gen = 0;
  const show = async () => {
    const o = list[idx];
    const my = ++gen;
    d.setTitle(`#${o.id} · ${o.peer || ''}`);
    d.el.querySelector('[data-prev]').disabled = idx <= 0;
    d.el.querySelector('[data-next]').disabled = idx >= list.length - 1;
    const st = STATE[o.state] || ['', o.statusText || ''];
    d.body.innerHTML = `
      <div class="qc-ord">
        <div class="row" style="gap:10px;align-items:flex-start"><span class="pill ${st[0]}"><span class="dotc"></span>${esc(o.statusText || st[1])}</span><span class="grow"></span><b class="qc-price">${esc(o.price || '')}</b></div>
        <div class="qc-desc">${esc(o.desc || '')}</div>
        <div class="dim" style="font-size:12px">${esc(o.game || '')} · ${esc(o.date || '')}</div>
        <div class="row" style="gap:8px;margin-top:10px;flex-wrap:wrap">
          <button class="btn sm" data-order>${icon('bag', 14)}Заказ</button>
          <button class="btn sm" data-chat>${icon('chat', 14)}Открыть чат</button>
          ${o.state === 'paid' ? `<button class="btn sm" data-sup>${icon('alert', 14)}В поддержку</button>` : ''}
        </div>
      </div>
      <div class="qc-msgs" data-msgs><div class="empty" style="padding:40px"><div class="spinner"></div></div></div>
      <form class="qc-send" data-form><input class="input" placeholder="Написать ${esc(o.peer || 'покупателю')}…" data-in autocomplete="off"><button class="btn pri" data-go>${icon('send', 15)}</button></form>`;
    let node = o.chatNode || '';
    let page = null;
    try {
      if (!node) {
        const full = await S.backend.order(o.id);
        node = full.chatNode || '';
      }
      if (my !== gen) return;
      if (!node) throw new Error('У этого заказа нет чата');
      page = await S.backend.openChat(node);
      if (my !== gen) return;
      const msgs = (page.messages || []).slice(-40);
      const me = String(S.me?.userId || '');
      const box = d.body.querySelector('[data-msgs]');
      // заказ в переписке: подсвечиваем сообщения про этот заказ
      box.innerHTML = msgs.length
        ? msgs
            .map((m) => {
              const mine = String(m.authorId) === me;
              const sys = m.authorId === '0' || /^FunPay$/i.test(m.author || '');
              const about = m.text && m.text.includes(o.id);
              if (sys) return `<div class="qc-sys ${about ? 'hot' : ''}">${richText(m.text || '')}</div>`;
              return `<div class="qc-m ${mine ? 'me' : ''} ${about ? 'hot' : ''}">${!mine && m.head ? `<span class="qc-a">${avatar(m.avatar, m.author, 22)}${esc(m.author || '')}</span>` : ''}${m.text ? `<div>${richText(m.text)}</div>` : ''}${m.thumb ? `<img src="${esc(m.thumb)}" alt="" loading="lazy">` : ''}<small>${esc((m.dateRaw || '').replace(/^.*?(\d{1,2}:\d{2}).*$/, '$1'))}</small></div>`;
            })
            .join('')
        : '<div class="dim" style="padding:20px;text-align:center">Сообщений нет</div>';
      box.scrollTop = box.scrollHeight;
      d.body.querySelector('[data-in]').focus();
    } catch (e) {
      if (my === gen) d.body.querySelector('[data-msgs]').innerHTML = `<div class="dim" style="padding:20px;text-align:center">${esc(e.message)}</div>`;
    }
    d.body.querySelector('[data-order]').onclick = () => (d.close(), openOrder(o.id, { onChange }));
    d.body.querySelector('[data-chat]').onclick = () => {
      if (!node) return;
      d.close();
      bus.emit('nav', 'chats');
      bus.emit('open-chat', page?.nodeId || node);
    };
    const sup = d.body.querySelector('[data-sup]');
    if (sup) sup.onclick = () => (d.close(), openSupportPicker());
    d.body.querySelector('[data-form]').onsubmit = async (e) => {
      e.preventDefault();
      const inp = d.body.querySelector('[data-in]');
      const t = inp.value.trim();
      if (!t || !node) return;
      inp.disabled = true;
      try {
        await S.backend.send(page?.nodeId || node, t);
        inp.value = '';
        ok('Отправлено', '');
        show();
      } catch (x) {
        err('Не отправилось', x);
      } finally {
        inp.disabled = false;
      }
    };
  };
  const go = (k) => {
    const n = idx + k;
    if (n < 0 || n >= list.length) return;
    idx = n;
    show();
  };
  d.el.querySelector('[data-prev]').onclick = () => go(-1);
  d.el.querySelector('[data-next]').onclick = () => go(1);
  const keys = (e) => {
    if (!document.body.contains(d.el)) return removeEventListener('keydown', keys);
    if (e.target.closest?.('input, textarea')) return;
    if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') (e.preventDefault(), go(-1));
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') (e.preventDefault(), go(1));
  };
  addEventListener('keydown', keys);
  show();
}
