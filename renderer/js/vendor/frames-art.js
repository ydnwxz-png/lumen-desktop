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
  // 'e9f0ff' — «Обычная»: рамка как на картинке (так было у всех раньше). Остальные перекрашивают рамку.
  const COLORS = [['Обычная', 'e9f0ff'], ['Белая', 'ffffff'], ['Кровь', 'ff2a3d'], ['Яд', '8dff3a'], ['Аметист', 'b07cff'], ['Лёд', '5fd0ff'],
    ['Золото', 'f5c542'], ['Роза', 'ff7ab6'], ['Тьма', '17171c']];
  const DEF_COLOR = 'e9f0ff';

  const N = 36;            // кадров в круге
  const DUR = 3000;        // мс на круг
  const B = 360, CX = 180, CY = 180, R = 56;   // базовые координаты рисунка
  const K = B / (2 * R);   // во сколько раз холст рамки больше самой аватарки

  const TAU = Math.PI * 2;
  const hexA = (h, a) => { const n = parseInt(h, 16); return `rgba(${n >> 16},${n >> 8 & 255},${n & 255},${a})`; };
  const mix = (a, b, t) => { const p = parseInt(a, 16), q = parseInt(b, 16); const c = sh => Math.round(((p >> sh) & 255) * (1 - t) + ((q >> sh) & 255) * t); return ((1 << 24) | (c(16) << 16) | (c(8) << 8) | c(0)).toString(16).slice(1); };
  const sat = h => { const n = parseInt(h, 16), r = n >> 16, g2 = n >> 8 & 255, b = n & 255, mx = Math.max(r, g2, b), mn = Math.min(r, g2, b); return mx ? (mx - mn) / mx : 0; };
  // как красить: orig — как на картинке, white — белый металл, dark — темнее, color — в цвет
  const tintMode = C => C === DEF_COLOR ? 'orig' : sat(C) < 0.18 ? (lum(C) > 0.6 ? 'white' : lum(C) < 0.25 ? 'dark' : 'orig') : 'color';
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
  // fit — сколько места есть вокруг аватарки (в радиусах аватарки). Если FunPay обрезает блок с аватаркой,
  // рамка уменьшается под это место, а то, что всё равно не влезает, плавно растворяется — без ровного среза.
  const picD = (id, compact, fit) => {
    const d = PIC[id]; let D = 2 * (R + 1) / d.in;   // отверстие картинки = аватарка (чуть заходит на неё)
    if (compact && id !== 'jester') D = Math.max(Math.min(D, 2 * R * 1.56 / d.out), D * 0.82);
    if (fit < 9 && id !== 'jester') D = Math.max(Math.min(D, 2 * R * fit / d.out * 0.97), 2 * R * 0.84 / d.in);
    return D;
  };
  /** Сколько места (в единицах рисунка) занимает рамка — для картинок меньше, чем весь холст, значит чётче */
  const box = (id, compact, fit = 9) => { const b = !PIC[id] ? B : id === 'jester' ? Math.max(picD(id, compact, fit), 2.9 * R) : picD(id, compact, fit) + 18; return fit < 9 ? Math.min(b, 2 * fit * R + 8) : b; };
  function drawPic(x, id, T, C, light, compact, fit = 9) {
    const P = pic(id === 'briar' && light && PIC.briar_l ? 'briar_l' : id);
    if (!P || !P.ok) return;
    const mode = TINT[id] ? tintMode(C) : 'orig', wh = mode === 'white' || mode === 'orig', dk = mode === 'dark';
    const D = picD(id, compact, fit), bx = box(id, compact, fit);
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
    if (mode !== 'orig') {
      const fill = (op, c) => { s.globalCompositeOperation = op; s.fillStyle = c; s.fillRect(-bx, -bx, 2 * bx, 2 * bx); };
      if (mode === 'white') { fill('color', '#ffffff'); fill('screen', 'rgba(185,190,202,.78)'); }
      else if (mode === 'dark') fill('multiply', '#3a3a42');
      else { fill('color', '#' + C); fill('soft-light', '#' + C); fill('screen', hexA(C, 0.18)); }
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
    if (fit < 9) {   // плавно гасим края у границы свободного места
      s.globalCompositeOperation = 'destination-in';
      const rg = s.createRadialGradient(0, 0, fit * R * 0.9, 0, 0, fit * R);
      rg.addColorStop(0, '#000'); rg.addColorStop(1, 'rgba(0,0,0,0)');
      s.fillStyle = rg; s.fillRect(-bx, -bx, 2 * bx, 2 * bx);
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
  function drawFrame(x, id, T, fi, C, light, compact, fit) { if (PIC[id]) drawPic(x, id, T, C, light, compact, fit || 9); }

  /* ---------- ленты кадров (кэш) ---------- */
  const sprites = new Map();   // key → { canvas, cell, ready }
  function sprite(id, C, light, compact, cell, fit) {
    const key = [id, C, light ? 1 : 0, compact ? 1 : 0, cell, fit].join(':');
    let s = sprites.get(key);
    if (s) return s;
    if (sprites.size >= 24) sprites.delete(sprites.keys().next().value);   // не копим ленты бесконечно (например, пока крутят выбор цвета)
    const cv = document.createElement('canvas');
    cv.width = cell * N; cv.height = cell;
    s = { canvas: cv, cell, ready: 0 };
    sprites.set(key, s);
    const ctx = cv.getContext('2d');
    const bx = box(id, compact, fit), k = cell / bx;
    // рисуем по нескольку кадров за раз, чтобы страница не подвисала
    let fi = 0;
    const step = () => {
      const until = performance.now() + 8;
      while (fi < N && performance.now() < until) {
        ctx.save(); ctx.translate(fi * cell, 0); ctx.scale(k, k); ctx.translate(bx / 2 - CX, bx / 2 - CY);
        ctx.beginPath();
        // маленькая аватарка (списки лотов, чаты): рамка почти не выходит за круг — не налезает на соседние строки и текст
        if (compact) { ctx.arc(CX, CY, R * 1.5, 0, TAU); ctx.ellipse(CX, CY - R * 0.42, R * 1.2, R * 1.2, 0, 0, TAU); }
        else ctx.rect(CX - bx / 2, CY - bx / 2, bx, bx);
        ctx.clip();
        drawFrame(ctx, id, fi / N, fi, C, light, compact, fit);
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

  // рамка «поверх страницы»: холст лежит в body и каждый кадр встаёт на место аватарки
  function place(o) {
    const h = o.host;
    if (!h.isConnected) {   // FunPay перерисовал список — через пару секунд убираем осиротевшую рамку
      o.cv.style.display = 'none';
      if (++o.gone > 24) o.off();
      return false;
    }
    o.gone = 0;
    const r = h.getBoundingClientRect();
    if (!r.width || !r.height) { o.cv.style.display = 'none'; return false; }
    const x = r.left + r.width / 2 + scrollX, y = r.top + r.height / 2 + scrollY, ov = o.ov;
    const key = x + ',' + y;
    if (o.pos !== key) {
      o.pos = key;
      o.cv.style.display = '';
      o.cv.style.left = (x - ov / 2) + 'px'; o.cv.style.top = (y - ov / 2) + 'px';
      // если аватарка внутри прокручиваемого списка — не вылезаем за его края
      let cl = null;
      o.scrollers.forEach(sc => { const b = sc.getBoundingClientRect(); cl = cl ? { l: Math.max(cl.l, b.left), t: Math.max(cl.t, b.top), r: Math.min(cl.r, b.right), b: Math.min(cl.b, b.bottom) } : { l: b.left, t: b.top, r: b.right, b: b.bottom }; });
      if (cl) { const L = r.left + r.width / 2 - ov / 2, T = r.top + r.height / 2 - ov / 2; o.cv.style.clipPath = `inset(${Math.max(0, cl.t - T)}px ${Math.max(0, L + ov - cl.r)}px ${Math.max(0, T + ov - cl.b)}px ${Math.max(0, cl.l - L)}px)`; }
      holes(o, r);
    } else if (++o.hk > 24) { o.hk = 0; holes(o, r); }   // раз в 2 секунды — вдруг значок появился/пропал
    return true;
  }

  /* «Окошки» в рамке над мелкими значками FunPay на аватарке (точка онлайн, кнопка-карандаш) — чтобы рамка их не закрывала */
  function badgeRects(host, hr, outer) {
    const out = [], cx = hr.left + hr.width / 2, cy = hr.top + hr.height / 2, max = hr.width * 0.7;
    const near = b => b.width > 2 && b.height > 2 && b.width <= max && b.height <= max && Math.hypot(Math.max(b.left - cx, 0, cx - b.right), Math.max(b.top - cy, 0, cy - b.bottom)) < outer;
    const scope = (host.parentElement && host.parentElement.parentElement) || host.parentElement || host;
    scope.querySelectorAll('*').forEach(el => {
      if (el === host || el.contains(host) || el.tagName === 'CANVAS' || el.closest('svg') && el.tagName !== 'svg') return;
      if (el.parentElement && el.parentElement !== scope && !el.parentElement.contains(host) && out.some(x => x.el === el.parentElement)) return;   // внутри уже найденного значка
      if ((el.textContent || '').trim().length > 2) return;   // ники и подписи не трогаем
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) return;
      const b = el.getBoundingClientRect();
      if (near(b) && (cs.backgroundColor !== 'rgba(0, 0, 0, 0)' || cs.backgroundImage !== 'none' || /^(BUTTON|A|I|SVG|svg|IMG)$/.test(el.tagName) || el.className && /online|status|btn|edit/i.test(el.className))) out.push({ el, b, round: parseFloat(cs.borderTopLeftRadius) >= b.width / 2 - 1 });
    });
    // значки-псевдоэлементы (::after у аватарки — частая точка онлайн)
    [host, host.parentElement].forEach(n => {
      if (!n) return;
      const nr = n.getBoundingClientRect();
      ['::after', '::before'].forEach(pe => {
        const cs = getComputedStyle(n, pe);
        if (!cs || cs.content === 'none' || cs.content === 'normal' || cs.position !== 'absolute' || cs.display === 'none') return;
        const bb = cs.boxSizing === 'border-box' ? 0 : 1;
        const w = parseFloat(cs.width) + bb * (parseFloat(cs.borderLeftWidth) + parseFloat(cs.borderRightWidth) + parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight)), h = parseFloat(cs.height) + bb * (parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth) + parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom));
        if (!(w > 2 && h > 2)) return;
        const l = cs.left !== 'auto' ? nr.left + parseFloat(cs.left) : nr.right - parseFloat(cs.right) - w;
        const t = cs.top !== 'auto' ? nr.top + parseFloat(cs.top) : nr.bottom - parseFloat(cs.bottom) - h;
        const b = { left: l, top: t, right: l + w, bottom: t + h, width: w, height: h };
        if (near(b)) out.push({ b, round: parseFloat(cs.borderTopLeftRadius) >= w / 2 - 1 });
      });
    });
    return out;
  }
  function holes(o, hr) {
    const L = hr.left + hr.width / 2 - o.ov / 2, T = hr.top + hr.height / 2 - o.ov / 2;
    const list = badgeRects(o.host, hr, o.ov / 2);
    const key = list.map(x => [x.b.left - L, x.b.top - T, x.b.width, x.b.height].map(Math.round).join(',')).join(';');
    if (key === o.hk2) return;
    o.hk2 = key;
    const st = o.cv.style;
    if (!list.length) { st.maskImage = st.webkitMaskImage = ''; return; }
    const m = list.map(({ b, round }) => {
      const x = b.left - L + b.width / 2, y = b.top - T + b.height / 2, k = round ? 1.0 : 1.2, rx = b.width / 2 * k + 2, ry = b.height / 2 * k + 2;
      return `radial-gradient(${rx}px ${ry}px at ${x}px ${y}px, transparent 99%, #000 100%)`;
    }).join(',');
    st.maskImage = st.webkitMaskImage = m;
    st.maskComposite = 'intersect'; st.webkitMaskComposite = 'source-in';
    st.maskRepeat = st.webkitMaskRepeat = 'no-repeat';
  }

  function tick() {
    const fi = reduce() ? 0 : Math.floor(performance.now() / (DUR / N)) % N;
    live.forEach(o => {
      if (o.host && !place(o)) return;
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
  // рамки поверх страницы двигаем сразу при прокрутке (иначе при листании чата они отстают и «улетают»)
  let moveRaf = 0;
  const moveAll = () => { moveRaf = 0; live.forEach(o => { if (o.host) place(o); }); };
  if (g.addEventListener) {
    g.addEventListener('scroll', () => { if (!moveRaf && live.size) moveRaf = requestAnimationFrame(moveAll); }, { capture: true, passive: true });
    g.addEventListener('resize', () => { if (!moveRaf && live.size) moveRaf = requestAnimationFrame(moveAll); }, { passive: true });
  }

  /** Сколько свободного места вокруг аватарки (в её радиусах), пока родители не обрежут рамку (overflow: hidden и т.п.).
      Стороны, где обрезана уже сама аватарка, не считаем — там рамка обрезается вместе с ней. */
  // z-index для рамки поверх страницы: выше блока, в котором живёт аватарка (иначе рамка уходит за контент и видна «сквозь» него)
  function topZ(host) {
    let z = 0;
    for (let n = host; n && n !== document.body && n !== document.documentElement; n = n.parentElement) { const v = parseInt(getComputedStyle(n).zIndex, 10); if (!isNaN(v)) z = v; }
    return Math.max(5, z + 1);
  }
  const scrolls = (n, cs) => /auto|scroll/.test(cs.overflowX + cs.overflowY) && (n.scrollHeight > n.clientHeight + 1 || n.scrollWidth > n.clientWidth + 1);
  function room(host, size, scrollOnly) {
    if (!host.isConnected) return 9;
    const r = host.getBoundingClientRect(), half = size / 2, cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    let best = 9 * half;
    for (let n = host.parentElement; n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
      const cs = getComputedStyle(n), all = /paint|strict|content/.test(cs.contain || '') || (cs.clipPath && cs.clipPath !== 'none');
      const ox = all || cs.overflowX !== 'visible', oy = all || cs.overflowY !== 'visible';
      if (!ox && !oy) continue;
      if (scrollOnly && !scrolls(n, cs)) continue;   // рамка поверх страницы: мешают только списки, которые реально прокручиваются
      const b = n.getBoundingClientRect(), d = [];
      if (ox) d.push(cx - b.left, b.right - cx);
      if (oy) d.push(cy - b.top, b.bottom - cy);
      d.forEach(v => { if (v >= half * 1.04 && v < best) best = v; });
    }
    return best / half;
  }

  /** Повесить рамку на элемент-аватарку (div). size — ширина аватарки в px. Вернёт функцию «снять». */
  function attach(host, opt) {
    const id = IDS.includes(opt.id) ? opt.id : null;
    if (!id) return () => {};
    const C = /^[0-9a-f]{6}$/i.test(opt.color || '') ? opt.color.toLowerCase() : DEF_COLOR;
    const size = Math.max(16, opt.size || host.getBoundingClientRect().width || 40);
    const compact = size < 72;   // маленькая аватарка: крылья → только «голова», шипы короче
    const dpr = Math.min(2, g.devicePixelRatio || 1);
    // поверх страницы: большая аватарка в профиле (чтобы шапка FunPay её не обрезала) и аватарки-картинки <img> (в них холст не вставить)
    const portal = (!!opt.portal || host.tagName === 'IMG') && !!document.body;
    let fit = opt.fit || (portal ? (compact ? Math.max(1.4, room(host, size, true)) : 1.35) : room(host, size));   // маленькие (диалоги, лоты) — под свободное место, без среза
    fit = fit >= 9 ? 9 : Math.max(1.08, Math.floor(fit * 10) / 10);
    const ov = size * box(id, compact, fit) / (2 * R);
    const want = ov * dpr;
    const cell = want <= 170 ? 160 : want <= 270 ? 256 : want <= 390 || !PIC[id] ? 384 : 448;
    const cv = document.createElement('canvas');
    cv.className = 'lm-frx';
    cv.width = cv.height = Math.round(Math.min(want, cell));
    cv.style.cssText = portal
      ? `position:absolute;left:0;top:0;width:${ov}px;height:${ov}px;pointer-events:none;z-index:${opt.z || topZ(host)};max-width:none;max-height:none;margin:0`
      : `position:absolute;left:50%;top:50%;width:${ov}px;height:${ov}px;margin:${-ov / 2}px 0 0 ${-ov / 2}px;pointer-events:none;z-index:2;max-width:none;max-height:none`;
    const o = { cv, ctx: cv.getContext('2d'), sp: sprite(id, C, !!opt.light, compact, cell, fit), vis: !io, last: -1 };
    cv.__lmfx = o;
    if (portal) {
      o.host = host; o.ov = ov; o.scrollers = []; o.hk = 0;
      for (let n = host.parentElement; n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
        const cs = getComputedStyle(n);
        if (scrolls(n, cs)) o.scrollers.push(n);
      }
      document.body.appendChild(cv); place(o);
      if (typeof ResizeObserver !== 'undefined') { o.ro = new ResizeObserver(() => { o.pos = ''; place(o); }); o.ro.observe(host); }
    } else host.appendChild(cv);
    live.add(o);
    if (io) io.observe(cv);
    if (!timer) tick();
    o.gone = 0;
    o.off = () => { live.delete(o); if (io) io.unobserve(cv); if (o.ro) o.ro.disconnect(); cv.remove(); };
    return o.off;
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
