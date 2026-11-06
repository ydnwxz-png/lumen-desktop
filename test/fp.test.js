// Проверка FunPay-клиента на локальном мок-сервере: вход, куки, 428/golden_seal, runner, csrf, редиректы, загрузка.
const http = require('http');
const assert = require('assert');
const { Session, cleanKey, parseMain } = require('../main/fp');

const GOOD = 'a'.repeat(32);
let sessN = 0;
const log = [];
const cookies = (req) => Object.fromEntries((req.headers.cookie || '').split(/;\s*/).filter(Boolean).map((c) => c.split('=')));
const page = (uid, name) => `<html><body class="x" data-app-data="{&quot;locale&quot;:&quot;ru&quot;,&quot;csrf-token&quot;:&quot;tok${sessN}&quot;,&quot;userId&quot;:${uid}}">
<a class="user-link-dropdown"><div class="user-link-photo"><img src="/img/me.jpg" alt=""></div><div class="user-link-name">${name}</div></a>
<span class="badge badge-balance">1 250 ₽</span></body></html>`;

const srv = http.createServer((req, res) => {
  let body = '';
  req.on('data', (d) => (body += d));
  req.on('end', () => {
    const c = cookies(req);
    log.push({ m: req.method, u: req.url, c, body, h: req.headers });
    if (req.url === '/') {
      if (c.golden_key !== GOOD) return res.end(page(0, ''));
      const h = {};
      if (!c.PHPSESSID) h['Set-Cookie'] = [`PHPSESSID=s${++sessN}; path=/`, 'locale=ru; path=/'];
      res.writeHead(200, h);
      return res.end(page(42, 'Xavier &amp; Co'));
    }
    if (req.url === '/redir') {
      res.writeHead(302, { Location: '/chat/' });
      return res.end();
    }
    if (req.url === '/chat/') return res.end('chat page');
    if (req.url === '/runner/') {
      const p = new URLSearchParams(body);
      const objs = JSON.parse(p.get('objects'));
      if (objs[0] && objs[0].type === 'chat_counter') {
        res.writeHead(200, { 'Set-Cookie': 'golden_seal=SEAL; path=/' });
        return res.end('{}');
      }
      if (!c.golden_seal) {
        res.writeHead(428);
        return res.end('need seal');
      }
      if (p.get('csrf_token') !== 'tok' + sessN) return res.end(JSON.stringify({ error: true, msg: 'bad csrf' }));
      return res.end(JSON.stringify({ objects: objs, response: p.get('request') === 'false' ? false : { error: null } }));
    }
    if (req.url === '/file/addChatImage') {
      return res.end(JSON.stringify({ fileId: 777, ok: body.includes('filename="a.png"') && body.includes('file_id') }));
    }
    res.writeHead(404);
    res.end('nf');
  });
});

(async () => {
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;

  assert.equal(cleanKey(' golden_key=abcDEF123; PHPSESSID=x'), 'abcDEF123');
  assert.equal(cleanKey('"abc"'), 'abc');

  const d = parseMain(page(42, 'Bob'));
  assert.equal(d.userId, '42');
  assert.equal(d.username, 'Bob');
  assert.equal(d.balance, '1 250 ₽');
  assert.equal(d.avatar, 'https://funpay.com/img/me.jpg');

  // неверный ключ
  const bad = new Session({ gk: 'b'.repeat(32) }, { base });
  await assert.rejects(bad.auth(true), /не принял golden_key/);

  // вход и сохранение кук
  let saved = null;
  const s = new Session({ gk: GOOD }, { base, onCookies: (c) => (saved = c) });
  const me = await s.auth();
  assert.equal(me.userId, '42');
  assert.equal(me.username, 'Xavier & Co');
  assert.equal(saved.PHPSESSID, 's1');

  // runner: 428 -> печать -> повтор, csrf подставляется
  const v = await s.runner(JSON.stringify([{ type: 'chat_bookmarks', id: '42', tag: '00000000', data: false }]), 'false');
  assert.equal(v.objects[0].type, 'chat_bookmarks');
  assert.equal(saved.golden_seal, 'SEAL');
  const last = log[log.length - 1];
  assert.equal(last.h['x-requested-with'], 'XMLHttpRequest');
  assert.ok(last.c.golden_key === GOOD && last.c.PHPSESSID === 's1');

  // протухший csrf: runner перелогинивается сам
  s.app.csrf = 'old';
  const v2 = await s.runner('[]', JSON.stringify({ action: 'chat_message', data: { node: '1', content: 'hi' } }));
  assert.deepEqual(v2.response, { error: null });

  // редиректы и параллельные вызовы по очереди
  const [r1, r2] = await Promise.all([s.request({ url: '/redir' }), s.request({ url: '/chat/' })]);
  assert.equal(r1.text, 'chat page');
  assert.equal(r2.status, 200);

  // загрузка картинки
  const up = await s.request({ url: '/file/addChatImage', xhr: true, file: { name: 'a.png', mime: 'image/png', data: Buffer.from([1, 2, 3]), extra: [['file_id', '0']] } });
  assert.deepEqual(JSON.parse(up.text), { fileId: 777, ok: true });

  // сохранённая сессия переживает перезапуск
  const s2 = new Session({ gk: GOOD, cookies: saved }, { base });
  await s2.auth();
  const mainHits = log.filter((l) => l.u === '/' && l.c.golden_key === GOOD);
  assert.equal(mainHits[mainHits.length - 1].c.PHPSESSID, 's1');

  console.log('fp.js: все проверки прошли');
  srv.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
