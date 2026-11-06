export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export function debounce(fn, ms) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

export function hash(s) {
  let h = 2166136261;
  for (const c of String(s)) h = Math.imul(h ^ c.codePointAt(0), 16777619);
  return h >>> 0;
}

export const isDefaultAvatar = (u) => !u || u.includes('/img/layout/avatar');

export function initials(name) {
  const s = String(name || '?').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const parts = s.split(' ').filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

/** Аватар: картинка, а если её нет или она не загрузилась — инициалы на градиенте. */
export function avatar(url, name, size = 40, extra = '', uid = '') {
  const h = hash(name || '?') % 360;
  const style = `--s:${size}px;--h1:${h};--h2:${(h + 50) % 360}`;
  const ini = `<span class="av-ini">${esc(initials(name))}</span>`;
  const img = !isDefaultAvatar(url) ? `<img src="${esc(url)}" alt="" loading="lazy">` : '';
  return `<span class="av ${extra}" style="${style}"${uid ? ` data-uid="${esc(String(uid))}"` : ''}>${ini}${img}</span>`;
}

const URL_RE = /\b(https?:\/\/[^\s<>"']+[^\s<>"'.,!?;:)\]])/g;
const ORDER_RE = /#([A-Z0-9]{8})\b/g;

/** Текст сообщения → безопасный HTML: ссылки, номера заказов, переносы. */
export function richText(text) {
  let s = esc(text);
  s = s.replace(URL_RE, (u) => `<a class="lnk" href="${u}" data-ext="${u}">${u.length > 60 ? u.slice(0, 57) + '…' : u}</a>`);
  s = s.replace(ORDER_RE, (m, id) => `<a class="order-lnk" data-order="${id}">#${id}</a>`);
  return s.replace(/\n/g, '<br>');
}

export const stripZW = (s) => String(s || '').replace(/[​-‍⁠﻿]/g, '');

export function findOrderIds(text) {
  return [...String(text).matchAll(ORDER_RE)].map((m) => m[1]);
}

// ---------------------------------------------------------------- даты (FunPay живёт по Москве)

const MONTHS = ['январ', 'феврал', 'март', 'апрел', 'ма', 'июн', 'июл', 'август', 'сентябр', 'октябр', 'ноябр', 'декабр'];
const MONTHS_EN = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const MSK = 3 * 3600e3;

/** «28 октября, 16:24:52», «вчера, 12:00», «16:24», «12.03.25, 10:00» → Date (настоящее время) или null. */
export function parseFpDate(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (!s) return null;
  const now = new Date(Date.now() + MSK); // «московские» поля через UTC-геттеры
  const tm = /(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(s);
  const H = tm ? +tm[1] : 0,
    M = tm ? +tm[2] : 0,
    S = tm && tm[3] ? +tm[3] : 0;
  let y = now.getUTCFullYear(),
    mo = now.getUTCMonth(),
    d = now.getUTCDate();
  const mk = () => new Date(Date.UTC(y, mo, d, H, M, S) - MSK);
  if (s.includes('сегодня') || s.includes('today')) return mk();
  if (s.includes('вчера') || s.includes('yesterday')) {
    const t = new Date(Date.UTC(y, mo, d) - 86400e3);
    y = t.getUTCFullYear();
    mo = t.getUTCMonth();
    d = t.getUTCDate();
    return mk();
  }
  const dmy = /(\d{1,2})\.(\d{1,2})\.(\d{2,4})/.exec(s);
  if (dmy) {
    d = +dmy[1];
    mo = +dmy[2] - 1;
    y = +dmy[3] < 100 ? 2000 + +dmy[3] : +dmy[3];
    return mk();
  }
  let mi = -1;
  const words = s.replace(/[\d,.:]/g, ' ').split(/\s+/).filter(Boolean);
  for (const w of words) {
    const i = MONTHS.findIndex((m) => (m === 'ма' ? w === 'мая' || w === 'май' : w.startsWith(m)));
    if (i >= 0) {
      mi = i;
      break;
    }
    const j = MONTHS_EN.findIndex((m) => w.startsWith(m));
    if (j >= 0) {
      mi = j;
      break;
    }
  }
  if (mi >= 0) {
    const day = /(^|\D)(\d{1,2})(\D|$)/.exec(s.replace(/\d{1,2}:\d{2}(:\d{2})?/, ''));
    if (!day) return null;
    const yr = /\b(20\d{2})\b/.exec(s);
    d = +day[2];
    mo = mi;
    if (yr) y = +yr[1];
    let r = mk();
    if (!yr && r.getTime() > Date.now() + 36 * 3600e3) {
      y -= 1;
      r = mk();
    }
    return r;
  }
  return tm ? mk() : null;
}

export const hhmm = (d) => (d ? d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '');

export function dayLabel(d) {
  const t = new Date();
  const k = (x) => `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`;
  if (k(d) === k(t)) return 'Сегодня';
  const y = new Date(t.getTime() - 86400e3);
  if (k(d) === k(y)) return 'Вчера';
  return `${d.getDate()} ${MONTHS_GEN[d.getMonth()]}${d.getFullYear() !== t.getFullYear() ? ' ' + d.getFullYear() : ''}`;
}

export const dayKey = (d) => (d ? `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}` : '');

export function plural(n, one, few, many) {
  const a = Math.abs(n) % 100,
    b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

export function fmtNum(n, frac = 0) {
  return Number(n || 0).toLocaleString('ru-RU', { minimumFractionDigits: frac, maximumFractionDigits: 2 });
}

export function fmtLeft(ms) {
  if (ms <= 0) return 'сейчас';
  const s = Math.round(ms / 1000);
  const h = Math.floor(s / 3600),
    m = Math.floor((s % 3600) / 60),
    sec = s % 60;
  if (h) return `${h} ч ${m} мин`;
  if (m) return `${m} мин ${sec ? sec + ' с' : ''}`.trim();
  return `${sec} с`;
}

export async function copyText(t) {
  try {
    await navigator.clipboard.writeText(t);
    return true;
  } catch {
    return false;
  }
}

/** FLIP-анимация перестановки детей контейнера. */
export function flip(container, mutate) {
  const kids = [...container.children];
  const before = new Map(kids.map((k) => [k, k.getBoundingClientRect().top]));
  mutate();
  if (document.documentElement.dataset.anim === 'off') return;
  for (const k of container.children) {
    const b = before.get(k);
    if (b === undefined) continue;
    const dy = b - k.getBoundingClientRect().top;
    if (Math.abs(dy) > 1) k.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 380, easing: 'cubic-bezier(.2,.8,.2,1)' });
  }
}

/** Плавный счётчик чисел. */
export function countUp(node, to, { frac = 0, suffix = '', ms = 900 } = {}) {
  const from = parseFloat(node.dataset.v || '0') || 0;
  node.dataset.v = to;
  if (document.documentElement.dataset.anim === 'off') {
    node.textContent = fmtNum(to, frac) + suffix;
    return;
  }
  const t0 = performance.now();
  const step = (t) => {
    const k = Math.min(1, (t - t0) / ms);
    const e = 1 - Math.pow(1 - k, 4);
    node.textContent = fmtNum(from + (to - from) * e, frac) + suffix;
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
