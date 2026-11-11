// Настройки, шаблоны и прочее сохраняемое + шина событий.
const hasApi = typeof window.api !== 'undefined';

export const persist = {
  async get(k, d) {
    if (hasApi) return window.api.store.get(k, d);
    try {
      const v = localStorage.getItem('lumen:' + k);
      return v == null ? d : JSON.parse(v);
    } catch {
      return d;
    }
  },
  set(k, v) {
    if (hasApi) return window.api.store.set(k, v).catch(() => {});
    try {
      localStorage.setItem('lumen:' + k, JSON.stringify(v));
    } catch {}
  },
};

export const DEFAULT_SETTINGS = {
  theme: 'dark', // dark | light | system
  accent: 'lumen', // или 'custom' + customAccent
  customAccent: null, // {a1, a2}
  tint: '', // оттенок фона, #rrggbb
  bg: 'aurora', // aurora | solid | oled
  density: 'comfortable',
  fontSize: 14,
  animations: true,
  notify: { mode: 'lumen', corner: 'br', sound: true, volume: 0.55, msgSound: 'lumen', orderSound: 'coins', preview: true, whenFocused: false, orders: true, allAccounts: true },
  pollInterval: 3,
  autoUpdate: true,
  tray: true,
  startMinimized: false,
  myNick: { style: 'aurora', c1: '#a78bfa', c2: '#22d3ee' },
  templatesBar: true,
  sendOnEnter: true,
  autoRaise: false,
  automation: { mode: 'off' }, // pc | off
  ai: { base: 'https://api.openai.com/v1', key: '', model: 'gpt-4o-mini' },
  dnd: { on: false, schedule: false, from: 23, to: 8, reply: false, text: 'Сейчас не на связи — отвечу, как только вернусь 🙏' },
};

export const DEFAULT_TEMPLATES = [
  { id: 't1', name: 'Привет', text: '$welcome, $username! 👋 Чем могу помочь?', color: 'violet', send: false },
  { id: 't2', name: 'Спасибо', text: 'Спасибо за покупку! Подтверди, пожалуйста, заказ $order_link и оставь отзыв — мне это очень помогает 🙏', color: 'mint', send: false },
  { id: 't3', name: 'Секунду', text: 'Секунду, сейчас всё сделаю ⏳', color: 'ocean', send: true },
  { id: 't4', name: 'В наличии', text: 'Да, в наличии. Можно оплачивать — выдам сразу после оплаты.', color: 'sunset', send: false },
];

function merge(def, v) {
  if (!v || typeof v !== 'object' || Array.isArray(def)) return v ?? def;
  const out = { ...def };
  for (const k of Object.keys(v)) out[k] = def[k] && typeof def[k] === 'object' && !Array.isArray(def[k]) ? merge(def[k], v[k]) : v[k];
  return out;
}

const listeners = new Map();
export const bus = {
  on(ev, fn) {
    if (!listeners.has(ev)) listeners.set(ev, new Set());
    listeners.get(ev).add(fn);
    return () => listeners.get(ev).delete(fn);
  },
  emit(ev, ...a) {
    for (const fn of listeners.get(ev) || []) {
      try {
        fn(...a);
      } catch (e) {
        console.error(ev, e);
      }
    }
  },
};

export const S = {
  settings: structuredClone(DEFAULT_SETTINGS),
  templates: [],
  backend: null, // активный клиент FunPay (настоящий или демо)
  accId: null,
  demo: false,
  me: null, // {userId, username, avatar, balance}
  focused: true,
  meta: {}, // по чатам: {pinned, muted, archived, nick, note}
};

export async function loadSettings() {
  S.settings = merge(DEFAULT_SETTINGS, await persist.get('settings', {}));
  // 1.6: фирменный цвет Lumen — зелёный, как в расширении. Старый фиолетовый «по умолчанию» меняем один раз.
  if (!S.settings.green && S.settings.accent === 'violet') S.settings.accent = 'lumen';
  S.settings.green = true;
  S.templates = await persist.get('templates', null);
  if (!Array.isArray(S.templates)) S.templates = structuredClone(DEFAULT_TEMPLATES);
}

export function saveSettings() {
  persist.set('settings', S.settings);
  bus.emit('settings');
}

export function saveTemplates() {
  persist.set('templates', S.templates);
  bus.emit('templates');
}

export async function loadMeta() {
  S.meta = (await persist.get('meta:' + (S.accId || 'demo'), {})) || {};
}

export function meta(node) {
  return S.meta[node] || {};
}

export function setMeta(node, patch) {
  S.meta[node] = { ...meta(node), ...patch };
  for (const k of Object.keys(S.meta[node])) if (S.meta[node][k] === false || S.meta[node][k] === '' || S.meta[node][k] == null) delete S.meta[node][k];
  persist.set('meta:' + (S.accId || 'demo'), S.meta);
  bus.emit('meta', node);
}
