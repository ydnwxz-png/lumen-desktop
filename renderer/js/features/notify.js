// Звук, всплывашки (свои / системные / внутри окна) и счётчик на иконке.
import { S } from '../core/state.js';
import { toast } from '../ui/kit.js';
import { avatar, esc } from '../core/util.js';
import { icon } from '../core/icons.js';

let ac;
export function sound(kind = 'msg') {
  const n = S.settings.notify;
  if (!n.sound) return;
  try {
    ac ||= new AudioContext();
    const t = ac.currentTime;
    const notes = kind === 'order' ? [659.25, 830.61, 987.77, 1318.5] : [880, 1318.5];
    notes.forEach((f, i) => {
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      const st = t + i * (kind === 'order' ? 0.07 : 0.09);
      g.gain.setValueAtTime(0, st);
      g.gain.linearRampToValueAtTime(0.18 * n.volume, st + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, st + 0.45);
      o.connect(g).connect(ac.destination);
      o.start(st);
      o.stop(st + 0.5);
    });
  } catch {}
}

const themeColors = () => {
  const cs = getComputedStyle(document.documentElement);
  return { a1: cs.getPropertyValue('--a1').trim(), a2: cs.getPropertyValue('--a2').trim(), dark: document.documentElement.dataset.theme !== 'light' };
};

/** p: {title, body, avatar, node, kind:'msg'|'order'} */
export function notify(p) {
  const n = S.settings.notify;
  if (n.mode === 'off') return;
  const body = n.preview ? p.body : 'Новое сообщение';
  sound(p.kind);
  if (S.focused || !window.api) {
    if (S.focused && !n.whenFocused && p.kind !== 'order') return;
    toast(p.title, body, {
      html: p.kind === 'order' ? `<span class="tic" style="background:rgba(52,211,153,.15);color:var(--ok)">${icon('cash', 17)}</span>` : avatar(p.avatar, p.name || p.title, 34),
      onClick: () => p.onClick?.(),
      ms: 5000,
    });
    return;
  }
  window.api.app.flash();
  if (n.mode === 'system') window.api.app.notify({ title: p.title, body, node: p.node });
  else window.api.app.toast({ title: p.title, body, avatar: p.avatar, name: p.name || p.title, node: p.node, kind: p.kind, corner: n.corner, theme: themeColors() });
}

let lastBadge = -1;
export function badge(count) {
  if (count === lastBadge || !window.api) return;
  lastBadge = count;
  let url = null;
  if (count > 0) {
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 32, 32);
    const t = themeColors();
    g.addColorStop(0, t.a1 || '#a78bfa');
    g.addColorStop(1, t.a2 || '#6366f1');
    x.fillStyle = g;
    x.beginPath();
    x.arc(16, 16, 16, 0, Math.PI * 2);
    x.fill();
    x.fillStyle = '#fff';
    x.font = 'bold 19px Inter, Arial';
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillText(count > 9 ? '9+' : String(count), 16, 17);
    url = c.toDataURL();
  }
  window.api.app.badge(count, url);
  document.title = count ? `(${count}) Lumen` : 'Lumen';
}

export const escHtml = esc;
