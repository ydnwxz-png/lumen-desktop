#!/bin/bash
# Сборка Lumen для Mac прямо на этом MacBook (если GitHub долго не даёт Mac-сборщик).
# Запуск: в Терминале  bash путь/к/build-mac.command
cd "$(dirname "$0")"
N="$HOME/.lumen/node"
export PATH="$PWD/runtime/node/bin:$N/bin:$PATH"
if ! (command -v node >/dev/null 2>&1 && [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 18 ]); then
  echo "Скачиваю Node.js, это один раз..."
  arch=$(uname -m); [ "$arch" = "arm64" ] || arch=x64
  v=$(curl -fsSL https://nodejs.org/dist/index.json | grep -o '"version":"v22[^"]*"' | head -1 | cut -d'"' -f4)
  mkdir -p "$HOME/.lumen" && curl -fL "https://nodejs.org/dist/$v/node-$v-darwin-$arch.tar.gz" | tar xz -C "$HOME/.lumen" || { echo "Не получилось скачать Node.js"; exit 1; }
  rm -rf "$N" && mv "$HOME/.lumen/node-$v-darwin-$arch" "$N"
fi
echo "Ставлю зависимости..."
npm install --no-audit --no-fund || { echo "Ошибка установки"; exit 1; }
echo "Собираю .dmg (5–10 минут)..."
rm -rf dist
CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac --publish never || { echo "Сборка не удалась — скинь скрин этого окна"; exit 1; }
echo ""
echo "Готово! Файлы для загрузки в релиз открыты в Finder (папка dist):"
ls dist/*.dmg dist/*.blockmap dist/latest-mac.yml 2>/dev/null
open dist
