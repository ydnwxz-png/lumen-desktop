// © 2026 Lumen. Все права защищены. Копирование, изменение и распространение этого кода запрещены без разрешения автора (см. LICENSE).
// Обновления с GitHub Releases.
// • Установленная версия (Lumen-Setup.exe) на Windows: качает обновление в фоне и ставит ТИХО — без окон установщика:
//   по кнопке «Перезапустить», при выходе из Lumen или в начале следующего запуска (если в прошлый раз не успели).
// • macOS: сам качает .zip с новой версией из релиза, распаковывает и при перезапуске подменяет Lumen.app
//   (без платного сертификата Apple: скачанное программой не помечается «карантином», поэтому macOS не ругается).
//   Если Lumen запущен не из «Программ» (прямо из .dmg / из «Загрузок») — как раньше, предлагает скачать.
// • Portable и всё остальное: проверяет последний релиз и предлагает скачать.
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
let hooks = { ready: () => {}, autoInstall: () => {} };
// Скачанное, но не поставленное обновление — запоминаем, чтобы поставить при следующем запуске
const PENDING = () => path.join(app.getPath('userData'), 'pending-update.json');
const readPending = () => { try { return JSON.parse(fs.readFileSync(PENDING(), 'utf8')).version || ''; } catch { return ''; } };
const writePending = (v) => { try { v ? fs.writeFileSync(PENDING(), JSON.stringify({ version: v })) : fs.unlinkSync(PENDING()); } catch {} };
let installOnReady = false;

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

/* ---------- macOS: своё автообновление ---------- */
const { spawn, execFile } = require('child_process');
const os = require('os');
// …/Lumen.app/Contents/MacOS/Lumen → …/Lumen.app
const macBundle = () => path.resolve(process.execPath, '..', '..', '..');
const MAC_DIR = () => path.join(app.getPath('userData'), 'mac-update');
function canMac() {
  if (!app.isPackaged || process.platform !== 'darwin' || !repo) return false;
  const b = macBundle();
  if (!b.endsWith('.app') || b.includes('/AppTranslocation/') || b.startsWith('/Volumes/')) return false;   // запущен из .dmg или «на карантине»
  try { fs.accessSync(path.dirname(b), fs.constants.W_OK); fs.accessSync(b, fs.constants.W_OK); return true; } catch { return false; }
}
const run = (cmd, args) => new Promise((res, rej) => execFile(cmd, args, { timeout: 120000 }, (e, out, err) => (e ? rej(new Error(String(err || e.message).slice(0, 200))) : res(out))));
const macReady = (v) => path.join(MAC_DIR(), v, 'Lumen.app');
let macBusy = false;

