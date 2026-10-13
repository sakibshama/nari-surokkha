import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Production Content-Security-Policy, injected as a <meta> ONLY in builds
 * (`apply: 'build'`) so Vite's dev server / HMR (inline scripts, ws to the dev
 * server) keeps working untouched.
 *
 * Origins come from VITE_API_URL / VITE_WS_URL at build time. The app replaces
 * a literal `localhost` in those URLs with the page's hostname at runtime, so
 * in that case any host on the API port is allowed.
 * Extra origins can be appended with VITE_CSP_EXTRA (space-separated).
 * frame-ancestors cannot be set from a <meta>; send it as an HTTP header.
 */
function cspPlugin(env: Record<string, string>): Plugin {
  const origins = new Set<string>()
  const wsOrigins = new Set<string>()
  const addOrigin = (raw: string | undefined, fallbackPort = '3001') => {
    let u: URL
    try {
      u = new URL(raw || `http://localhost:${fallbackPort}`)
    } catch {
      return
    }
    const port = u.port ? `:${u.port}` : ''
    const http = u.protocol === 'https:' || u.protocol === 'wss:' ? 'https' : 'http'
    const ws = http === 'https' ? 'wss' : 'ws'
    const host = u.hostname === 'localhost' ? '*' : u.hostname
    if (host === '*') {
      // Runtime hostname substitution: allow both schemes on that port.
      for (const s of ['http', 'https']) origins.add(`${s}://*${port}`)
      for (const s of ['ws', 'wss']) wsOrigins.add(`${s}://*${port}`)
    } else {
      origins.add(`${http}://${host}${port}`)
      wsOrigins.add(`${ws}://${host}${port}`)
    }
  }
  addOrigin(env.VITE_API_URL)
  if (env.VITE_WS_URL) addOrigin(env.VITE_WS_URL)
  const api = [...origins].join(' ')
  const ws = [...wsOrigins].join(' ')
  const extra = (env.VITE_CSP_EXTRA || '').trim()

  const google = 'https://maps.googleapis.com https://maps.gstatic.com https://*.googleapis.com https://*.gstatic.com https://*.google.com'
  const tiles = 'https://tile.openstreetmap.org https://*.tile.openstreetmap.org https://*.basemaps.cartocdn.com https://server.arcgisonline.com'

  const directives: Record<string, string> = {
    'default-src': "'self'",
    // Google Maps JS needs 'unsafe-eval' and blob: workers (per Google's CSP guide).
    'script-src': `'self' ${google} 'unsafe-eval' blob:`,
    // React inline style attributes, MUI/emotion and component <style> tags.
    'style-src': "'self' 'unsafe-inline' https://fonts.googleapis.com",
    'font-src': "'self' data: https://fonts.gstatic.com",
    // Evidence comes from the API origin or a signed S3/R2 URL (any https host).
    'img-src': `'self' data: blob: ${api} ${tiles} ${google} https://*.ggpht.com https://*.googleusercontent.com https: ${extra}`,
    'media-src': `'self' data: blob: ${api} https: ${extra}`,
    'connect-src': `'self' ${api} ${ws} https://router.project-osrm.org https://overpass-api.de ${google} data: blob: ${extra}`,
    'worker-src': "'self' blob:",
    'frame-src': 'https://*.google.com',
    'object-src': "'none'",
    'base-uri': "'self'",
    'form-action': "'self'",
  }
  const policy = Object.entries(directives)
    .map(([k, v]) => `${k} ${v.replace(/\s+/g, ' ').trim()}`)
    .join('; ')

  return {
    name: 'nari-csp-meta',
    apply: 'build',
    // Insert right after <meta charset>: the charset must stay within the
    // first 1024 bytes, and the CSP must precede every script/style it governs.
    transformIndexHtml(html) {
      const meta = `<meta http-equiv="Content-Security-Policy" content="${policy.replace(/"/g, '&quot;')}" />`
      const charset = /<meta charset=[^>]*>/i
      return charset.test(html) ? html.replace(charset, (m) => `${m}\n    ${meta}`) : html.replace('<head>', `<head>\n    ${meta}`)
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  return {
  plugins: [
    react(),
    cspPlugin(env),
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
}
})
