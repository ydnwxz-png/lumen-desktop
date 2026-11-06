// Окно своих уведомлений поверх всего экрана.
const stack = document.getElementById('stack');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const ini = (n) => (String(n || '?').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().slice(0, 2) || '?').toUpperCase();

function close(t) {
  if (t.dataset.closing) return;
  t.dataset.closing = 1;
  t.classList.add('out');
  setTimeout(() => {
    t.remove();
    if (!stack.children.length) window.toastApi.empty();
  }, 330);
}

window.toastApi.onToast((p) => {
  document.body.className = (p.corner || 'br').includes('t') ? 'pos-top' : 'pos-bottom';
  const t = document.createElement('div');
  t.className = 't' + (p.theme && !p.theme.dark ? ' light' : '') + (p.kind === 'order' ? ' order' : '');
  if (p.theme) {
    t.style.setProperty('--a1', p.theme.a1);
    t.style.setProperty('--a2', p.theme.a2);
  }
  const img = p.avatar && !p.avatar.includes('/img/layout/avatar') ? `<img src="${esc(p.avatar)}">` : '';
  t.innerHTML = `<div class="av">${p.kind === 'order' ? '₽' : esc(ini(p.name)) + img}</div><div class="tx"><div class="ti">${esc(p.title)}</div><div class="bd">${esc(p.body)}</div></div><span class="app">Lumen</span><span class="bar"></span>`;
  t.querySelector('img')?.addEventListener('error', (e) => e.target.remove());
  t.onclick = () => {
    window.toastApi.click(p.node);
    close(t);
  };
  t.onmouseenter = () => window.toastApi.mouse(true);
  t.onmouseleave = () => window.toastApi.mouse(false);
  let left = 7000;
  let since = Date.now();
  let timer = setTimeout(() => close(t), left);
  t.addEventListener('mouseenter', () => {
    clearTimeout(timer);
    left -= Date.now() - since;
  });
  t.addEventListener('mouseleave', () => {
    since = Date.now();
    timer = setTimeout(() => close(t), Math.max(1500, left));
  });
  stack.append(t);
  const alive = [...stack.children].filter((c) => !c.dataset.closing);
  for (const c of alive.slice(0, Math.max(0, alive.length - 4))) close(c);
});

// окно всегда ровно по размеру карточек — никакого пустого прямоугольника
new ResizeObserver(() => {
  const h = stack.children.length ? Math.ceil(stack.getBoundingClientRect().height) : 0;
  window.toastApi.size(h);
}).observe(stack);
