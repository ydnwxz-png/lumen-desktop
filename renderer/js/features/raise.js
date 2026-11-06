// Поднятие лотов по играм (как в FunPay Tools 4.5 и Cardinal): один запрос на игру со всеми её разделами.
// Автоподнятие ждёт ровно столько, сколько просит FunPay («Подождите N часов»).
import { S, bus } from '../core/state.js';

export const R = { games: [], st: new Map(), running: false, loadedAt: 0 };
let timer = null;

async function loadGames(force) {
  if (!force && R.games.length && Date.now() - R.loadedAt < 30 * 60e3) return R.games;
  R.games = await S.backend.raiseGames();
  R.loadedAt = Date.now();
  return R.games;
}

export const gameOfNode = (node) => R.games.find((g) => g.nodes.includes(String(node)));
export const stateOfNode = (node) => {
  const g = gameOfNode(node);
  return g ? R.st.get(g.game) : null;
};

async function raiseOne(g) {
  try {
    const r = await S.backend.raiseGame(g.game, g.nodes);
    R.st.set(g.game, { ok: r.ok, msg: r.msg, at: Date.now(), nextAt: Date.now() + (r.wait || 10 * 60e3) + 20e3, error: r.error });
    return r;
  } catch (e) {
    R.st.set(g.game, { ok: false, msg: e.message, at: Date.now(), nextAt: Date.now() + 5 * 60e3, error: true });
    throw e;
  } finally {
    bus.emit('raise');
  }
}

/** Поднять раздел (а с ним всю игру). */
export async function raiseNode(node) {
  await loadGames(false);
  let g = gameOfNode(node);
  if (!g) g = (await loadGames(true), gameOfNode(node));
  if (!g) return { ok: false, msg: 'FunPay не дал поднять этот раздел' };
  return raiseOne(g);
}

/** Поднять всё, что пора (force — не смотреть на таймеры). */
export async function raiseDue(force = false) {
  if (R.running || !S.backend) return [];
  R.running = true;
  bus.emit('raise');
  const out = [];
  try {
    await loadGames(force);
    for (const g of R.games) {
      const s = R.st.get(g.game);
      if (!force && s && s.nextAt > Date.now()) continue;
      try {
        out.push(await raiseOne(g));
      } catch (e) {
        out.push({ ok: false, msg: e.message });
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
  } finally {
    R.running = false;
    bus.emit('raise');
  }
  return out;
}

export function nextAt() {
  let n = Infinity;
  for (const s of R.st.values()) n = Math.min(n, s.nextAt);
  return n;
}

export function syncAuto() {
  clearInterval(timer);
  timer = null;
  if (S.settings.autoRaise && S.backend) {
    raiseDue().catch(() => {});
    timer = setInterval(() => raiseDue().catch(() => {}), 60e3);
  }
  bus.emit('raise');
}

export function resetRaise() {
  R.games = [];
  R.loadedAt = 0;
  R.st.clear();
  syncAuto();
}
