#!/bin/sh
# SPEED CLUB - PowerShell on an Apple Silicon Mac, so that scripts/verify.ps1 and scripts/build-apk.ps1 run here.
#
#   sh scripts/setup-powershell.sh
#
# Needs no password: it installs into ~/.local and touches nothing else. The archive is the official release from GitHub, checked
# against the SHA-256 GitHub publishes for it. Homebrew has no stable cask for it, and its preview cask asks for a password.
set -eu

VERSION=7.6.9
SHA256=a1c7e98ac403da4be5ba75c1c5855af272de7787a91d478c4267466fe58fc1af
URL="https://github.com/PowerShell/PowerShell/releases/download/v$VERSION/powershell-$VERSION-osx-arm64.tar.gz"
TARGET="$HOME/.local/share/powershell/$VERSION"
BIN="$HOME/.local/bin"

fail() {
  echo "[FAIL] $1" >&2
  exit 1
}

[ "$(uname -s)-$(uname -m)" = 'Darwin-arm64' ] || fail "This script is for an Apple Silicon Mac; this is $(uname -s) $(uname -m)."

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

echo "Downloading PowerShell $VERSION ..."
curl -fsSL --retry 3 -o "$WORK/powershell.tar.gz" "$URL" || fail "Download failed: $URL"

GOT=$(shasum -a 256 "$WORK/powershell.tar.gz" | cut -d ' ' -f 1)
[ "$GOT" = "$SHA256" ] || fail "Checksum mismatch: expected $SHA256, got $GOT. Nothing was installed."

mkdir -p "$TARGET" "$BIN"
tar -xzf "$WORK/powershell.tar.gz" -C "$TARGET"
chmod +x "$TARGET/pwsh"
ln -sfn "$TARGET/pwsh" "$BIN/pwsh"
ln -sfn "$TARGET/pwsh" "$BIN/powershell"

echo "[OK] Installed: $("$BIN/powershell" -NoProfile -Command '$PSVersionTable.PSVersion.ToString()')"
echo "[OK] Command: $BIN/powershell"
case ":$PATH:" in
  *":$BIN:"*) ;;
  *) echo "Add this to your shell profile so the command is found: export PATH=\"\$HOME/.local/bin:\$PATH\"" ;;
esac
