import React, { useEffect, useState } from 'react';
import { Modal, Pressable, Switch, Text, View } from 'react-native';
import { showAlert } from '../../utils/notify';
import * as Location from 'expo-location';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { FadeIn as RFadeIn, SlideInDown } from 'react-native-reanimated';
import {
  Briefcase,
  CheckCircle,
  Clock,
  CreditCard,
  Droplets,
  Phone,
  Save,
  ShieldCheck,
  User,
  Wifi,
  WifiOff,
  XCircle,
} from 'lucide-react-native';

import { useAuthStore } from '../../store/authStore';
import api from '../../services/api';
import { useTheme } from '../../theme';
import { useT } from '../../i18n';
import { radius, spacing } from '../../theme/tokens';
import {
  Button,
  Card,
  FadeIn,
  Field,
  KeyboardAwareScrollView,
  Screen,
  SectionLabel,
  Shimmer,
  Txt,
} from '../../components/ui';

const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-'];

export default function ProfileSetupScreen() {
  const { colors, gradients, shadows } = useTheme();
  const t = useT();
  const { user, updateUser } = useAuthStore();

  const [fullName, setFullName] = useState('');
  const [bloodGroup, setBloodGroup] = useState('');
  const [loading, setLoading] = useState(false);
  const [fetchingProfile, setFetchingProfile] = useState(true);

  const [responderData, setResponderData] = useState<any>(null);
  const [fetchingResponder, setFetchingResponder] = useState(true);

  const [showApplyModal, setShowApplyModal] = useState(false);
  const [nationalId, setNationalId] = useState('');
  const [occupation, setOccupation] = useState('');
  const [orgName, setOrgName] = useState('');
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get('/profile');
        const d = res.data?.data;
        const p = d?.profile ?? d;
        if (p) {
          setFullName(p.fullName || '');
          setBloodGroup(p.bloodGroup || '');
          await updateUser({ profile: { fullName: p.fullName, bloodGroup: p.bloodGroup } });
        }
      } catch {
        setFullName(user?.profile?.fullName || '');
        setBloodGroup(user?.profile?.bloodGroup || '');
      } finally {
        setFetchingProfile(false);
      }
    })();

    api
      .get('/responders/me')
      .then((r) => setResponderData(r.data.data))
      .catch(() => {})
      .finally(() => setFetchingResponder(false));
  }, []);

  const handleSave = async () => {
    if (!fullName.trim()) {
      showAlert(t('Validation'), t('Full name is required.'));
      return;
    }
    setLoading(true);
    try {
      await api.put('/profile', { fullName: fullName.trim(), bloodGroup: bloodGroup.trim() });
      await updateUser({ profile: { fullName: fullName.trim(), bloodGroup: bloodGroup.trim() } });
      showAlert(t('Saved'), t('Profile updated successfully!'));
    } catch (e: any) {
      showAlert(t('Error'), e.response?.data?.error?.message || t('Update failed'));
    } finally {
      setLoading(false);
    }
  };

  const handleApply = async () => {
    setApplying(true);
    try {
      await api.post('/responders/apply', {
        nationalId: nationalId.trim() || undefined,
        occupation: occupation.trim() || undefined,
        organizationName: orgName.trim() || undefined,
      });
      setResponderData({ status: 'pending', availability: 'offline' });
      setShowApplyModal(false);
      showAlert(t('Application submitted'), t("Your application is under review. We'll notify you once approved."));
    } catch (e: any) {
      const msg = e.response?.data?.error?.message || e.response?.data?.message || t('Application failed. Try again.');
      showAlert(t('Error'), msg);
    } finally {
      setApplying(false);
    }
  };

  const toggleAvail = async (v: boolean) => {
    const newAvail = v ? 'online' : 'offline';
    // Going online needs a real GPS fix — dispatch routes by responder location.
    // Going offline sends no coordinates at all (never a fake 0,0).
    const body: { availability: 'online' | 'offline'; latitude?: number; longitude?: number } = { availability: newAvail };
    if (newAvail === 'online') {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          showAlert(
            t('Location required'),
            t('Responders must share their location so nearby emergencies can be routed to them.'),
          );
          return;
        }
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        body.latitude = loc.coords.latitude;
        body.longitude = loc.coords.longitude;
      } catch {
        showAlert(t('Location error'), t('Could not get your location. Please try again.'));
        return;
      }
    }
    const previous = responderData;
    setResponderData({ ...responderData, availability: newAvail });
    try {
      await api.patch('/responders/location', body);
    } catch {
      setResponderData(previous);
      showAlert(t('Error'), t('Could not update availability'));
    }
  };

  // 'busy' = on duty and currently handling an accepted dispatch.
  const isOnline = ['available', 'online', 'busy'].includes(responderData?.availability);
  const rStatus = responderData?.status as 'pending' | 'verified' | 'rejected' | undefined;
  const initials =
    fullName
      .split(' ')
      .map((w) => w[0])
      .join('')
      .toUpperCase()
      .slice(0, 2) || 'U';

  const statusMeta = {
    pending: { icon: Clock, color: colors.warningText, title: t('Pending review'), sub: t('Your application is being reviewed.'), tone: 'warning' as const },
    verified: { icon: CheckCircle, color: colors.successText, title: t('Verified responder'), sub: t("You're authorized to receive alerts."), tone: 'success' as const },
    rejected: { icon: XCircle, color: colors.dangerText, title: t('Application rejected'), sub: t('Contact support or reapply.'), tone: 'danger' as const },
  };

  return (
    <>
      <Screen>
        {/* Hero */}
        <FadeIn from="zoom" style={{ alignItems: 'center', paddingVertical: spacing.lg }}>
          <LinearGradient
            colors={gradients.accent}
            style={[
              { width: 96, height: 96, borderRadius: 48, alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: colors.surface },
              shadows.accent,
            ]}
          >
            <Text style={{ fontSize: 34, fontWeight: '800', color: colors.onAccent }}>{initials}</Text>
          </LinearGradient>
          <Txt variant="h1" center style={{ marginTop: spacing.md }}>
            {fullName || t('Your profile')}
          </Txt>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              marginTop: spacing.sm,
              backgroundColor: colors.surfaceAlt,
              borderRadius: radius.full,
              paddingHorizontal: spacing.md,
              paddingVertical: 6,
            }}
          >
            <Phone color={colors.textMuted} size={13} />
            <Txt variant="sm" tone="sub">{user?.phone || '—'}</Txt>
          </View>
        </FadeIn>

        {/* Personal info */}
        <SectionLabel>{t('Personal information')}</SectionLabel>
        <Card delay={80} elevation="raised">
          {fetchingProfile ? (
            <View style={{ gap: spacing.md }}>
              <Shimmer width="100%" height={52} />
              <Shimmer width="100%" height={52} />
            </View>
          ) : (
            <>
              <Field
                label={t('Full name')}
                placeholder={t('Your full name')}
                value={fullName}
                onChangeText={setFullName}
                autoCapitalize="words"
                icon={(c) => <User size={18} color={c} />}
              />

              <Txt variant="label" tone="muted" style={{ textTransform: 'uppercase', marginBottom: spacing.sm }}>
                {t('Blood group')}
              </Txt>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md }}>
                {BLOOD_GROUPS.map((g) => {
                  const active = bloodGroup.toUpperCase() === g;
                  return (
                    <Pressable
                      key={g}
                      onPress={() => setBloodGroup(active ? '' : g)}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: active }}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 4,
                        paddingHorizontal: 12,
                        paddingVertical: 8,
                        borderRadius: radius.full,
                        borderWidth: 1,
                        borderColor: active ? colors.danger : colors.border,
                        backgroundColor: active ? colors.dangerSoft : colors.surfaceAlt,
                      }}
                    >
                      <Droplets size={13} color={active ? colors.dangerText : colors.textMuted} />
                      <Text style={{ fontWeight: '700', color: active ? colors.dangerText : colors.textSub }}>{g}</Text>
                    </Pressable>
                  );
                })}
              </View>

              <Field
                label={t('Phone number')}
                value={user?.phone || '—'}
                editable={false}
                icon={(c) => <Phone size={18} color={c} />}
                containerStyle={{ opacity: 0.65 }}
              />

              <Button
                label={t('Save changes')}
                onPress={handleSave}
                loading={loading}
                icon={<Save size={18} color={colors.onAccent} />}
              />
            </>
          )}
        </Card>

        {/* Responder */}
        <SectionLabel>{t('Community responder')}</SectionLabel>
        {fetchingResponder ? (
          <Shimmer width="100%" height={90} radius={radius.lg} />
        ) : !responderData ? (
          <Card delay={140} tone="accent">
            <View style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'center', marginBottom: spacing.md }}>
              <ShieldCheck color={colors.accentText} size={28} />
              <View style={{ flex: 1 }}>
                <Txt variant="bodyStrong">{t('Become a verified responder')}</Txt>
                <Txt variant="sm" tone="sub">{t('Help women near you when they press SOS.')}</Txt>
              </View>
            </View>
            <Button label={t('Apply as responder')} onPress={() => setShowApplyModal(true)} />
          </Card>
        ) : rStatus && statusMeta[rStatus] ? (
          <Card delay={140} tone={statusMeta[rStatus].tone}>
            <Animated.View entering={RFadeIn} style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'center' }}>
              {React.createElement(statusMeta[rStatus].icon, { color: statusMeta[rStatus].color, size: 26 })}
              <View style={{ flex: 1 }}>
                <Txt variant="bodyStrong" style={{ color: statusMeta[rStatus].color }}>{statusMeta[rStatus].title}</Txt>
                <Txt variant="sm" tone="sub">{statusMeta[rStatus].sub}</Txt>
              </View>
            </Animated.View>

            {rStatus === 'rejected' && (
              <Button label={t('Reapply')} onPress={() => setShowApplyModal(true)} style={{ marginTop: spacing.md }} />
            )}

            {rStatus === 'verified' && (
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginTop: spacing.md,
                  paddingTop: spacing.md,
                  borderTopWidth: 1,
                  borderTopColor: colors.border,
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flex: 1 }}>
                  {isOnline ? <Wifi color={colors.successText} size={18} /> : <WifiOff color={colors.textMuted} size={18} />}
                  <Txt variant="smStrong" style={{ color: isOnline ? colors.successText : colors.textMuted }}>
                    {isOnline ? t('Online — receiving alerts') : t('Offline')}
                  </Txt>
                </View>
                <Switch
                  value={isOnline}
                  onValueChange={toggleAvail}
                  trackColor={{ false: colors.borderStrong, true: colors.success }}
                  thumbColor={colors.surface}
                />
              </View>
            )}
          </Card>
        ) : null}
      </Screen>

      {/* Apply sheet */}
      <Modal visible={showApplyModal} transparent animationType="fade" onRequestClose={() => setShowApplyModal(false)}>
        {/* A Modal is its own window: it needs its own keyboard handling so the
            sheet rises above the keyboard and the focused field stays visible. */}
        <KeyboardAwareScrollView
          inModal
          containerStyle={{ backgroundColor: colors.scrim }}
          contentContainerStyle={{ flexGrow: 1 }}
          bounces={false}
          overScrollMode="never"
          showsVerticalScrollIndicator={false}
        >
          <Pressable
            style={{ flex: 1, justifyContent: 'flex-end' }}
            onPress={() => setShowApplyModal(false)}
          >
            <Animated.View entering={SlideInDown.springify().damping(18)}>
              <Pressable
                onPress={() => {}}
                style={{
                  backgroundColor: colors.surface,
                  borderTopLeftRadius: radius.xl,
                  borderTopRightRadius: radius.xl,
                  padding: spacing.lg,
                  paddingBottom: spacing.xxl,
                }}
              >
                <View style={{ alignSelf: 'center', width: 44, height: 5, borderRadius: 3, backgroundColor: colors.borderStrong, marginBottom: spacing.md }} />
                <Txt variant="h2">{t('Apply as responder')}</Txt>
                <Txt variant="sm" tone="muted" style={{ marginTop: 4, marginBottom: spacing.lg }}>
                  {t('All fields are optional but help speed up verification.')}
                </Txt>

                <Field
                  label={t('National ID (NID)')}
                  placeholder="1234567890123"
                  value={nationalId}
                  onChangeText={setNationalId}
                  keyboardType="numeric"
                  icon={(c) => <CreditCard size={18} color={c} />}
                />
                <Field
                  label={t('Occupation')}
                  placeholder={t('e.g. Doctor, Teacher')}
                  value={occupation}
                  onChangeText={setOccupation}
                  icon={(c) => <Briefcase size={18} color={c} />}
                />
                <Field
                  label={t('Organization (if any)')}
                  placeholder={t('e.g. Red Crescent')}
                  value={orgName}
                  onChangeText={setOrgName}
                  icon={(c) => <ShieldCheck size={18} color={c} />}
                />

                <Button
                  label={t('Submit application')}
                  onPress={handleApply}
                  loading={applying}
                  icon={<ShieldCheck color={colors.onAccent} size={18} />}
                />
                <Button
                  label={t('Cancel')}
                  variant="ghost"
                  onPress={() => setShowApplyModal(false)}
                  style={{ marginTop: spacing.sm }}
                />
              </Pressable>
            </Animated.View>
          </Pressable>
        </KeyboardAwareScrollView>
      </Modal>
    </>
  );
}
