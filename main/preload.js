const { contextBridge, ipcRenderer } = require('electron');

const call = async (ch, ...args) => {
  const r = await ipcRenderer.invoke(ch, ...args);
  if (!r.ok) throw new Error(r.error);
  return r.data;
};

contextBridge.exposeInMainWorld('api', {
  acc: {
    list: () => call('acc:list'),
    addKey: (gk) => call('acc:add-key', gk),
    addBrowser: () => call('acc:add-browser'),
    remove: (id) => call('acc:remove', id),
    setActive: (id) => call('acc:active', id),
    key: (id) => call('acc:key', id),
  },
  fp: {
    auth: (id, force) => call('fp:auth', id, force),
    req: (id, opts) => call('fp:req', id, opts),
    runner: (id, objects, request) => call('fp:runner', id, objects, request),
    upload: (id, url, file) => call('fp:upload', id, url, file),
    support: (id, p) => call('fp:support', id, p),
  },
  store: {
    get: (k, d) => call('store:get', k, d),
    set: (k, v) => call('store:set', k, v),
  },
  app: {
    info: () => call('app:info'),
    clipboard: () => call('app:clipboard'),
    copy: (t) => call('app:copy', t),
    open: (url) => call('app:open', url),
    browser: (id, url) => call('app:browser', id, url),
    browserPrep: (id) => call('app:browserPrep', id),
    notify: (p) => call('app:notify', p),
    toast: (p) => call('app:toast', p),
    badge: (n, dataUrl) => call('app:badge', n, dataUrl),
    flash: () => call('app:flash'),
    chrome: (c) => call('app:chrome', c),
    autostart: (on) => call('app:autostart', on),
    quit: () => call('app:quit'),
    win: (a) => call('win:ctl', a),
    on: (ch, fn) => {
      if (!['nav:chat', 'app:focus', 'upd:state', 'auto:event', 'win:max'].includes(ch)) return;
      ipcRenderer.on(ch, (_e, ...a) => fn(...a));
    },
  },
  ai: (cfg, messages) => call('ai:chat', cfg, messages),
  tr: (text) => call('tr:en', text),
  trx: (text, sl, tl) => call('tr:x', text, sl, tl),
  fx: { list: () => call('fx:list') },
  lumen: (path, method, body) => call('lumen:api', path, method, body),
  auto: {
    attach: (id, mode) => call('auto:attach', id, mode),
    detach: () => call('auto:detach'),
    mode: (m) => call('auto:mode', m),
    info: () => call('auto:info'),
    setCfg: (cfg) => call('auto:cfg', cfg),
    products: (id) => call('auto:products', id),
    setProducts: (id, lines) => call('auto:setProducts', id, lines),
    plugin: (action, id, a, b) => call('auto:plugin', action, id, a, b),
  },
  upd: {
    state: () => call('upd:state'),
    check: () => call('upd:check'),
    download: () => call('upd:download'),
    install: () => call('upd:install'),
    releases: () => call('upd:releases'),
  },
});
