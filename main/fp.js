// © 2026 Lumen. Все права защищены. Копирование, изменение и распространение этого кода запрещены без разрешения автора (см. LICENSE). Частично основано на стороннем коде под лицензией MIT — см. NOTICE.txt.
// FunPay-клиент главного процесса: куки (golden_key, PHPSESSID, golden_seal), вход, runner, загрузка файлов.
// Чистый Node (fetch), без Electron — поэтому тестируется отдельно.

const BASE = 'https://funpay.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36';
const AUTH_TTL = 20 * 60e3;
const FRESH_EVERY = 50 * 60e3;
const NOT_KNOWN = 'FunPay не принял golden_key. Проверь, что скопировал его целиком. Если FunPay просит код при входе — войди через браузер.';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Оптимизация запросов ──
// Список чатов и счётчики заказов опрашивают сразу несколько частей программы (окно, автоматика, уведомления
// с других аккаунтов, плагины). Сессия держит одну общую свежую копию и спрашивает FunPay с тегами:
// если ничего не изменилось, FunPay не присылает страницу заново.
const SHARED = new Set(['chat_bookmarks', 'orders_counters']);
const ZERO_TAG = '00000000';
const skey = (o) => o.type + ':' + o.id;
const hasData = (o) => (o.type === 'chat_bookmarks' ? !!o.data && o.data.html != null : o.data != null && o.data !== false);
const GAP = 250; // минимум между запросами одного аккаунта
const COOL = [2000, 4000, 8000, 15000, 20000]; // пауза после 429, растёт при повторах
// FunPay ограничивает частоту по IP, а все аккаунты программы ходят с одного IP — пауза общая на все сессии
const LIMIT = { until: 0, level: 0 };
const HIST_TTL = 30e3;
const isHistory = (o) => o && (!o.method || o.method === 'GET') && !o.form && !o.file && /^\/chat\/history\?/.test(String(o.url || ''));
const FUNPAY_HOST = /^([a-z0-9-]+\.)*funpay\.com$/i;
const SUPPORT = 'https://support.funpay.com';
const SUPPORT_CAT = '1'; // «Подтверждение заказа»
const escHtml = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/** Токен формы поддержки: <input name="ticket[_token]" value="..."> (атрибуты в любом порядке). */
function parseSupportToken(html) {
  const tag = /<input\b[^>]*name=["']ticket\[_token\]["'][^>]*>/i.exec(String(html || ''));
  if (!tag) return '';
  const v = /\bvalue=["']([^"']*)["']/i.exec(tag[0]);
  return v ? decodeEntities(v[1]) : '';
}

function cleanKey(raw) {
  const s = String(raw || '');
  const m = /golden_key"?\s*[=:]\s*"?([A-Za-z0-9]+)/.exec(s);
  if (m) return m[1];
  return s.trim().replace(/^["';\s]+|["';\s]+$/g, '');
}

function decodeEntities(s) {
  return String(s)
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

function absUrl(u) {
  u = String(u || '').trim();
  if (u.startsWith('//')) return 'https:' + u;
  if (u.startsWith('/')) return BASE + u;
  return u;
}

/** Главная страница: csrf, userId, ник, аватар, баланс. null — страница не FunPay. */
function parseMain(html) {
  const m = /<body[^>]*?\sdata-app-data=(?:"([^"]*)"|'([^']*)')/i.exec(html);
  if (!m) return null;
  let json;
  try {
    json = JSON.parse(decodeEntities(m[1] ?? m[2]));
  } catch {
    return null;
  }
  const d = {
    csrf: json['csrf-token'] || '',
    userId: json.userId == null ? '0' : String(json.userId),
    locale: json.locale || 'ru',
    username: '',
    avatar: '',
    balance: '',
    blocked: html.includes('account-blocked-box'),
  };
  const name = /class="[^"]*\buser-link-name\b[^"]*"[^>]*>([^<]*)</.exec(html);
  if (name) d.username = decodeEntities(name[1]).trim();
  const photo = /class="[^"]*\buser-link-photo\b[^"]*"[^>]*>\s*<img[^>]*?\ssrc="([^"]+)"/.exec(html);
  if (photo) d.avatar = absUrl(decodeEntities(photo[1]));
  const bal = /class="[^"]*\bbadge-balance\b[^"]*"[^>]*>([^<]*)</.exec(html);
  if (bal) d.balance = decodeEntities(bal[1]).replace(/\s+/g, ' ').trim();
  return d;
}

function isCloudflare(text) {
  return /cf-browser-verification|challenge-platform|Just a moment\.\.\.|cf_chl_opt/i.test(text.slice(0, 20000));
}

function netErr(e) {
  const c = e && (e.cause?.code || e.code || e.name);
  if (c === 'TimeoutError' || c === 'UND_ERR_CONNECT_TIMEOUT') return 'FunPay долго не отвечает';
  if (c === 'ENOTFOUND' || c === 'EAI_AGAIN') return 'Нет интернета';
  if (c === 'ECONNRESET' || c === 'ECONNREFUSED') return 'Соединение с FunPay оборвалось';
  return 'Сеть: ' + (e?.cause?.message || e?.message || 'ошибка');
}

function pairs(form) {
  if (!form) return [];
  if (Array.isArray(form)) return form.map(([k, v]) => [String(k), v == null ? '' : String(v)]);
  return Object.entries(form).map(([k, v]) => [k, v == null ? '' : String(v)]);
}

function captureTo(jar, headers) {
  const list = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : [];
  for (const raw of list) {
    const first = raw.split(';')[0];
    const i = first.indexOf('=');
    if (i <= 0) continue;
    const name = first.slice(0, i).trim();
    const value = first.slice(i + 1).trim();
    const low = raw.toLowerCase();
    if (!value || value === 'deleted' || low.includes('max-age=0') || low.includes('expires=thu, 01-jan-1970')) jar.delete(name);
    else jar.set(name, value);
  }
}

class Session {
  /**
   * @param {{gk:string, cookies?:Object, ua?:string}} acc
   * @param {{onCookies?:(c:Object)=>void, fetch?:Function, base?:string}} opts
   */
  constructor(acc, opts = {}) {
    this.gk = cleanKey(acc.gk);
    this.jar = new Map(Object.entries(acc.cookies || {}));
    this.jar.delete('golden_key');
    this.ua = acc.ua && acc.ua.startsWith('Mozilla/') ? acc.ua.replace(/\s*Electron\/[\d.]+/, '').replace(/\s*lumen-desktop\/[\d.]+/i, '') : UA;
    this.app = null;
    this.authAt = 0;
    this.freshAt = 0;
    this.dirty = false;
    this.onCookies = opts.onCookies || (() => {});
    this.fetch = opts.fetch || globalThis.fetch;
    this.base = opts.base || BASE;
    this.supportBase = opts.support || SUPPORT;
    this.sjar = new Map(); // куки support.funpay.com — отдельно, чтобы их PHPSESSID не затёр сессию funpay.com
    this.queue = Promise.resolve();
    // общий кэш опроса (см. SHARED)
    this.fresh = opts.fresh || 2500; // сколько мс копия списка чатов считается свежей
    this.snap = new Map(); // 'type:id' → { type, id, tag, data, at }
    this.extra = new Map(); // счётчики заказов: подмешиваем к каждому опросу чатов, если их кто-то ждёт
    this.bmSeq = 0; // растёт, когда список чатов изменился (новое сообщение) — по нему сбрасывается кэш истории
    this.inflight = null;
    this.hist = new Map(); // кэш /chat/history: ключ → { seq, at, r }
    this.histFlight = new Map();
    // темп: пауза между запросами и после 429
    this.gap = opts.gap ?? GAP;
    this.lastAt = 0;
    this.authFail = null; // { n, until, msg } — вход не удался: не долбим FunPay, ждём
  }

  // Все публичные вызовы идут по очереди: куки и csrf не перемешиваются.
  lock(fn) {
    const p = this.queue.then(fn, fn);
    this.queue = p.catch(() => {});
    return p;
  }

  url(u) {
    if (u.startsWith('http')) return u;
    return this.base + (u.startsWith('/') ? u : '/' + u);
  }

  /** golden_key и куки уходят только на funpay.com (или на тестовый адрес). */
  allowed(u) {
    try {
      const h = new URL(u);
      return h.origin === new URL(this.base).origin || (h.protocol === 'https:' && FUNPAY_HOST.test(h.hostname));
    } catch {
      return false;
    }
  }

  cookieHeader(noSession) {
    const parts = [`golden_key=${this.gk}`];
    if (!this.jar.has('cookie_prefs')) parts.push('cookie_prefs=1');
    for (const [k, v] of this.jar) {
      if (k === 'golden_key' || (noSession && k === 'PHPSESSID')) continue;
      parts.push(`${k}=${v}`);
    }
    return parts.join('; ');
  }

  capture(headers, jar) {
    if (jar) return captureTo(jar, headers);
    const list = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : [];
    for (const raw of list) {
      const first = raw.split(';')[0];
      const i = first.indexOf('=');
      if (i <= 0) continue;
      const name = first.slice(0, i).trim();
      const value = first.slice(i + 1).trim();
      if (!name || name === 'golden_key') continue;
      const low = raw.toLowerCase();
      const expired = !value || value === 'deleted' || low.includes('max-age=0') || low.includes('expires=thu, 01-jan-1970');
      if (expired) {
        if (this.jar.delete(name)) this.dirty = true;
      } else if (this.jar.get(name) !== value) {
        this.jar.set(name, value);
        this.dirty = true;
      }
    }
  }

  flush() {
    if (!this.dirty) return;
    this.dirty = false;
    try {
      this.onCookies(Object.fromEntries(this.jar));
    } catch {}
  }

  async once(method, url, body, xhr, noSession) {
    url = this.url(url);
    for (let hop = 0; hop < 6; hop++) {
      if (!this.allowed(url)) throw new Error('FunPay перенаправил на чужой сайт: ' + new URL(url).hostname);
      await this.pace();
      const headers = {
        'User-Agent': this.ua,
        'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.8',
        Cookie: this.cookieHeader(noSession),
      };
      if (xhr) {
        headers['X-Requested-With'] = 'XMLHttpRequest';
        headers.Accept = 'application/json, text/javascript, */*; q=0.01';
        headers.Origin = BASE;
        headers.Referer = BASE + '/chat/';
      } else {
        headers.Accept = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';
      }
      let res;
      try {
        res = await this.fetch(url, {
          method,
          headers,
          body: method === 'POST' ? body : undefined,
          redirect: 'manual',
          signal: AbortSignal.timeout(30000),
        });
      } catch (e) {
        throw new Error(netErr(e));
      }
      this.capture(res.headers);
      this.onStatus(res);
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('location');
        if (loc) {
          url = new URL(loc, url).href;
          method = 'GET';
          body = undefined;
          continue;
        }
      }
      const text = await res.text();
      return { status: res.status, text, url };
    }
    throw new Error('Слишком много перенаправлений');
  }

  /** Не чаще раза в this.gap мс и не раньше, чем кончится пауза после 429. */
  async pace() {
    const wait = Math.max(this.lastAt + this.gap - Date.now(), LIMIT.until - Date.now(), 0);
    if (wait > 0) await sleep(wait);
    this.lastAt = Date.now();
  }

  onStatus(res) {
    if (res.status === 429) {
      const ra = parseInt(res.headers.get('retry-after') || '', 10);
      const ms = ra > 0 ? Math.min(60e3, ra * 1000) : COOL[LIMIT.level];
      LIMIT.until = Math.max(LIMIT.until, Date.now() + ms);
      LIMIT.level = Math.min(LIMIT.level + 1, COOL.length - 1);
    } else if (res.status < 400 && LIMIT.level && Date.now() > LIMIT.until) LIMIT.level--;
  }

  async refreshSeal() {
    const uid = this.app && this.app.userId ? this.app.userId : '0';
    const tag = Array.from({ length: 8 }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('');
    const body = new URLSearchParams([
      ['objects', JSON.stringify([{ type: 'chat_counter', id: uid, tag, data: false }])],
      ['request', 'false'],
    ]);
    try {
      await this.once('POST', '/runner/', body, true, false);
    } catch {}
  }

  isAuthed() {
    return !!(this.app && this.app.csrf && this.app.userId && this.app.userId !== '0');
  }

  async _auth(force) {
    if (!force && this.isAuthed() && Date.now() - this.authAt < AUTH_TTL) return this.app;
    // вход недавно не удался (неверный ключ, нет сети) — не грузим главную FunPay на каждый запрос
    if (!force && this.authFail && Date.now() < this.authFail.until) throw new Error(this.authFail.msg);
    try {
      const d = await this._authNet(force);
      this.authFail = null;
      return d;
    } catch (e) {
      const n = (this.authFail?.n || 0) + 1;
      const hard = e.message === NOT_KNOWN || /заблокирован/.test(e.message);
      const ms = Math.min(hard ? 10 * 60e3 : 30e3, (hard ? 60e3 : 5e3) * 2 ** (n - 1));
      this.authFail = { n, until: Date.now() + ms, msg: e.message };
      throw e;
    }
  }

  async _authNet(force) {
    if (!this.gk) throw new Error('Нет golden_key');
    // Сначала живая сессия (после входа через браузер в ней уже пройден код), свежая — по таймеру или если старой нет.
    const saved = this.jar.get('PHPSESSID');
    const due = this.freshAt && Date.now() - this.freshAt > FRESH_EVERY;
    const modes = !saved ? [true, true] : due ? [true, false] : [false, true];
    let lastErr = 'FunPay не ответил';
    let notKnown = false;
    for (let attempt = 1; modes.length && attempt <= 5; attempt++) {
      const fresh = modes[0];
      if (fresh) {
        if (this.jar.delete('PHPSESSID')) this.dirty = true;
      } else if (saved && this.jar.get('PHPSESSID') !== saved) {
        this.jar.set('PHPSESSID', saved);
        this.dirty = true;
      }
      let r;
      try {
        r = await this.once('GET', '/', undefined, false, fresh);
      } catch (e) {
        lastErr = e.message;
        await sleep(1200 * attempt);
        continue;
      }
      if (fresh) this.freshAt = Date.now();
      if (r.status === 428) {
        await this.refreshSeal();
        continue;
      }
      if (isCloudflare(r.text)) {
        lastErr = 'FunPay закрыт проверкой Cloudflare, пробую ещё';
        await sleep(2500 * attempt);
        continue;
      }
      const d = parseMain(r.text);
      if (!d) {
        lastErr = `Не удалось прочитать страницу FunPay (HTTP ${r.status})`;
        modes.shift();
        continue;
      }
      if (d.blocked) throw new Error('Аккаунт заблокирован администрацией FunPay');
      if (!d.userId || d.userId === '0' || !d.username) {
        notKnown = true;
        modes.shift();
        continue;
      }
      if (!this.freshAt) this.freshAt = Date.now();
      this.app = d;
      this.authAt = Date.now();
      this.flush();
      return d;
    }
    this.flush();
    throw new Error(notKnown ? NOT_KNOWN : lastErr);
  }

  buildBody({ form, csrf, file }) {
    if (file) {
      const fd = new FormData();
      fd.append(file.field || 'file', new Blob([file.data], { type: file.mime || 'application/octet-stream' }), file.name || 'file');
      for (const [k, v] of pairs(file.extra)) fd.append(k, v);
      return fd;
    }
    if (form || csrf) {
      const p = new URLSearchParams(pairs(form));
      if (csrf && this.app) p.append('csrf_token', this.app.csrf);
      return p;
    }
    return undefined;
  }

  async _request({ method = 'GET', url, form, xhr = false, csrf = false, file }) {
    await this._auth(false);
    if (file) method = 'POST';
    let r = await this.once(method, url, this.buildBody({ form, csrf, file }), xhr, false);
    // 429: FunPay запрос не выполнил — ждём паузу (её выставил onStatus) и повторяем, а не теряем сообщение или ответ.
    // Повтор безопасен: отклонённый запрос FunPay не обработал, дубля не будет.
    for (let i = 0; i < 3 && r.status === 429; i++) r = await this.once(method, url, this.buildBody({ form, csrf, file }), xhr, false);
    if (r.status === 428) {
      await this.refreshSeal();
      r = await this.once(method, url, this.buildBody({ form, csrf, file }), xhr, false);
      if (r.status === 428) throw new Error('FunPay просит войти заново (428). Обнови golden_key или войди через браузер.');
    }
    if (r.text.includes('account-blocked-box') && !xhr) throw new Error('Аккаунт заблокирован администрацией FunPay');
    this.flush();
    return { status: r.status, text: r.text, url: r.url };
  }

  async _runner(objects, request, retry = true) {
    await this._auth(false);
    const r = await this._request({
      method: 'POST',
      url: '/runner/',
      form: [
        ['objects', objects],
        ['request', request || 'false'],
      ],
      xhr: true,
      csrf: true,
    });
    if (r.text.includes('account-blocked-box')) throw new Error('Аккаунт заблокирован администрацией FunPay');
    // 429 — FunPay просит подождать; 5xx — у FunPay сбой. Перелогин тут не поможет, только добавит запросов.
    if (r.status === 429) throw new Error('FunPay просит не спешить (HTTP 429)');
    if (r.status >= 500) throw new Error(`FunPay временно не отвечает (HTTP ${r.status})`);
    let v;
    try {
      v = JSON.parse(r.text);
    } catch {
      if (retry) {
        await this._auth(true);
        return this._runner(objects, request, false);
      }
      throw new Error(`FunPay ответил не JSON (HTTP ${r.status})`);
    }
    if (v && v.error === true) {
      // чаще всего протух csrf
      if (retry) {
        await this._auth(true);
        return this._runner(objects, request, false);
      }
      throw new Error(v.msg || 'Ошибка runner');
    }
    return v;
  }

  // ── Поддержка FunPay (support.funpay.com) ──
  // Вход через SSO: funpay.com/support/sso → редирект на support.funpay.com, там своя сессия.
  // Каждый хост получает только свои куки.
  async _sfetch(method, url, body, referer) {
    const sOrigin = new URL(this.supportBase).origin;
    for (let hop = 0; hop < 8; hop++) {
      const u = new URL(url);
      const isSup = u.origin === sOrigin;
      if (!isSup && !this.allowed(url)) throw new Error('Поддержка перенаправила на чужой сайт: ' + u.hostname);
      const headers = {
        'User-Agent': this.ua,
        'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.8',
        Cookie: isSup ? [...this.sjar].map(([k, v]) => `${k}=${v}`).join('; ') : this.cookieHeader(false),
      };
      if (referer) {
        headers['X-Requested-With'] = 'XMLHttpRequest';
        headers.Accept = 'application/json, text/javascript, */*; q=0.01';
        headers.Origin = sOrigin;
        headers.Referer = referer;
      } else {
        headers.Accept = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';
      }
      if (!headers.Cookie) delete headers.Cookie;
      let res;
      try {
        res = await this.fetch(url, { method, headers, body: method === 'POST' ? body : undefined, redirect: 'manual', signal: AbortSignal.timeout(30000) });
      } catch (e) {
        throw new Error(netErr(e));
      }
      if (isSup) this.capture(res.headers, this.sjar);
      else this.capture(res.headers);
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        url = new URL(res.headers.get('location'), url).href;
        method = 'GET';
        body = undefined;
        continue;
      }
      return { status: res.status, text: await res.text(), url };
    }
    throw new Error('Слишком много перенаправлений');
  }

  async _supportForm() {
    const path = '/tickets/new/' + SUPPORT_CAT;
    let r = await this._sfetch('GET', this.supportBase + path);
    let token = parseSupportToken(r.text);
    if (!token) {
      // нет сессии поддержки — входим через funpay.com
      r = await this._sfetch('GET', this.url('/support/sso?return_to=' + encodeURIComponent(path)));
      token = parseSupportToken(r.text);
      if (!token && !r.url.includes(path)) {
        r = await this._sfetch('GET', this.supportBase + path);
        token = parseSupportToken(r.text);
      }
    }
    this.flush();
    if (!token) throw new Error('Не удалось войти в поддержку FunPay. Открой support.funpay.com через «Браузер» один раз и попробуй снова.');
    return token;
  }

  /** Обращение «Покупатель не подтвердил заказ». orders — номера без #. Возвращает номер тикета. */
  async _supportTicket({ orders, text }) {
    const ids = (orders || []).map((x) => String(x).replace(/^#/, '').trim()).filter((x) => /^[A-Z0-9]{6,12}$/i.test(x));
    if (!ids.length) throw new Error('Нет номеров заказов');
    const me = await this._auth(false);
    const token = await this._supportForm();
    const html = String(text || '')
      .split(/\n/)
      .map((l) => `<p>${escHtml(l) || '<br>'}</p>`)
      .join('');
    const form = new URLSearchParams([
      ['ticket[fields][1]', me.username],
      ['ticket[fields][2]', ids.join(', ')],
      ['ticket[fields][3]', '2'],
      ['ticket[fields][5]', '201'],
      ['ticket[comment][body_html]', html],
      ['ticket[comment][attachments]', ''],
      ['ticket[_token]', token],
    ]);
    const r = await this._sfetch('POST', `${this.supportBase}/tickets/create/${SUPPORT_CAT}`, form, `${this.supportBase}/tickets/new/${SUPPORT_CAT}`);
    let v = null;
    try {
      v = JSON.parse(r.text);
    } catch {}
    const link = v && v.action && v.action.url ? String(v.action.url) : '';
    const id = (/\/tickets\/(\d+)/.exec(link) || [])[1] || '';
    if (r.status >= 400 || !id) {
      const e = v && (v.error || v.message || (v.errors && JSON.stringify(v.errors)));
      throw new Error(e ? 'Поддержка: ' + String(e).slice(0, 200) : `Поддержка не приняла обращение (HTTP ${r.status})`);
    }
    return { id, url: new URL(link, this.supportBase).href, orders: ids };
  }

  supportTicket(p) {
    return this.lock(() => this._supportTicket(p));
  }

  auth(force = false) {
    return this.lock(() => this._auth(force));
  }
  request(opts) {
    if (!isHistory(opts)) return this.lock(() => this._request(opts));
    // История чата: одинаковые запросы (окно, автоматика, плагины) — один поход в FunPay.
    // Кэш живёт, пока список чатов не изменился: новое сообщение → новый запрос.
    const key = opts.url;
    const seq = this.bmSeq;
    const hit = this.histGet(key, seq);
    if (hit) return Promise.resolve(hit);
    const fk = key + '#' + seq;
    const flying = this.histFlight.get(fk);
    if (flying) return flying.then((r) => ({ ...r }));
    const p = this.lock(async () => {
      const again = this.histGet(key, seq);
      if (again) return again;
      const r = await this._request(opts);
      if (r.status === 200) this.histPut(key, seq, r);
      return r;
    });
    this.histFlight.set(fk, p);
    p.then(
      () => this.histFlight.delete(fk),
      () => this.histFlight.delete(fk)
    );
    return p;
  }

  histGet(key, seq) {
    const c = this.hist.get(key);
    if (!c || c.seq !== seq || seq !== this.bmSeq || Date.now() - c.at > HIST_TTL) return null;
    return { ...c.r };
  }

  histPut(key, seq, r) {
    this.hist.delete(key);
    this.hist.set(key, { seq, at: Date.now(), r: { status: r.status, text: r.text, url: r.url } });
    if (this.hist.size > 200) this.hist.delete(this.hist.keys().next().value);
  }

  runner(objects, request) {
    let list = null;
    if (!request || request === 'false') {
      try {
        const v = typeof objects === 'string' ? JSON.parse(objects) : objects;
        if (Array.isArray(v) && v.length && v.every((o) => o && typeof o === 'object')) list = v;
      } catch {}
    }
    if (!list || !list.some((o) => SHARED.has(o.type))) return this.lock(() => this._runner(typeof objects === 'string' ? objects : JSON.stringify(objects), request));
    return this.poll(list);
  }

  // ── общий опрос списка чатов / счётчиков ──

  /** Ответ из свежей копии, без запроса. null — копии нет или она старая. */
  fromSnap(list, maxAge) {
    const now = Date.now();
    const out = [];
    for (const o of list) {
      const s = this.snap.get(skey(o));
      if (!s || now - s.at > maxAge) return null;
      out.push({ type: s.type, id: s.id, tag: s.tag, data: s.data });
    }
    return { objects: out, response: false };
  }

  async poll(list) {
    const onlyShared = list.every((o) => SHARED.has(o.type));
    for (const o of list) if (o.type === 'orders_counters') this.extra.set(skey(o), { type: o.type, id: o.id });
    if (onlyShared) {
      const hit = this.fromSnap(list, this.fresh);
      if (hit) return hit;
      // такой же опрос уже в пути — подождём его, а не пошлём второй
      if (this.inflight) {
        await this.inflight.catch(() => {});
        const hit2 = this.fromSnap(list, this.fresh);
        if (hit2) return hit2;
      }
    }
    const p = this.lock(() => this._poll(list, onlyShared));
    if (list.some((o) => o.type === 'chat_bookmarks')) {
      this.inflight = p;
      p.catch(() => {}).then(() => this.inflight === p && (this.inflight = null));
    }
    return p;
  }

  async _poll(list, onlyShared) {
    if (onlyShared) {
      const hit = this.fromSnap(list, this.fresh);
      if (hit) return hit; // пока стояли в очереди, кто-то уже обновил
    }
    const send = [];
    const seen = new Set();
    const shared = (o) => {
      const k = skey(o);
      if (seen.has(k)) return;
      seen.add(k);
      const s = this.snap.get(k);
      send.push({ type: o.type, id: o.id, tag: s ? s.tag : ZERO_TAG, data: false });
    };
    for (const o of list) SHARED.has(o.type) ? shared(o) : send.push(o);
    // счётчики заказов едут вместе со списком чатов — автоматике не нужен отдельный запрос
    if (list.some((o) => o.type === 'chat_bookmarks')) for (const x of this.extra.values()) shared(x);
    const v = await this._runner(JSON.stringify(send), 'false');
    const now = Date.now();
    const got = new Map();
    const rest = [];
    for (const o of (v && v.objects) || []) {
      if (!o || !SHARED.has(o.type)) {
        rest.push(o);
        continue;
      }
      const k = skey(o);
      got.set(k, o);
      const s = this.snap.get(k);
      if (hasData(o)) {
        if (o.type === 'chat_bookmarks' && (!s || s.tag !== o.tag || s.data?.html !== o.data.html)) this.bmSeq++;
        this.snap.set(k, { type: o.type, id: o.id, tag: o.tag, data: o.data, at: now });
      } else if (s && (o.tag == null || o.tag === s.tag)) s.at = now;
      else if (s) this.snap.delete(k); // тег новый, а данных нет — в следующий раз попросим целиком
    }
    // FunPay не прислал объект, который мы спросили со своим тегом, — значит, не изменился
    for (const x of send) {
      if (!SHARED.has(x.type) || got.has(skey(x))) continue;
      const s = this.snap.get(skey(x));
      if (s && s.tag === x.tag) s.at = now;
    }
    const objects = rest;
    for (const o of list) {
      if (!SHARED.has(o.type)) continue;
      const s = this.snap.get(skey(o));
      if (s) objects.push({ type: s.type, id: s.id, tag: s.tag, data: s.data });
      else if (got.has(skey(o))) objects.push(got.get(skey(o)));
    }
    return { ...v, objects };
  }
  cookies() {
    return [['golden_key', this.gk], ...this.jar];
  }
}

module.exports = { Session, cleanKey, parseMain, parseSupportToken, decodeEntities, UA, BASE, NOT_KNOWN };
