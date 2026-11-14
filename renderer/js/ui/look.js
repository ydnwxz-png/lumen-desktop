// © 2026 Lumen. Все права защищены. Копирование, изменение и распространение этого кода запрещены без разрешения автора (см. LICENSE).
import { S } from '../core/state.js';

const mq = matchMedia('(prefers-color-scheme: light)');
mq.addEventListener('change', () => S.settings.theme === 'system' && applyLook());

// ---------------------------------------------------------------- цвета
const hex2rgb = (h) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(h || '').trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const rgb2hex = (c) => '#' + c.map((x) => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, '0')).join('');
const mix = (a, b, t) => a.map((x, i) => x + (b[i] - x) * t); // t — доля цвета b
const lum = ([r, g, b]) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

// базовые поверхности тем (как в app.css)
const BASE = {
  dark: { bg: '#0b0b10', 'bg-2': '#0f0f16', surface: '#15151e', 'surface-2': '#1b1b26', 'surface-3': '#242431', 'bubble-in': '#1c1c28', panel: '#14141d' },
  oled: { bg: '#000000', 'bg-2': '#050507', surface: '#0c0c10', 'surface-2': '#121218', 'surface-3': '#1a1a22', 'bubble-in': '#131319', panel: '#0a0a0e' },
  light: { bg: '#f4f4f8', 'bg-2': '#ececf3', surface: '#ffffff', 'surface-2': '#f6f6fa', 'surface-3': '#ebebf2', 'bubble-in': '#ffffff', panel: '#ffffff' },
};
const TINT_VARS = ['bg', 'bg-2', 'surface', 'surface-2', 'surface-3', 'bubble-in', 'panel'];
const ACCENT_VARS = ['a1', 'a2', 'a-rgb', 'on-accent'];

