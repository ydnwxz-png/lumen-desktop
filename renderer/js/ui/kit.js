// Мелкие компоненты: тосты, модалки, меню, шторка, лайтбокс, подсказки, сегменты, свитчи.
import { el, esc, $ } from '../core/util.js';
import { icon } from '../core/icons.js';

// ---------------------------------------------------------------- тосты внутри окна
let toastRoot;
export function toast(title, body = '', { kind = '', icon: ic, onClick, ms = 4200, html } = {}) {
  toastRoot ||= document.body.appendChild(el('<div class="toasts"></div>'));
  const ico = ic || (kind === 'ok' ? 'check' : kind === 'err' ? 'alert' : 'info');
  const t = el(`<div class="toast ${kind}">${html || `<span class="tic">${icon(ico, 17)}</span>`}<div class="grow"><div class="t">${esc(title)}</div>${body ? `<div class="b">${esc(body)}</div>` : ''}</div></div>`);
  const close = () => {
    t.classList.add('out');
    setTimeout(() => t.remove(), 300);
  };
  t.onclick = () => {
    onClick?.();
    close();
  };
  toastRoot.append(t);
  while (toastRoot.children.length > 4) toastRoot.firstElementChild.remove();
  setTimeout(close, ms);
  return t;
}
export const ok = (t, b) => toast(t, b, { kind: 'ok' });
export const err = (t, b) => toast(t, String(b?.message || b || ''), { kind: 'err', ms: 6500 });

// ---------------------------------------------------------------- модалки
export function modal(html, { wide = false, onClose } = {}) {
  const wrap = el(`<div class="modal-wrap"><div class="scrim"></div><div class="modal ${wide ? 'wide' : ''}">${html}</div></div>`);
  const m = wrap.querySelector('.modal');
  let closed = false;
  const close = (v) => {
    if (closed) return;
    closed = true;
    m.classList.add('out');
    wrap.querySelector('.scrim').style.animation = 'fadeIn .2s reverse forwards';
    setTimeout(() => wrap.remove(), 200);
    document.removeEventListener('keydown', key, true);
    onClose?.(v);
  };
  const key = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  };
  document.addEventListener('keydown', key, true);
  wrap.querySelector('.scrim').onclick = () => close();
  wrap.querySelectorAll('[data-close]').forEach((b) => (b.onclick = () => close()));
  document.body.append(wrap);
  return { el: m, close };
}

export function confirmBox(title, text, { yes = 'Да', no = 'Отмена', danger = false } = {}) {
  return new Promise((res) => {
    const m = modal(`<h3>${esc(title)}</h3><p>${esc(text)}</p><div class="modal-acts"><button class="btn ghost" data-no>${esc(no)}</button><button class="btn ${danger ? 'danger' : 'pri'}" data-yes>${esc(yes)}</button></div>`, { onClose: () => res(false) });
    m.el.querySelector('[data-no]').onclick = () => m.close();
    m.el.querySelector('[data-yes]').onclick = () => {
      res(true);
      m.close(true);
    };
    setTimeout(() => m.el.querySelector('[data-yes]').focus(), 50);
  });
}

export function promptBox(title, { text = '', value = '', placeholder = '', multiline = false, yes = 'Сохранить' } = {}) {
  return new Promise((res) => {
    const field = multiline ? `<textarea class="textarea" rows="5" placeholder="${esc(placeholder)}">${esc(value)}</textarea>` : `<input class="input" value="${esc(value)}" placeholder="${esc(placeholder)}">`;
    const m = modal(`<h3>${esc(title)}</h3>${text ? `<p>${esc(text)}</p>` : '<div style="height:10px"></div>'}${field}<div class="modal-acts"><button class="btn ghost" data-close>Отмена</button><button class="btn pri" data-yes>${esc(yes)}</button></div>`, { onClose: () => res(null) });
    const inp = m.el.querySelector('input,textarea');
    const done = () => {
      res(inp.value);
      m.close(1);
    };
    m.el.querySelector('[data-yes]').onclick = done;
    inp.onkeydown = (e) => {
      if (e.key === 'Enter' && (!multiline || e.ctrlKey)) done();
    };
    setTimeout(() => {
      inp.focus();
      inp.select?.();
    }, 50);
  });
}

