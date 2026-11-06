// Свои кнопки окна для Windows (вместо системных): свернуть, развернуть, закрыть.
import { el } from '../core/util.js';

const I = {
  min: '<svg viewBox="0 0 12 12" width="12" height="12"><path d="M2.5 6h7" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
  max: '<svg viewBox="0 0 12 12" width="12" height="12"><rect x="2.5" y="2.5" width="7" height="7" rx="2" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>',
  restore: '<svg viewBox="0 0 12 12" width="12" height="12"><rect x="2" y="4" width="6" height="6" rx="1.6" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M4.5 2.5h3.5a1.5 1.5 0 0 1 1.5 1.5v3.5" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>',
  close: '<svg viewBox="0 0 12 12" width="12" height="12"><path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
};

const all = new Set();
let maxed = false;
let hooked = false;

function paint() {
  for (const b of all) {
    b.innerHTML = maxed ? I.restore : I.max;
    b.dataset.tip = maxed ? 'Свернуть в окно' : 'Развернуть';
  }
}

/** Кнопки окна; на других системах — пусто. */
export function winControls() {
  if (!document.body.classList.contains('win') || !window.api?.app.win) return document.createComment('');
  const box = el(`<div class="wctl">
    <button class="wbtn" data-w="min" data-tip="Свернуть">${I.min}</button>
    <button class="wbtn" data-w="max">${I.max}</button>
    <button class="wbtn close" data-w="close" data-tip="Закрыть">${I.close}</button></div>`);
  const mb = box.querySelector('[data-w=max]');
  all.add(mb);
  paint();
  box.onclick = async (e) => {
    const a = e.target.closest('[data-w]')?.dataset.w;
    if (!a) return;
    const r = await window.api.app.win(a).catch(() => null);
    if (a === 'max' && typeof r === 'boolean') {
      maxed = r;
      paint();
    }
  };
  box.ondblclick = (e) => e.stopPropagation();
  if (!hooked) {
    hooked = true;
    window.api.app.on('win:max', (v) => {
      maxed = !!v;
      paint();
    });
  }
  return box;
}
