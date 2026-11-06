#!/bin/bash
# Запуск Lumen на Mac: сам скачает Node.js и всё поставит.
cd "$(dirname "$0")"
N="$HOME/.lumen/node"
export PATH="$PWD/runtime/node/bin:$N/bin:$PATH"
need=1
if command -v node >/dev/null 2>&1 && [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 18 ]; then need=0; fi
if [ $need = 1 ]; then
  echo "Скачиваю Node.js, это один раз..."
  arch=$(uname -m); [ "$arch" = "arm64" ] || arch=x64
  v=$(curl -fsSL https://nodejs.org/dist/index.json | grep -o '"version":"v22[^"]*"' | head -1 | cut -d'"' -f4)
  mkdir -p "$HOME/.lumen" && curl -fL "https://nodejs.org/dist/$v/node-$v-darwin-$arch.tar.gz" | tar xz -C "$HOME/.lumen" || { echo "Не получилось скачать Node.js"; read; exit 1; }
  rm -rf "$N" && mv "$HOME/.lumen/node-$v-darwin-$arch" "$N"
fi
[ -d node_modules/electron/dist ] || npm install --no-audit --no-fund || { echo "Ошибка установки"; read; exit 1; }
nohup npm start >/dev/null 2>&1 &
