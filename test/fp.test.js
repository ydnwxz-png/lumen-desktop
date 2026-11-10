// Проверка FunPay-клиента на локальном мок-сервере: вход, куки, 428/golden_seal, runner, csrf, редиректы, загрузка.
const http = require('http');
const assert = require('assert');
const { Session, cleanKey, parseMain, parseSupportToken } = require('../main/fp');

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
      return res.end(page(42, 'Nick &amp; Co'));
    }
    if (req.url === '/redir') {
      res.writeHead(302, { Location: '/chat/' });
      return res.end();
    }
    if (req.url === '/chat/') return res.end('chat page');
    if (req.url.startsWith('/support/sso?return_to=')) {
      if (c.golden_key !== GOOD || c.PHPSESSID !== 's1') return res.end('login');
      const back = decodeURIComponent(req.url.split('=')[1]);
      res.writeHead(302, { Location: `${supBase}/sso/login?jwt=J&return_to=${encodeURIComponent(back)}` });
      return res.end();
    }
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

// мок support.funpay.com: своя сессия PHPSESSID, вход через SSO с funpay.com
let supBase = '';
const supLog = [];
const sup = http.createServer((req, res) => {
  let body = '';
  req.on('data', (d) => (body += d));
  req.on('end', () => {
    const c = cookies(req);
    supLog.push({ m: req.method, u: req.url, c, body, h: req.headers });
    if (req.url.startsWith('/sso/login?jwt=J')) {
      res.writeHead(302, { 'Set-Cookie': 'PHPSESSID=SUP; path=/', Location: decodeURIComponent(req.url.split('return_to=')[1]) });
      return res.end();
    }
    if (req.url === '/tickets/new/1') {
      if (c.PHPSESSID !== 'SUP') {
        res.writeHead(302, { Location: '/login' });
        return res.end();
      }
      return res.end('<form><input type="hidden" id="ticket__token" value="T&amp;1" name="ticket[_token]"></form>');
    }
    if (req.url === '/login') return res.end('<a href="https://funpay.com/support/sso">Войти</a>');
    if (req.url === '/tickets/create/1' && req.method === 'POST') {
      const p = new URLSearchParams(body);
      const okReq = c.PHPSESSID === 'SUP' && !c.golden_key && p.get('ticket[_token]') === 'T&1' && p.get('ticket[fields][1]') === 'Nick & Co' && p.get('ticket[fields][2]') === 'ABCD1234, QWER5678' && p.get('ticket[fields][5]') === '201' && p.get('ticket[comment][body_html]') === '<p>Привет &lt;b&gt;</p><p>#ABCD1234</p>' && req.headers['x-requested-with'] === 'XMLHttpRequest';
      if (!okReq) {
        res.writeHead(422);
        return res.end(JSON.stringify({ error: 'bad ticket' }));
      }
      return res.end(JSON.stringify({ action: { type: 'redirect', url: '/tickets/555' } }));
    }
    res.writeHead(404);
    res.end('nf');
  });
});

(async () => {
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  await new Promise((r) => sup.listen(0, '127.0.0.1', r));
  supBase = `http://127.0.0.1:${sup.address().port}`;
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
  assert.equal(me.username, 'Nick & Co');
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

  // поддержка: SSO, отдельные куки, тикет
  assert.equal(parseSupportToken('<input value="abc" name="ticket[_token]" type="hidden">'), 'abc');
  const ss = new Session({ gk: GOOD, cookies: saved }, { base, support: supBase });
  const t = await ss.supportTicket({ orders: ['#ABCD1234', 'QWER5678', 'bad id!'], text: 'Привет <b>\n#ABCD1234' });
  assert.equal(t.id, '555');
  assert.deepEqual(t.orders, ['ABCD1234', 'QWER5678']);
  assert.equal(ss.jar.get('PHPSESSID'), 's1'); // сессия funpay.com не затёрта
  assert.ok(supLog.every((l) => !l.c.golden_key)); // golden_key не уходит в поддержку
  // второй тикет — уже без SSO
  const ssoBefore = log.filter((l) => l.u.startsWith('/support/sso')).length;
  await ss.supportTicket({ orders: ['ABCD1234', 'QWER5678'], text: 'Привет <b>\n#ABCD1234' });
  assert.equal(log.filter((l) => l.u.startsWith('/support/sso')).length, ssoBefore);
  await assert.rejects(ss.supportTicket({ orders: ['ABCD1234'], text: 'x' }), /Поддержка: bad ticket/);

  console.log('fp.js: все проверки прошли');
  srv.close();
  sup.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
