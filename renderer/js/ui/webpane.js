// Встроенная панель FunPay: открывается внутри окна Lumen, а не отдельным окном.
import { el, esc } from '../core/util.js';
import { icon } from '../core/icons.js';
import { err } from './kit.js';

let pane = null; // { box, wv, partition }

const isFp = (u) => /^https:\/\/([a-z0-9-]+\.)?funpay\.com\//.test(u || '');

export function closeWebPane() {
  if (!pane) return;
  const box = pane.box;
  pane = null;
  box.classList.add('out');
  setTimeout(() => box.remove(), 200); // убираем целиком — страница не висит в памяти
}

export const webPaneOpen = () => !!pane;

/** Открыть ссылку FunPay во встроенной панели (с куками аккаунта). */
export async function openWebPane(accId, url) {
  url = url || 'https://funpay.com/';
  if (!isFp(url)) return window.api?.app.open(url);
  let prep;
  try {
    prep = await window.api.app.browserPrep(accId);
  } catch (e) {
    return err('FunPay не открылся', e);
  }
  document.querySelectorAll('.drawer [data-x], .modal-wrap .scrim').forEach((x) => x.click());
  if (pane && pane.partition === prep.partition) {
    pane.wv.loadURL(url).catch(() => {});
    return;
  }
  closeWebPane();
  document.querySelectorAll('.drawer [data-x], .modal-wrap .scrim').forEach((x) => x.click());
  const stage = document.querySelector('.stage');
  if (!stage) return;
  const box = el(`<div class="webpane">
    <div class="wp-bar">
      <button class="ibtn sm" data-b="back" data-tip="Назад">${icon('chevL', 18)}</button>
      <button class="ibtn sm" data-b="fwd" data-tip="Вперёд">${icon('chevR', 18)}</button>
      <button class="ibtn sm" data-b="reload" data-tip="Обновить">${icon('refresh', 16)}</button>
      <div class="wp-addr"><span class="wp-lock">${icon('globe', 13)}</span><span class="wp-url ell"></span></div>
      <button class="ibtn sm" data-b="ext" data-tip="Открыть в обычном браузере">${icon('external', 16)}</button>
      <button class="ibtn sm wp-close" data-b="close" data-tip="Закрыть (Esc)">${icon('x', 18)}</button>
      <i class="wp-load"></i>
    </div>
    <webview partition="${esc(prep.partition)}" useragent="${esc(prep.ua || '')}" src="${esc(url)}" allowpopups></webview>
  </div>`);
  const wv = box.querySelector('webview');
  const urlEl = box.querySelector('.wp-url');
  const btn = (b) => box.querySelector(`[data-b=${b}]`);
  const sync = () => {
    try {
      const u = wv.getURL();
      urlEl.textContent = u.replace(/^https:\/\//, '');
      btn('back').disabled = !wv.canGoBack();
      btn('fwd').disabled = !wv.canGoForward();
    } catch {}
  };
  wv.addEventListener('did-navigate', sync);
  wv.addEventListener('did-navigate-in-page', sync);
  wv.addEventListener('dom-ready', sync);
  wv.addEventListener('did-start-loading', () => box.classList.add('loading'));
  wv.addEventListener('did-stop-loading', () => (box.classList.remove('loading'), sync()));
  urlEl.textContent = url.replace(/^https:\/\//, '');
  box.querySelector('.wp-bar').onclick = (e) => {
    const b = e.target.closest('[data-b]')?.dataset.b;
    if (b === 'back' && wv.canGoBack()) wv.goBack();
    if (b === 'fwd' && wv.canGoForward()) wv.goForward();
    if (b === 'reload') wv.reload();
    if (b === 'ext') window.api?.app.open((wv.getURL && wv.getURL()) || url);
    if (b === 'close') closeWebPane();
  };
  stage.append(box);
  pane = { box, wv, partition: prep.partition };
}

// Esc (когда фокус не внутри страницы) и переход в другой раздел закрывают панель
if (typeof document !== 'undefined')
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && pane && !document.querySelector('.modal-wrap')) closeWebPane();
  });
