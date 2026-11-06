// Экран входа: через браузер (с кодом подтверждения) или по golden_key, плюс демо.
import { $, el, esc } from '../core/util.js';
import { icon } from '../core/icons.js';
import { busy } from '../ui/kit.js';
import { winControls } from '../ui/winctl.js';

/** onDone(acc|'demo'), cancelable — есть куда вернуться (добавление второго аккаунта). */
export function showLogin(onDone, { cancelable = false } = {}) {
  const hasApi = !!window.api;
  const box = el(`<div id="login">
    <div class="titlebar"></div>
    <div class="login-card">
      <div class="login-logo"><img src="../assets/icon.png" alt=""></div>
      <h1>${cancelable ? 'Ещё один <span>аккаунт</span>' : 'Добро пожаловать в <span>Lumen</span>'}</h1>
      <p>Чаты, сделки и лоты FunPay — в одном красивом окне.</p>
      <div class="login-box">
        <button class="btn pri lg" data-browser>${icon('globe', 18)}Войти через браузер</button>
        <div class="or">или</div>
        <div class="key-wrap"><input class="input" style="height:44px;padding-right:110px" placeholder="Вставь golden_key" data-key spellcheck="false" autocomplete="off"><button class="btn sm ghost" data-paste>${icon('copy', 15)}Вставить</button></div>
        <button class="btn lg" data-keybtn>${icon('key', 17)}Войти по ключу</button>
        <div class="login-err" data-err></div>
        <div class="login-help">Где взять golden_key: открой funpay.com → F12 → Application → Cookies → <b>golden_key</b>. Ключ хранится только на этом компьютере.</div>
      </div>
      <div class="login-foot">${cancelable ? '<button data-cancel>← Назад</button>' : `Просто посмотреть? <button data-demo>Открыть демо</button>`}</div>
      <div class="feature-row"><span>${icon('chat', 15)}Чаты и шаблоны</span><span>${icon('bag', 15)}Сделки</span><span>${icon('rocket', 15)}Автоподнятие</span><span>${icon('sparkles', 15)}Анимированные ники</span></div>
    </div></div>`);
  $('.titlebar', box).append(winControls());
  const errEl = $('[data-err]', box);
  const fail = (e) => {
    errEl.textContent = e.message || String(e);
    $('.login-box', box).animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-8px)' }, { transform: 'translateX(8px)' }, { transform: 'translateX(-4px)' }, { transform: 'none' }], { duration: 380 });
  };
  const done = (v) => {
    box.style.transition = 'opacity .35s, transform .35s';
    box.style.opacity = '0';
    box.style.transform = 'scale(1.03)';
    setTimeout(() => box.remove(), 350);
    onDone(v);
  };
  $('[data-browser]', box).onclick = (e) => {
    errEl.textContent = '';
    if (!hasApi) return fail(new Error('Вход работает в приложении. Здесь можно открыть демо.'));
    busy(e.currentTarget, window.api.acc.addBrowser().then(done, fail));
  };
  const byKey = () => {
    errEl.textContent = '';
    const k = $('[data-key]', box).value.trim();
    if (!k) return fail(new Error('Вставь golden_key'));
    if (!hasApi) return fail(new Error('Вход работает в приложении. Здесь можно открыть демо.'));
    busy($('[data-keybtn]', box), window.api.acc.addKey(k).then(done, fail));
  };
  // Вставка ключа: кнопкой и Ctrl+V (через главный процесс — работает всегда)
  const keyIn = $('[data-key]', box);
  const pasteKey = async () => {
    try {
      const t = window.api ? await window.api.app.clipboard() : await navigator.clipboard.readText();
      if (t) {
        keyIn.value = t.trim();
        keyIn.focus();
        errEl.textContent = '';
      } else fail(new Error('Буфер обмена пустой — скопируй golden_key ещё раз'));
    } catch (e) {
      fail(e);
    }
  };
  $('[data-paste]', box).onclick = pasteKey;
  keyIn.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyV') {
      e.preventDefault();
      pasteKey();
    }
  });
  $('[data-keybtn]', box).onclick = byKey;
  $('[data-key]', box).onkeydown = (e) => e.key === 'Enter' && byKey();
  $('[data-demo]', box) && ($('[data-demo]', box).onclick = () => done('demo'));
  $('[data-cancel]', box) && ($('[data-cancel]', box).onclick = () => done(null));
  document.body.append(box);
  return box;
}

export const _e = esc;
