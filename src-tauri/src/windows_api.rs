// MIT License - Copyright (c) 2026 ScreenPrompt Contributors
// Windows API integration: capture exclusion, click-through, opacity, cursor

use tauri::WebviewWindow;
use windows::Win32::Foundation::{HINSTANCE, HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::UI::Shell::{DefSubclassProc, SetWindowSubclass};
use windows::Win32::UI::WindowsAndMessaging::{
    GetWindowLongPtrW, LoadCursorW, SetCursor, SetWindowLongPtrW, SetLayeredWindowAttributes,
    ShowWindow, GWL_EXSTYLE, HTBOTTOMRIGHT, HTLEFT, IDC_ARROW, LWA_ALPHA, SW_SHOWNOACTIVATE,
    WM_SETCURSOR, WS_EX_LAYERED, WS_EX_TRANSPARENT,
};

// Identifies keep_arrow_cursor's subclass among the window's others
const ARROW_CURSOR_SUBCLASS: usize = 0x5350_4152;

// Windows 10 Display Affinity constants
const WDA_NONE: u32 = 0x00000000;
const WDA_EXCLUDEFROMCAPTURE: u32 = 0x00000011;

// External Windows API functions
#[link(name = "user32")]
extern "system" {
    fn SetWindowDisplayAffinity(hwnd: HWND, affinity: u32) -> i32;
}

/// Apply WDA_EXCLUDEFROMCAPTURE to hide window from screen capture
///
/// Three steps:
/// 1. Add WS_EX_LAYERED extended style
/// 2. Call SetLayeredWindowAttributes (makes it compatible with affinity)
/// 3. Call SetWindowDisplayAffinity
///
/// Reference: https://learn.microsoft.com/en-us/answers/questions/700122/setwindowdisplayaffinity-on-windows-11
pub fn apply_capture_exclusion(window: WebviewWindow) -> Result<(), String> {
    unsafe {
        // Get the window handle
        let hwnd_val = window.hwnd().map_err(|e| format!("Failed to get HWND: {}", e))?.0;
        let hwnd = HWND(hwnd_val as *mut core::ffi::c_void);

        // Step 1: Get current extended style and add WS_EX_LAYERED
        let ex_style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        SetWindowLongPtrW(hwnd, GWL_EXSTYLE, ex_style | WS_EX_LAYERED.0 as isize);

        // Step 2: Set layered attributes (255 = fully opaque, LWA_ALPHA mode)
        // This makes it a "SetLayeredWindowAttributes window" which is
        // compatible with SetWindowDisplayAffinity (unlike UpdateLayeredWindow)
        let result = SetLayeredWindowAttributes(hwnd, windows::Win32::Foundation::COLORREF(0), 255, LWA_ALPHA);
        if result.is_err() {
            return Err("SetLayeredWindowAttributes failed".to_string());
        }

        // Step 3: Now apply capture exclusion
        let affinity_result = SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE);
        if affinity_result == 0 {
            return Err("SetWindowDisplayAffinity failed - requires Windows 10 Build 2004+".to_string());
        }

        Ok(())
    }
}

/// Show the window without activating it, so the app in front keeps focus and
/// the taskbar doesn't change (its button would dim, then light up again).
/// Bypasses Tauri, whose show() activates: only for short-lived windows (the
/// snip window), as Tauri no longer knows it's visible.
pub fn show_without_focus(window: &WebviewWindow) -> Result<(), String> {
    let hwnd_val = window.hwnd().map_err(|e| format!("Failed to get HWND: {}", e))?.0;
    let hwnd = HWND(hwnd_val as *mut core::ffi::c_void);
    // The return value is whether it was visible before, not success
    let _ = unsafe { ShowWindow(hwnd, SW_SHOWNOACTIVATE) };
    Ok(())
}

/// Keep the plain arrow cursor over the window's edges too. Being undecorated,
/// Tauri gives it invisible resize borders (a child window), which would show
/// the resize arrows; resizing by dragging them still works. Inside the window
/// the webview sets the cursor, and CSS keeps that the arrow (index.css).
/// Must run on the thread that owns the window (the main thread).
pub fn keep_arrow_cursor(window: &WebviewWindow) -> Result<(), String> {
    let hwnd_val = window.hwnd().map_err(|e| format!("Failed to get HWND: {}", e))?.0;
    let hwnd = HWND(hwnd_val as *mut core::ffi::c_void);
    if unsafe { SetWindowSubclass(hwnd, Some(arrow_cursor_proc), ARROW_CURSOR_SUBCLASS, 0) }.as_bool() {
        Ok(())
    } else {
        Err("SetWindowSubclass failed".to_string())
    }
}

// The resize borders don't set a cursor themselves: Windows asks their parent
// (this window) first, and the arrow set here ends it
unsafe extern "system" fn arrow_cursor_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    _id: usize,
    _data: usize,
) -> LRESULT {
    if msg == WM_SETCURSOR {
        // Low word: where the cursor is. HTLEFT..=HTBOTTOMRIGHT are the edges and corners.
        let hit = (lparam.0 as u32) & 0xFFFF;
        if (HTLEFT..=HTBOTTOMRIGHT).contains(&hit) {
            if let Ok(arrow) = LoadCursorW(HINSTANCE::default(), IDC_ARROW) {
                SetCursor(arrow);
            }
            return LRESULT(1);
        }
    }
    DefSubclassProc(hwnd, msg, wparam, lparam)
}

/// Show the window in screen capture again (visible = true), or hide it as at
/// startup (Settings › Hide from screen capture)
pub fn set_capture_visible(window: WebviewWindow, visible: bool) -> Result<(), String> {
    let hwnd_val = window.hwnd().map_err(|e| format!("Failed to get HWND: {}", e))?.0;
    let hwnd = HWND(hwnd_val as *mut core::ffi::c_void);
    let affinity = if visible { WDA_NONE } else { WDA_EXCLUDEFROMCAPTURE };
    if unsafe { SetWindowDisplayAffinity(hwnd, affinity) } == 0 {
        return Err("SetWindowDisplayAffinity failed".to_string());
    }
    Ok(())
}

/// Toggle click-through (mouse pass-through) mode
///
/// When enabled, clicks pass through the window to apps beneath.
/// Uses both WS_EX_TRANSPARENT (outer window) and Tauri's
/// set_ignore_cursor_events (WebView2 child) so the entire
/// window becomes truly click-through.
pub fn set_click_through(window: WebviewWindow, enabled: bool) -> Result<(), String> {
    unsafe {
        let hwnd_val = window.hwnd().map_err(|e| format!("Failed to get HWND: {}", e))?.0;
        let hwnd = HWND(hwnd_val as *mut core::ffi::c_void);

        let ex_style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);

        if enabled {
            SetWindowLongPtrW(hwnd, GWL_EXSTYLE, ex_style | WS_EX_TRANSPARENT.0 as isize);
        } else {
            SetWindowLongPtrW(hwnd, GWL_EXSTYLE, ex_style & !(WS_EX_TRANSPARENT.0 as isize));
        }
    }

    // Also tell the WebView2 child to ignore/accept cursor events
    window
        .set_ignore_cursor_events(enabled)
        .map_err(|e| format!("set_ignore_cursor_events failed: {}", e))?;

    Ok(())
}
