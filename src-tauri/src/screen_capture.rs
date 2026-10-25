// MIT License - Copyright (c) 2026 ScreenPrompt Contributors
// Screenshots of a screen region, for questions asked about the screen

use windows::Win32::Foundation::HWND;
use windows::Win32::Graphics::Gdi::{
    BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC, GetDIBits,
    ReleaseDC, SelectObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HGDIOBJ, SRCCOPY,
};

// Larger than any real screen area (8K is 7680 x 4320); guards the allocation
const MAX_SIDE: i32 = 16384;

/// The pixels of a screen area (physical px, virtual-screen coordinates), as an
/// 8-byte header (width, height: u32 little-endian) then top-down BGRA rows.
///
/// Reads the desktop through DWM, which leaves out windows excluded from capture,
/// so the overlay itself is never in the picture: it shows what's behind it.
pub fn capture(x: i32, y: i32, width: i32, height: i32) -> Result<Vec<u8>, String> {
    if width <= 0 || height <= 0 || width > MAX_SIDE || height > MAX_SIDE {
        return Err(format!("Invalid capture size {}x{}", width, height));
    }

    let header_len = 8;
    let pixels_len = width as usize * height as usize * 4;
    let mut out = vec![0u8; header_len + pixels_len];
    out[0..4].copy_from_slice(&(width as u32).to_le_bytes());
    out[4..8].copy_from_slice(&(height as u32).to_le_bytes());

    unsafe {
        let screen = GetDC(HWND(std::ptr::null_mut()));
        if screen.is_invalid() {
            return Err("GetDC failed".to_string());
        }
        let memory = CreateCompatibleDC(screen);
        let bitmap = CreateCompatibleBitmap(screen, width, height);
        let previous = SelectObject(memory, HGDIOBJ(bitmap.0));

        // No CAPTUREBLT: it hides the mouse cursor for the copy, so it flickers or
        // vanishes (every few seconds while live). It isn't needed: the desktop
        // compositor already includes other apps' layered windows (menus, tooltips).
        let copied = BitBlt(memory, 0, 0, width, height, screen, x, y, SRCCOPY);

        let mut info = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: width,
                biHeight: -height, // negative: rows top-down
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                ..Default::default()
            },
            ..Default::default()
        };
        // The bitmap must not be selected into a DC while GetDIBits reads it
        SelectObject(memory, previous);
        let lines = if copied.is_ok() {
            GetDIBits(
                memory,
                bitmap,
                0,
                height as u32,
                Some(out[header_len..].as_mut_ptr() as *mut core::ffi::c_void),
                &mut info,
                DIB_RGB_COLORS,
            )
        } else {
            0
        };

        let _ = DeleteObject(HGDIOBJ(bitmap.0));
        let _ = DeleteDC(memory);
        ReleaseDC(HWND(std::ptr::null_mut()), screen);

        copied.map_err(|e| format!("BitBlt failed: {}", e))?;
        if lines != height {
            return Err("GetDIBits failed".to_string());
        }
    }

    Ok(out)
}
