// © 2026 Lumen. Все права защищены. Копирование, изменение и распространение этого кода запрещены без разрешения автора (см. LICENSE).
// Темы Lumen: сохранить свою, загрузить из файла, поставить тему из Telegram-бота.
// Файл темы (.lumen-theme) — JSON: { lumenTheme: 1, name, author, look: {...}, bgImage?: 'data:image/...' }.
import { esc } from '../core/util.js';
import { S, persist, saveSettings } from '../core/state.js';
import { applyLook, setDemoBg, resetBgCache } from '../ui/look.js';

export const ACCENT_IDS = ['lumen', 'helios', 'crimson', 'violet', 'ocean', 'mint', 'sunset', 'rose', 'gold', 'lime', 'mono', 'custom'];
export const ACCENT_COLORS = { lumen: ['#c6f432', '#5ef0c8'], helios: ['#f2b8e4', '#b55fa8'], crimson: ['#ff6a4a', '#b8201b'], violet: ['#a78bfa', '#6366f1'], ocean: ['#22d3ee', '#3b82f6'], mint: ['#34d399', '#14b8a6'], sunset: ['#fb923c', '#ec4899'], rose: ['#fb7185', '#e11d48'], gold: ['#fcd34d', '#f59e0b'], lime: ['#bef264', '#22c55e'], mono: ['#f4f4f5', '#71717a'] };
const HEX = /^#[0-9a-f]{6}$/i;
const IMG = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/;
export const MAX_THEME_BG = 3 * 1024 * 1024; // картинка в теме — до 3 МБ

const num = (v, a, b, d) => (Number.isFinite(+v) ? Math.min(b, Math.max(a, +v)) : d);
const pick = (v, list, d) => (list.includes(v) ? v : d);

/** Проверить тему (из файла или из бота): только известные поля и безопасные значения. */
export function cleanTheme(t) {
  if (!t || t.lumenTheme !== 1 || typeof t.look !== 'object') throw new Error('Это не тема Lumen');
  const l = t.look;
  const look = {
    theme: pick(l.theme, ['dark', 'light'], 'dark'),
    accent: pick(l.accent, ACCENT_IDS, 'lumen'),
    customAccent: l.customAccent && HEX.test(l.customAccent.a1) ? { a1: l.customAccent.a1, a2: HEX.test(l.customAccent.a2) ? l.customAccent.a2 : l.customAccent.a1 } : null,
    tint: HEX.test(l.tint) ? l.tint : '',
    bg: pick(l.bg, ['aurora', 'solid', 'oled', 'custom'], 'aurora'),
    glow: num(l.glow, 0, 150, 100),
    radius: num(l.radius, 6, 34, 26),
    glass: num(l.glass, 0, 100, 50),
    font: pick(l.font, ['inter', 'system', 'rounded', 'mono'], 'inter'),
    fontSize: num(l.fontSize, 12, 16, 14),
    bgDim: num(l.bgDim, 0, 90, 45),
    bgBlur: num(l.bgBlur, 0, 30, 0),
  };
  if (look.accent === 'custom' && !look.customAccent) look.accent = 'lumen';
  const bgImage = typeof t.bgImage === 'string' && t.bgImage.length < MAX_THEME_BG * 1.4 && IMG.test(t.bgImage) ? t.bgImage : '';
  if (look.bg === 'custom' && !bgImage) look.bg = 'aurora';
  return { lumenTheme: 1, name: String(t.name || 'Без названия').slice(0, 40), author: String(t.author || '').slice(0, 40), look, bgImage };
}

