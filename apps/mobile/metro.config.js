// Learn more https://docs.expo.io/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// Disable package exports to fix the event-target-shim warning from react-native-webrtc
config.resolver.unstable_enablePackageExports = false;

// ── Windows monorepo watcher fix ─────────────────────────────────────────────
// This is an npm-workspaces monorepo, so node_modules is hoisted to the repo
// root and Metro (using the fallback watcher, since Windows has no Watchman)
// watches ALL of it — including transient temp dirs created by the Vite-based
// admin/police portals (e.g. node_modules/.vite-plugin-cjs-interop-*). Those
// folders disappear mid-watch and crash Metro with "ENOENT: watch ...".
// Excluding them (and the sibling Vite portals) from Metro's file map stops it.
const ignorePatterns = [
  /.*[\\/]node_modules[\\/]\.vite.*/,
  /.*[\\/]node_modules[\\/]\.cache[\\/].*/,
  /.*[\\/]node_modules[\\/]\.[^\\/]*-cjs-interop[^\\/]*[\\/].*/,
  /.*[\\/]apps[\\/]admin-portal[\\/].*/,
  /.*[\\/]apps[\\/]police-portal[\\/].*/,
];

const existing = config.resolver.blockList;
const existingList = existing ? (Array.isArray(existing) ? existing : [existing]) : [];
const allPatterns = [...existingList, ...ignorePatterns];
// Combine into a single RegExp (accepted by every Metro version).
config.resolver.blockList = new RegExp(allPatterns.map((r) => r.source).join('|'));

module.exports = config;
