// © 2026 Lumen. Все права защищены. Копирование, изменение и распространение этого кода запрещены без разрешения автора (см. LICENSE).
// Активность в Discord («Играет в Lumen»): без библиотек, через локальный канал Discord (IPC).
// Работает, только если Discord запущен на этом компьютере. Включается в Настройки → Система.
//
// CLIENT_ID — ID приложения на discord.com/developers/applications (его название Discord пишет как «Играет в …»).
// В «Rich Presence → Art Assets» загрузи картинку с ключом «lumen» — она будет большой иконкой.
const CLIENT_ID = process.env.LUMEN_DISCORD_ID || '1570244367111692308';

const net = require('net');
const path = require('path');
const crypto = require('crypto');

let sock = null;
let ready = false;
let want = null; // { on, nick }
let retry = null;
let startedAt = Date.now();
let buf = Buffer.alloc(0);

const pipePath = (i) =>
  process.platform === 'win32'
    ? `\\\\?\\pipe\\discord-ipc-${i}`
    : path.join(process.env.XDG_RUNTIME_DIR || process.env.TMPDIR || process.env.TMP || process.env.TEMP || '/tmp', `discord-ipc-${i}`);

function frame(op, data) {
  const json = Buffer.from(JSON.stringify(data));
  const h = Buffer.alloc(8);
  h.writeInt32LE(op, 0);
  h.writeInt32LE(json.length, 4);
  return Buffer.concat([h, json]);
}

function send(op, data) {
  if (sock && !sock.destroyed) sock.write(frame(op, data));
}

function activity() {
  if (!want?.on) return null;
  return {
    details: 'Продаю на FunPay',
    state: want.nick ? `Продавец ${want.nick}` : 'Lumen Desktop — помощник продавца',
    timestamps: { start: Math.floor(startedAt / 1000) },
    assets: { large_image: 'lumen', large_text: 'Lumen Desktop' },
    buttons: [
      { label: 'Скачать Lumen', url: 'https://lumenfp.online' },
      { label: 'Канал Lumen', url: 'https://t.me/Lumen_Funpay' },
    ],
  };
}

function push() {
  if (!ready) return;
  send(1, { cmd: 'SET_ACTIVITY', args: { pid: process.pid, activity: activity() }, nonce: crypto.randomUUID() });
}

function close() {
  ready = false;
  buf = Buffer.alloc(0);
  if (sock) {
    sock.removeAllListeners();
    sock.destroy();
  }
  sock = null;
}

function later() {
  clearTimeout(retry);
  if (want?.on) retry = setTimeout(connect, 30000); // Discord закрыт — попробуем позже
}

function connect(i = 0) {
  if (!want?.on || !CLIENT_ID || sock) return;
  if (i > 9) return later();
  const s = net.createConnection(pipePath(i));
  sock = s;
  s.once('error', () => {
    if (sock === s) sock = null;
    s.destroy();
    connect(i + 1);
  });
  s.on('connect', () => send(0, { v: 1, client_id: CLIENT_ID }));
  s.on('data', (d) => {
    buf = Buffer.concat([buf, d]);
    while (buf.length >= 8) {
      const op = buf.readInt32LE(0);
      const len = buf.readInt32LE(4);
      if (buf.length < 8 + len) break;
      let msg = {};
      try {
        msg = JSON.parse(buf.subarray(8, 8 + len).toString());
      } catch {}
      buf = buf.subarray(8 + len);
      if (op === 1 && msg.evt === 'READY') {
        ready = true;
        push();
      }
      if (op === 2) {
        close(); // Discord закрыл соединение (например, неверный CLIENT_ID)
        later();
        return;
      }
    }
  });
  s.on('close', () => {
    if (sock === s) {
      close();
      later();
    }
  });
}

/** Включить/выключить и обновить. on — показывать активность, nick — ник FunPay (или пусто). */
function set(opts) {
  const was = !!want?.on;
  want = { on: !!opts?.on, nick: opts?.nick || '' };
  if (!CLIENT_ID) return { ok: false, reason: 'no-id' };
  if (want.on && !was) startedAt = Date.now();
  if (!want.on) {
    clearTimeout(retry);
    if (ready) push(); // убираем активность
    setTimeout(close, 300);
    return { ok: true };
  }
  if (ready) push();
  else connect();
  return { ok: true };
}

const available = () => !!CLIENT_ID;

module.exports = { set, available, stop: close };