/** Текущий вид как тема. withBg — приложить свою картинку фона (видео в темы не кладём). */
export async function currentTheme(name, withBg = true) {
  const s = S.settings;
  const t = { lumenTheme: 1, name, author: S.me?.username || '', look: {}, bgImage: '' };
  for (const k of ['theme', 'accent', 'customAccent', 'tint', 'bg', 'glow', 'radius', 'glass', 'font', 'fontSize', 'bgDim', 'bgBlur']) t.look[k] = s[k];
  if (t.look.theme === 'system') t.look.theme = document.documentElement.dataset.theme;
  if (withBg && s.bg === 'custom') {
    const f = window.api?.app?.bgGet ? await window.api.app.bgGet().catch(() => null) : null;
    if (f?.type?.startsWith('image/') && f.data.byteLength <= MAX_THEME_BG) t.bgImage = await toDataUrl(new Blob([f.data], { type: f.type }));
    else t.look.bg = 'aurora';
  }
  return cleanTheme(t);
}

const toDataUrl = (blob) => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = no; r.readAsDataURL(blob); });
function dataToBytes(url) {
  const [head, b64] = url.split(',');
  const type = /data:([^;]+)/.exec(head)[1];
  const bin = atob(b64);
  const a = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
  return { type, data: a };
}

/** Записать свой фон (файл с диска или из темы). */
export async function setBackground(data, type) {
  if (window.api?.app?.bgSet) await window.api.app.bgSet(data, type);
  else setDemoBg(data, type);
  S.settings.bgVer = Date.now();
  resetBgCache();
}

/** Поставить тему. */
export async function applyTheme(raw) {
  const t = cleanTheme(raw);
  if (t.bgImage) {
    const { type, data } = dataToBytes(t.bgImage);
    await setBackground(data, type);
  }
  Object.assign(S.settings, t.look);
  S.settings.themeName = t.name;
  saveSettings();
  applyLook();
  return t;
}

// ---------------------------------------------------------------- мои темы (на этом компьютере)
export async function myThemes() {
  const l = await persist.get('myThemes', []);
  return Array.isArray(l) ? l : [];
}
export async function saveMyTheme(t) {
  const l = (await myThemes()).filter((x) => x.name !== t.name);
  l.unshift({ ...t, savedAt: Date.now() });
  await persist.set('myThemes', l.slice(0, 30));
}
export async function deleteMyTheme(name) {
  await persist.set('myThemes', (await myThemes()).filter((x) => x.name !== name));
}

/** Скачать тему файлом (Windows спросит, куда сохранить). */
export function downloadTheme(t) {
  const blob = new Blob([JSON.stringify(t)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${t.name.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'theme'}.lumen-theme`;
  document.body.append(a);
  a.click();
  setTimeout(() => (URL.revokeObjectURL(a.href), a.remove()), 2000);
}

/** Мини-превью темы: фон, свечение, карточки и кнопка в цветах темы. */
export function themePreview(t, extra = '') {
  const l = t.look || {};
  const [a1, a2] = l.accent === 'custom' && l.customAccent ? [l.customAccent.a1, l.customAccent.a2] : ACCENT_COLORS[l.accent] || ACCENT_COLORS.lumen;
  const light = l.theme === 'light';
  const base = light ? '#f2f2f6' : l.bg === 'oled' ? '#000' : '#0b0b0d';
  const glow = l.bg === 'aurora' || !l.bg ? `radial-gradient(70% 90% at 100% 0%, ${a1}66, transparent 60%), radial-gradient(60% 80% at 0% 100%, ${a2}44, transparent 60%),` : '';
  const bg = t.bgImage || t.thumb ? `url("${esc(t.bgImage || t.thumb)}") center/cover,` : '';
  const card = light ? 'rgba(255,255,255,.85)' : 'rgba(255,255,255,.07)';
  const r = Math.round((l.radius || 26) / 3.2);
  return `<div class="tp" style="background:${glow}${bg}${base};--tp-a:${a1};--tp-a2:${a2};--tp-c:${card};--tp-r:${r}px" ${extra}>
    <i class="tp-rail"></i><i class="tp-k"></i><i class="tp-k"></i><i class="tp-big"></i><i class="tp-btn"></i></div>`;
}
