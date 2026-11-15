// © 2026 Lumen. Все права защищены. Копирование, изменение и распространение этого кода запрещены без разрешения автора (см. LICENSE).
/* Lumen — рамки аватарок (венцы, звезда, руки, шут).
   Как это работает быстро: каждая рамка один раз рисуется в «ленту» из кадров (для пары цвет+фон),
   а потом все аватарки на странице просто показывают нужный кадр из готовой ленты — 12 раз в секунду.
   Ничего не считается заново на каждом кадре, поэтому FunPay не тормозит. */
(function (g) {
  'use strict';
  if (g.LumenFrames) return;

  // id → название. Порядок = порядок в редакторе.
  const LIST = [
    ['drip', 'Чёрный венец'], ['venom', 'Синий венец'], ['abyss', 'Бездна'], ['star', 'Чёрная звезда'],
    ['briar', 'Терновник'], ['hands', 'Руки'], ['jester', 'Шут'],
  ];
  const IDS = LIST.map(x => x[0]);
  const WINGS = [];
  // готовые цвета (в ключе хранится только hex)
  const COLORS = [['Иней', 'e9f0ff'], ['Кровь', 'ff2a3d'], ['Яд', '8dff3a'], ['Аметист', 'b07cff'], ['Лёд', '5fd0ff'],
    ['Золото', 'f5c542'], ['Роза', 'ff7ab6'], ['Тьма', '17171c']];
  const DEF_COLOR = 'e9f0ff';

  const N = 36;            // кадров в круге
  const DUR = 3000;        // мс на круг
  const B = 360, CX = 180, CY = 180, R = 56;   // базовые координаты рисунка
  const K = B / (2 * R);   // во сколько раз холст рамки больше самой аватарки

  const TAU = Math.PI * 2;
  const hexA = (h, a) => { const n = parseInt(h, 16); return `rgba(${n >> 16},${n >> 8 & 255},${n & 255},${a})`; };
  const mix = (a, b, t) => { const p = parseInt(a, 16), q = parseInt(b, 16); const c = sh => Math.round(((p >> sh) & 255) * (1 - t) + ((q >> sh) & 255) * t); return ((1 << 24) | (c(16) << 16) | (c(8) << 8) | c(0)).toString(16).slice(1); };
  const lum = h => { const n = parseInt(h, 16); return (0.2126 * (n >> 16) + 0.7152 * (n >> 8 & 255) + 0.0722 * (n & 255)) / 255; };



  /* ---------- рамки-картинки (венцы, звезда, руки, шут) ---------- */
  const PIC = g.LumenFramesImg || {};
  const TINT = { drip: 1, abyss: 1, star: 1, briar: 1 };   // эти можно перекрасить выбранным цветом
  const TINTABLE = Object.keys(TINT);
  const pics = {};
  function pic(id) {
    if (pics[id]) return pics[id];
    const d = PIC[id]; if (!d || typeof Image === 'undefined') return null;
    const im = new Image(); const o = { im, ok: false, wait: [] };
    im.onload = () => { o.ok = true; o.wait.splice(0).forEach(f => f()); };
    im.src = d.src;
    return (pics[id] = o);
  }
  let scr = null;
  const picD = (id, compact) => {
    const d = PIC[id]; let D = 2 * (R + 1) / d.in;   // отверстие картинки = аватарка (чуть заходит на неё)
    if (compact && id !== 'jester') D = Math.max(Math.min(D, 2 * R * 1.42 / d.out), D * 0.78);
    return D;
  };
  /** Сколько места (в единицах рисунка) занимает рамка — для картинок меньше, чем весь холст, значит чётче */
  const box = (id, compact) => !PIC[id] ? B : id === 'jester' ? Math.max(picD(id, compact), 2.9 * R) : picD(id, compact) + 18;
  function drawPic(x, id, T, C, light, compact) {
    const P = pic(id === 'briar' && light && PIC.briar_l ? 'briar_l' : id);
    if (!P || !P.ok) return;
    const wh = lum(C) > 0.8, dk = lum(C) < 0.2;
    const D = picD(id, compact), bx = box(id, compact);
    const M = x.getTransform ? x.getTransform() : { a: 1, b: 0 }, sc = Math.hypot(M.a, M.b) || 1, W = Math.min(1024, Math.ceil(bx * sc));
    if (!scr) scr = document.createElement('canvas');
    if (scr.width !== W) scr.width = scr.height = W;
    const s = scr.getContext('2d');
    s.setTransform(1, 0, 0, 1, 0, 0); s.globalCompositeOperation = 'source-over'; s.globalAlpha = 1; s.filter = 'none'; s.clearRect(0, 0, W, W);
    s.setTransform(W / bx, 0, 0, W / bx, W / 2, W / 2);   // (0,0) — центр аватарки
    const place = () => {
      s.save();
      if (id === 'briar') s.rotate(Math.sin(TAU * T) * 0.05);
      if (id === 'hands') { const k = 1 + 0.012 * Math.sin(TAU * T); s.scale(k, k); }
      if (id === 'jester') { const top = -R * 0.6; s.translate(0, top); s.rotate(Math.sin(TAU * T) * 0.035); s.translate(0, -top); }
      s.drawImage(P.im, -D / 2, -D / 2, D, D);
      s.restore();
    };
    place();
    // перекраска (только для чёрно-белых)
    if (TINT[id] && !wh && !dk) {
      s.globalCompositeOperation = 'color'; s.fillStyle = '#' + C; s.fillRect(-bx, -bx, 2 * bx, 2 * bx);
      s.globalCompositeOperation = 'destination-in'; place();
    }
    // бегущий по кругу блик на металле
    if (id !== 'hands' && id !== 'jester' && s.createConicGradient) {
      s.globalCompositeOperation = 'source-atop';
      const cg = s.createConicGradient(TAU * T - Math.PI / 2, 0, 0);
      cg.addColorStop(0, 'rgba(255,255,255,0)'); cg.addColorStop(0.04, 'rgba(255,255,255,.5)'); cg.addColorStop(0.1, 'rgba(255,255,255,0)');
      cg.addColorStop(0.5, 'rgba(255,255,255,0)'); cg.addColorStop(0.54, 'rgba(255,255,255,.22)'); cg.addColorStop(0.6, 'rgba(255,255,255,0)'); cg.addColorStop(1, 'rgba(255,255,255,0)');
      s.fillStyle = cg; s.fillRect(-bx, -bx, 2 * bx, 2 * bx);
    }
    s.globalCompositeOperation = 'source-over';
    x.save();
    if (!light) {   // на тёмном фоне — свечение, чтобы чёрная рамка не терялась
      const glow = id === 'hands' ? 'd4234a' : id === 'venom' ? '3f5bff' : id === 'jester' ? '000000' : (wh || dk ? 'aab4d0' : C);
      const beat = id === 'hands' ? Math.max(Math.exp(-Math.pow((T - 0.1) / 0.05, 2)), 0.7 * Math.exp(-Math.pow((T - 0.28) / 0.05, 2))) : 0.5 + 0.5 * Math.sin(TAU * T);
      x.shadowColor = hexA(glow, id === 'jester' ? 0.6 : 0.3 + 0.3 * beat); x.shadowBlur = 6 + 6 * beat;
    }
    x.drawImage(scr, 0, 0, W, W, CX - bx / 2, CY - bx / 2, bx, bx);
    x.restore();
  }

  /* ---------- один кадр ---------- */
  function drawFrame(x, id, T, fi, C, light, compact) { if (PIC[id]) drawPic(x, id, T, C, light, compact); }

  /* ---------- ленты кадров (кэш) ---------- */
  const sprites = new Map();   // key → { canvas, cell, ready }
  function sprite(id, C, light, compact, cell) {
    const key = [id, C, light ? 1 : 0, compact ? 1 : 0, cell].join(':');
    let s = sprites.get(key);
    if (s) return s;
    if (sprites.size >= 24) sprites.delete(sprites.keys().next().value);   // не копим ленты бесконечно (например, пока крутят выбор цвета)
    const cv = document.createElement('canvas');
    cv.width = cell * N; cv.height = cell;
    s = { canvas: cv, cell, ready: 0 };
    sprites.set(key, s);
    const ctx = cv.getContext('2d');
    const bx = box(id, compact), k = cell / bx;
    // рисуем по нескольку кадров за раз, чтобы страница не подвисала
    let fi = 0;
    const step = () => {
      const until = performance.now() + 8;
      while (fi < N && performance.now() < until) {
        ctx.save(); ctx.translate(fi * cell, 0); ctx.scale(k, k); ctx.translate(bx / 2 - CX, bx / 2 - CY);
        ctx.beginPath();
        // маленькая аватарка (списки лотов, чаты): рамка почти не выходит за круг — не налезает на соседние строки и текст
        if (compact) { ctx.arc(CX, CY, R * 1.3, 0, TAU); ctx.ellipse(CX, CY - R * 0.42, R * 1.15, R * 1.18, 0, 0, TAU); }
        else ctx.rect(CX - bx / 2, CY - bx / 2, bx, bx);
        ctx.clip();
        drawFrame(ctx, id, fi / N, fi, C, light, compact);
        ctx.restore();
        fi++; s.ready = fi;
      }
      if (fi < N) setTimeout(step, 16);
    };
    const P = PIC[id] && pic(id === 'briar' && light && PIC.briar_l ? 'briar_l' : id);
    if (P && !P.ok) P.wait.push(step); else step();
    return s;
  }

  /* ---------- показ на странице ---------- */
  const live = new Set();
  let timer = null;
  const reduce = () => g.matchMedia && g.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const io = typeof IntersectionObserver !== 'undefined' ? new IntersectionObserver(es => es.forEach(e => { const o = e.target.__lmfx; if (o) o.vis = e.isIntersecting; }), { rootMargin: '100px' }) : null;

  function tick() {
    const fi = reduce() ? 0 : Math.floor(performance.now() / (DUR / N)) % N;
    live.forEach(o => {
      if (!o.vis || !o.cv.isConnected) return;
      const s = o.sp, f = Math.min(fi, Math.max(0, s.ready - 1));
      if (o.last === f && o.lastReady === s.ready) return;
      o.last = f; o.lastReady = s.ready;
      o.ctx.clearRect(0, 0, o.cv.width, o.cv.height);
      if (s.ready) o.ctx.drawImage(s.canvas, f * s.cell, 0, s.cell, s.cell, 0, 0, o.cv.width, o.cv.height);
    });
    if (live.size && !document.hidden) timer = setTimeout(tick, DUR / N);
    else timer = null;
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden && live.size && !timer) tick(); });

  /** Повесить рамку на элемент-аватарку (div). size — ширина аватарки в px. Вернёт функцию «снять». */
  function attach(host, opt) {
    const id = IDS.includes(opt.id) ? opt.id : null;
    if (!id) return () => {};
    const C = /^[0-9a-f]{6}$/i.test(opt.color || '') ? opt.color.toLowerCase() : DEF_COLOR;
    const size = Math.max(16, opt.size || host.getBoundingClientRect().width || 40);
    const compact = size < 72;   // маленькая аватарка: крылья → только «голова», шипы короче
    const dpr = Math.min(2, g.devicePixelRatio || 1);
    const ov = size * box(id, compact) / (2 * R);
    const want = ov * dpr;
    const cell = want <= 170 ? 160 : want <= 270 ? 256 : want <= 390 || !PIC[id] ? 384 : 448;
    const cv = document.createElement('canvas');
    cv.className = 'lm-frx';
    cv.width = cv.height = Math.round(Math.min(want, cell));
    cv.style.cssText = `position:absolute;left:50%;top:50%;width:${ov}px;height:${ov}px;margin:${-ov / 2}px 0 0 ${-ov / 2}px;pointer-events:none;z-index:2;max-width:none;max-height:none`;
    const o = { cv, ctx: cv.getContext('2d'), sp: sprite(id, C, !!opt.light, compact, cell), vis: !io, last: -1 };
    cv.__lmfx = o;
    host.appendChild(cv);
    live.add(o);
    if (io) io.observe(cv);
    if (!timer) tick();
    return () => { live.delete(o); if (io) io.unobserve(cv); cv.remove(); };
  }

  /** Светлый ли фон под элементом (чтобы рамка на белом FunPay была с обводкой) */
  function isLight(el) {
    let n = el;
    while (n && n.nodeType === 1) {
      const c = getComputedStyle(n).backgroundColor;
      const m = c && c.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?/);
      if (m && (m[4] === undefined || +m[4] > 0.5)) return (0.2126 * m[1] + 0.7152 * m[2] + 0.0722 * m[3]) / 255 > 0.55;
      n = n.parentElement;
    }
    return true;
  }

  /** Вызвать cb, когда картинки рамок загружены (для иконок в редакторе) */
  function ready(cb) { const w = Object.keys(PIC).map(pic).filter(o => o && !o.ok); let n = w.length; if (!n) return cb(); w.forEach(o => o.wait.push(() => { if (!--n) cb(); })); }

  g.LumenFrames = { LIST, IDS, WINGS, TINTABLE, COLORS, DEF_COLOR, K, attach, isLight, drawFrame, ready, B };
})(typeof window !== 'undefined' ? window : self);
