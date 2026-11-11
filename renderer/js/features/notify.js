// Звук, всплывашки (свои / системные / внутри окна) и счётчик на иконке.
import { S } from '../core/state.js';
import { toast } from '../ui/kit.js';
import { avatar, esc } from '../core/util.js';
import { icon } from '../core/icons.js';

let ac;
// Звуки собираются синтезатором прямо в приложении — без файлов. Нота: [частота, старт(с), длина(с), форма, громкость, скольжение-до]
const N = (f, t, d = 0.45, w = 'sine', v = 1, to = 0) => ({ f, t, d, w, v, to });
export const SOUNDS = {
  lumen: { name: 'Lumen', notes: [N(880, 0), N(1318.5, 0.09)] },
  pop: { name: 'Поп', notes: [N(620, 0, 0.12, 'sine', 1.3, 240)] },
  bubble: { name: 'Пузырёк', notes: [N(900, 0, 0.1, 'sine', 1, 1500), N(1200, 0.1, 0.14, 'sine', 0.9, 1900)] },
  ding: { name: 'Динь', notes: [N(1568, 0, 0.8), N(3136, 0, 0.35, 'sine', 0.25)] },
  chime: { name: 'Колокольчики', notes: [N(1046.5, 0, 0.9, 'triangle'), N(1318.5, 0.08, 0.9, 'triangle'), N(1568, 0.16, 1.1, 'triangle')] },
  bell: { name: 'Колокол', notes: [N(660, 0, 1.4), N(660 * 2.76, 0, 0.7, 'sine', 0.35), N(660 * 5.4, 0, 0.35, 'sine', 0.15)] },
  soft: { name: 'Мягкий', notes: [N(523.25, 0, 0.6, 'sine', 0.7), N(659.25, 0.14, 0.7, 'sine', 0.7)] },
  knock: { name: 'Тук-тук', notes: [N(180, 0, 0.09, 'triangle', 1.6, 90), N(180, 0.16, 0.09, 'triangle', 1.6, 90)] },
  arcade: { name: 'Аркада', notes: [N(523.25, 0, 0.09, 'square', 0.35), N(659.25, 0.06, 0.09, 'square', 0.35), N(783.99, 0.12, 0.09, 'square', 0.35), N(1046.5, 0.18, 0.2, 'square', 0.35)] },
  coins: { name: 'Монетки', notes: [N(659.25, 0), N(830.61, 0.07), N(987.77, 0.14), N(1318.5, 0.21)] },
  cash: { name: 'Касса', notes: [N(2093, 0, 0.12, 'square', 0.25), N(2637, 0.08, 0.6, 'sine', 0.9), N(3136, 0.08, 0.5, 'sine', 0.4)] },
  fanfare: { name: 'Фанфары', notes: [N(523.25, 0, 0.18, 'sawtooth', 0.3), N(659.25, 0.12, 0.18, 'sawtooth', 0.3), N(783.99, 0.24, 0.18, 'sawtooth', 0.3), N(1046.5, 0.36, 0.6, 'sawtooth', 0.35)] },
};

/** kind: 'msg' | 'order'; preset — чтобы послушать конкретный звук в настройках */
export function sound(kind = 'msg', preset) {
  const n = S.settings.notify;
  if (!n.sound && !preset) return;
  const id = preset || (kind === 'order' ? n.orderSound : n.msgSound) || (kind === 'order' ? 'coins' : 'lumen');
  const snd = SOUNDS[id] || SOUNDS.lumen;
  try {
    ac ||= new AudioContext();
    if (ac.state === 'suspended') ac.resume();
    const t = ac.currentTime + 0.02;
    for (const x of snd.notes) {
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.type = x.w;
      const st = t + x.t;
      o.frequency.setValueAtTime(x.f, st);
      if (x.to) o.frequency.exponentialRampToValueAtTime(x.to, st + x.d * 0.9);
      g.gain.setValueAtTime(0, st);
      g.gain.linearRampToValueAtTime(0.18 * n.volume * x.v, st + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, st + x.d);
      o.connect(g).connect(ac.destination);
      o.start(st);
      o.stop(st + x.d + 0.05);
    }
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
  const body = n.preview || p.raw ? p.body : 'Новое сообщение';
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
