import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react()
  ],
  server: {
    port: 5174,
  },
  // Ensure a single React/react-dom copy and force these into the dep
  // pre-bundle so named exports like createPortal resolve reliably.
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
  build: {
    // Split vendor code by library rather than shipping one enormous chunk.
    // These are cached independently, so a code change no longer invalidates
    // the user's copy of MUI or Leaflet.
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          mui: ['@mui/material', '@mui/icons-material', '@emotion/react', '@emotion/styled'],
          maps: ['leaflet', 'react-leaflet'],
          charts: ['recharts'],
          realtime: ['socket.io-client'],
        },
      },
    },
    // Fail loudly if a chunk creeps back over budget.
    chunkSizeWarningLimit: 600,
    sourcemap: false,
  },
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'react-dom/client',
      '@mui/material',
      '@emotion/react',
      '@emotion/styled',
      'react-leaflet',
      '@react-leaflet/core',
      'leaflet',
    ],
  },
})


