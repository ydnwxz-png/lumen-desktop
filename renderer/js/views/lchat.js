// © 2026 Lumen. Все права защищены. Копирование, изменение и распространение этого кода запрещены без разрешения автора (см. LICENSE).
// Общий чат Lumen: один на всех — Lumen Desktop, расширение и приложение на телефон.
// Запросы идут через главный процесс (window.api.lumen). Вход — через бота Lumen (подтверждение аккаунта FunPay).
// Ники рендерятся как <span class="nick" data-uid> — их украшает features/fx.js, как и везде в программе.
import { $, esc, copyText, richText } from '../core/util.js';
import { icon } from '../core/icons.js';
import { toast } from '../ui/kit.js';

const BOT = 'Lumenfx_bot';
const TOK = 'lumenChatTok';
const CL = { app: ['📱', 'Приложение на телефон'], ext: ['🧩', 'Расширение'], desk: ['💻', 'Lumen Desktop'] };
const api = (p, m, b) => (window.api?.lumen ? window.api.lumen(p, m, b) : Promise.resolve({ status: 0, j: null }));

const V = { msgs: [], lastId: 0, firstId: 0, ds: 0, tok: null, reply: null, loginN: null, shown: false, loaded: false, timer: null, loginT: null, oldBusy: false };
let root, box, bottom, top, pin;

/* ---------- «онлайн»: раз в 2 минуты, пока программа открыта ---------- */
function pingLoop() {
  api('/api/online').catch(() => {});
  setTimeout(pingLoop, 120000);
}

export function mountLchat(c) {
  root = c;
  root.innerHTML = `<style>
    .lc-wrap{flex:1;min-width:0;display:flex;flex-direction:column;height:100%;max-width:980px;margin:0 auto;padding:22px 26px 18px;box-sizing:border-box}
    .lc-top{display:flex;align-items:center;gap:10px;color:var(--text-2);font-size:13px;margin:-6px 0 12px}
    .lc-dot{width:8px;height:8px;border-radius:50%;background:var(--ok,#34d399);box-shadow:0 0 8px var(--ok,#34d399)}
    .lc-pin{padding:10px 14px;border-radius:12px;margin-bottom:12px;font-size:13px;background:rgba(var(--a-rgb),.08);border:1px solid rgba(var(--a-rgb),.28);white-space:pre-wrap}
    .lc-box{flex:1;overflow-y:auto;border:1px solid var(--line);border-radius:16px;padding:8px 6px;background:var(--surface)}
    .lc-day{text-align:center;margin:12px 0 6px}
    .lc-day span{font-size:11px;color:var(--text-3);border:1px solid var(--line);border-radius:99px;padding:2px 10px}
    .lc-msg{padding:7px 12px;border-radius:12px;cursor:pointer}
    .lc-msg:hover{background:var(--surface-2)}
    .lc-msg.me{background:rgba(var(--a-rgb),.06)}
    .lc-head{display:flex;align-items:center;gap:7px;font-size:12.5px}
    .lc-head .nick{font-weight:700}
    .lc-meta{color:var(--text-3);font-size:11px}
    .lc-text{font-size:13.5px;line-height:1.5;white-space:pre-wrap;word-break:break-word;margin-top:2px}
    .lc-quote{font-size:12px;color:var(--text-2);border-left:2px solid rgba(var(--a-rgb),.7);padding-left:8px;margin:3px 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .lc-bottom{margin-top:12px}
    .lc-form{display:flex;gap:10px;align-items:flex-end}
    .lc-form .textarea{min-height:44px;max-height:160px}
    .lc-reply{display:flex;justify-content:space-between;gap:10px;font-size:12px;color:var(--text-2);margin-bottom:8px}
    .lc-login{text-align:center;padding:16px;border:1px solid var(--line);border-radius:16px;background:var(--surface)}
    .lc-login p{color:var(--text-2);font-size:12.5px;margin:6px 0 12px}
    .lc-code{font-family:var(--font-mono,monospace);font-size:13px;padding:6px 12px;border-radius:8px;background:var(--surface-2);display:inline-block;margin:4px 0 10px;user-select:all}
    .lc-err{color:var(--bad,#f87171);font-size:12px;margin-top:6px;min-height:14px}
  </style>
  <div class="lc-wrap">
    <div class="page-head"><h1>Общий чат</h1><span class="grow"></span></div>
    <div class="lc-top" data-top><span class="lc-dot"></span><span>подключаюсь…</span></div>
    <div class="lc-pin" data-pin hidden></div>
    <div class="lc-box" data-box></div>
    <div class="lc-bottom" data-bottom></div>
  </div>`;
  box = $('[data-box]', root);
  bottom = $('[data-bottom]', root);
  top = $('[data-top]', root);
  pin = $('[data-pin]', root);
  box.addEventListener('scroll', loadOlder);
  box.addEventListener('click', (e) => {
    const ext = e.target.closest('[data-ext]');
    if (ext) return e.preventDefault(), window.api?.app.open(ext.dataset.ext);
    const nk = e.target.closest('.nick[data-uid]');
    if (nk && +nk.dataset.uid) return window.api?.app.open('https://funpay.com/users/' + nk.dataset.uid + '/');
    if (e.target.closest('a')) return e.preventDefault();
    const m = e.target.closest('[data-mid]');
    if (!m || !V.tok) return;
    V.reply = V.msgs.find((x) => x.id === +m.dataset.mid) || null;
    renderBottom();
  });
  pingLoop();
}

