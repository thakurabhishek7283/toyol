// Screenshots of a screen region, for questions about what's on screen. Taken
// in Rust (screen_capture.rs) through the desktop compositor, which leaves out
// windows excluded from capture: the panel itself is never in the picture.

import { invoke } from '@tauri-apps/api/core';

/** A screen area in physical px, virtual-screen coordinates (as window positions are) */
export interface ScreenRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Long enough an edge to read screen text, short enough to stay quick (vision
// models scale larger images down anyway)
const MAX_IMAGE_EDGE = 2000;
const JPEG_QUALITY = 0.9;
const HEADER_BYTES = 8;

/** A screenshot of `rect`, as a JPEG data URL for the AI service */
export async function captureRegion(rect: ScreenRect): Promise<string> {
  const buffer = await invoke<ArrayBuffer>('capture_screen', {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  });
  // 8-byte header (width, height), then BGRA rows
  const header = new DataView(buffer, 0, HEADER_BYTES);
  const width = header.getUint32(0, true);
  const height = header.getUint32(4, true);
  const bgra = new Uint8Array(buffer, HEADER_BYTES, width * height * 4);
  const rgba = new Uint8ClampedArray(bgra.length);
  for (let i = 0; i < bgra.length; i += 4) {
    rgba[i] = bgra[i + 2];
    rgba[i + 1] = bgra[i + 1];
    rgba[i + 2] = bgra[i];
    rgba[i + 3] = 255; // GDI leaves alpha 0
  }

  const bitmap = await createImageBitmap(new ImageData(rgba, width, height));
  const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas is not available');
  context.imageSmoothingQuality = 'high';
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL('image/jpeg', JPEG_QUALITY);
}
