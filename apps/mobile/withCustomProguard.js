const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

module.exports = function withCustomProguardRules(config) {
  return withDangerousMod(config, [
    'android',
    async (config) => {
      const proguardRulesPath = path.join(
        config.modRequest.platformProjectRoot,
        'app',
        'proguard-rules.pro'
      );

      const customRules = `
# Keep expo.modules.kotlin.** to prevent NoClassDefFoundError for LazyKType
-keep class expo.modules.kotlin.** { *; }
-keep class expo.modules.av.** { *; }
-keep class expo.modules.core.** { *; }
`;

      if (fs.existsSync(proguardRulesPath)) {
        let content = fs.readFileSync(proguardRulesPath, 'utf8');
        if (!content.includes('expo.modules.kotlin.**')) {
          fs.writeFileSync(proguardRulesPath, content + customRules);
        }
      } else {
        fs.writeFileSync(proguardRulesPath, customRules);
      }

      return config;
    },
  ]);
};
