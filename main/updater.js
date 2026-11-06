// Обновления с GitHub Releases.
// • Установленная версия (Lumen-Setup.exe) на Windows: качает обновление сама и ставит при перезапуске (electron-updater).
// • Portable, macOS и всё остальное: проверяет последний релиз и предлагает скачать.
// Откуда брать релизы, electron-builder записывает в resources/app-update.yml при сборке в GitHub Actions.
// Если файла нет (собрал сам у себя) — проверка обновлений просто выключена.
const { app, shell } = require('electron');
const fs = require('fs');
const path = require('path');

const CHECK_EVERY = 4 * 3600e3;
let send = () => {};
let repo = null; // { owner, repo }
let state = { state: 'idle', version: app.getVersion() };
let au = null;
let timer = null;
let getSettings = () => ({});

function readRepo() {
  try {
    const y = fs.readFileSync(path.join(process.resourcesPath, 'app-update.yml'), 'utf8');
    const owner = /^owner:\s*['"]?([^'"\s]+)/m.exec(y)?.[1];
    const name = /^repo:\s*['"]?([^'"\s]+)/m.exec(y)?.[1];
    return owner && name ? { owner, repo: name } : null;
  } catch {
    return null;
  }
}

const isPortable = () => !!process.env.PORTABLE_EXECUTABLE_DIR;
const canAuto = () => app.isPackaged && process.platform === 'win32' && !isPortable() && !!repo;

function set(s) {
  state = { ...state, ...s };
  send(state);
}

function newer(a, b) {
  const p = (v) => String(v).replace(/^v/, '').split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const x = p(a),
    y = p(b);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
}

async function manualCheck() {
  const r = await fetch(`https://api.github.com/repos/${repo.owner}/${repo.repo}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Lumen-Desktop' },
    signal: AbortSignal.timeout(20000),
  });
  if (r.status === 404) return set({ state: 'none', latest: '', url: '', checkedAt: Date.now() });
  if (!r.ok) throw new Error(`GitHub ответил ${r.status}`);
  const j = await r.json();
  const v = String(j.tag_name || '').replace(/^v/, '');
  if (v && newer(v, app.getVersion())) set({ state: 'manual', latest: v, url: j.html_url, checkedAt: Date.now() });
  else set({ state: 'none', latest: '', url: '', checkedAt: Date.now() });
}

async function check() {
  if (!repo) return set({ state: 'off' });
  if (!app.isPackaged) return set({ state: 'dev' });
  try {
    set({ state: 'checking' });
    if (canAuto() && au) {
      au.autoDownload = getSettings().autoUpdate !== false;
      await au.checkForUpdates();
    }
    else await manualCheck();
  } catch (e) {
    set({ state: 'error', error: String(e?.message || e).slice(0, 200), checkedAt: Date.now() });
  }
}

function init(onState, settingsFn) {
  send = onState;
  getSettings = settingsFn || getSettings;
  repo = readRepo();
  if (canAuto()) {
    try {
      au = require('electron-updater').autoUpdater;
      au.autoDownload = getSettings().autoUpdate !== false;
      au.autoInstallOnAppQuit = true;
      au.on('update-available', (i) => set({ state: au.autoDownload ? 'downloading' : 'available', latest: i.version, percent: 0 }));
      au.on('update-not-available', () => set({ state: 'none', checkedAt: Date.now() }));
      au.on('download-progress', (p) => set({ state: 'downloading', percent: Math.round(p.percent || 0) }));
      au.on('update-downloaded', (i) => set({ state: 'ready', latest: i.version, checkedAt: Date.now() }));
      au.on('error', (e) => set({ state: 'error', error: String(e?.message || e).slice(0, 200) }));
    } catch {
      au = null; // нет electron-updater — работаем через проверку релиза
    }
  }
  setTimeout(check, 15000);
  clearInterval(timer);
  timer = setInterval(check, CHECK_EVERY);
}

module.exports = {
  init,
  check,
  state: () => ({ ...state, auto: canAuto(), repo: repo ? `${repo.owner}/${repo.repo}` : '' }),
  download: () => {
    if (au && state.state === 'available') au.downloadUpdate();
    else if (state.url) shell.openExternal(state.url);
  },
  install: () => {
    if (au && state.state === 'ready') au.quitAndInstall(false, true);
  },
  releasesUrl: () => (repo ? `https://github.com/${repo.owner}/${repo.repo}/releases` : ''),
};
