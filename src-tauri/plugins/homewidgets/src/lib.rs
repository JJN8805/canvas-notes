//! Home screen widgets (Android only). All the work is in the Kotlin half (`android/`): the widgets run while the app is closed,
//! keeping a small snapshot of lists and pages in the app's private storage and queueing what the person does until the app applies it.
//! On other systems the plugin registers nothing, so its commands simply do not exist.

use tauri::{
    plugin::{Builder, TauriPlugin},
    Runtime,
};

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("homewidgets")
        .setup(|_app, _api| {
            #[cfg(target_os = "android")]
            _api.register_android_plugin("dev.jjn8805.canvasnotes.widgets", "HomeWidgetsPlugin")?;
            Ok(())
        })
        .build()
}
