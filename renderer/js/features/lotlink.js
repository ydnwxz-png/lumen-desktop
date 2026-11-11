// Ссылка на лот и меню «Скопировать ссылку / название» — для «Лотов» и «Профиля».
import { copyText } from '../core/util.js';
import { menu, ok } from '../ui/kit.js';

/** Прямая ссылка на страницу лота: https://funpay.com/lots/offer?id=… (или /chips/offer?id=… для валюты). */
export function lotLink(l) {
  const u = String(l?.url || '');
  if (/^https:\/\/funpay\.com\/(lots|chips)\/offer\?id=/.test(u)) return u;
  const id = l?.id || (/(?:offer=|[?&]id=)([0-9A-Za-z-]+)/.exec(u) || [])[1];
  if (!id) return u;
  const chips = l?.chips || /\/chips\//.test(u) || /-/.test(String(id));
  return `https://funpay.com/${chips ? 'chips' : 'lots'}/offer?id=${id}`;
}

export function copyLotLink(l) {
  const u = lotLink(l);
  return copyText(u).then(() => ok('Ссылка скопирована', u));
}
export function copyLotTitle(l) {
  return copyText(l.title || '').then(() => ok('Название скопировано', l.title || ''));
}

/** Меню по правому клику на лоте. extra — дополнительные пункты в конце. */
export function lotMenu(x, y, lot, extra = []) {
  menu(x, y, [
    { header: lot.title || 'Лот' },
    { label: 'Скопировать ссылку', icon: 'link', run: () => copyLotLink(lot) },
    { label: 'Скопировать название', icon: 'copy', run: () => copyLotTitle(lot) },
    ...extra,
  ]);
}
