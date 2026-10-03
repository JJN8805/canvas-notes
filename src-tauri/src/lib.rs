//! Canvas Notes has little Rust of its own: the UI talks to SQLite and the
//! file system through the official Tauri plugins, limited by
//! `capabilities/default.json`. The only custom code is the Wi-Fi sync
//! transport in `sync.rs`.

mod sync;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // SQLite database at <app config dir>/canvas-notes.db (schema is created by the UI).
        .plugin(tauri_plugin_sql::Builder::default().build())
        // Image files at <app config dir>/images/.
        .plugin(tauri_plugin_fs::init())
        // Save dialogs for exporting pages.
        .plugin(tauri_plugin_dialog::init())
        .manage(sync::SyncState::default())
        .invoke_handler(tauri::generate_handler![
            sync::sync_platform,
            sync::sync_client_request,
            sync::sync_server_start,
            sync::sync_server_stop,
            sync::sync_server_reply,
            sync::sync_local_addresses,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Canvas Notes");
}
