import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import mkcert from 'vite-plugin-mkcert'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), mkcert()],
  server: {
    host: "0.0.0.0",
    port: 8686,
    strictPort: true,
    https: true,
    proxy: {
      "/offer": {
        target: process.env.VITE_PROXY_TARGET || "http://localhost:8787",
        changeOrigin: true,
        secure: false
      }
    },
    watch: {
      usePolling: true,
      interval: 100
    }
  }
})
