import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Tauri expects the dev server on a fixed port and shows its own output.
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    // Rust files are watched by Tauri itself; don't reload the page for them.
    watch: { ignored: ['**/src-tauri/**'] },
  },
})
