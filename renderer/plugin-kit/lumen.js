// Мост для страниц плагинов Lumen: window.lumen — доступ к FunPay и приложению через окно Lumen.
(() => {
  let seq = 0;
  const wait = new Map();
  const call = (method, ...args) =>
    new Promise((res, rej) => {
      const id = ++seq;
      wait.set(id, { res, rej });
      parent.postMessage({ lumen: 1, id, method, args }, '*');
    });
  addEventListener('message', (e) => {
    const d = e.data;
    if (!d || d.lumen !== 1 || e.source !== parent) return;
    if (d.type === 'theme') {
      const r = document.documentElement;
      for (const [k, v] of Object.entries(d.vars || {})) r.style.setProperty(k, v);
      r.dataset.theme = d.theme || 'dark';
      return;
    }
    const w = wait.get(d.id);
    if (!w) return;
    wait.delete(d.id);
    d.ok ? w.res(d.data) : w.rej(new Error(d.error || 'Ошибка'));
  });
  window.lumen = {
    call,
    me: () => call('me'),
    chats: () => call('chats'),
    openChat: () => call('openChat'),
    send: (chat, text) => call('send', chat, text),
    toast: (title, body = '', kind = '') => call('toast', title, body, kind),
    confirm: (title, text = '', yes = 'Да') => call('confirm', title, text, yes),
    copy: (text) => call('copy', text),
    open: (url) => call('open', url),
    translate: (text) => call('translate', text),
    plugin: (name, ...args) => call('plugin', name, ...args),
    storage: { get: (k, d) => call('storage.get', k, d), set: (k, v) => call('storage.set', k, v) },
    fp: {
      myLots: () => call('fp.myLots'),
      lotNewForm: (node) => call('fp.lotNewForm', node),
      lotCreate: (f) => call('fp.lotCreate', f),
      withdrawRate: () => call('fp.withdrawRate'),
    },
  };
  call('hello').catch(() => {});
})();
