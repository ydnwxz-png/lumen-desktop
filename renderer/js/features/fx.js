// Украшения ников Lumen FX — те же, что видят пользователи расширения Lumen на funpay.com.
// Список «ID профиля → стиль» берётся с сервера (fx.json), стили — только ID эффектов, цвета и числа.
// Ник в разметке: <span class="nick" data-uid="123">name</span>, аватарка: <span class="av" data-uid="123">.
import '../vendor/fx-core.js';
import '../vendor/deco-art.js';
import { S } from '../core/state.js';

const FXC = window.LumenFX;
const ART = window.LumenArt;
let map = {};
let hasAny = false;
const live = new Set();
const MAX_LIVE = 40;

export const fxHas = (uid) => !!map[String(uid)];
export const fxCount = () => Object.keys(map).length;

// ---------------------------------------------------------------- загрузка списка

async function load() {
  // главный процесс скачивает fx.json (без CORS) и хранит копию на случай без интернета
  let raw = null;
  try {
    raw = window.api ? await window.api.fx.list() : null;
  } catch {}
  if (!raw && !window.api) {
    try {
      raw = await (await fetch(FXC.API + '/fx.json', { cache: 'no-cache' })).json();
    } catch {}
  }
  if (!raw) return;
  map = FXC.cleanList(raw);
  hasAny = Object.keys(map).length > 0;
  schedule();
}

// ---------------------------------------------------------------- оформление

const setColors = (el, st) => {
  el.style.setProperty('--fx1', st.c[0]);
  el.style.setProperty('--fx2', st.c[1]);
  el.style.setProperty('--fx3', st.c[2]);
  el.style.setProperty('--fx1a', st.c[0] + 'a6');
  el.style.setProperty('--fx2a', st.c[1] + '8c');
};

function bgLight(el) {
  for (let a = el; a && a !== document.documentElement.parentNode; a = a.parentElement) {
    const m = getComputedStyle(a).backgroundColor.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?/);
    if (m && (m[4] === undefined || +m[4] > 0.5)) return 0.299 * m[1] + 0.587 * m[2] + 0.114 * m[3] > 150;
  }
  return document.documentElement.dataset.theme === 'light';
}

function undo(el) {
  const rm = [...el.classList].filter((c) => (c.startsWith('lm-fx') && c !== 'lm-fx-wrap') || c.startsWith('lm-pl-'));
  if (rm.length) el.classList.remove(...rm);
  ['--fx1', '--fx2', '--fx3', '--fx1a', '--fx2a', '--fxz', '--fxs', 'padding-top', 'padding-bottom'].forEach((p) => el.style.removeProperty(p));
  delete el.dataset.lmfx;
  delete el._fx;
  live.delete(el);
  if (el._deco) el._deco.remove();
  if (el._sig) el._sig.remove();
  delete el._deco;
  delete el._sig;
  if (el._localNick) el.classList.add(...el._localNick);
  delete el._localNick;
}

// где ник: крупно с частицами (шапка чата, профиль) или мелко (списки, сообщения)
const kindOf = (el) => (el.closest('.chat-head, .prof-name') ? 'big' : 'list');
const placeOf = (el) => (el.closest('.prof-name') ? 'profile' : el.closest('.chat-head') ? 'head' : el.closest('.grp-name') ? 'chat' : el.closest('.ci') ? 'contact' : 'list');