export async function showLchat() {
  V.shown = true;
  if (!V.loaded) {
    V.loaded = true;
    box.innerHTML = `<div class="empty" style="padding:60px"><p>Загружаю…</p></div>`;
    V.tok = await window.api?.store.get(TOK, null).catch(() => null) || null;
    if (V.tok) {
      const r = await api('/api/chat/me?t=' + encodeURIComponent(V.tok.token)).catch(() => null);
      if (r?.j && r.j.ok === false) await setTok(null);
      else if (r?.j?.ok) V.tok.nick = r.j.nick || V.tok.nick;
    }
    renderBottom();
  }
  clearTimeout(V.timer);
  poll(true);
}
export function hideLchat() {
  V.shown = false;
}

async function setTok(t) {
  V.tok = t;
  await window.api?.store.set(TOK, t).catch(() => {});
}

const hm = (ts) => new Date(ts * 1000).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
function day(ts) {
  const d = new Date(ts * 1000);
  const t = new Date();
  if (d.toDateString() === t.toDateString()) return 'Сегодня';
  t.setDate(t.getDate() - 1);
  if (d.toDateString() === t.toDateString()) return 'Вчера';
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
}

// fromPoll — только опрос двигает курсор «после какого id» (иначе после своей отправки можно пропустить чужие сообщения)
function merge(list, { fromPoll = false, older = false } = {}) {
  if (!list?.length) return false;
  const have = new Set(V.msgs.map((m) => m.id));
  const add = list.filter((m) => !have.has(m.id));
  if (fromPoll) V.lastId = Math.max(V.lastId, ...list.map((m) => m.id));
  if (!add.length) return false;
  V.msgs = V.msgs.concat(add).sort((a, b) => a.id - b.id);
  if (!older && V.msgs.length > 500) V.msgs = V.msgs.slice(-500);
  V.firstId = V.msgs[0].id;
  return true;
}

