// © 2026 Lumen. Все права защищены. Копирование, изменение и распространение этого кода запрещены без разрешения автора (см. LICENSE).
// Клиент FunPay для окна приложения: запросы идут через главный процесс Electron.
import { createAccount } from './account.js';
import { openWebPane } from '../ui/webpane.js';

export function createClient(accId) {
  const api = window.api;
  return createAccount(
    {
      auth: (force) => api.fp.auth(accId, force),
      req: (opts) => api.fp.req(accId, opts),
      runner: (objects, request) => api.fp.runner(accId, objects, request),
      upload: (url, file) => api.fp.upload(accId, url, file),
      openBrowser: (url) => openWebPane(accId, url),
    },
    { accId }
  );
}
