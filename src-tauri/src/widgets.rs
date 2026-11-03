//! Desktop widgets: small borderless windows that show a box or page on the desktop, plus the tray icon and
//! background mode that keep them there when the main window is closed. The UI decides *what* to show
//! (`src/widgets/`); this file only makes the windows, after checking the request (`guard.rs`).

#[cfg(desktop)]
mod desktop {
    use std::sync::atomic::{AtomicBool, Ordering};

    use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindowBuilder};

    use crate::guard::{check_widget, check_widget_label, clamp_size, WIDGET_MIN};

    /// Whether closing the main window hides it (keeping widgets and the tray alive) instead of quitting.
    #[derive(Default)]
    pub struct Background {
        keep_running: AtomicBool,
        /// This run was started at login, with no window asked for.
        started_hidden: AtomicBool,
    }

    impl Background {
        pub fn keep_running(&self) -> bool {
            self.keep_running.load(Ordering::Relaxed)
        }
        pub fn set_started_hidden(&self, v: bool) {
            self.started_hidden.store(v, Ordering::Relaxed);
        }
    }

    #[tauri::command]
    pub fn widget_open(
        app: AppHandle,
        id: String,
        page_id: String,
        block_id: Option<String>,
        x: Option<f64>,
        y: Option<f64>,
        w: f64,
        h: f64,
        bottom: bool,
    ) -> Result<(), String> {
        check_widget(&id, &page_id, block_id.as_deref())?;
        if let Some(existing) = app.get_webview_window(&id) {
            let _ = existing.show();
            return Ok(());
        }
        let (w, h) = clamp_size(w, h);
        let query = match &block_id {
            Some(b) => format!("index.html?widget={page_id}&block={b}"),
            None => format!("index.html?widget={page_id}"),
        };
        let mut builder = WebviewWindowBuilder::new(&app, &id, WebviewUrl::App(query.into()))
            .title("Canvas Notes widget")
            .inner_size(w, h)
            .min_inner_size(WIDGET_MIN.0, WIDGET_MIN.1)
            .decorations(false)
            .skip_taskbar(true)
            .resizable(true)
            .always_on_bottom(bottom)
            .always_on_top(!bottom)
            .visible_on_all_workspaces(true);
        if let (Some(x), Some(y)) = (x, y) {
            if x.is_finite() && y.is_finite() {
                builder = builder.position(x, y);
            }
        }
        builder.build().map(|_| ()).map_err(|e| e.to_string())
    }

    /// Behind other windows (like part of the desktop) or floating above them.
    #[tauri::command]
    pub fn widget_set_layer(app: AppHandle, id: String, bottom: bool) -> Result<(), String> {
        check_widget_label(&id)?;
        let win = app.get_webview_window(&id).ok_or("That widget isn't open.")?;
        // Clear the other layer first so the two never fight.
        if bottom {
            win.set_always_on_top(false).map_err(|e| e.to_string())?;
            win.set_always_on_bottom(true).map_err(|e| e.to_string())
        } else {
            win.set_always_on_bottom(false).map_err(|e| e.to_string())?;
            win.set_always_on_top(true).map_err(|e| e.to_string())
        }
    }

    /// Sets the inside size (logical pixels). A widget uses this once, to correct for screens where the web view's pixel
    /// ratio differs from the window's scale (fractional scaling on Linux) and for the frame some window managers add.
    #[tauri::command]
    pub fn widget_resize(app: AppHandle, id: String, w: f64, h: f64) -> Result<(), String> {
        check_widget_label(&id)?;
        let (w, h) = clamp_size(w, h);
        let win = app.get_webview_window(&id).ok_or("That widget isn't open.")?;
        win.set_size(tauri::LogicalSize::new(w, h)).map_err(|e| e.to_string())
    }

    #[tauri::command]
    pub fn widget_close(app: AppHandle, id: String) -> Result<(), String> {
        check_widget_label(&id)?;
        if let Some(win) = app.get_webview_window(&id) {
            win.destroy().map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    #[tauri::command]
    pub fn background_set(state: State<'_, Background>, on: bool) {
        state.keep_running.store(on, Ordering::Relaxed);
    }

    #[tauri::command]
    pub fn started_in_background(state: State<'_, Background>) -> bool {
        state.started_hidden.load(Ordering::Relaxed)
    }

    /// Brings the main window forward (from the tray, or when a second copy is started).
    pub fn show_main(app: &AppHandle) {
        if let Some(main) = app.get_webview_window("main") {
            let _ = main.show();
            let _ = main.unminimize();
            let _ = main.set_focus();
        }
    }

    #[tauri::command]
    pub fn main_show(app: AppHandle) {
        show_main(&app);
    }

    /// The tray icon: click it (or choose Open) for the main window, Quit to stop everything including the widgets.
    pub fn build_tray(app: &AppHandle) -> tauri::Result<()> {
        use tauri::menu::{Menu, MenuItem};
        use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

        let open = MenuItem::with_id(app, "open", "Open Canvas Notes", true, None::<&str>)?;
        let quit = MenuItem::with_id(app, "quit", "Quit (closes widgets)", true, None::<&str>)?;
        let menu = Menu::with_items(app, &[&open, &quit])?;
        let mut tray = TrayIconBuilder::with_id("main")
            .tooltip("Canvas Notes")
            .menu(&menu)
            .show_menu_on_left_click(false)
            .on_menu_event(|app, event| match event.id.as_ref() {
                "open" => show_main(app),
                "quit" => app.exit(0),
                _ => {}
            })
            .on_tray_icon_event(|tray, event| {
                if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                    show_main(tray.app_handle());
                }
            });
        if let Some(icon) = app.default_window_icon() {
            tray = tray.icon(icon.clone());
        }
        tray.build(app)?;
        Ok(())
    }
}

#[cfg(desktop)]
pub use desktop::*;

/// Phones have no desktop: the commands exist so the command list is the same, and say so.
#[cfg(mobile)]
mod mobile {
    #[derive(Default)]
    pub struct Background;

    const NO: &str = "Desktop widgets are only on the laptop app.";

    #[tauri::command]
    pub fn widget_open(id: String, page_id: String, block_id: Option<String>, x: Option<f64>, y: Option<f64>, w: f64, h: f64, bottom: bool) -> Result<(), String> {
        let _ = (id, page_id, block_id, x, y, w, h, bottom);
        Err(NO.into())
    }
    #[tauri::command]
    pub fn widget_set_layer(id: String, bottom: bool) -> Result<(), String> {
        let _ = (id, bottom);
        Err(NO.into())
    }
    #[tauri::command]
    pub fn widget_resize(id: String, w: f64, h: f64) -> Result<(), String> {
        let _ = (id, w, h);
        Err(NO.into())
    }
    #[tauri::command]
    pub fn widget_close(id: String) -> Result<(), String> {
        let _ = id;
        Err(NO.into())
    }
    #[tauri::command]
    pub fn background_set(on: bool) {
        let _ = on;
    }
    #[tauri::command]
    pub fn started_in_background() -> bool {
        false
    }
    #[tauri::command]
    pub fn main_show() {}
}
#[cfg(mobile)]
pub use mobile::*;