function draw(stick, keepOld) {
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
  const prevH = box.scrollHeight;
  const prevTop = box.scrollTop;
  if (!V.msgs.length) {
    box.innerHTML = `<div class="empty" style="padding:70px 20px"><div class="orb">${icon('users', 28)}</div><h3>Пока тихо</h3><p>Напиши первым — тебя увидят в Lumen Desktop, расширении и приложении на телефон.</p></div>`;
    return;
  }
  const byId = new Map(V.msgs.map((m) => [m.id, m]));
  let dl = '';
  let html = '';
  for (const m of V.msgs) {
    const d = day(m.ts);
    if (d !== dl) {
      dl = d;
      html += `<div class="lc-day"><span>${esc(d)}</span></div>`;
    }
    const cl = CL[m.c] || CL.app;
    const q = m.r && byId.get(m.r);
    const mine = V.tok && String(m.u) === String(V.tok.fp_id);
    html += `<div class="lc-msg${mine ? ' me' : ''}" data-mid="${m.id}">
      <div class="lc-head"><span class="nick" data-uid="${+m.u || 0}">${esc(m.n || 'id' + m.u)}</span><span title="${cl[1]}">${cl[0]}</span><span class="lc-meta">${hm(m.ts)}</span></div>
      ${q ? `<div class="lc-quote">↪ ${esc(q.n || '')}: ${esc(q.t)}</div>` : ''}
      <div class="lc-text">${richText(m.t)}</div></div>`;
  }
  box.innerHTML = html;
  if (stick || atBottom) box.scrollTop = box.scrollHeight;
  else if (keepOld) box.scrollTop = prevTop + (box.scrollHeight - prevH);
  else box.scrollTop = prevTop;
}

function head(j) {
  top.innerHTML = `<span class="lc-dot"></span><span>${+j.online || 0} онлайн</span>${j.on === false ? '<span style="color:var(--warn,#fbbf24)">· чат временно выключен</span>' : ''}${
    V.tok ? `<span class="grow"></span><span>ты: <b>${esc(V.tok.nick || '')}</b></span><button class="btn sm" data-out>Выйти</button>` : ''
  }`;
  const out = $('[data-out]', top);
  if (out)
    out.onclick = async () => {
      await setTok(null);
      V.reply = null;
      V.loginN = null;
      clearTimeout(V.loginT);
      head(j);
      renderBottom();
      draw();
    };
  pin.hidden = !j.pinned;
  pin.textContent = j.pinned ? '📌 ' + j.pinned : '';
}

let first = true;
async function poll(now) {
  clearTimeout(V.timer);
  try {
    const r = await api('/api/chat?after=' + V.lastId + (V.ds ? '&ds=' + V.ds : ''));
    const j = r?.j;
    if (j?.ok) {
      head(j);
      let ch = merge(j.msgs, { fromPoll: true });
      if (j.deleted?.length) {
        const del = new Set(j.deleted);
        const n = V.msgs.length;
        V.msgs = V.msgs.filter((m) => !del.has(m.id));
        ch = ch || n !== V.msgs.length;
      }
      V.ds = j.now || V.ds;
      if (ch || first || now) draw(first);
      first = false;
    } else if (first) box.innerHTML = `<div class="empty" style="padding:60px"><h3>Нет связи с сервером Lumen</h3><p>Проверь интернет — чат подключится сам.</p></div>`;
  } catch {}
  V.timer = setTimeout(poll, V.shown && document.visibilityState === 'visible' ? 3000 : 20000);
}

async function loadOlder() {
  if (box.scrollTop > 40 || V.oldBusy || !V.firstId) return;
  V.oldBusy = true;
  try {
    const r = await api('/api/chat?before=' + V.firstId);
    if (r?.j?.ok && merge(r.j.msgs, { older: true })) draw(false, true);
  } catch {}
  V.oldBusy = false;
}

