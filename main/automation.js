// Автоматика и плагины в приложении: движок работает в главном процессе.
// Режимы: 'pc' — включена, 'off' — выключена.
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { app, shell } = require('electron');

const ROOT = path.join(__dirname, '..');
const mod = (p) => import(pathToFileURL(path.join(ROOT, p)).href);

let cur = null; // { accId, engine }
let emit = () => {};
let gen = 0;

const pluginsDir = () => path.join(app.getPath('userData'), 'plugins');

// Раньше сюда копировались примеры плагинов. Их больше нет — убираем старые копии (только наши, нетронутые).
const OLD_EXAMPLES = ['hello', 'keyword-alert', 'daily-report', 'bonus-after-delivery'];
function preparePlugins() {
  const dir = pluginsDir();
  fs.mkdirSync(dir, { recursive: true });
  const mark = path.join(dir, '.examples-removed');
  if (fs.existsSync(mark)) return;
  for (const id of OLD_EXAMPLES) {
    const f = path.join(dir, id + '.js');
    try {
      const src = fs.readFileSync(f, 'utf8');
      if (src.includes(`id: '${id}'`) && src.includes("author: 'Lumen'")) fs.unlinkSync(f);
    } catch {}
  }
  try {
    fs.writeFileSync(mark, '');
  } catch {}
}

async function attach(accId, session, mode) {
  const my = ++gen;
  if (cur && cur.accId === accId) return syncMode(mode);
  await detach();
  if (!accId || !session) return null;
  preparePlugins();
  const [{ Engine }, { accountFromSession }] = await Promise.all([mod('engine/engine.js'), mod('engine/node.js')]);
  const account = await accountFromSession(session);
  const me = await session.auth(false);
  if (my !== gen) return null;
  const engine = new Engine({ account, dataDir: path.join(app.getPath('userData'), 'automation', String(me.userId)), pluginsDir: pluginsDir(), off: ['raise'] });
  for (const ev of ['message', 'order', 'orderStatus', 'review', 'delivered', 'deliveryEmpty', 'command', 'notify', 'status', 'log']) {
    engine.on(ev, (data) => emit({ type: ev, data: slim(ev, data) }));
  }
  cur = { accId, engine };
  await engine.plugins.loadAll();
  await syncMode(mode);
  return info();
}

// в окно отправляем только то, что нужно для уведомлений (без больших объектов)
function slim(ev, d) {
  if (!d) return d;
  if (ev === 'delivered' || ev === 'deliveryEmpty') return { order: d.order, rule: { id: d.rule.id, name: d.rule.name }, left: d.left === Infinity ? null : d.left, need: d.need };
  if (ev === 'review') return { orderId: d.orderId, rating: d.rating, text: d.text, buyer: d.buyer };
  if (ev === 'command') return { chat: d.chat, text: d.text, rule: { triggers: d.rule.triggers } };
  if (ev === 'message') return { chat: d.chat, text: d.text, author: d.author };
  return d;
}

async function syncMode(mode) {
  if (!cur) return null;
  const e = cur.engine;
  if (mode === 'pc' && !e.running) await e.start().catch((err) => e.log('error', 'Автоматика не запустилась: ' + err.message));
  if (mode !== 'pc' && e.running) await e.stop();
  return info();
}

async function detach() {
  if (cur?.engine.running) await cur.engine.stop().catch(() => {});
  cur = null;
}

function need() {
  if (!cur) throw new Error('Войди в аккаунт FunPay, чтобы настроить автоматику');
  return cur.engine;
}

function info() {
  if (!cur) return null;
  const e = cur.engine;
  return { cfg: e.cfg, info: e.info(), plugins: e.plugins.all(), events: e.events.slice(-60), rules: e.cfg.delivery.rules.map((r) => ({ id: r.id, count: e.infinite(r) ? null : e.products(r).length })) };
}

module.exports = {
  init(onEvent) {
    emit = onEvent;
  },
  attach,
  detach,
  syncMode,
  info,
  async setCfg(cfg) {
    const e = need();
    const { DEFAULTS } = await mod('engine/defaults.js');
    const { merge } = await mod('engine/store.js');
    e.cfgStore.data = merge(structuredClone(DEFAULTS), { ...cfg, plugins: e.cfg.plugins });
    e.saveCfg();
    return info();
  },
  products: (id) => need().products({ id }),
  setProducts(id, lines) {
    need().setProducts({ id }, lines);
    return info();
  },
  async plugin(action, id, a, b) {
    const e = need();
    if (action === 'toggle') await e.plugins.setEnabled(id, a);
    if (action === 'setting') e.plugins.setSetting(id, a, b);
    if (action === 'remove') await e.plugins.remove(id);
    if (action === 'reload') await e.plugins.loadAll();
    if (action === 'install') {
      const p = await e.plugins.install(id, a);
      if (p.error) {
        await e.plugins.remove(p.id);
        throw new Error('Плагин не загрузился: ' + p.error);
      }
    }
    if (action === 'folder') {
      preparePlugins();
      shell.openPath(pluginsDir());
    }
    return info();
  },
  async raiseNow() {
    return need().raiseDue(true);
  },
};