async function macDownload(v, asset) {
  if (macBusy) return;
  macBusy = true;
  try {
    const dir = path.join(MAC_DIR(), v);
    fs.rmSync(MAC_DIR(), { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    const zip = path.join(dir, 'update.zip');
    set({ state: 'downloading', latest: v, percent: 0 });
    const r = await fetch(asset.browser_download_url, { headers: { 'User-Agent': 'Lumen-Desktop' }, signal: AbortSignal.timeout(15 * 60e3) });
    if (!r.ok || !r.body) throw new Error(`GitHub ответил ${r.status}`);
    const total = +r.headers.get('content-length') || asset.size || 0;
    const out = fs.createWriteStream(zip);
    let got = 0, last = 0;
    for await (const chunk of r.body) {
      got += chunk.length;
      if (!out.write(chunk)) await new Promise((ok) => out.once('drain', ok));
      const pc = total ? Math.round(got / total * 100) : 0;
      if (pc !== last) { last = pc; set({ state: 'downloading', percent: pc }); }
    }
    await new Promise((ok, bad) => out.end((e) => (e ? bad(e) : ok())));
    if (total && got !== total) throw new Error('файл скачался не полностью');
    await run('/usr/bin/ditto', ['-x', '-k', zip, dir]);            // родная распаковка macOS: сохраняет подпись и права
    fs.rmSync(zip, { force: true });
    const appDir = fs.readdirSync(dir).find((n) => n.endsWith('.app'));
    if (!appDir) throw new Error('в архиве нет Lumen.app');
    if (appDir !== 'Lumen.app') fs.renameSync(path.join(dir, appDir), macReady(v));
    await run('/usr/bin/codesign', ['--verify', '--deep', macReady(v)]).catch(() => {});   // проверка целостности (подпись ad-hoc)
    writePending(v);
    if (installOnReady) {
      installOnReady = false;
      set({ state: 'installing', latest: v });
      setTimeout(() => hooks.autoInstall(), 2500);
      return;
    }
    set({ state: 'ready', latest: v, checkedAt: Date.now() });
    hooks.ready(v);
  } catch (e) {
    fs.rmSync(MAC_DIR(), { recursive: true, force: true });
    set({ state: 'error', error: 'Обновление: ' + String(e?.message || e).slice(0, 180) });
  } finally {
    macBusy = false;
  }
}

function macInstall() {
  const v = state.latest || readPending();
  const src = v && macReady(v);
  if (!src || !fs.existsSync(src)) return false;
  const dst = macBundle();
  // Скрипт ждёт, пока Lumen закроется, меняет папку программы и запускает новую версию. Не вышло — возвращает старую.
  const sh = path.join(os.tmpdir(), 'lumen-update.sh');
  fs.writeFileSync(sh, `#!/bin/bash
PID="$1"; APP="$2"; NEW="$3"
for i in $(seq 1 100); do kill -0 "$PID" 2>/dev/null || break; sleep 0.2; done
rm -rf "$APP.old"
if mv "$APP" "$APP.old" && mv "$NEW" "$APP"; then rm -rf "$APP.old"; else [ -d "$APP" ] || mv "$APP.old" "$APP"; fi
/usr/bin/xattr -dr com.apple.quarantine "$APP" 2>/dev/null
open "$APP"
`, { mode: 0o755 });
  spawn('/bin/bash', [sh, String(process.pid), dst, src], { detached: true, stdio: 'ignore' }).unref();
  writePending('');
  setTimeout(() => app.quit(), 200);
  return true;
}

function set(s) {
  state = { ...state, ...s };
  const { asset, ...pub } = state;
  send(pub);
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
  if (!v || !newer(v, app.getVersion())) return set({ state: 'none', latest: '', url: '', checkedAt: Date.now() });
  if (canMac()) {
    const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
    const asset = (j.assets || []).find((a) => a.name === `Lumen-${v}-${arch}.zip` || (a.name.endsWith('.zip') && a.name.includes(arch) && a.name.includes(v)));
    if (asset) {
      if (fs.existsSync(macReady(v))) { set({ state: 'ready', latest: v, url: j.html_url, checkedAt: Date.now() }); if (installOnReady) { installOnReady = false; set({ state: 'installing' }); setTimeout(() => hooks.autoInstall(), 2500); } return; }
      set({ latest: v, url: j.html_url, asset });
      if (getSettings().autoUpdate !== false || installOnReady) return macDownload(v, asset);
      return set({ state: 'available', checkedAt: Date.now() });
    }
  }
  set({ state: 'manual', latest: v, url: j.html_url, checkedAt: Date.now() });
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

function init(onState, settingsFn, h) {
  send = onState;
  getSettings = settingsFn || getSettings;
  hooks = { ...hooks, ...(h || {}) };
  repo = readRepo();
  const pend = readPending();
  if (pend && !newer(pend, app.getVersion())) writePending('');   // уже обновились
  // в прошлый раз скачали, но не поставили (выключили ПК) — ставим сразу при запуске
  installOnReady = (canAuto() || canMac()) && !!pend && newer(pend, app.getVersion());
  if (canAuto()) {
    try {
      au = require('electron-updater').autoUpdater;
      au.autoDownload = getSettings().autoUpdate !== false;
      au.autoInstallOnAppQuit = true;
      au.on('update-available', (i) => set({ state: au.autoDownload ? 'downloading' : 'available', latest: i.version, percent: 0 }));
      au.on('update-not-available', () => set({ state: 'none', checkedAt: Date.now() }));
      au.on('download-progress', (p) => set({ state: 'downloading', percent: Math.round(p.percent || 0) }));
      au.on('update-downloaded', (i) => {
        writePending(i.version);
        if (installOnReady) {
          installOnReady = false;
          set({ state: 'installing', latest: i.version });
          setTimeout(() => hooks.autoInstall(), 2500);   // экран «Обновляю…» и тихая установка
          return;
        }
        set({ state: 'ready', latest: i.version, checkedAt: Date.now() });
        hooks.ready(i.version);
      });
      au.on('error', (e) => set({ state: 'error', error: String(e?.message || e).slice(0, 200) }));
    } catch {
      au = null; // нет electron-updater — работаем через проверку релиза
    }
  }
  setTimeout(check, installOnReady ? 1500 : 15000);
  clearInterval(timer);
  timer = setInterval(check, CHECK_EVERY);
}

module.exports = {
  init,
  check,
  state: () => { const { asset, ...st } = state; return { ...st, auto: canAuto() || canMac(), repo: repo ? `${repo.owner}/${repo.repo}` : '' }; },
  download: () => {
    if (au && state.state === 'available') au.downloadUpdate();
    else if (canMac() && state.state === 'available' && state.asset) macDownload(state.latest, state.asset);
    else if (state.url) shell.openExternal(state.url);
  },
  install: () => {
    // true, true — тихо (без окна установщика) и сразу открыть новый Lumen
    if (au && (state.state === 'ready' || state.state === 'installing')) au.quitAndInstall(true, true);
    else if (process.platform === 'darwin' && (state.state === 'ready' || state.state === 'installing')) macInstall();
  },
  releasesUrl: () => (repo ? `https://github.com/${repo.owner}/${repo.repo}/releases` : ''),
};