export function applyLook() {
  const s = S.settings;
  const r = document.documentElement;
  const theme = s.theme === 'system' ? (mq.matches ? 'light' : 'dark') : s.theme;
  r.dataset.theme = theme;
  r.dataset.accent = s.accent;
  r.dataset.bg = s.bg;
  r.dataset.density = 'comfortable';
  r.dataset.anim = s.animations ? 'on' : 'off';
  r.style.setProperty('--fs', (s.fontSize || 14) + 'px');
  // подробная настройка: скругления, стекло карточек, свечение, шрифт
  r.style.setProperty('--rc', Math.min(34, Math.max(6, +s.radius || 26)) + 'px');
  r.style.setProperty('--ga', (0.012 + (Math.min(100, Math.max(0, s.glass ?? 50)) / 100) * 0.09).toFixed(3));
  r.style.setProperty('--glow', (Math.min(150, Math.max(0, s.glow ?? 100)) / 100).toFixed(2));
  const F = { system: "'Segoe UI Variable Text', 'Segoe UI', system-ui, -apple-system, sans-serif", rounded: "'SF Pro Rounded', 'Segoe UI Variable Display', 'Nunito', 'Inter', system-ui, sans-serif", mono: "'Cascadia Code', 'JetBrains Mono', 'SF Mono', Consolas, monospace" };
  if (F[s.font]) r.style.setProperty('--font', F[s.font] + ", 'Segoe UI Emoji', 'Apple Color Emoji', 'Noto Color Emoji'");
  else r.style.removeProperty('--font');
  customBg(s);

  // свой акцентный цвет
  const a1 = hex2rgb(s.customAccent?.a1);
  const a2 = hex2rgb(s.customAccent?.a2) || a1;
  if (s.accent === 'custom' && a1) {
    const avg = mix(a1, a2, 0.5);
    r.style.setProperty('--a1', rgb2hex(a1));
    r.style.setProperty('--a2', rgb2hex(a2));
    r.style.setProperty('--a-rgb', avg.map(Math.round).join(', '));
    r.style.setProperty('--on-accent', lum(avg) > 0.62 ? '#111' : '#fff');
  } else ACCENT_VARS.forEach((v) => r.style.removeProperty('--' + v));

  // яркость цвета: приглушить акцент (смешать с серым), если режет глаза
  const lvl = Math.min(100, Math.max(40, +s.accentLevel || 100)) / 100;
  if (lvl < 1) {
    const cs = getComputedStyle(r);
    const c1 = hex2rgb(cs.getPropertyValue('--a1'));
    const c2 = hex2rgb(cs.getPropertyValue('--a2')) || c1;
    if (c1) {
      const grey = theme === 'light' ? [120, 120, 130] : [70, 70, 78];
      const m1 = mix(c1, grey, 1 - lvl);
      const m2 = mix(c2, grey, 1 - lvl);
      r.style.setProperty('--a1', rgb2hex(m1));
      r.style.setProperty('--a2', rgb2hex(m2));
      r.style.setProperty('--a-rgb', mix(m1, m2, 0.5).map(Math.round).join(', '));
    }
  }

  // цвет текста (в тёмной теме): белый, тёплый, холодный или свой
  const tc = theme !== 'light' ? hex2rgb(s.textColor) : null;
  if (tc) {
    r.style.setProperty('--text', rgb2hex(tc));
    const hi = s.contrast !== 'normal';
    r.style.setProperty('--text-2', `rgba(${tc.join(', ')}, ${hi ? '.8' : '.68'})`);
    r.style.setProperty('--text-3', `rgba(${tc.join(', ')}, ${hi ? '.62' : '.46'})`);
  } else ['text', 'text-2', 'text-3'].forEach((v) => r.style.removeProperty('--' + v));

  // оттенок фона
  const tint = hex2rgb(s.tint);
  const base = BASE[theme === 'light' ? 'light' : s.bg === 'oled' ? 'oled' : 'dark'];
  if (tint) {
    const k = theme === 'light' ? 0.1 : s.bg === 'oled' ? 0.07 : 0.11;
    for (const v of TINT_VARS) {
      const c = rgb2hex(mix(hex2rgb(base[v]), tint, v === 'surface-3' ? k * 1.3 : k));
      r.style.setProperty('--' + v, v === 'panel' ? `rgba(${hex2rgb(c).join(', ')}, ${theme === 'light' ? 0.78 : 0.74})` : c);
    }
  } else TINT_VARS.forEach((v) => r.style.removeProperty('--' + v));

  const bg = tint ? rgb2hex(mix(hex2rgb(base.bg), tint, theme === 'light' ? 0.1 : s.bg === 'oled' ? 0.07 : 0.11)) : base.bg;
  window.api?.app.chrome({ bg, fg: theme === 'light' ? '#222233' : '#e8e8ef' }).catch(() => {});
}

// ---------------------------------------------------------------- свой фон: картинка, GIF или видео
let bgUrl = null; // blob: для текущего файла
let bgVer = -1;
const demoBg = { data: null, type: '' };
export function setDemoBg(data, type) {
  demoBg.data = data;
  demoBg.type = type;
}
export function resetBgCache() {
  bgVer = -1;
}
async function customBg(s) {
  let box = document.querySelector('.custom-bg');
  if (s.bg !== 'custom') return box?.remove();
  if (!box) {
    box = document.createElement('div');
    box.className = 'custom-bg';
    document.querySelector('.backdrop')?.after(box);
  }
  box.style.setProperty('--dim', ((s.bgDim ?? 45) / 100).toFixed(2));
  box.style.setProperty('--blur', (s.bgBlur ?? 0) + 'px');
  const ver = s.bgVer || 0;
  if (ver === bgVer && box.firstChild) return;
  bgVer = ver;
  let f = null;
  try {
    f = window.api?.app?.bgGet ? await window.api.app.bgGet() : demoBg.data ? demoBg : null;
  } catch {}
  if (bgUrl) URL.revokeObjectURL(bgUrl);
  bgUrl = null;
  if (!f?.data) return (box.innerHTML = '');
  bgUrl = URL.createObjectURL(new Blob([f.data], { type: f.type }));
  box.innerHTML = f.type.startsWith('video/') ? `<video src="${bgUrl}" autoplay muted loop playsinline></video>` : `<img src="${bgUrl}" alt="">`;
}
