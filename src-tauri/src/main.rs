// Native macOS window around the web client in ../dist. All data stays in the
// app's own WebView storage (IndexedDB), as in the browser version.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running Nodeboard");
}