function decorate(el, st) {
  const kind = kindOf(el);
  const sig = [st.c.join(''), st.f, st.t, st.p, st.z, st.s, st.k, st.pl || '', kind, document.documentElement.dataset.theme].join('|');
  if (el.dataset.lmfx === sig) return;
  undo(el);
  // своё оформление ника (стиль-метка в Lumen) уступает купленному украшению
  const local = [...el.classList].filter((c) => c.startsWith('nick-'));
  if (local.length) {
    el._localNick = local;
    el.classList.remove(...local);
  }
  el.dataset.lmfx = sig;
  el.classList.add('lm-fx', 'lm-fx-f-' + st.f, bgLight(el) ? 'lm-fx-onlight' : 'lm-fx-ondark');
  if (kind !== 'big') el.classList.add('lm-fx-sm');
  if (st.pl) {
    el.classList.add('lm-fx-pl', 'lm-pl-' + st.pl);
    if (!/[A-ZА-ЯЁ0-9bdfhklt@#$%&!?ібдйё]/.test(el.textContent)) el.classList.add('lm-pl-x');
  }
  const t = st.t === 'shine' && st.f !== 'solid' ? 'glow' : st.t;
  if (t !== 'none') el.classList.add('lm-fx-t-' + t);
  setColors(el, st);
  el.style.setProperty('--fxz', String(st.z));
  el.style.setProperty('--fxs', String(st.s));
  el._fs = parseFloat(getComputedStyle(el).fontSize) || 14;
  deco(el, st, placeOf(el));
  if (st.pl) requestAnimationFrame(() => centerPlate(el));
  if (st.p !== 'none' && S.settings.animations !== false && (kind === 'big' || live.size < MAX_LIVE)) {
    el._fx = { st, P: [], big: kind === 'big', tick: 0, box: null, clips: [] };
    live.add(el);
    loop();
  }
}

// текст на плашке — ровно по центру при любом шрифте (у части шрифтов буквы «садятся» ниже середины)
let probeCtx = null;
function centerPlate(el) {
  if (!el.isConnected || !el.classList.contains('lm-fx-pl')) return;
  el.style.removeProperty('padding-top');
  el.style.removeProperty('padding-bottom');
  const cs = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  if (!r.height) return;
  const pr = document.createElement('span');
  pr.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline';
  el.appendChild(pr);
  const base = pr.getBoundingClientRect().top;
  pr.remove();
  probeCtx ||= document.createElement('canvas').getContext('2d');
  probeCtx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  const cap = probeCtx.measureText(el.classList.contains('lm-pl-x') ? 'x' : 'H').actualBoundingBoxAscent;
  const d = base - cap / 2 - (r.top + r.height / 2); // > 0 — буквы ниже середины плашки
  if (Math.abs(d) < 0.3) return;
  el.style.setProperty('padding-top', Math.max(0, parseFloat(cs.paddingTop) - d) + 'px', 'important');
  el.style.setProperty('padding-bottom', Math.max(0, parseFloat(cs.paddingBottom) + d) + 'px', 'important');
}

const DECO_AT = { head: 1, profile: 1, chat: 1, contact: 1 };
const MSC_AT = { head: 1, profile: 1, chat: 1 };
const SIG_AT = { head: 1, profile: 1 };
function deco(el, st, place) {
  if (!ART) return;
  const bd = DECO_AT[place] && st.bd ? st.bd : [];
  const ms = MSC_AT[place] && st.ms ? st.ms : '';
  const sg = SIG_AT[place] && st.sg ? st.sg : '';
  if (bd.length || ms) {
    const box = document.createElement('span');
    box.className = 'lm-deco';
    bd.forEach((b) => {
      const a = ART.BADGE[b];
      if (!a) return;
      const i = document.createElement('i');
      i.className = 'lm-bdg' + (ART.RARE.includes(b) ? ' lm-bdg-rare' : '');
      i.title = a[3];
      i.innerHTML = ART.badgeSvg(b, Math.random().toString(36).slice(2, 7));
      box.append(i);
    });
    if (ms && ART.MASCOT[ms]) {
      const i = document.createElement('i');
      i.className = 'lm-msc';
      i.title = ART.MASCOT[ms][0];
      i.innerHTML = ART.mascotSvg(ms);
      box.append(i);
    }
    el.after(box);
    el._deco = box;
  }
  if (sg) {
    const d = document.createElement('div');
    d.className = 'lm-sig' + (place === 'profile' ? ' lm-sig-big' : '') + (bgLight(el) ? ' lm-sig-onlight' : '');
    d.textContent = sg;
    setColors(d, st);
    if (place === 'head') {
      d.classList.add('lm-sig-inline');
      (el._deco || el).after(d);
    } else (el.closest('.prof-name') || el).after(d);
    el._sig = d;
  }
}

function frame(av, st) {
  const sig = st && st.fr ? st.fr + st.c.join('') : '';
  if ((av.dataset.lmfr || '') === sig) return;
  av.classList.remove(...[...av.classList].filter((c) => c.startsWith('lm-fr')));
  ['--frw', '--frimg', '--fx1', '--fx2', '--fx3', '--fx1a', '--fx2a'].forEach((p) => av.style.removeProperty(p));
  delete av.dataset.lmfr;
  if (!sig) return;
  av.dataset.lmfr = sig;
  const w = av.getBoundingClientRect().width || 40;
  av.classList.add('lm-fr', 'lm-fr-' + st.fr);
  av.style.setProperty('--frw', (w >= 90 ? 4 : w >= 56 ? 3 : w >= 36 ? 2.4 : 2) + 'px');
  setColors(av, st);
}

let shown = [];
function scan() {
  pending = false;
  const want = new Map();
  if (hasAny) document.querySelectorAll('.nick[data-uid]').forEach((el) => map[el.dataset.uid] && want.set(el, map[el.dataset.uid]));
  document.querySelectorAll('.lm-fx').forEach((el) => !want.has(el) && undo(el));
  want.forEach((st, el) => decorate(el, st));
  document.querySelectorAll('.av[data-uid]').forEach((av) => frame(av, hasAny ? map[av.dataset.uid] : null));
  shown = [...want.keys()].slice(0, 120);
  // что-то открылось/закрылось (окно, шторка) — сразу перепроверить, не закрыт ли ник
  live.forEach((el) => el._fx && (el._fx.tick = 0));
}

let pending = false;
function schedule() {
  if (pending) return;
  pending = true;
  requestAnimationFrame(scan);
}

// ---------------------------------------------------------------- частицы: один общий слой поверх окна

let layer = null,
  lctx = null,
  dpr = 1,
  drawn = false;
const erase = [];
function ensureLayer() {
  if (layer && layer.isConnected) return;
  layer = document.createElement('canvas');
  layer.className = 'lm-fx-layer';
  layer.setAttribute('aria-hidden', 'true');
  document.documentElement.appendChild(layer);
  lctx = layer.getContext('2d');
  sizeLayer();
}
function sizeLayer() {
  if (!layer) return;
  dpr = Math.min(2, devicePixelRatio || 1);
  layer.width = Math.round(innerWidth * dpr);
  layer.height = Math.round(innerHeight * dpr);
  lctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
addEventListener('resize', () => {
  sizeLayer();
  live.forEach((el) => el._fx && (el._fx.tick = 0));
});

let running = false;
function loop() {
  if (running) return;
  running = true;
  ensureLayer();
  let last = performance.now();
  const step = (now) => {
    for (const el of [...live]) if (!el.isConnected) live.delete(el);
    if (!live.size) {
      if (lctx) lctx.clearRect(0, 0, innerWidth, innerHeight);
      running = false;
      drawn = false;
      return;
    }
    const dt = Math.min(3, (now - last) / 16.7);
    last = now;
    if (!document.hidden) {
      if (drawn) lctx.clearRect(0, 0, innerWidth, innerHeight);
      drawn = false;
      erase.length = 0;
      live.forEach((el) => {
        try {
          if (draw(el, dt)) drawn = true;
        } catch {
          try {
            lctx.restore();
          } catch {}
          lctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          live.delete(el);
        }
      });
      if (drawn)
        shown.forEach((el) => {
          if (live.has(el) || !el.isConnected) return;
          const r = el.getBoundingClientRect();
          if (!r.width || r.bottom < 0 || r.top > innerHeight) return;
          const fs = el._fs || 14;
          const th = r.height - fs * 0.5;
          erase.push([r.left + fs * 0.4 - 1, r.top + fs * 0.25 + th * 0.12, r.width - fs * 0.8 + 2, th * 0.8]);
        });
      if (erase.length) {
        lctx.save();
        lctx.globalCompositeOperation = 'destination-out';
        lctx.shadowColor = '#000';
        lctx.shadowBlur = 3;
        lctx.fillStyle = '#000';
        for (const [x, y, w, h] of erase) {
          if (!(w > 2 && h > 2)) continue;
          lctx.beginPath();
          if (lctx.roundRect) lctx.roundRect(x, y, w, h, h / 2);
          else lctx.rect(x, y, w, h);
          lctx.fill();
        }
        lctx.restore();
      }
    }
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function measure(el, f) {
  const r = el.getBoundingClientRect();
  const rg = document.createRange();
  rg.selectNodeContents(el);
  const tr = rg.getBoundingClientRect();
  const t = tr.width ? tr : r;
  f.box = { dx: t.left - r.left, dy: t.top - r.top, w: t.width, h: t.height };
  const cx = t.left + t.width / 2,
    cy = t.top + t.height / 2;
  const top = cx >= 0 && cy >= 0 && cx < innerWidth && cy < innerHeight ? document.elementFromPoint(cx, cy) : null;
  f.covered = !!top && top !== el && !el.contains(top) && !top.contains(el);
  f.clips = [];
  for (let a = el.parentElement, i = 0; a && a !== document.body && i < 14; a = a.parentElement, i++) {
    const cs = getComputedStyle(a);
    if (/auto|scroll|hidden/.test(cs.overflowX + cs.overflowY) && !a.matches('.ci-top, .nm, .grp-name, .prof-name')) f.clips.push(a);
    if (f.clips.length >= 3) break;
  }
}

function spawn(st, w, h, init, sc, bx, by, bw, bh) {
  const t = st.p,
    col = st.c[(Math.random() * 3) | 0];
  const p = { x: bx + Math.random() * bw, y: by + 1 + Math.random() * 3, vx: (Math.random() - 0.5) * 0.3, vy: -(0.3 + Math.random() * 0.7), life: 0, max: 50 + Math.random() * 70, s: Math.max(1.3, (1 + Math.random() * 2.2) * Math.min(1.3, Math.max(0.8, st.z)) * (sc || 1)), col, rot: Math.random() * 6, ch: Math.random() < 0.5 ? '0' : '1' };
  if (t === 'snow' || t === 'matrix' || t === 'confetti' || t === 'petals' || t === 'leaves' || t === 'coins') {
    p.y = -5 - Math.random() * 10;
    p.vy = 0.3 + Math.random() * 0.6;
    p.x = Math.random() * w;
  }
  if (t === 'rain') {
    p.y = -8 - Math.random() * 10;
    p.x = Math.random() * w;
    p.vy = 1.8 + Math.random() * 0.9;
    p.vx = -0.25;
    p.max = 40 + Math.random() * 30;
  }
  if (t === 'meteors') {
    p.y = -6 - Math.random() * h * 0.4;
    p.x = Math.random() * w * 0.8 - w * 0.1;
    p.vx = 1.4 + Math.random() * 0.6;
    p.vy = 0.8 + Math.random() * 0.4;
    p.max = 35 + Math.random() * 25;
  }
  if (t === 'fireflies') {
    p.x = Math.random() * w;
    p.vx = (Math.random() - 0.5) * 0.4;
    p.vy = (Math.random() - 0.5) * 0.4;
    p.max = 90 + Math.random() * 80;
    p.ph = Math.random() * 6;
    p.y = Math.random() < 0.6 ? Math.random() * Math.max(2, by - 2) : by + bh + 2 + Math.random() * Math.max(2, h - by - bh - 4);
  }
  if (t === 'notes') {
    p.ch = Math.random() < 0.5 ? '♪' : '♫';
    p.vy = -(0.35 + Math.random() * 0.4);
  }
  if (t === 'pixels') p.vy = -(0.25 + Math.random() * 0.5);
  if (t === 'stars' || t === 'sparkle' || t === 'dots') {
    p.x = Math.random() * w;
    p.vx = p.vy = 0;
    p.max = 40 + Math.random() * 60;
    p.y = Math.random() < 0.6 ? Math.random() * Math.max(2, by - 2) : by + bh + 2 + Math.random() * Math.max(2, h - by - bh - 4);
  }
  if (t === 'bubbles') p.vy = -(0.2 + Math.random() * 0.4);
  if (t === 'smoke') {
    p.s *= 4;
    p.vy = -(0.15 + Math.random() * 0.3);
    p.max = 100 + Math.random() * 60;
  }
  if (t === 'bolts') {
    p.y = 1 + Math.random() * Math.max(1, by - 15);
    p.max = 8 + Math.random() * 8;
    p.vx = p.vy = 0;
  }
  if (init) {
    p.life = Math.random() * p.max;
    p.y += p.vy * p.life;
  }
  return p;
}

function draw(el, dt) {
  const f = el._fx;
  if (!f) return false;
  const st = f.st;
  if (!f.box || f.tick++ % (f.covered ? 10 : 30) === 0) measure(el, f);
  const r = el.getBoundingClientRect();
  if (!r.width || r.bottom < -40 || r.top > innerHeight + 40 || r.right < -40 || r.left > innerWidth + 40) return false;
  if (f.covered) return false;
  const pad = f.big ? [60, 44] : [40, 30];
  const w = f.box.w + pad[0],
    h = f.box.h + pad[1];
  const ox = r.left + f.box.dx - pad[0] / 2,
    oy = r.top + f.box.dy - pad[1] / 2;
  let cl = 0,
    ct = 0,
    cr = innerWidth,
    cb = innerHeight;
  for (const a of f.clips) {
    const ar = a.getBoundingClientRect();
    cl = Math.max(cl, ar.left);
    ct = Math.max(ct, ar.top);
    cr = Math.min(cr, ar.right);
    cb = Math.min(cb, ar.bottom);
  }
  if (f.clips.length && (cr <= cl || cb <= ct)) return false;
  const cx = r.left + f.box.dx + f.box.w / 2,
    cy = r.top + f.box.dy + f.box.h / 2;
  if (cx < cl || cx > cr || cy < ct || cy > cb) return false;
  const ctx = lctx;
  ctx.save();
  if (f.clips.length) {
    ctx.beginPath();
    ctx.rect(cl, ct, cr - cl, cb - ct);
    ctx.clip();
  }
  ctx.translate(ox, oy);
  const sp = st.s * dt;
  const n = f.big ? Math.min(st.k, 40) : Math.min(Math.ceil(st.k / 2), 14);
  const sc = f.big ? 1 : 0.85;
  if (Math.abs((f.w || w) - w) > 6) f.P.forEach((p) => (p.x *= w / f.w));
  f.w = w;
  const bx = pad[0] / 2,
    by = pad[1] / 2,
    bw = f.box.w,
    bh = f.box.h;
  while (f.P.length < n) f.P.push(spawn(st, w, h, true, sc, bx, by, bw, bh));
  f.P.length = n;
  f.P.forEach((p, i) => {
    p.life += sp;
    p.x += p.vx * sp;
    p.y += p.vy * sp;
    p.rot += 0.05 * sp;
    const k = p.life / p.max,
      a = Math.max(0, k < 0.2 ? k / 0.2 : 1 - (k - 0.2) / 0.8),
      t = st.p;
    ctx.globalAlpha = a;
    ctx.fillStyle = p.col;
    ctx.strokeStyle = p.col;
    PAINT[t]?.(ctx, p, k, a, st);
    if (p.life >= p.max || p.y < -20 || p.y > h + 20) f.P[i] = spawn(st, w, h, false, sc, bx, by, bw, bh);
  });
  erase.push([ox + pad[0] / 2 - 1, oy + pad[1] / 2 + f.box.h * 0.12, f.box.w + 2, f.box.h * 0.8]);
  ctx.restore();
  return true;
}

// как рисовать каждую частицу (перенесено из расширения Lumen без изменений)
const PAINT = {
  embers(ctx, p) {
    ctx.shadowBlur = 8;
    ctx.shadowColor = p.col;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.s, 0, 7);
    ctx.fill();
    ctx.shadowBlur = 0;
    p.vx += (Math.random() - 0.5) * 0.05;
  },
  snow(ctx, p) {
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(p.x + Math.sin(p.life / 15) * 3, p.y, p.s * 0.9, 0, 7);
    ctx.fill();
  },
  stars: (ctx, p, k) => star(ctx, p, k, 2),
  sparkle: (ctx, p, k) => star(ctx, p, k, 1.6),
  hearts(ctx, p) {
    const s = p.s * 1.6;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.beginPath();
    ctx.moveTo(0, s * 0.9);
    ctx.bezierCurveTo(-s * 1.6, -s * 0.2, -s * 0.6, -s * 1.4, 0, -s * 0.5);
    ctx.bezierCurveTo(s * 0.6, -s * 1.4, s * 1.6, -s * 0.2, 0, s * 0.9);
    ctx.fill();
    ctx.restore();
  },
  bubbles(ctx, p) {
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(p.x + Math.sin(p.life / 12) * 2, p.y, p.s * 1.6, 0, 7);
    ctx.stroke();
  },
  matrix(ctx, p) {
    ctx.font = `600 ${8 + p.s * 2}px monospace`;
    ctx.fillText(p.ch, p.x, p.y);
  },
  confetti(ctx, p) {
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot * 2);
    ctx.fillRect(-p.s, -p.s / 2, p.s * 2, p.s);
    ctx.restore();
    p.x += Math.sin(p.life / 8) * 0.4;
  },
  smoke(ctx, p) {
    const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.s * 2);
    g.addColorStop(0, p.col + '55');
    g.addColorStop(1, p.col + '00');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.s * 2, 0, 7);
    ctx.fill();
  },
  bolts(ctx, p, k, a, st) {
    if (!p.path) {
      p.path = [];
      let x = 0;
      for (let j = 0; j < 3; j++) {
        x += (Math.random() - 0.5) * 8;
        p.path.push(x);
      }
    }
    ctx.lineWidth = 1.1 * Math.min(1.3, st.z);
    ctx.shadowBlur = 4;
    ctx.shadowColor = p.col;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    p.path.forEach((dx, j) => ctx.lineTo(p.x + dx, p.y + (j + 1) * 4.5));
    ctx.stroke();
    ctx.shadowBlur = 0;
  },
  dots(ctx, p) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.s * 0.8, 0, 7);
    ctx.fill();
  },
  petals(ctx, p) {
    ctx.save();
    ctx.translate(p.x + Math.sin(p.life / 14) * 4, p.y);
    ctx.rotate(p.rot);
    ctx.beginPath();
    ctx.ellipse(0, 0, p.s * 1.5, p.s * 0.8, 0, 0, 7);
    ctx.fill();
    ctx.restore();
  },
  leaves(ctx, p) {
    const s = p.s * 1.5;
    ctx.save();
    ctx.translate(p.x + Math.sin(p.life / 18) * 5, p.y);
    ctx.rotate(p.rot + Math.sin(p.life / 10) * 0.6);
    ctx.beginPath();
    ctx.moveTo(0, -s);
    ctx.quadraticCurveTo(s, 0, 0, s);
    ctx.quadraticCurveTo(-s, 0, 0, -s);
    ctx.fill();
    ctx.restore();
  },
  coins(ctx, p) {
    const sx = Math.abs(Math.cos(p.rot * 1.5)) * 0.85 + 0.15;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.scale(sx, 1);
    ctx.beginPath();
    ctx.arc(0, 0, p.s * 1.5, 0, 7);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.55)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.arc(0, 0, p.s * 0.95, 0, 7);
    ctx.stroke();
    ctx.restore();
  },
  notes(ctx, p) {
    ctx.font = `700 ${9 + p.s * 2.5}px system-ui, sans-serif`;
    ctx.fillText(p.ch, p.x + Math.sin(p.life / 12) * 3, p.y);
  },
  fireflies(ctx, p, k, a) {
    p.vx += (Math.random() - 0.5) * 0.04;
    p.vy += (Math.random() - 0.5) * 0.04;
    p.vx *= 0.98;
    p.vy *= 0.98;
    ctx.globalAlpha = a * (0.45 + 0.55 * Math.abs(Math.sin(p.life / 9 + p.ph)));
    ctx.shadowBlur = 10;
    ctx.shadowColor = p.col;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.s * 0.75, 0, 7);
    ctx.fill();
    ctx.shadowBlur = 0;
  },
  rain(ctx, p, k, a) {
    ctx.lineWidth = 1;
    ctx.globalAlpha = a * 0.75;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x + p.vx * 3, p.y - 4 - p.s * 2.5);
    ctx.stroke();
  },
  meteors(ctx, p) {
    const L = 8 + p.s * 4,
      nn = Math.hypot(p.vx, p.vy),
      g = ctx.createLinearGradient(p.x, p.y, p.x - (p.vx / nn) * L, p.y - (p.vy / nn) * L);
    g.addColorStop(0, p.col);
    g.addColorStop(1, p.col + '00');
    ctx.strokeStyle = g;
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x - (p.vx / nn) * L, p.y - (p.vy / nn) * L);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(p.x, p.y, 1.1, 0, 7);
    ctx.fill();
  },
  pixels(ctx, p) {
    const s = Math.max(1.5, p.s * 1.2);
    ctx.fillRect(Math.round(p.x), Math.round(p.y), s, s);
  },
};
function star(ctx, p, k, m) {
  const rr = p.s * m * Math.sin(Math.PI * Math.min(1, k));
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(p.rot);
  ctx.beginPath();
  for (let j = 0; j < 4; j++) {
    ctx.lineTo(0, -rr);
    ctx.rotate(Math.PI / 4);
    ctx.lineTo(0, -rr * 0.3);
    ctx.rotate(Math.PI / 4);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// ---------------------------------------------------------------- запуск

export function initFx() {
  if (!FXC || !FXC.configured()) return;
  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  load();
  setInterval(load, 10 * 60e3); // список обновляется раз в 10 минут
}