// ---------------------------------------------------------------- контекстное меню
let openMenu = null;
export function menu(x, y, items) {
  openMenu?.remove();
  const m = el('<div class="menu"></div>');
  for (const it of items) {
    if (!it) continue;
    if (it === '-') m.append(el('<hr>'));
    else if (it.header) m.append(el(`<div class="mh">${esc(it.header)}</div>`));
    else {
      const b = el(`<button class="${it.danger ? 'danger' : ''}">${icon(it.icon || 'dot', 16)}<span class="grow">${esc(it.label)}</span>${it.hint ? `<span class="dim" style="font-size:11px">${esc(it.hint)}</span>` : ''}</button>`);
      b.onclick = () => {
        close();
        it.run();
      };
      m.append(b);
    }
  }
  document.body.append(m);
  const r = m.getBoundingClientRect();
  m.style.left = Math.min(x, innerWidth - r.width - 8) + 'px';
  m.style.top = Math.min(y, innerHeight - r.height - 8) + 'px';
  openMenu = m;
  const close = () => {
    m.remove();
    if (openMenu === m) openMenu = null;
    removeEventListener('mousedown', out, true);
    removeEventListener('keydown', esc_, true);
  };
  const out = (e) => !m.contains(e.target) && close();
  const esc_ = (e) => e.key === 'Escape' && close();
  setTimeout(() => {
    addEventListener('mousedown', out, true);
    addEventListener('keydown', esc_, true);
  });
  return close;
}
export const menuAt = (btn, items) => {
  const r = btn.getBoundingClientRect();
  return menu(r.left, r.bottom + 6, items);
};

// ---------------------------------------------------------------- шторка справа
export function drawer(title, { actions = '' } = {}) {
  const scrim = el('<div class="scrim"></div>');
  const d = el(`<div class="drawer"><div class="drawer-head"><h2 class="ell">${esc(title)}</h2>${actions}<button class="ibtn" data-x>${icon('x', 18)}</button></div><div class="drawer-body"><div class="empty"><div class="spinner"></div></div></div></div>`);
  const close = () => {
    d.classList.add('out');
    scrim.style.animation = 'fadeIn .25s reverse forwards';
    setTimeout(() => {
      d.remove();
      scrim.remove();
    }, 250);
    removeEventListener('keydown', key, true);
  };
  const key = (e) => {
    if (e.key === 'Escape' && !document.querySelector('.modal-wrap')) {
      e.stopPropagation();
      close();
    }
  };
  addEventListener('keydown', key, true);
  scrim.onclick = close;
  d.querySelector('[data-x]').onclick = close;
  document.body.append(scrim, d);
  return { el: d, body: d.querySelector('.drawer-body'), head: d.querySelector('.drawer-head'), close, setTitle: (t) => (d.querySelector('h2').textContent = t) };
}

// ---------------------------------------------------------------- картинки
export function lightbox(src) {
  const lb = el(`<div class="lightbox"><img src="${esc(src)}" alt=""><div class="lb-bar"><button class="ibtn" data-open title="Открыть в браузере">${icon('external', 18)}</button><button class="ibtn" data-x>${icon('x', 18)}</button></div></div>`);
  const img = lb.querySelector('img');
  let z = 1;
  const close = () => {
    lb.remove();
    removeEventListener('keydown', k, true);
  };
  const k = (e) => e.key === 'Escape' && (e.stopPropagation(), close());
  lb.onclick = (e) => (e.target === lb || e.target.closest('[data-x]')) && close();
  lb.querySelector('[data-open]').onclick = () => window.api?.app.open(src);
  img.onwheel = (e) => {
    e.preventDefault();
    z = Math.max(1, Math.min(5, z * (e.deltaY < 0 ? 1.15 : 0.87)));
    img.style.transform = `scale(${z})`;
  };
  addEventListener('keydown', k, true);
  document.body.append(lb);
}

