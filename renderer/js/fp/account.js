// Аккаунт FunPay: все действия и разбор страниц. Один и тот же код работает
// в окне приложения и в движке автоматики (главный процесс, транспорт — main/fp.js).
//
// transport = { auth(force), req({method,url,form,xhr,csrf}), runner(objectsJson, requestJson), upload(url, file), openBrowser?(url) }
import * as P from './parse.js';
import { parseFpDate } from '../core/util.js';

export function createAccount(transport, { accId = '' } = {}) {
  const api = { fp: { auth: (_, f) => transport.auth(f), req: (_, o) => transport.req(o), runner: (_, o, r) => transport.runner(o, r), upload: (_, u, f) => transport.upload(u, f) }, app: { browser: (_, u) => (transport.openBrowser ? transport.openBrowser(u) : null) } };
  const ctxs = new Map();
  const ctx = (node) => {
    if (!ctxs.has(node)) ctxs.set(node, P.newCtx());
    return ctxs.get(node);
  };
  let me = null;

  const get = (url, xhr = false) => api.fp.req(accId, { url, xhr });
  const post = (url, form, csrf = true) => api.fp.req(accId, { method: 'POST', url, form, xhr: true, csrf });
  async function postJson(url, form) {
    const r = await post(url, form);
    if (r.status >= 400) throw new Error(`FunPay ответил ошибкой (HTTP ${r.status})`);
    let v = {};
    try {
      v = JSON.parse(r.text);
    } catch {}
    const err = v.error === true || (typeof v.error === 'number' && v.error !== 0) || (typeof v.error === 'string' && v.error && v.error !== '0');
    if (err) throw new Error(v.msg || (typeof v.error === 'string' ? v.error : 'FunPay не выполнил действие'));
    return v;
  }
  const runner = (objects, request = false) => api.fp.runner(accId, JSON.stringify(objects), request === false ? 'false' : JSON.stringify(request));
  const bookmarksObj = () => ({ type: 'chat_bookmarks', id: me.userId, tag: '00000000', data: false });
  const nodeObj = (node, last) => ({ type: 'chat_node', id: node, tag: '00000000', data: { node, last_message: last || -1, content: '' } });

  function sendError(v) {
    const r = v?.response;
    if (r && typeof r === 'object') {
      const e = r.error;
      if (e && e !== '0' && e !== 'false' && e !== 0) return typeof e === 'string' && e.length > 1 ? e : 'FunPay не принял сообщение';
      return null;
    }
    if (v?.error) return v.msg || 'FunPay не принял сообщение';
    if (r === null || r === false) return 'FunPay не принял сообщение';
    return null;
  }

  async function sendRaw(node, data) {
    const v = await runner([], { action: 'chat_message', data: { node, last_message: -1, ...data } });
    const e = sendError(v);
    if (e) throw new Error(e);
  }

  return {
    demo: false,
    accId,
    url: (p) => (p.startsWith('http') ? p : 'https://funpay.com' + p),
    async auth(force) {
      me = await api.fp.auth(accId, force);
      return me;
    },
    async chats() {
      const v = await runner([bookmarksObj()]);
      const o = (v.objects || []).find((x) => x.type === 'chat_bookmarks');
      return o?.data?.html != null ? P.parseBookmarks(o.data.html) : [];
    },
    async poll(openNode, lastId) {
      const objs = [bookmarksObj()];
      if (openNode) objs.push(nodeObj(openNode, lastId));
      const v = await runner(objs);
      let chats = null,
        messages = null;
      for (const o of v.objects || []) {
        if (o.type === 'chat_bookmarks' && o.data?.html != null) chats = P.parseBookmarks(o.data.html);
        if (o.type === 'chat_node' && o.data?.messages) messages = P.parseMessagesJson(o.data.messages, ctx(openNode)).filter((m) => m.id > (lastId || 0));
      }
      return { chats, messages };
    },
    async openChat(node) {
      const r = await get(`/chat/?node=${encodeURIComponent(node)}`);
      if (r.status >= 400) throw new Error(`Чат не открылся (HTTP ${r.status})`);
      const c = P.newCtx();
      const page = P.parseChatPage(r.text, c);
      ctxs.set(page.nodeId || node, c);
      return page;
    },
    async history(node, before) {
      const r = await get(`/chat/history?node=${encodeURIComponent(node)}&last_message=${before || '99999999999999'}`, true);
      let v;
      try {
        v = JSON.parse(r.text);
      } catch {
        throw new Error(`История не загрузилась (HTTP ${r.status})`);
      }
      const c = P.newCtx();
      c.names = new Map(ctx(node).names);
      return { messages: P.parseMessagesJson(v.chat?.messages, c), more: !!v.chat?.hasHistory, nodeName: String(v.chat?.node?.name || v.chat?.name || '') };
    },
    send: (node, text) => sendRaw(node, { content: text }),
    async sendImage(node, file) {
      const data = new Uint8Array(await file.arrayBuffer());
      const r = await api.fp.upload(accId, '/file/addChatImage', { field: 'file', name: file.name || 'image.png', mime: file.type || 'image/png', data, extra: [['file_id', '0']] });
      let v = {};
      try {
        v = JSON.parse(r.text);
      } catch {
        throw new Error(`Картинка не загрузилась (HTTP ${r.status})`);
      }
      const id = v.fileId ?? v.url;
      if (id == null || id === '') throw new Error(v.msg || 'FunPay не принял картинку');
      await sendRaw(node, { image_id: String(id), content: '' });
    },
    markRead: (node) => runner([nodeObj(node, -1)]).then(() => true),

    async order(id) {
      const r = await get(`/orders/${id}/`);
      if (r.status >= 400) throw new Error(`Заказ не открылся (HTTP ${r.status})`);
      const o = P.parseOrder(r.text);
      o.id ||= id;
      return o;
    },
    refund: (id) => postJson('/orders/refund', [['id', id]]),
    confirm: (id) => postJson('/orders/complete', [['id', id]]),
    review: (id, text, rating = 5) => postJson('/orders/review', [['orderId', id], ['text', text], ['rating', rating], ['authorId', me.userId]]),
    reviewDelete: (id) => postJson('/orders/reviewDelete', [['orderId', id], ['authorId', me.userId]]),

    async trades(kind, state, cont) {
      const base = kind === 'sales' ? '/orders/trade' : '/orders/';
      const url = state ? `${base}?state=${state}` : base;
      const r = cont ? await post(url, [['continue', cont]], false) : await get(url);
      if (r.status >= 400) throw new Error(`Список заказов не открылся (HTTP ${r.status})`);
      return P.parseTrade(r.text);
    },
    async transactions(cont) {
      const r = await post('/users/transactions', [['user_id', me.userId], ['filter', ''], ['continue', cont || '']], false);
      if (r.status >= 400) throw new Error(`Финансы не открылись (HTTP ${r.status})`);
      return P.parseTransactions(r.text);
    },
    async profile(id) {
      const r = await get(`/users/${id}/`);
      if (r.status >= 400) throw new Error(`Профиль не открылся (HTTP ${r.status})`);
      return P.parseProfile(r.text, id);
    },
    async moreReviews(id, cont) {
      const r = await post('/users/reviews', [['user_id', id], ['continue', cont], ['filter', '']], false);
      const d = P.doc(r.text);
      return { reviews: P.parseReviews(d), next: P.parseContinue(d) };
    },

    async myLots() {
      const r = await get(`/users/${me.userId}/`);
      if (r.status >= 400) throw new Error(`Профиль не открылся (HTTP ${r.status})`);
      return P.parseMyLots(r.text);
    },
    /** Разделы с лотами, сгруппированные по игре: [{game, title, nodes:[]}] */
    async raiseGames() {
      const r = await get(`/users/${me.userId}/`);
      if (r.status >= 400) throw new Error(`Профиль не открылся (HTTP ${r.status})`);
      const groups = P.parseRaiseGroups(r.text);
      if (groups.some((g) => !g.game)) {
        const m = await get('/');
        const map = P.parseNodeGames(m.text);
        for (const g of groups) g.game ||= map[g.node] || '';
      }
      const games = [];
      for (const g of groups) {
        if (!g.game) continue;
        let x = games.find((y) => y.game === g.game);
        if (!x) games.push((x = { game: g.game, title: g.title, nodes: [] }));
        if (!x.nodes.includes(g.node)) x.nodes.push(g.node);
      }
      return games;
    },
    /** Поднять все разделы одной игры: {ok, wait(мс), msg} */
    async raiseGame(game, nodes) {
      const call = async (form) => {
        const r = await post('/lots/raise', form, false);
        let v = {};
        try {
          v = JSON.parse(r.text);
        } catch {}
        return [r, v];
      };
      const full = (ids) => [['game_id', game], ['node_id', ids[0]], ...ids.map((n) => ['node_ids[]', n])];
      let [r, v] = await call(full(nodes));
      if (v.modal || (v.url && !v.error)) {
        // FunPay просит выбрать разделы — берём их из окна и повторяем
        const [, iv] = await call([['game_id', game], ['node_id', nodes[0]]]);
        const ids = [...String(iv.modal || '').matchAll(/value="(\d+)"/g)].map((m) => m[1]);
        if (ids.length) {
          await new Promise((res) => setTimeout(res, 800));
          [r, v] = await call(full(ids));
        } else v = iv;
      }
      const msg = v.msg || '';
      const wait = +v.wait > 0 ? +v.wait * 1000 : 0;
      if (P.isWaitMsg(msg)) return { ok: false, wait: wait || P.waitMs(msg), msg };
      const err = v.error === true || (typeof v.error === 'number' && v.error !== 0);
      if (!err && r.status < 400) return { ok: true, wait: wait || 3600e3, msg: msg || 'Предложения подняты' };
      return { ok: false, wait: 0, msg: msg || `FunPay ответил ошибкой (HTTP ${r.status})`, error: true };
    },
    async txnInfo(id) {
      const r = await get(`/users/transaction?id=${encodeURIComponent(id)}`, true);
      if (r.status >= 400) throw new Error(`FunPay не открыл операцию (HTTP ${r.status})`);
      let v;
      try {
        v = JSON.parse(r.text);
      } catch {
        throw new Error('FunPay ответил не так, как ждали');
      }
      if (!v.html) throw new Error('В ответе нет данных об операции');
      return P.parseTxnInfo(v.html);
    },
    /** Продажи новее cutoff (мс), страница за страницей. */
    async salesSince(cutoff, maxPages = 40, progress) {
      const all = [];
      let cont = '';
      for (let i = 0; i < maxPages; i++) {
        const { items, next } = await this.trades('sales', '', cont);
        all.push(...items);
        progress?.(all.length);
        const older = cutoff && items.some((t) => (parseFpDate(t.date)?.getTime() || Infinity) < cutoff);
        if (older || !next) break;
        cont = next;
      }
      return all;
    },
    async lotDelete(lot) {
      return postJson('/lots/offerSave', [['offer_id', lot.id], ['deleted', '1']]);
    },
    async lotForm(lot) {
      const r = await get(`/lots/offerEdit?offer=${lot.id}`);
      const f = P.parseOfferForm(r.text);
      if (!f) throw new Error('Форма лота не открылась');
      if (!f.some(([k]) => k === 'node_id')) f.push(['node_id', lot.node]);
      return f;
    },
    async lotSave(form) {
      const v = await postJson('/lots/offerSave', form.filter(([k]) => k !== 'csrf_token'));
      if (v.errors?.length) throw new Error(v.errors.map((e) => (Array.isArray(e) ? e.join(': ') : e)).join('; '));
      return v;
    },
    /** Пустая форма нового лота в разделе node: { form: [[k,v]], selects: [...] } */
    async lotNewForm(node) {
      const r = await get(`/lots/offerEdit?node=${encodeURIComponent(node)}`);
      if (r.status >= 400) throw new Error(`Форма лота не открылась (HTTP ${r.status})`);
      const form = P.parseOfferForm(r.text);
      if (!form) throw new Error('Форма лота не открылась — проверь, что вход в FunPay выполнен');
      if (!form.some(([k]) => k === 'node_id')) form.push(['node_id', String(node)]);
      return { form, selects: P.parseOfferSelects(r.text) };
    },
    /** Создать лот. f: {node, title:{ru,en}, desc:{ru,en}, price, amount, selects:{name:value}} → {id, url} */
    async lotCreate(f) {
      const { form } = await this.lotNewForm(f.node);
      const idsBefore = new Set(((await this.myLots()).find((g) => g.node === String(f.node))?.lots || []).map((l) => l.id));
      const set = (re, v, required) => {
        const row = form.find(([k]) => re.test(k));
        if (row) row[1] = String(v);
        else if (required) throw new Error(`В форме FunPay нет поля «${required}» — похоже, FunPay поменял форму лота`);
      };
      set(/^offer_id$/, '0');
      set(/summary\]\[ru\]$/, f.title.ru, 'название');
      set(/summary\]\[en\]$/, f.title.en);
      set(/desc\]\[ru\]$/, f.desc.ru);
      set(/desc\]\[en\]$/, f.desc.en);
      set(/^price$/, f.price, 'цена');
      set(/^amount$/, f.amount);
      for (const [k, v] of Object.entries(f.selects || {})) set(new RegExp('^' + k.replace(/[[\]]/g, '\\$&') + '$'), v);
      const out = form.filter(([k]) => !(k === 'active' || k === 'deleted'));
      out.push(['active', 'on']);
      const v = await this.lotSave(out);
      // ссылку на новый лот берём из списка своих лотов в этом разделе
      for (let i = 0; i < 3; i++) {
        const g = (await this.myLots()).find((x) => x.node === String(f.node));
        const lot = g?.lots.find((l) => !idsBefore.has(l.id));
        if (lot) return { id: lot.id, url: lot.url };
        await new Promise((res) => setTimeout(res, 1200));
      }
      return { id: '', url: v.url ? this.url(v.url) : `https://funpay.com/lots/${f.node}/trade` };
    },
    async withdrawRate() {
      const r = await get('/account/balance');
      if (r.status >= 400) throw new Error(`Страница баланса не открылась (HTTP ${r.status})`);
      const x = P.parseWithdrawRate(r.text);
      if (!x) throw new Error('Не нашёл курс вывода в USDT TRC20 на странице баланса');
      return x;
    },
    async lotSetActive(lot, on) {
      let f = await this.lotForm(lot);
      f = f.filter(([k, v]) => !(k === 'active' && v !== ''));
      if (!f.some(([k]) => k === 'active')) f.push(['active', '']);
      if (on) {
        f.push(['active', 'on']);
        const am = f.find(([k]) => k === 'amount');
        if (am && (!am[1] || am[1] === '0')) am[1] = '1';
      }
      return this.lotSave(f);
    },
    async lotSetPrice(lot, price) {
      const f = await this.lotForm(lot);
      const p = f.find(([k]) => k === 'price');
      if (!p) throw new Error('У лота нет поля цены');
      p[1] = String(price);
      return this.lotSave(f);
    },
    openBrowser: (url) => api.app.browser(accId, url),
    me: () => me,

    // ------------------------------------------------ для движка автоматики
    /** Лёгкий опрос с тегами: FunPay присылает объект, только если он изменился. */
    async pollTags(tags) {
      const objs = [
        { type: 'chat_bookmarks', id: me.userId, tag: tags.bm || '00000000', data: false },
        { type: 'orders_counters', id: me.userId, tag: tags.oc || '00000000', data: false },
      ];
      const v = await runner(objs);
      const out = { chats: null, counters: null };
      for (const o of v.objects || []) {
        if (o.type === 'chat_bookmarks' && o.tag !== tags.bm) {
          tags.bm = o.tag;
          if (o.data?.html != null) out.chats = P.parseBookmarks(o.data.html);
        }
        if (o.type === 'orders_counters' && o.tag !== tags.oc) {
          tags.oc = o.tag;
          out.counters = o.data || {};
        }
      }
      return out;
    },
    /** Последние сообщения чата без отметки «прочитано». */
    async lastMessages(node) {
      return (await this.history(node, 0)).messages;
    },
    /** Количество товара в заказе (поле «Количество» на странице заказа), по умолчанию 1. */
    orderAmount(o) {
      const p = (o.params || []).find(([k]) => /количество|amount|quantity/i.test(k));
      const n = p ? parseInt(String(p[1]).replace(/\s/g, ''), 10) : 1;
      return n > 0 && n < 10000 ? n : 1;
    },
    /** Имя личного чата с пользователем: users-<меньший id>-<больший id>. */
    chatWith(userId) {
      const [a, b] = [+me.userId, +userId].sort((x, y) => x - y);
      return `users-${a}-${b}`;
    },
  };
}
