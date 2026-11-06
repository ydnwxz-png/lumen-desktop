// FunPay-клиент главного процесса: куки (golden_key, PHPSESSID, golden_seal), вход, runner, загрузка файлов.
// Чистый Node (fetch), без Electron — поэтому тестируется отдельно.

const BASE = 'https://funpay.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36';
const AUTH_TTL = 20 * 60e3;
const FRESH_EVERY = 50 * 60e3;
const NOT_KNOWN = 'FunPay не принял golden_key. Проверь, что скопировал его целиком. Если FunPay просит код при входе — войди через браузер.';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FUNPAY_HOST = /^([a-z0-9-]+\.)*funpay\.com$/i;

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
    this.queue = Promise.resolve();
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

  capture(headers) {
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

  auth(force = false) {
    return this.lock(() => this._auth(force));
  }
  request(opts) {
    return this.lock(() => this._request(opts));
  }
  runner(objects, request) {
    return this.lock(() => this._runner(objects, request));
  }
  cookies() {
    return [['golden_key', this.gk], ...this.jar];
  }
}

module.exports = { Session, cleanKey, parseMain, decodeEntities, UA, BASE, NOT_KNOWN };
