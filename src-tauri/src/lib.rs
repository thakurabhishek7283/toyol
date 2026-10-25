// Window plumbing for the overlay. The Windows-specific modules come from
// ScreenPrompt (MIT); see their headers.

#[cfg(windows)]
mod keyboard_hook;
#[cfg(windows)]
mod mouse_hook;
#[cfg(windows)]
mod screen_capture;
#[cfg(windows)]
mod windows_api;

use tauri::webview::{PermissionKind, PermissionResponse};
use tauri::{Manager, WebviewWindow};

#[cfg(windows)]
const SNIP_WINDOW: &str = "snip";

#[tauri::command]
#[cfg(windows)]
fn set_capture_visible(window: WebviewWindow, visible: bool) -> Result<(), String> {
    windows_api::set_capture_visible(window, visible)
}

#[tauri::command]
#[cfg(windows)]
fn set_click_through(window: WebviewWindow, enabled: bool) -> Result<(), String> {
    windows_api::set_click_through(window, enabled)
}

#[tauri::command]
#[cfg(windows)]
fn install_mouse_hook(window: WebviewWindow) -> Result<(), String> {
    mouse_hook::install_hook(window)
}

#[tauri::command]
#[cfg(windows)]
fn uninstall_mouse_hook() -> Result<(), String> {
    mouse_hook::uninstall_hook()
}

#[tauri::command]
#[cfg(windows)]
fn set_unlock_zone(x: i32, y: i32, width: i32, height: i32) {
    mouse_hook::set_unlock_zone(x, y, width, height)
}

#[tauri::command]
#[cfg(windows)]
fn install_keyboard_hook(app_handle: tauri::AppHandle) -> Result<(), String> {
    keyboard_hook::install_hook(app_handle)
}

#[tauri::command]
#[cfg(windows)]
fn uninstall_keyboard_hook() -> Result<(), String> {
    keyboard_hook::uninstall_hook()
}

/// A screenshot of a screen area: see screen_capture::capture.
/// Binary, so a full screen's pixels don't go through JSON.
#[tauri::command]
#[cfg(windows)]
async fn capture_screen(x: i32, y: i32, width: i32, height: i32) -> Result<tauri::ipc::Response, String> {
    tauri::async_runtime::spawn_blocking(move || screen_capture::capture(x, y, width, height))
        .await
        .map_err(|e| format!("Capture thread failed: {}", e))?
        .map(tauri::ipc::Response::new)
}

/// The snip window: covers the work area (physical px) of the monitor the mouse
/// is on, so a region can be picked there with two clicks (SnipOverlay), which
/// reports it with a "snip" event and closes. Excluded from capture before it's
/// shown, so a screen share never sees it. It never takes focus: the app being
/// snipped stays in front. Esc is a global shortcut while it's open (useSnip).
/// Async: creating a window from a sync command deadlocks on Windows.
#[tauri::command]
#[cfg(windows)]
async fn open_snip_window(app: tauri::AppHandle) -> Result<(), String> {
    if app.get_webview_window(SNIP_WINDOW).is_some() {
        return Ok(());
    }
    let cursor = app.cursor_position().map_err(|e| e.to_string())?;
    let monitor = match app.monitor_from_point(cursor.x, cursor.y).map_err(|e| e.to_string())? {
        Some(monitor) => monitor,
        None => app
            .primary_monitor()
            .map_err(|e| e.to_string())?
            .ok_or("No monitor found")?,
    };
    // The work area, not the whole monitor: a window covering all of it counts as
    // full screen, and Windows dims the taskbar for it
    let area = *monitor.work_area();

    let window = tauri::WebviewWindowBuilder::new(&app, SNIP_WINDOW, tauri::WebviewUrl::App("index.html#snip".into()))
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .shadow(false)
        .focusable(false) // clicks on it don't activate it
        .focused(false)
        .visible(false)
        .build()
        .map_err(|e| format!("Failed to open the snip window: {}", e))?;
    window.set_position(area.position).map_err(|e| e.to_string())?;
    window.set_size(area.size).map_err(|e| e.to_string())?;
    windows_api::apply_capture_exclusion(window.clone())?;
    windows_api::show_without_focus(&window)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        // Voice input records in the webview. Its permission prompt would be a
        // separate window that shows up in screen shares, and the webview only
        // ever loads this app, so allow the microphone without one. It's open
        // only while listening.
        .on_permission_request(|_, kind| match kind {
            PermissionKind::Microphone => PermissionResponse::Allow,
            _ => PermissionResponse::Default,
        })
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            #[cfg(windows)]
            {
                let window = app.get_webview_window("main").unwrap();
                if let Err(e) = windows_api::apply_capture_exclusion(window.clone()) {
                    log::error!("Failed to apply capture exclusion: {}", e);
                }
                if let Err(e) = windows_api::keep_arrow_cursor(&window) {
                    log::error!("Failed to keep the arrow cursor: {}", e);
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            set_capture_visible,
            set_click_through,
            install_mouse_hook,
            uninstall_mouse_hook,
            set_unlock_zone,
            install_keyboard_hook,
            uninstall_keyboard_hook,
            capture_screen,
            open_snip_window,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
