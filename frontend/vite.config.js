import path from "path"
import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(),
    tailwindcss()
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: parseInt(process.env.FRONTEND_PORT || "5173"),
    proxy: {
      "/api": `http://localhost:${process.env.API_PORT || "8000"}`,
    },
  },
  build: {
    outDir: "../compiler/static",
    emptyOutDir: true,
  },
})
