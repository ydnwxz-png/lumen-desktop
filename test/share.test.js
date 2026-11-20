// © 2026 Lumen. Все права защищены. Копирование, изменение и распространение этого кода запрещены без разрешения автора (см. LICENSE).
// Общий опрос и экономия запросов: одна копия списка чатов на всех, теги, кэш истории, 429, пауза после неудачного входа.
const http = require('http');
const assert = require('assert');
const { Session } = require('../main/fp');

const GK = 'a'.repeat(32);
let html = '<a class="contact-item" data-id="n1" data-node-msg="5"></a>';
const tagOf = () => 't' + html.length.toString(16).padStart(7, '0');
const hits = { main: 0, runner: 0, history: 0, full: 0 };
let r429 = 0; // сколько следующих запросов отбить 429

const srv = http.createServer((req, res) => {
  let body = '';
  req.on('data', (d) => (body += d));
  req.on('end', () => {
    if (r429 > 0) {
      r429--;
      res.writeHead(429);
      return res.end('slow down');
    }
    if (req.url === '/') {
      hits.main++;
      const ok = (req.headers.cookie || '').includes('golden_key=' + GK);
      return res.end(`<html><body data-app-data="{&quot;csrf-token&quot;:&quot;c&quot;,&quot;userId&quot;:${ok ? 7 : 0}}"><div class="user-link-name">me</div></body></html>`);
    }
    if (req.url === '/runner/') {
      hits.runner++;
      const objs = JSON.parse(new URLSearchParams(body).get('objects'));
      const out = [];
      for (const o of objs) {
        if (o.type === 'chat_bookmarks') {
          if (o.tag === tagOf()) continue; // не изменилось — FunPay объект не шлёт
          hits.full++;
          out.push({ type: o.type, id: o.id, tag: tagOf(), data: { html } });
        } else if (o.type === 'orders_counters') {
          if (o.tag !== 'oc1') out.push({ type: o.type, id: o.id, tag: 'oc1', data: { seller: 1 } });
        } else out.push(o);
      }
      return res.end(JSON.stringify({ objects: out, response: false }));
    }
    if (req.url.startsWith('/chat/history')) {
      hits.history++;
      return res.end(JSON.stringify({ chat: { messages: [{ id: hits.history }] } }));
    }
    res.end('');
  });
});

const bm = (tag = '00000000') => JSON.stringify([{ type: 'chat_bookmarks', id: '7', tag, data: false }]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const s = new Session({ gk: GK }, { base, gap: 0, fresh: 1000 });
  await s.auth();

  // 1. первый опрос — целиком; второй в пределах свежести — без запроса, тот же список
  const a = await s.runner(bm(), 'false');
  assert.equal(a.objects[0].data.html, html);
  const n1 = hits.runner;
  const b = await s.runner(bm(), 'false');
  assert.equal(hits.runner, n1, 'свежая копия — без запроса');
  assert.equal(b.objects[0].data.html, html);
  assert.equal(b.objects[0].tag, tagOf());

  // 2. одновременные опросы (окно, автоматика, плагин) — один запрос
  await sleep(1100);
  const n2 = hits.runner;
  await Promise.all([s.runner(bm(), 'false'), s.runner(bm(), 'false'), s.runner(bm('xxxxxxxx'), 'false')]);
  assert.equal(hits.runner, n2 + 1, 'три опроса — один запрос');

  // 3. устарело, но не изменилось — запрос с тегом, FunPay страницу не шлёт, ответ всё равно полный
  await sleep(1100);
  const full = hits.full;
  const c = await s.runner(bm(), 'false');
  assert.equal(hits.full, full, 'неизменившийся список не скачивается заново');
  assert.equal(c.objects[0].data.html, html);

  // 4. счётчики заказов (автоматика) едут вместе со списком чатов
  const tags = {};
  const both = JSON.stringify([{ type: 'chat_bookmarks', id: '7', tag: '00000000', data: false }, { type: 'orders_counters', id: '7', tag: '00000000', data: false }]);
  await sleep(1100);
  const d = await s.runner(both, 'false');
  assert.ok(d.objects.find((o) => o.type === 'orders_counters'));
  const n4 = hits.runner;
  const e = await s.runner(both, 'false');
  assert.equal(hits.runner, n4, 'чаты+счётчики из свежей копии');
  assert.equal(e.objects.length, 2);
  void tags;

  // 5. кэш истории: один запрос, пока список чатов не изменился; новое сообщение — новый запрос
  const hq = { url: '/chat/history?node=n1&last_message=99999999999999', xhr: true };
  const h1 = await s.request(hq);
  const h2 = await s.request(hq);
  assert.equal(hits.history, 1);
  assert.equal(h1.text, h2.text);
  html += '<a class="contact-item" data-id="n2" data-node-msg="6"></a>'; // пришло сообщение
  await sleep(1100);
  await s.runner(bm(), 'false');
  const h3 = await s.request(hq);
  assert.equal(hits.history, 2, 'после нового сообщения история грузится заново');
  assert.notEqual(h3.text, h1.text);
  // одинаковые запросы одновременно — один поход
  html += '<b></b>';
  await sleep(1100);
  await s.runner(bm(), 'false');
  await Promise.all([s.request(hq), s.request(hq), s.request(hq)]);
  assert.equal(hits.history, 3);

  // 6. 429: без перелогина, пауза и повтор — запрос всё равно выполняется
  const mainBefore = hits.main;
  r429 = 1;
  const t0 = Date.now();
  const v = await s.runner('[]', JSON.stringify({ action: 'chat_message', data: { node: 'n1', content: 'hi' } }));
  assert.equal(v.response, false);
  assert.ok(Date.now() - t0 >= 1900, 'после 429 — пауза');
  assert.equal(hits.main, mainBefore, 'после 429 нет перелогина');
  r429 = 10; // FunPay долго просит подождать — ошибка с «429» в тексте (её ждут плагины и окно)
  await sleep(1100);
  await assert.rejects(s.runner(bm(), 'false'), /429/);
  r429 = 0;

  // 7. неверный ключ: повторные попытки не грузят FunPay, пока не пройдёт пауза
  const bad = new Session({ gk: 'b'.repeat(32) }, { base, gap: 0 });
  await assert.rejects(bad.auth(), /golden_key/);
  const m = hits.main;
  for (let i = 0; i < 5; i++) await assert.rejects(bad.runner(bm(), 'false'), /golden_key/);
  assert.equal(hits.main, m, 'плохой ключ — без новых запросов');
  await assert.rejects(bad.auth(true), /golden_key/); // явный вход (кнопка) — пробует сразу
  assert.ok(hits.main > m);

  console.log('общий опрос: все проверки прошли');
  srv.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
