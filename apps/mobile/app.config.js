/**
 * Dynamic config on top of app.json.
 *
 * Release builds must not allow cleartext (http://) traffic: it is only needed
 * to reach a development API on the LAN. Production is detected from the EAS
 * build profile or APP_ENV.
 */
const PRODUCTION =
  process.env.EAS_BUILD_PROFILE === 'production' || process.env.APP_ENV === 'production';

module.exports = ({ config }) => {
  const plugins = (config.plugins ?? []).map((plugin) => {
    if (!Array.isArray(plugin) || plugin[0] !== 'expo-build-properties') return plugin;
    const [name, options = {}] = plugin;
    return [
      name,
      {
        ...options,
        android: { ...(options.android ?? {}), usesCleartextTraffic: !PRODUCTION },
      },
    ];
  });
  return { ...config, plugins };
};
