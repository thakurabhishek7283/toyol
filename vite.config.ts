import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    // Tauri's dev URL expects this port
    port: 5173,
    strictPort: true,
    watch: {
      // Cargo writes under src-tauri/target while `tauri dev` runs; watching it
      // fails with EBUSY on locked .exe files
      ignored: ['**/src-tauri/**'],
    },
  },
})
