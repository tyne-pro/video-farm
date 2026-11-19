#!/bin/bash
# Installs TyneFarm (the tyne.pro video farm app) on a Mac from the latest release of github.com/tyne-pro/video-farm.
#   curl -fsSL https://raw.githubusercontent.com/tyne-pro/video-farm/main/install.sh | bash
# Running it again updates the app. Data (clips, cache) stays in ~/TyneFarm.
set -euo pipefail
REPO=tyne-pro/video-farm

[ "$(uname -s)" = Darwin ] || { echo "Цей скрипт для macOS. / This script is for macOS."; exit 1; }
[ "$(uname -m)" = arm64 ] || { echo "Поки є версія лише для Mac на Apple Silicon (M1 і новіші). / Apple Silicon Macs only for now."; exit 1; }

URL=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" | grep -o '"browser_download_url": *"[^"]*aarch64\.dmg"' | head -1 | sed 's/.*"\(https[^"]*\)"$/\1/')
[ -n "$URL" ] || { echo "Не знайшов файл для завантаження. / No download found."; exit 1; }

TMP=$(mktemp -d)
cleanup() { hdiutil detach "$TMP/mnt" -quiet 2>/dev/null || true; rm -rf "$TMP"; }
trap cleanup EXIT

echo "==> $URL"
curl -fL --progress-bar "$URL" -o "$TMP/TyneFarm.dmg"
hdiutil attach "$TMP/TyneFarm.dmg" -nobrowse -quiet -mountpoint "$TMP/mnt"

DEST=/Applications
[ -w "$DEST" ] || DEST="$HOME/Applications"
mkdir -p "$DEST"
osascript -e 'quit app "TyneFarm"' >/dev/null 2>&1 || true
sleep 1
rm -rf "$DEST/TyneFarm.app"
cp -R "$TMP/mnt/TyneFarm.app" "$DEST/"

echo "==> Готово / Done: $DEST/TyneFarm.app"
open "$DEST/TyneFarm.app"
