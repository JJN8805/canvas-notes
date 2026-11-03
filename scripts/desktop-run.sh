#!/bin/bash
# Runs the built desktop app (src-tauri/target/debug/canvas-notes) against a throwaway data folder, so testing never
# touches your real notes. Needs `npm run dev` running and `cargo build` in src-tauri done.
#   scripts/desktop-run.sh              normal start
#   scripts/desktop-run.sh --background started at login: no main window, just widgets and the tray
# Data goes to .desktop-profile/ (git-ignored); delete it to start fresh. Snap-packaged editors set library paths that
# break GTK apps, so those are cleared. GDK_BACKEND=x11 lets xdotool/xwininfo inspect the windows.
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROFILE="$ROOT/.desktop-profile"
mkdir -p "$PROFILE/config" "$PROFILE/data"
exec env -u LD_LIBRARY_PATH -u GTK_PATH -u GTK_EXE_PREFIX -u GIO_MODULE_DIR -u GDK_PIXBUF_MODULE_FILE -u GTK_IM_MODULE_FILE \
  XDG_CONFIG_HOME="$PROFILE/config" XDG_DATA_HOME="$PROFILE/data" GDK_BACKEND=x11 \
  "$ROOT/src-tauri/target/debug/canvas-notes" "$@"
