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
          // Both map libraries get their own chunks. SmartLocationMap
          // lazy-imports whichever one the runtime config selects, so a user
          // downloads one mapping library, not two.
          maps: ['leaflet', 'react-leaflet'],
          gmaps: ['@react-google-maps/api'],
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


