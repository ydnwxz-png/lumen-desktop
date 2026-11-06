// Аккаунт FunPay для Node (главный процесс приложения): сеть — main/fp.js, разбор страниц — linkedom.
import { createRequire } from 'node:module';
import { setDOMParser } from '../renderer/js/fp/parse.js';
import { createAccount } from '../renderer/js/fp/account.js';

const require = createRequire(import.meta.url);
const { Session } = require('../main/fp.js');

let domReady = null;
export async function ensureDOM() {
  domReady ||= import('linkedom').then((m) => setDOMParser(m.DOMParser));
  return domReady;
}

/** Аккаунт поверх готовой сессии main/fp.js. */
export async function accountFromSession(session) {
  await ensureDOM();
  return createAccount({
    auth: (force) => session.auth(force),
    req: (o) => session.request(o),
    runner: (o, r) => session.runner(o, r),
    upload: (url, file) => session.request({ url, xhr: true, file: { ...file, data: Buffer.from(file.data) } }),
  });
}

export { Session };
