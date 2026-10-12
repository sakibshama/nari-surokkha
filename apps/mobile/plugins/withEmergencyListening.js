/**
 * Expo config plugin — lets automatic emergency detection keep the microphone
 * open while the app is in the background on Android.
 *
 * Android 14+ only allows background microphone access from a foreground
 * service declared with foregroundServiceType="microphone", and the app must
 * hold FOREGROUND_SERVICE_MICROPHONE. react-native-background-actions ships the
 * service without a type, so we add it here (manifest merge).
 */
const { withAndroidManifest, AndroidConfig } = require('expo/config-plugins');

const SERVICE = 'com.asterinet.react.bgactions.RNBackgroundActionsTask';
const PERMISSIONS = [
  'android.permission.FOREGROUND_SERVICE',
  'android.permission.FOREGROUND_SERVICE_MICROPHONE',
  'android.permission.RECORD_AUDIO',
  'android.permission.POST_NOTIFICATIONS',
];

module.exports = function withEmergencyListening(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults;
    manifest.manifest.$ = manifest.manifest.$ || {};
    manifest.manifest.$['xmlns:tools'] = manifest.manifest.$['xmlns:tools'] || 'http://schemas.android.com/tools';

    AndroidConfig.Permissions.ensurePermissions(manifest, PERMISSIONS);

    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(manifest);
    app.service = app.service || [];
    let svc = app.service.find((s) => s.$ && s.$['android:name'] === SERVICE);
    if (!svc) {
      svc = { $: { 'android:name': SERVICE } };
      app.service.push(svc);
    }
    svc.$['android:foregroundServiceType'] = 'microphone';
    svc.$['android:exported'] = 'false';
    svc.$['tools:node'] = 'merge';
    return cfg;
  });
};
