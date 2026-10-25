import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Cross-origin isolation lets the speech model's runtime use SharedArrayBuffer,
// so it runs on several threads instead of one (several times faster). The
// packaged app sends the same headers (tauri.conf.json, app.security.headers).
const ISOLATION_HEADERS = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
}

export default defineConfig({
  plugins: [react()],
  // The speech worker's model library is ES-module only (it imports its runtime
  // with import.meta.url), so the worker must be an ES module too
  worker: {
    format: 'es',
  },
  // Don't pre-bundle the model library in dev: pre-bundling moves its code to
  // node_modules/.vite/deps but not the ONNX runtime's .wasm, which its code
  // finds relative to itself, so the runtime would never start
  optimizeDeps: {
    exclude: ['@huggingface/transformers', 'onnxruntime-web'],
  },
  server: {
    // Tauri's dev URL expects this port
    port: 5173,
    strictPort: true,
    headers: ISOLATION_HEADERS,
    watch: {
      // Cargo writes under src-tauri/target while `tauri dev` runs; watching it
      // fails with EBUSY on locked .exe files
      ignored: ['**/src-tauri/**'],
    },
  },
  preview: {
    headers: ISOLATION_HEADERS,
  },
})
