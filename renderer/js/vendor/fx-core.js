// © 2026 Lumen. Все права защищены. Копирование, изменение и распространение этого кода запрещены без разрешения автора (см. LICENSE).
/* Lumen — украшения ников: адрес сервера и проверка стилей.
   Используется и в фоне (importScripts), и на странице. */
(function (g) {
  'use strict';

  // ← сюда адрес сервера бота (PUBLIC_URL из .env) и имя бота без @
  const API = 'https://lumenfp.online';
  const BOT = 'Lumenfx_bot';

  const FILLS = ['solid', 'grad', 'flow', 'rainbow', 'metal'];
  const TEXTS = ['none', 'glow', 'neon', 'shine', 'pulse', 'wave', 'glitch', 'flicker', 'hue', 'float', 'breath'];
  const PARTS = ['none', 'embers', 'snow', 'stars', 'hearts', 'bubbles', 'bolts', 'matrix', 'confetti', 'sparkle', 'smoke', 'dots',
    'petals', 'leaves', 'coins', 'notes', 'fireflies', 'rain', 'meteors', 'pixels'];
  // украшения вокруг ника — только ID из этих списков
  const PLATES = ['own', 'aurora', 'fire', 'night', 'gold', 'ice', 'candy'];
  const BADGES = ['diamond', 'bolt', 'crown', 'fire', 'star', 'heart', 'rocket', 'shield', 'clover', 'gem'];
  const RARE = ['early', 'top'];
  const MASCOTS = ['cat', 'dragon', 'ghost', 'slime'];
  const FRAMES = ['own', 'fire', 'neon', 'snow', 'rainbow', 'gold'];
  const SIG_BAD = /(https?|www\.|t\.me|@|telegram|телег|discord|\d{5,})/i;
  const HEX = /^[0-9a-f]{6}$/i;
  const num = (v, lo, hi, d) => { v = Number(v); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d; };

  /** Стиль с сервера → безопасный объект или null. Никакого CSS с сервера — только ID из списков, цвета и числа. */
  function clean(s) {
    if (!s || typeof s !== 'object') return null;
    if (!Array.isArray(s.c) || s.c.length !== 3 || !s.c.every(x => typeof x === 'string' && HEX.test(x))) return null;
    if (typeof s.f !== 'string' || typeof s.t !== 'string' || typeof s.p !== 'string') return null;
    // эффект, которого эта версия ещё не знает (вышел позже) — заменяем похожим, а не прячем украшение целиком
    const f = FILLS.includes(s.f) ? s.f : 'grad', t = TEXTS.includes(s.t) ? s.t : 'glow', p = PARTS.includes(s.p) ? s.p : 'none';
    const out = { c: s.c.map(x => '#' + x.toLowerCase()), f, t, p, z: num(s.z, 0.4, 2, 1), s: num(s.s, 0.3, 2.5, 1), k: Math.round(num(s.k, 4, 60, 22)) };
    // необязательное: незнакомое значение просто не показываем
    if (PLATES.includes(s.pl)) out.pl = s.pl;
    if (MASCOTS.includes(s.ms)) out.ms = s.ms;
    if (FRAMES.includes(s.fr)) out.fr = s.fr;
    const bd = Array.isArray(s.bd) ? s.bd.filter(b => BADGES.includes(b)).slice(0, 3) : [];
    const rb = Array.isArray(s.rb) ? s.rb.filter(b => RARE.includes(b)).slice(0, 2) : [];
    if (bd.length || rb.length) out.bd = [...new Set([...rb, ...bd])];
    if (typeof s.sg === 'string') {
      const sg = s.sg.replace(/[\u0000-\u001f\u007f<>\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, '').trim().slice(0, 28);
      if (sg && !SIG_BAD.test(sg)) out.sg = sg;
    }
    if (s.lh === 1) out.lh = 1;
    return out;
  }

  /** Весь ответ /fx.json → { id: стиль } (только числовые ID, максимум 50 000 записей) */
  function cleanList(data) {
    const out = {};
    if (!data || typeof data !== 'object' || !data.u || typeof data.u !== 'object') return out;
    let n = 0;
    for (const id in data.u) {
      if (!/^\d{1,12}$/.test(id) || ++n > 50000) continue;
      const st = clean(data.u[id]);
      if (st) out[id] = st;
    }
    return out;
  }

  const configured = () => !/example\.com/.test(API);

  g.LumenFX = { API, BOT, FILLS, TEXTS, PARTS, PLATES, BADGES, RARE, MASCOTS, FRAMES, clean, cleanList, configured };
})(typeof self !== 'undefined' ? self : window);
