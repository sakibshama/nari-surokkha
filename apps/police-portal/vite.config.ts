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
        // rolldown (Vite 8's bundler) requires manualChunks to be a FUNCTION —
        // the object form Rollup accepted fails the build with "manualChunks
        // is not a function".
        //
        // Only EAGER vendors are grouped here, and that restriction is the
        // whole point. Forcing a lazily-used library (recharts, leaflet,
        // @react-google-maps) into a named chunk hoists it out of the lazy
        // route chunk and into the entry's chunk graph, so Vite emits a
        // <link rel="modulepreload"> for it and the browser downloads it on
        // first paint anyway. Measured on this app: naming charts/maps/gmaps
        // put 974 KB on the critical path; leaving them to be placed inside
        // their lazy chunks brings it down to ~446 KB.
        //
        // Rule of thumb: manual-chunk a vendor only if something reachable
        // WITHOUT navigation imports it.
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return;
          const m = /node_modules[\\/](?:\.pnpm[\\/])?((?:@[^\\/]+[\\/])?[^\\/]+)/.exec(id);
          const pkg = m ? m[1].replace(/\\/g, '/') : '';

          if (pkg === 'react' || pkg === 'react-dom' || pkg === 'react-router' || pkg === 'react-router-dom') return 'react';
          if (pkg === '@mui/material' || pkg === '@mui/icons-material' || pkg.startsWith('@emotion')) return 'mui';
          if (pkg === 'socket.io-client' || pkg === 'engine.io-client') return 'realtime';
          return; // everything else: let rolldown place it, lazily where possible
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