// ---------------------------------------------------------------- подсказки для [data-tip]
export function initTips() {
  // Одна подсказка на всё окно. Раньше она пересоздавалась при каждом движении мыши по иконке
  // (над svg внутри кнопки) — и мигала. Теперь: та же кнопка — ничего не делаем; соседняя — подсказка
  // плавно переезжает без повторной анимации.
  let tip = null,
    cur = null,
    timer = 0,
    lastHide = 0;
  const hide = () => {
    clearTimeout(timer);
    cur = null;
    if (tip) {
      tip.remove();
      tip = null;
      lastHide = Date.now();
    }
  };
  const place = (t) => {
    const r = t.getBoundingClientRect();
    const side = t.dataset.tipSide || (t.closest('.rail') ? 'right' : 'bottom');
    const tr = tip.getBoundingClientRect();
    if (side === 'right') {
      tip.style.left = r.right + 10 + 'px';
      tip.style.top = r.top + r.height / 2 - tr.height / 2 + 'px';
    } else {
      tip.style.left = Math.max(6, Math.min(innerWidth - tr.width - 6, r.left + r.width / 2 - tr.width / 2)) + 'px';
      tip.style.top = Math.min(innerHeight - tr.height - 6, r.bottom + 8) + 'px';
    }
  };
  const show = (t, quick) => {
    if (!t.isConnected || !t.dataset.tip) return;
    if (tip && quick) {
      tip.classList.add('swap');
      tip.textContent = t.dataset.tip;
    } else {
      tip?.remove();
      tip = el(`<div class="tip">${esc(t.dataset.tip)}</div>`);
      if (quick) tip.classList.add('swap', 'still');
      document.body.append(tip);
    }
    place(t);
  };
  document.addEventListener('mouseover', (e) => {
    const t = e.target.closest?.('[data-tip]');
    if (t === cur) return; // всё ещё над той же кнопкой (над её иконкой) — ничего не трогаем
    if (!t) {
      // промежуток между кнопками: подсказку убираем чуть позже — если мышь дошла до соседней, она просто переедет
      cur = null;
      clearTimeout(timer);
      timer = setTimeout(hide, 140);
      return;
    }
    cur = t;
    clearTimeout(timer);
    const quick = !!tip || Date.now() - lastHide < 350;
    if (quick) show(t, true);
    else timer = setTimeout(() => cur === t && show(t, false), 250);
  });
  document.addEventListener('mouseout', (e) => !e.relatedTarget && hide()); // мышь ушла из окна
  document.addEventListener('mousedown', hide, true);
  document.addEventListener('scroll', hide, true);
  window.addEventListener('blur', hide);
}

// ---------------------------------------------------------------- сегменты и свитчи
/** Сегментированный переключатель с плавающей подложкой. */
export function seg(container, value, onChange) {
  const ind = container.querySelector('.seg-ind') || container.insertBefore(el('<span class="seg-ind"></span>'), container.firstChild);
  const btns = [...container.querySelectorAll('button')];
  const set = (v, anim = true) => {
    const b = btns.find((x) => x.dataset.v === v) || btns[0];
    btns.forEach((x) => x.classList.toggle('on', x === b));
    if (!anim) ind.style.transition = 'none';
    ind.style.width = b.offsetWidth + 'px';
    ind.style.transform = `translateX(${b.offsetLeft}px)`;
    if (!anim) requestAnimationFrame(() => (ind.style.transition = ''));
  };
  btns.forEach((b) =>
    b.addEventListener('click', () => {
      set(b.dataset.v);
      onChange(b.dataset.v);
    })
  );
  requestAnimationFrame(() => set(value, false));
  new ResizeObserver(() => set(btns.find((b) => b.classList.contains('on'))?.dataset.v ?? value, false)).observe(container);
  return { set };
}

export function switchEl(on, onChange) {
  const s = el(`<button class="switch ${on ? 'on' : ''}" role="switch"></button>`);
  s.onclick = () => {
    s.classList.toggle('on');
    onChange(s.classList.contains('on'));
  };
  return s;
}

export function stars(n, size = 14) {
  return `<span class="stars">${[1, 2, 3, 4, 5].map((i) => `<span class="${i <= n ? '' : 'off'}">${icon('star', size)}</span>`).join('')}</span>`;
}

export function busy(btn, p) {
  btn.classList.add('busy');
  return Promise.resolve(p).finally(() => btn.classList.remove('busy'));
}

export const byId = (id) => $('#' + id);
