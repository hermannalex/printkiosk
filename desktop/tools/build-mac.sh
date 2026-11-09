#!/bin/sh
# Monta o imprime.ai.app (universal: Apple Silicon e Intel). Precisa de Go 1.24 e Python 3.
# Uso: tools/build-mac.sh [pasta-de-saída]   (rode dentro de desktop/)
set -e
OUT="${1:-dist}"
APP="$OUT/imprime.ai.app"
VERSION=$(sed -n 's/^const appVersion = "\(.*\)"/\1/p' app.go)
rm -rf "$APP" && mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
GOOS=darwin GOARCH=arm64 go build -trimpath -ldflags "-s -w" -o "$OUT/imprime-arm64" .
GOOS=darwin GOARCH=amd64 go build -trimpath -ldflags "-s -w" -o "$OUT/imprime-amd64" .
python3 tools/lipo.py "$APP/Contents/MacOS/imprime" "$OUT/imprime-arm64" "$OUT/imprime-amd64"
rm "$OUT/imprime-arm64" "$OUT/imprime-amd64"
chmod +x "$APP/Contents/MacOS/imprime"
cp tools/imprime.icns "$APP/Contents/Resources/imprime.icns"
cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>imprime.ai</string>
  <key>CFBundleDisplayName</key><string>imprime.ai</string>
  <key>CFBundleIdentifier</key><string>br.com.somainfo.quioco.mac</string>
  <key>CFBundleExecutable</key><string>imprime</string>
  <key>CFBundleIconFile</key><string>imprime</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$VERSION</string>
  <key>CFBundleVersion</key><string>$VERSION</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
  <key>LSUIElement</key><true/>
  <key>NSHumanReadableCopyright</key><string>Soma Informática</string>
</dict></plist>
PLIST
echo "$APP"