function renderBottom(note = '') {
  const draft = $('[data-ta]', bottom)?.value || '';
  if (!V.tok) {
    if (V.loginN) {
      const cmd = '/start chat_' + V.loginN;
      bottom.innerHTML = `<div class="lc-login"><b>Подтверди вход в боте Lumen…</b>
        <p>Бот откроется в Telegram. Если Telegram на другом устройстве — отправь боту @${BOT}:</p>
        <div class="lc-code">${esc(cmd)}</div><br>
        <button class="btn pri sm" data-bot>Открыть бота</button> <button class="btn sm" data-copy>Копировать</button> <button class="btn sm" data-cancel>Отмена</button>
        <p style="margin-bottom:0">Код действует 15 минут.</p></div>`;
      $('[data-bot]', bottom).onclick = () => window.api?.app.open(`https://t.me/${BOT}?start=chat_${V.loginN}`);
      $('[data-copy]', bottom).onclick = () => (copyText(cmd), toast('Скопировано', 'Отправь это боту @' + BOT));
      $('[data-cancel]', bottom).onclick = () => ((V.loginN = null), clearTimeout(V.loginT), renderBottom());
    } else {
      bottom.innerHTML = `<div class="lc-login"><b>Чтобы писать, войди через бота Lumen</b>
        <p>Один раз подтвердишь свой аккаунт FunPay — и будешь в чате под своим ником (с украшением, если оно есть).</p>
        ${note ? `<div class="lc-err" style="margin-bottom:8px">${esc(note)}</div>` : ''}
        <button class="btn pri" data-login>${icon('send', 15)}Войти в чат</button></div>`;
      $('[data-login]', bottom).onclick = startLogin;
    }
    return;
  }
  bottom.innerHTML = `${V.reply ? `<div class="lc-reply"><span>↪ Ответ <b>${esc(V.reply.n)}</b>: ${esc(V.reply.t.slice(0, 90))}</span><a href="#" data-unreply>✕</a></div>` : ''}
    <div class="lc-form"><textarea class="textarea" data-ta maxlength="1000" placeholder="Сообщение… (Enter — отправить, Shift+Enter — новая строка)"></textarea><button class="btn pri" data-send>${icon('send', 15)}Отправить</button></div>
    <div class="lc-err" data-err>${esc(note)}</div>`;
  const ta = $('[data-ta]', bottom);
  ta.value = draft;
  const send = $('[data-send]', bottom);
  let busy = false;
  const un = $('[data-unreply]', bottom);
  if (un) un.onclick = (e) => (e.preventDefault(), (V.reply = null), renderBottom());
  const go = async () => {
    const text = ta.value.trim();
    if (!text || busy) return;
    busy = true;
    send.disabled = true;
    const r = await api('/api/chat/send', 'POST', { t: V.tok.token, text, r: V.reply ? V.reply.id : null }).catch(() => null);
    busy = false;
    send.disabled = false;
    const j = r?.j;
    if (j?.ok) {
      V.reply = null;
      ta.value = '';
      if (j.msg && typeof j.msg === 'object') merge([j.msg]);
      renderBottom();
      draw(true);
      return;
    }
    const m = j?.msg || (r?.status === 429 ? 'Слишком часто — подожди пару секунд.' : 'Не отправилось — проверь интернет.');
    if (/войти в чат заново/i.test(m)) {
      await setTok(null);
      renderBottom(m);
      return;
    }
    $('[data-err]', bottom).textContent = m;
  };
  ta.onkeydown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      go();
    }
  };
  send.onclick = go;
  setTimeout(() => ta.focus(), 0);
}

let logging = false;
async function startLogin() {
  if (logging || V.loginN) return;
  logging = true;
  const r = await api('/api/chat/login').catch(() => null);
  logging = false;
  const j = r?.j;
  if (!j?.ok || !j.n) return renderBottom(r?.status === 429 ? 'Слишком много попыток — подожди минуту.' : 'Нет связи с сервером Lumen.');
  V.loginN = j.n;
  renderBottom();
  window.api?.app.open(j.url).catch(() => {});
  const until = Date.now() + 15 * 60e3;
  const step = async () => {
    if (!V.loginN) return;
    const p = await api('/api/chat/login?n=' + encodeURIComponent(V.loginN)).catch(() => null);
    const pj = p?.j;
    if (pj?.ok && pj.token) {
      await setTok({ token: pj.token, fp_id: pj.fp_id, nick: pj.nick });
      V.loginN = null;
      renderBottom();
      draw(true);
      toast('Готово', 'Ты в общем чате как ' + pj.nick, { kind: 'ok' });
      return;
    }
    if (pj?.expired || Date.now() > until) {
      V.loginN = null;
      return renderBottom('Вход устарел — нажми «Войти в чат» ещё раз.');
    }
    V.loginT = setTimeout(step, 2500);
  };
  V.loginT = setTimeout(step, 2500);
}

