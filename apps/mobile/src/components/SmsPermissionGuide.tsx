/**
 * Step-by-step guide to turn on the emergency-SMS permission when Android
 * will not show its own "Allow" dialog:
 *
 *  - restricted: Android 15+ and the app was installed from an APK file or a
 *    browser download. SMS stays greyed out until "Allow restricted settings"
 *    is used on the app's info page (an Android security rule; no app can
 *    skip it — installs from Google Play are not affected).
 *  - blocked: the user chose "Don't ask again" earlier.
 *
 * Opens over any screen (rendered once in App.tsx), closes by itself as soon
 * as the permission is on when the user comes back from Settings.
 */
import React from 'react';
import { Modal, ScrollView, StyleSheet, View } from 'react-native';
import { MessageSquareWarning, ShieldCheck } from 'lucide-react-native';
import { Button, Txt } from './ui';
import { useTheme } from '../theme';
import { useT } from '../i18n';
import { radius, spacing } from '../theme/tokens';
import { ensureSmsPermission, openAppSettings, useSmsPermission } from '../services/smsPermission';

export default function SmsPermissionGuide() {
  const { colors } = useTheme();
  const t = useT();
  const { state, guideVisible, hideGuide } = useSmsPermission();

  if (!guideVisible || state === 'granted' || state === 'unsupported' || state === null) return null;

  const restricted = state === 'restricted';
  const steps = restricted
    ? [
        t('Tap “Open settings” below. The app info page opens.'),
        t('Tap ⋮ (top right) and choose “Allow restricted settings”. Confirm with your PIN or fingerprint.'),
        t('Tap Permissions → SMS → Allow.'),
        t('Come back to Nari Surokkha.'),
      ]
    : [
        t('Tap “Open settings” below. The app info page opens.'),
        t('Tap Permissions → SMS → Allow.'),
        t('Come back to Nari Surokkha.'),
      ];

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={hideGuide}>
      <View style={[styles.backdrop, { backgroundColor: 'rgba(0,0,0,0.55)' }]}>
        <View style={[styles.sheet, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <ScrollView contentContainerStyle={{ gap: spacing.md }}>
            <View style={[styles.iconWrap, { backgroundColor: colors.dangerSoft }]}>
              <MessageSquareWarning size={28} color={colors.danger} />
            </View>
            <Txt variant="h3" style={styles.center}>
              {t('Allow emergency SMS')}
            </Txt>
            <Txt tone="muted" style={styles.center}>
              {restricted
                ? t('Without internet, your SOS reaches your trusted contacts by SMS from your SIM. Android blocks SMS for apps installed from an APK file until you allow it once in Settings.')
                : t('Without internet, your SOS reaches your trusted contacts by SMS from your SIM. SMS permission is turned off for this app.')}
            </Txt>

            <View style={{ gap: spacing.sm }}>
              {steps.map((step, i) => (
                <View key={i} style={styles.stepRow}>
                  <View style={[styles.stepNum, { backgroundColor: colors.accent }]}>
                    <Txt variant="xs" style={{ color: colors.onAccent, fontWeight: '700' }}>
                      {String(i + 1)}
                    </Txt>
                  </View>
                  <Txt style={{ flex: 1 }}>{step}</Txt>
                </View>
              ))}
            </View>

            <Txt variant="xs" tone="muted">
              {t('On Xiaomi, Redmi, POCO, Realme or Oppo phones, also allow “Send SMS” under “Other permissions” if you see it.')}
            </Txt>

            <View style={[styles.note, { backgroundColor: colors.surfaceAlt }]}>
              <ShieldCheck size={16} color={colors.accent} />
              <Txt variant="xs" tone="muted" style={{ flex: 1 }}>
                {t('SMS is only sent to your trusted contacts during an SOS. Standard operator charges may apply.')}
              </Txt>
            </View>

            <Button label={t('Open settings')} onPress={openAppSettings} />
            <Button label={t('I have allowed it — check again')} variant="subtle" onPress={() => void ensureSmsPermission(false)} />
            <Button label={t('Later')} variant="ghost" onPress={hideGuide} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'center', padding: spacing.lg },
  sheet: { borderRadius: radius.xl, borderWidth: 1, padding: spacing.lg, maxHeight: '90%' },
  iconWrap: { alignSelf: 'center', width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  center: { textAlign: 'center' },
  stepRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  stepNum: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  note: { flexDirection: 'row', gap: spacing.sm, padding: spacing.sm, borderRadius: radius.md, alignItems: 'center' },
});
