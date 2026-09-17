module.exports = function (api) {
  api.cache(true);

  const plugins = [];

  // Strip console.log / console.warn from PRODUCTION bundles to avoid leaking
  // log noise (and a minor perf cost) into shipped apps. console.error is kept
  // so real crash diagnostics still surface. Dev builds keep everything.
  const isProd =
    process.env.NODE_ENV === 'production' || process.env.BABEL_ENV === 'production';
  if (isProd) {
    plugins.push(['transform-remove-console', { exclude: ['error'] }]);
  }

  // react-native-reanimated/plugin MUST be listed last.
  plugins.push('react-native-reanimated/plugin');

  return {
    presets: ['babel-preset-expo'],
    plugins,
  };
};
