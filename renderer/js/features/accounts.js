// Клиенты FunPay для всех добавленных аккаунтов (не только активного) — для уведомлений и слежки за закрепом.
import { S } from '../core/state.js';
import { createClient } from '../fp/client.js';

const cache = new Map(); // id → { client, me, at }
const AUTH_TTL = 30 * 60e3;

/** Все аккаунты из программы: [{ id, userId, username, avatar }] */
export async function accountsList() {
  if (S.demo || !window.api?.acc) return S.me ? [{ id: 'demo', userId: S.me.userId, username: S.me.username, avatar: S.me.avatar }] : [];
  try {
    return (await window.api.acc.list()).list || [];
  } catch {
    return [];
  }
}

/** Клиент и «я» для аккаунта id. Активный — тот же, что в окне. */
export async function clientFor(id) {
  if (S.demo || id === 'demo') return { client: S.backend, me: S.me };
  if (id === S.accId && S.backend && S.me) return { client: S.backend, me: S.me };
  let c = cache.get(id);
  if (!c || Date.now() - c.at > AUTH_TTL) {
    const client = c?.client || createClient(id);
    const me = await client.auth(false);
    c = { client, me, at: Date.now() };
    cache.set(id, c);
  }
  return c;
}

export function forget(id) {
  cache.delete(id);
}
