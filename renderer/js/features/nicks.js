// © 2026 Lumen. Все права защищены. Копирование, изменение и распространение этого кода запрещены без разрешения автора (см. LICENSE).
import { esc } from '../core/util.js';
import { S, meta } from '../core/state.js';

export const NICK_STYLES = [
  { id: 'none', name: 'Обычный' },
  { id: 'aurora', name: 'Аврора' },
  { id: 'sunset', name: 'Закат' },
  { id: 'gold', name: 'Золото' },
  { id: 'neon', name: 'Неон' },
  { id: 'fire', name: 'Огонь' },
  { id: 'ice', name: 'Лёд' },
  { id: 'rainbow', name: 'Радуга' },
  { id: 'toxic', name: 'Токсик' },
  { id: 'glitch', name: 'Глитч' },
  { id: 'pulse', name: 'Пульс' },
  { id: 'custom', name: 'Свой' },
];

/** uid — ID профиля FunPay: по нему подтягивается купленное украшение Lumen FX (см. features/fx.js). */
export function nickHtml(name, style, c1, c2, cls = '', uid = '') {
  const u = uid ? ` data-uid="${esc(String(uid))}"` : '';
  if (!style || style === 'none') return `<span class="nick ${cls}"${u}>${esc(name)}</span>`;
  const vars = style === 'custom' ? ` style="--n1:${esc(c1 || '#a78bfa')};--n2:${esc(c2 || '#22d3ee')}"` : '';
  return `<span class="nick nick-${style} ${cls}"${vars}${u}>${esc(name)}</span>`;
}

export const myNick = (name, cls) => {
  const n = S.settings.myNick || {};
  return nickHtml(name, 'none', '', '', cls, S.me?.userId); // свой стиль ника убран — украшение даёт Lumen FX
};

/** Ник собеседника: свой стиль-метка, если ты её поставил. */
export function peerNick(node, name, cls, uid) {
  return nickHtml(name, 'none', '', '', cls, uid);
}

export const TAG_COLORS = { violet: '#a78bfa', ocean: '#38bdf8', mint: '#34d399', sunset: '#fb923c', rose: '#fb7185', gold: '#fbbf24' };
