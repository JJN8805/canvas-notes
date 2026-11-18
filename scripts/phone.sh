#!/usr/bin/env bash
# The development app on your phone, kept in step with this project.
#
#   scripts/phone.sh            build the current code, install it over the old copy (your notes on the phone stay), open it
#   scripts/phone.sh build      only build the APK
#   scripts/phone.sh live       run with live reload: edits to the code show on the phone at once (laptop and phone on the same Wi-Fi)
#   scripts/phone.sh devices    list the phones adb can see
#   scripts/phone.sh connect IP:PORT   connect a phone over Wi-Fi (Developer options -> Wireless debugging)
#
# Several phones: set ANDROID_SERIAL=<serial from `devices`>.
# Notes: the app is installed with `adb install -r`, which keeps its data, so what you stored (and the sync pairing) survives every update.
# Uninstalling the app wipes the phone's copy; with sync on, the laptop still has everything and the phone fills up again on the next sync.
set -euo pipefail
cd "$(dirname "$0")/.."

APP_ID="dev.jjn8805.canvasnotes"
export JAVA_HOME="${JAVA_HOME:-/snap/android-studio/current/jbr}"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Android/Sdk}"
if [ -z "${NDK_HOME:-}" ] && [ -d "$ANDROID_HOME/ndk" ]; then
  export NDK_HOME="$ANDROID_HOME/ndk/$(ls -1 "$ANDROID_HOME/ndk" | sort -V | tail -1)"
fi
ADB="$ANDROID_HOME/platform-tools/adb"

die() { echo "phone: $*" >&2; exit 1; }
[ -x "$ADB" ] || die "adb not found at $ADB. Install the Android SDK Platform-Tools (see README, 'Phone setup')."
[ -d "$JAVA_HOME" ] || die "JAVA_HOME ($JAVA_HOME) does not exist. See README, 'Phone setup', step 3."
[ -n "${NDK_HOME:-}" ] && [ -d "$NDK_HOME" ] || die "the Android NDK was not found under $ANDROID_HOME/ndk. See README, 'Phone setup', step 2."
[ -d src-tauri/gen/android ] || die "the Android project does not exist yet: run 'npm run android:init' once."

# Which phone: ANDROID_SERIAL, or the only one connected.
pick_device() {
  if [ -n "${ANDROID_SERIAL:-}" ]; then echo "$ANDROID_SERIAL"; return; fi
  local list n
  list="$("$ADB" devices | awk 'NR>1 && $2=="device" {print $1}')"
  n="$(printf '%s\n' "$list" | grep -c . || true)"
  [ "$n" -ge 1 ] || die "no phone found. Plug it in with USB debugging on (README, 'Phone setup', step 5), or run: scripts/phone.sh connect IP:PORT"
  [ "$n" -eq 1 ] || die "several phones are connected ($(echo $list)). Pick one: ANDROID_SERIAL=<serial> scripts/phone.sh"
  echo "$list"
}

# Rust target for the phone's processor, so only that one is compiled.
target_for() {
  case "$("$ADB" -s "$1" shell getprop ro.product.cpu.abi | tr -d '\r')" in
    arm64-v8a) echo aarch64 ;;
    armeabi-v7a) echo armv7 ;;
    x86_64) echo x86_64 ;;
    x86) echo i686 ;;
    *) echo "" ;;
  esac
}

build_apk() {
  local target="${1:-}"
  local args=(android build --apk --debug)
  [ -n "$target" ] && args+=(--target "$target")
  echo "phone: building the app (first time takes a while; Gradle likes memory, close big apps)..."
  npx tauri "${args[@]}"
}

newest_apk() {
  find src-tauri/gen/android/app/build/outputs/apk -name '*.apk' -printf '%T@ %p\n' 2>/dev/null | sort -n | tail -1 | cut -d' ' -f2-
}

sync_hint() {
  local ip
  ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
  cat <<EOF

phone: done. To keep the phone's notes in step with this laptop:
  1. On the laptop (npm run desktop): Sync -> turn on "Let my phone sync with this laptop".  Address: ${ip:-<this laptop's IP>}  (it shows the pairing code)
  2. On the phone: Sync -> enter the address and the code -> Connect (once; it is remembered across updates).
  The laptop app must be open, both on the same Wi-Fi. If it cannot connect: sudo ufw allow 47821/tcp
Run 'scripts/phone.sh' again after any change to put the update on the phone; the notes on the phone are kept.
EOF
}

cmd="${1:-install}"
case "$cmd" in
  devices)
    "$ADB" devices -l
    ;;
  connect)
    [ -n "${2:-}" ] || die "usage: scripts/phone.sh connect IP:PORT (shown on the phone under Wireless debugging)"
    "$ADB" connect "$2"
    ;;
  build)
    build_apk "$(target_for "$(pick_device)" 2>/dev/null || true)"
    echo "phone: APK: $(newest_apk)"
    ;;
  install)
    serial="$(pick_device)"
    target="$(target_for "$serial")"
    build_apk "$target"
    apk="$(newest_apk)"
    [ -n "$apk" ] || die "the build finished but no APK was found."
    echo "phone: installing $apk on $serial (keeping the app's data)..."
    if ! out="$("$ADB" -s "$serial" install -r -d "$apk" 2>&1)"; then
      echo "$out" >&2
      if echo "$out" | grep -q "INSTALL_FAILED_UPDATE_INCOMPATIBLE\|signatures do not match"; then
        die "the copy on the phone was signed with a different key. Sync first, then uninstall it on the phone (its notes come back from the laptop on the next sync) and run this again."
      fi
      die "the install failed."
    fi
    echo "$out" | tail -1
    "$ADB" -s "$serial" shell monkey -p "$APP_ID" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1 || true
    sync_hint
    ;;
  live)
    pick_device >/dev/null
    echo "phone: live mode. The phone loads the app from this laptop (same Wi-Fi), so edits to the code show up on it as you save. Ctrl+C stops it."
    echo "phone: its notes are the phone app's own and sync with the laptop like the installed copy."
    exec npx tauri android dev
    ;;
  *)
    sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'
    exit 2
    ;;
esac
