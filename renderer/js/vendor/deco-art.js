// © 2026 Lumen. Все права защищены. Копирование, изменение и распространение этого кода запрещены без разрешения автора (см. LICENSE).
/* Lumen — картинки украшений: значки и маскоты (статичные SVG, ничего не приходит с сервера).
   Тот же файл вставлен в редактор на сайте — меняешь здесь, копируешь туда. */
(function (g) {
  'use strict';

  // значок: [цвет1, цвет2, глиф (viewBox 24), подсказка]
  const BADGE = {
    diamond: ['#5b9bff', '#2f5bff', '<path d="M6.5 9.5 9 6h6l2.5 3.5L12 18z" fill="#fff"/><path d="M6.5 9.5h11M9 6l3 12 3-12" stroke="#2f5bff" stroke-width="1" fill="none" stroke-linejoin="round" opacity=".55"/>', 'Бриллиант'],
    bolt: ['#ffd24d', '#ff9a1a', '<path d="M13.5 4 7 13.2h4.4L10.3 20l6.7-9.4h-4.5z" fill="#fff"/>', 'Молния'],
    crown: ['#ffd96b', '#eea21b', '<path d="M5.5 16.5h13l.9-8-4.2 3.3L12 7l-3.2 4.8-4.2-3.3z" fill="#fff"/><rect x="5.5" y="17.3" width="13" height="1.8" rx=".9" fill="#fff"/>', 'Корона'],
    fire: ['#ff7a5c', '#e8304a', '<path d="M12 3.8c.8 2.6 3.9 4.6 3.9 8.6A3.9 3.9 0 0 1 8.1 13c0-1.8.8-3 1.9-3.9-.1 1.7.8 2.8 1.8 3 .2-2.9-.9-5.6.2-8.3z" fill="#fff"/>', 'Огонь'],
    star: ['#ffdf6b', '#ffab1f', '<path d="m12 4.5 2.2 4.6 5 .7-3.6 3.5.9 5-4.5-2.4-4.5 2.4.9-5L4.8 9.8l5-.7z" fill="#fff"/>', 'Звезда'],
    heart: ['#ff86c0', '#ff3d8b', '<path d="M12 18.6s-6.4-3.8-6.4-8.2A3.4 3.4 0 0 1 12 8.6a3.4 3.4 0 0 1 6.4 1.8c0 4.4-6.4 8.2-6.4 8.2z" fill="#fff"/>', 'Сердце'],
    rocket: ['#b39bff', '#7a5cff', '<path d="M14.8 5.2c2.3-.6 4 .1 4 .1s.6 1.7 0 4c-.6 2.3-3.4 5-5.6 6.4L9.4 11.9c1.4-2.2 4.1-5 5.4-6.7z" fill="#fff"/><circle cx="15" cy="9" r="1.3" fill="#7a5cff"/><path d="M9.6 12.6 6.5 13l-1 2.6 2.8-.3M11.4 14.4l-.4 3.1-2.6 1 .3-2.8" fill="#fff"/>', 'Ракета'],
    shield: ['#45e0a0', '#13a36a', '<path d="M12 4.2 18 6.6v4.6c0 3.8-2.6 6.4-6 7.8-3.4-1.4-6-4-6-7.8V6.6z" fill="#fff"/><path d="m9.3 11.8 1.9 1.9 3.6-3.8" stroke="#13a36a" stroke-width="1.7" fill="none" stroke-linecap="round" stroke-linejoin="round"/>', 'Щит'],
    clover: ['#6be07a', '#2f9e44', '<circle cx="9.3" cy="9.4" r="2.8" fill="#fff"/><circle cx="14.7" cy="9.4" r="2.8" fill="#fff"/><circle cx="9.3" cy="14.4" r="2.8" fill="#fff"/><circle cx="14.7" cy="14.4" r="2.8" fill="#fff"/><path d="M12 12c.6 2.8 1.6 4.6 3.4 6" stroke="#fff" stroke-width="1.4" fill="none" stroke-linecap="round"/>', 'Клевер'],
    gem: ['#6ef3e3', '#18aec7', '<path d="M12 4.5 18 8v8l-6 3.5L6 16V8z" fill="#fff"/><path d="M12 4.5v15M6 8l12 8M18 8 6 16" stroke="#18aec7" stroke-width=".9" opacity=".45"/>', 'Кристалл'],
    // редкие — выдаёт только админ
    early: ['#d39bff', '#7c3aed', '<circle cx="12" cy="10.3" r="4.6" fill="#fff"/><path d="m9.6 14.3-1.4 5 3.8-1.8 3.8 1.8-1.4-5" fill="#fff"/><path d="M11.1 8.6 12.4 7.8v5" stroke="#7c3aed" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>', 'Ранний покупатель Lumen'],
    top: ['#ffe58f', '#d49a0b', '<path d="M8 5.2h8v3.6a4 4 0 0 1-8 0z" fill="#fff"/><path d="M8 6.4H5.6c0 2.4 1.2 3.6 2.8 3.8M16 6.4h2.4c0 2.4-1.2 3.6-2.8 3.8" stroke="#fff" stroke-width="1.3" fill="none"/><path d="M11 12.6h2v3h2.6v2.4H8.4v-2.4H11z" fill="#fff"/>', 'Топ-продавец'],
  };
  const RARE = ['early', 'top'];

  function badgeSvg(id, uid) {
    const b = BADGE[id];
    if (!b) return '';
    const gid = 'lmbg-' + id + (uid || '');
    return `<svg viewBox="0 0 24 24" aria-hidden="true"><defs><linearGradient id="${gid}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${b[0]}"/><stop offset="1" stop-color="${b[1]}"/></linearGradient></defs>` +
      `<rect x="1" y="1" width="22" height="22" rx="7" fill="url(#${gid})"/><rect x="1.5" y="1.5" width="21" height="10" rx="6" fill="#fff" opacity=".14"/>${b[2]}</svg>`;
  }

  // маскоты: viewBox 32×32; классы m-eye (моргают), m-paw (машет), m-body (дышит/плывёт)
  const MASCOT = {
    cat: ['Котик', '<g class="m-body">' +
      '<path d="M6.5 13.5 8.4 4.6l6 5.2z" fill="#f59a3c"/><path d="M25.5 13.5 23.6 4.6l-6 5.2z" fill="#f59a3c"/>' +
      '<path d="m8.7 7.4.8-1.6 2.6 2.4z" fill="#ffd2a3"/><path d="m23.3 7.4-.8-1.6-2.6 2.4z" fill="#ffd2a3"/>' +
      '<ellipse cx="16" cy="17.5" rx="10.2" ry="8.8" fill="#f59a3c"/>' +
      '<path d="M10.5 12.5c1.5-.9 2.6-.9 3.6 0M17.9 12.5c1-.9 2.1-.9 3.6 0" stroke="#d9741b" stroke-width="1" fill="none" stroke-linecap="round"/>' +
      '<ellipse cx="16" cy="21.4" rx="6.2" ry="4.3" fill="#ffe6cc"/>' +
      '<g class="m-eye"><ellipse cx="11.8" cy="16.4" rx="1.5" ry="1.9" fill="#2b1a10"/><ellipse cx="20.2" cy="16.4" rx="1.5" ry="1.9" fill="#2b1a10"/>' +
      '<circle cx="12.3" cy="15.8" r=".5" fill="#fff"/><circle cx="20.7" cy="15.8" r=".5" fill="#fff"/></g>' +
      '<path d="M15 19.6h2l-1 1.2z" fill="#e8607f"/><path d="M16 20.8c-.5.9-1.6 1.1-2.4.5M16 20.8c.5.9 1.6 1.1 2.4.5" stroke="#2b1a10" stroke-width=".8" fill="none" stroke-linecap="round"/>' +
      '<ellipse cx="9.4" cy="20.2" rx="1.6" ry="1" fill="#ff8fa3" opacity=".55"/><ellipse cx="22.6" cy="20.2" rx="1.6" ry="1" fill="#ff8fa3" opacity=".55"/></g>' +
      '<g class="m-paw"><ellipse cx="27.6" cy="23.6" rx="2.5" ry="3.1" fill="#f59a3c"/><path d="M26.6 21.6v1.3M28.6 21.6v1.3" stroke="#d9741b" stroke-width=".7" stroke-linecap="round"/></g>'],
    dragon: ['Дракончик', '<g class="m-paw"><path d="M22.5 13.5c3-4.5 6.8-4.6 8.3-3.4-1.2.2-1.6 1.2-1.4 2.2-1-.5-2-.3-2.5.6-.8-.7-2-.6-2.8.4z" fill="#3fc77a"/></g>' +
      '<g class="m-body"><path d="M10.5 9.5 9 4.2l4 3.6zM21.5 9.5 23 4.2l-4 3.6z" fill="#f7d36b"/>' +
      '<ellipse cx="16" cy="17.4" rx="10" ry="9" fill="#4fd88a"/>' +
      '<path d="M12.5 9.8 14 7.6l1.2 2.1L16 7.4l.8 2.3 1.2-2.1 1.5 2.2" fill="#2fb06a"/>' +
      '<ellipse cx="16" cy="22" rx="6.6" ry="4" fill="#c9f5d9"/>' +
      '<g class="m-eye"><ellipse cx="11.6" cy="16" rx="1.6" ry="2" fill="#11301f"/><ellipse cx="20.4" cy="16" rx="1.6" ry="2" fill="#11301f"/>' +
      '<circle cx="12.1" cy="15.3" r=".55" fill="#fff"/><circle cx="20.9" cy="15.3" r=".55" fill="#fff"/></g>' +
      '<circle cx="14.4" cy="21" r=".55" fill="#2a7a4b"/><circle cx="17.6" cy="21" r=".55" fill="#2a7a4b"/>' +
      '<path d="M14 23.4c1.3.9 2.7.9 4 0" stroke="#2a7a4b" stroke-width=".9" fill="none" stroke-linecap="round"/></g>'],
    ghost: ['Призрак', '<g class="m-body"><path d="M7 27V15.5a9 9 0 0 1 18 0V27l-3-2.2-3 2.2-3-2.2-3 2.2-3-2.2z" fill="#f4f6ff"/>' +
      '<path d="M7 27V15.5a9 9 0 0 1 4.2-7.6A9 9 0 0 0 9 15.5V25z" fill="#d7dcf5"/>' +
      '<g class="m-eye"><ellipse cx="12.6" cy="15.6" rx="1.6" ry="2.2" fill="#1d2140"/><ellipse cx="19.4" cy="15.6" rx="1.6" ry="2.2" fill="#1d2140"/></g>' +
      '<ellipse cx="16" cy="20" rx="1.4" ry="1.7" fill="#1d2140"/>' +
      '<ellipse cx="10.4" cy="18.6" rx="1.5" ry=".9" fill="#ff9ec4" opacity=".6"/><ellipse cx="21.6" cy="18.6" rx="1.5" ry=".9" fill="#ff9ec4" opacity=".6"/></g>'],
    slime: ['Слизень', '<g class="m-body"><path d="M4.5 26.5c0-9 4.6-15.5 11.5-15.5s11.5 6.5 11.5 15.5c0 .8-.6 1.3-1.4 1.3H5.9c-.8 0-1.4-.5-1.4-1.3z" fill="#7d6bff"/>' +
      '<path d="M15.2 11.1c.4-2 1.6-3.3 3.2-3.6-.6 1-.7 2.2-.3 3.6" fill="#7d6bff"/>' +
      '<ellipse cx="10.6" cy="16.6" rx="2.2" ry="1.3" fill="#fff" opacity=".35" transform="rotate(-30 10.6 16.6)"/>' +
      '<g class="m-eye"><ellipse cx="12.6" cy="20" rx="1.6" ry="2.1" fill="#1b1442"/><ellipse cx="19.4" cy="20" rx="1.6" ry="2.1" fill="#1b1442"/>' +
      '<circle cx="13.1" cy="19.3" r=".55" fill="#fff"/><circle cx="19.9" cy="19.3" r=".55" fill="#fff"/></g>' +
      '<path d="M14.6 23.6c.9.7 1.9.7 2.8 0" stroke="#1b1442" stroke-width=".9" fill="none" stroke-linecap="round"/></g>'],
  };

  function mascotSvg(id) {
    const m = MASCOT[id];
    return m ? `<svg viewBox="0 0 32 32" class="lm-m-${id}" aria-hidden="true">${m[1]}</svg>` : '';
  }

  g.LumenArt = { BADGE, RARE, MASCOT, badgeSvg, mascotSvg };
})(typeof self !== 'undefined' ? self : window);
