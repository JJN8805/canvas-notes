//! Canvas Notes has little Rust of its own: the UI talks to SQLite and the
//! file system through the official Tauri plugins, limited by
//! `capabilities/`. The custom code is the Wi-Fi sync transport (`sync.rs`),
//! the checks around it (`guard.rs`), desktop widgets with the tray (`widgets.rs`) and the network side of the
//! optional AI add-on (`ai.rs`).

mod ai;
mod guard;
mod sync;
mod widgets;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();

    // A second copy (say, started from the menu while the login copy runs in the tray) just shows the first one's window.
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| widgets::show_main(app)));

    // "Start at login" starts the app with --background: no window, just the widgets and the tray icon.
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_autostart::init(
        tauri_plugin_autostart::MacosLauncher::LaunchAgent,
        Some(vec!["--background"]),
    ));

    let builder = builder
        // SQLite database at <app config dir>/canvas-notes.db (schema is created by the UI).
        .plugin(tauri_plugin_sql::Builder::default().build())
        // Image files at <app config dir>/images/.
        .plugin(tauri_plugin_fs::init())
        // Save dialogs for exporting pages.
        .plugin(tauri_plugin_dialog::init())
        .manage(sync::SyncState::default())
        .manage(widgets::Background::default())
        .manage(ai::AiState::default())
        .invoke_handler(tauri::generate_handler![
            sync::sync_platform,
            sync::sync_client_request,
            sync::sync_server_start,
            sync::sync_server_stop,
            sync::sync_server_reply,
            sync::sync_local_addresses,
            ai::ai_request,
            ai::ai_cancel,
            ai::ai_key_set,
            ai::ai_key_has,
            ai::ai_key_clear,
            widgets::widget_open,
            widgets::widget_set_layer,
            widgets::widget_resize,
            widgets::widget_close,
            widgets::background_set,
            widgets::started_in_background,
            widgets::main_show,
        ]);

    #[cfg(desktop)]
    let builder = builder
        .setup(|app| {
            use tauri::Manager;
            let hidden = std::env::args().any(|a| a == "--background");
            app.state::<widgets::Background>().set_started_hidden(hidden);
            widgets::build_tray(app.handle())?;
            if !hidden {
                if let Some(main) = app.get_webview_window("main") {
                    main.show()?;
                }
            }
            Ok(())
        })
        // Closing the main window hides it, instead of quitting, while widgets are open or background mode is on.
        .on_window_event(|window, event| {
            use tauri::Manager;
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() != "main" {
                    return;
                }
                let app = window.app_handle();
                let keep = app.state::<widgets::Background>().keep_running() || app.webview_windows().len() > 1;
                if keep {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        });

    builder.run(tauri::generate_context!()).expect("error while running Canvas Notes");
}
