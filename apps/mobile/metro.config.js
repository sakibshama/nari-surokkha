// Learn more https://docs.expo.io/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// ── Monorepo root node_modules resolution ─────────────────────────────────────
// npm workspaces may hoist some packages (e.g. react-native-worklets) to the
// monorepo root. Metro needs to know about the root node_modules so it can
// resolve those packages (e.g. react-native-reanimated/plugin re-exports
// react-native-worklets/plugin which lives at root level).
const monorepoRoot = path.resolve(__dirname, '../..');
config.resolver.nodeModulesPaths = [
  path.resolve(monorepoRoot, 'node_modules'),
  path.resolve(__dirname, 'node_modules'),
];
config.watchFolders = [monorepoRoot];

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
  /.*[\\\/]node_modules[\\\/]\.vite.*/,
  /.*[\\\/]node_modules[\\\/]\.cache[\\\/].*/,
  /.*[\\\/]node_modules[\\\/]\.[^\\\/]*-cjs-interop[^\\\/]*[\\\/].*/,
  /.*[\\\/]apps[\\\/]admin-portal[\\\/].*/,
  /.*[\\\/]apps[\\\/]police-portal[\\\/].*/,
];

const existing = config.resolver.blockList;
const existingList = existing ? (Array.isArray(existing) ? existing : [existing]) : [];
const allPatterns = [...existingList, ...ignorePatterns];
// Combine into a single RegExp (accepted by every Metro version).
config.resolver.blockList = new RegExp(allPatterns.map((r) => r.source).join('|'));

module.exports = config;
