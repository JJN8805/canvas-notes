// The commands are Kotlin methods of `HomeWidgetsPlugin` (android/). Listing them here generates their permissions.
const COMMANDS: &[&str] = &["publish", "pending", "ack", "status", "pin"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).android_path("android").build();
}
