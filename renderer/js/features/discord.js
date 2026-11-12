// Активность в Discord: синхронизируем настройку с основной частью программы.
import { S } from '../core/state.js';

export function syncDiscord() {
  const d = S.settings.discord || {};
  if (!window.api?.app?.discord) return;
  window.api.app.discord({ on: !!d.on && !S.demo, nick: d.nick ? S.me?.username || '' : '' }).catch(() => {});
}
