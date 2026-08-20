import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // Split vendor code by library instead of one large chunk, so a code
    // change no longer invalidates the browser's cached copy of MUI or Leaflet.
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          mui: ['@mui/material', '@mui/icons-material', '@emotion/react', '@emotion/styled'],
          maps: ['leaflet', 'react-leaflet'],
          realtime: ['socket.io-client'],
        },
      },
    },
    chunkSizeWarningLimit: 600,
    sourcemap: false,
  },
  optimizeDeps: {
    include: ['react-dom', 'react-leaflet', '@react-leaflet/core', 'leaflet']
  }
})


