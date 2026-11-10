#!/bin/sh
# SPEED CLUB - Android upload key on macOS or Linux, the twin of step 7 of setup-windows.ps1.
#
#   sh scripts/setup-signing.sh
#
# Creates the keystore outside the repo, in ~/speedclub-secrets, and writes the signing lines to ~/.gradle/gradle.properties.
# The password is generated here and never printed. The one thing printed is the certificate's SHA-256, which is public: it goes
# into ANDROID_CERT_SHA256 and docs/RELEASES.md.
#
# It refuses to run when a key exists. Replacing an upload key changes the app's identity, so that has to be a deliberate act.
set -eu
umask 077

SECRETS="$HOME/speedclub-secrets"
KEYSTORE="$SECRETS/speedclub-upload.keystore"
NOTE="$SECRETS/keystore-password.txt"
GRADLE_DIR="$HOME/.gradle"
GRADLE_PROPS="$GRADLE_DIR/gradle.properties"
ALIAS=speedclub
DNAME='CN=SPEED CLUB, OU=Mobile, O=SPEED CLUB, L=Berlin, ST=Berlin, C=DE'

fail() {
  echo "[FAIL] $1" >&2
  exit 1
}

# macOS has a stub at /usr/bin/keytool that only asks for a JDK, so a real one goes first.
KEYTOOL=
for candidate in "${JAVA_HOME:-}/bin/keytool" /opt/homebrew/opt/openjdk@17/bin/keytool /usr/local/opt/openjdk@17/bin/keytool; do
  if [ -x "$candidate" ]; then
    KEYTOOL=$candidate
    break
  fi
done
[ -n "$KEYTOOL" ] || KEYTOOL=$(command -v keytool) || fail 'keytool not found: install a JDK 17 (brew install openjdk@17)'
command -v openssl >/dev/null || fail 'openssl not found'

[ ! -e "$KEYSTORE" ] || fail "A keystore already exists: $KEYSTORE. Not replaced: a new key changes the app's identity. Move it away first if you really mean to."
# -q prints nothing, so the passwords in this file stay out of every log.
if [ -f "$GRADLE_PROPS" ] && grep -q '^SPEEDCLUB_UPLOAD_' "$GRADLE_PROPS"; then
  fail "$GRADLE_PROPS already has SPEEDCLUB_UPLOAD_ lines. Not replaced."
fi

mkdir -p "$SECRETS" "$GRADLE_DIR"
chmod 700 "$SECRETS"

# Hex, so nothing in it means anything to a properties file. PKCS12 takes one password for the store and the key.
SC_KEYSTORE_PASSWORD=$(openssl rand -hex 24)
export SC_KEYSTORE_PASSWORD

"$KEYTOOL" -genkeypair -storetype PKCS12 -keystore "$KEYSTORE" -alias "$ALIAS" \
  -keyalg RSA -keysize 2048 -validity 10000 -dname "$DNAME" \
  -storepass:env SC_KEYSTORE_PASSWORD -keypass:env SC_KEYSTORE_PASSWORD 2>/dev/null \
  || fail 'keytool could not create the keystore'
chmod 600 "$KEYSTORE"

{
  echo "SPEEDCLUB_UPLOAD_STORE_FILE=$KEYSTORE"
  echo "SPEEDCLUB_UPLOAD_STORE_PASSWORD=$SC_KEYSTORE_PASSWORD"
  echo "SPEEDCLUB_UPLOAD_KEY_ALIAS=$ALIAS"
  echo "SPEEDCLUB_UPLOAD_KEY_PASSWORD=$SC_KEYSTORE_PASSWORD"
} >>"$GRADLE_PROPS"
chmod 600 "$GRADLE_PROPS"

cat >"$NOTE" <<EOF
SPEED CLUB - Android upload keystore
====================================
Keystore : $KEYSTORE
Alias    : $ALIAS
Password : $SC_KEYSTORE_PASSWORD   (store password = key password, PKCS12)
Created  : $(date '+%Y-%m-%d %H:%M')

BACK UP THIS FOLDER AND PASSWORD NOW (password manager + offline copy).
Without them, future updates cannot be signed as the same app.
EOF
chmod 600 "$NOTE"

SHA256=$("$KEYTOOL" -list -v -keystore "$KEYSTORE" -alias "$ALIAS" -storepass:env SC_KEYSTORE_PASSWORD 2>/dev/null | sed -n 's/^[[:space:]]*SHA256: //p')
unset SC_KEYSTORE_PASSWORD
[ -n "$SHA256" ] || fail 'The keystore was written, but its certificate could not be read back.'

echo "[OK] Upload key created: $KEYSTORE"
echo "[OK] Signing lines written: $GRADLE_PROPS"
echo "[OK] Signer: $DNAME"
echo "[OK] Certificate SHA-256 (public): $SHA256"
echo "Back up $SECRETS (password manager + offline copy)."
