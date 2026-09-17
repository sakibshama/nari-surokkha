import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, ScrollView, Switch, KeyboardAvoidingView, Platform, Modal } from 'react-native';
import { useAuthStore } from '../../store/authStore';
import api from '../../services/api';
import * as Location from 'expo-location';
import { LinearGradient } from 'expo-linear-gradient';
import { Theme, useTheme, useThemedStyles } from '../../theme';
import { radius, spacing, type } from '../../theme/tokens';
import { User, Droplets, Phone, ShieldCheck, Clock, CheckCircle, XCircle, Wifi, WifiOff, ChevronLeft, ChevronRight, Briefcase, CreditCard } from 'lucide-react-native';
import { useNavigation } from '@react-navigation/native';

export default function ProfileSetupScreen() {
  const styles = useThemedStyles(makeStyles);
  const { colors, gradients, shadows } = useTheme();
  void gradients; void shadows;
  const navigation = useNavigation();
  const { user, updateUser } = useAuthStore();

  // Profile form state
  const [fullName, setFullName]   = useState('');
  const [bloodGroup, setBloodGroup] = useState('');
  const [loading, setLoading] = useState(false);
  const [fetchingProfile, setFetchingProfile] = useState(true);

  // Focus states
  const [nameFocused, setNameFocused] = useState(false);
  const [bloodFocused, setBloodFocused] = useState(false);

  // Responder state
  const [responderData, setResponderData] = useState<any>(null);
  const [fetchingResponder, setFetchingResponder] = useState(true);

  // Apply modal state
  const [showApplyModal, setShowApplyModal] = useState(false);
  const [nationalId, setNationalId] = useState('');
  const [occupation, setOccupation] = useState('');
  const [orgName, setOrgName] = useState('');
  const [applying, setApplying] = useState(false);

  // ─── Fetch latest profile on mount ───────────────────────────────
  useEffect(() => {
    const fetchAll = async () => {
      try {
        const profileRes = await api.get('/profile');
        const p = profileRes.data?.data;
        if (p) {
          setFullName(p.fullName || '');
          setBloodGroup(p.bloodGroup || '');
          // Sync store
          await updateUser({ profile: { fullName: p.fullName, bloodGroup: p.bloodGroup } });
        }
      } catch {
        // Fallback to cached store data
        setFullName(user?.profile?.fullName || '');
        setBloodGroup(user?.profile?.bloodGroup || '');
      } finally {
        setFetchingProfile(false);
      }
    };
    fetchAll();

    api.get('/responders/me')
      .then(r => setResponderData(r.data.data))
      .catch(() => {})
      .finally(() => setFetchingResponder(false));
  }, []);

  // ─── Save profile ─────────────────────────────────────────────────
  const handleSave = async () => {
    if (!fullName.trim()) { Alert.alert('Validation', 'Full name is required.'); return; }
    setLoading(true);
    try {
      await api.put('/profile', { fullName: fullName.trim(), bloodGroup: bloodGroup.trim() });
      // Update the global auth store so Drawer reflects new name immediately
      await updateUser({ profile: { fullName: fullName.trim(), bloodGroup: bloodGroup.trim() } });
      Alert.alert('✅ Saved', 'Profile updated successfully!');
    } catch (e: any) {
      Alert.alert('Error', e.response?.data?.error?.message || 'Update failed');
    } finally { setLoading(false); }
  };

  // ─── Responder apply ──────────────────────────────────────────────
  const handleApply = async () => {
    setApplying(true);
    try {
      const res = await api.post('/responders/apply', {
        nationalId: nationalId.trim() || undefined,
        occupation: occupation.trim() || undefined,
        organizationName: orgName.trim() || undefined,
      });
      setResponderData({ status: 'pending', availability: 'offline' });
      setShowApplyModal(false);
      Alert.alert('🎉 Application Submitted', "Your application is under review. We'll notify you once approved.");
    } catch (e: any) {
      const msg = e.response?.data?.error?.message || e.response?.data?.message || 'Application failed. Try again.';
      Alert.alert('Error', msg);
    } finally { setApplying(false); }
  };

  // ─── Responder availability toggle ───────────────────────────────
  const toggleAvail = async (v: boolean) => {
    const newAvail = v ? 'available' : 'offline';
    // Going ONLINE requires a real GPS fix — the dispatch system routes nearby
    // emergencies by the responder's location, so 0,0 would make them invisible.
    let latitude = 0;
    let longitude = 0;
    if (newAvail === 'available') {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          Alert.alert('Location required', 'Responders must share their location so nearby emergencies can be routed to them.');
          return;
        }
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        latitude = loc.coords.latitude;
        longitude = loc.coords.longitude;
      } catch {
        Alert.alert('Location error', 'Could not get your location. Please try again.');
        return;
      }
    }
    setResponderData({ ...responderData, availability: newAvail });
    try {
      await api.patch('/responders/location', { latitude, longitude, availability: newAvail });
    } catch (e: any) {
      // revert the optimistic UI change on failure
      setResponderData({ ...responderData, availability: v ? 'offline' : 'available' });
      Alert.alert('Error', 'Could not update availability');
    }
  };

  const isOnline = responderData?.availability === 'available' || responderData?.availability === 'online';
  const rStatus = responderData?.status;
  const firstName = fullName?.split(' ')[0] || 'User';
  const initials = fullName.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2) || 'U';

  return (
    <LinearGradient colors={gradients.hero} style={styles.root}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        {/* Nav Header */}
        <View style={styles.navHeader}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.navBackBtn} activeOpacity={0.7}>
            <ChevronLeft color={colors.text} size={24} />
          </TouchableOpacity>
          <Text style={styles.navTitle}>Profile</Text>
          <View style={{ width: 40 }} />
        </View>

        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

          {/* Profile Hero */}
          <View style={styles.hero}>
            <LinearGradient colors={gradients.danger} style={styles.avatar}>
              <Text style={styles.avatarInit}>{initials}</Text>
            </LinearGradient>
            <Text style={styles.heroName}>{fullName || 'Your Profile'}</Text>
            <View style={styles.phonePill}>
              <Phone color={colors.textMuted} size={14} />
              <Text style={styles.phonePillText}>{user?.phone || '—'}</Text>
            </View>
          </View>

          {/* Personal Info Card */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>PERSONAL INFORMATION</Text>
            <View style={styles.card}>
              {fetchingProfile
                ? <ActivityIndicator color={colors.danger} style={{ paddingVertical: spacing.lg }} />
                : <>
                  {/* Name */}
                  <Text style={styles.fieldLabel}>Full Name</Text>
                  <View style={[styles.inputRow, nameFocused && styles.inputFocused]}>
                    <User color={nameFocused ? colors.danger : colors.textMuted} size={18} />
                    <TextInput
                      style={styles.input}
                      placeholder="Your full name"
                      placeholderTextColor={colors.textMuted}
                      value={fullName}
                      onChangeText={setFullName}
                      onFocus={() => setNameFocused(true)}
                      onBlur={() => setNameFocused(false)}
                    />
                  </View>

                  {/* Blood */}
                  <Text style={[styles.fieldLabel, { marginTop: spacing.md }]}>Blood Group</Text>
                  <View style={[styles.inputRow, bloodFocused && styles.inputFocused]}>
                    <Droplets color={bloodFocused ? colors.danger : colors.textMuted} size={18} />
                    <TextInput
                      style={styles.input}
                      placeholder="e.g. O+"
                      placeholderTextColor={colors.textMuted}
                      value={bloodGroup}
                      onChangeText={setBloodGroup}
                      autoCapitalize="characters"
                      onFocus={() => setBloodFocused(true)}
                      onBlur={() => setBloodFocused(false)}
                    />
                  </View>

                  {/* Phone (read-only) */}
                  <Text style={[styles.fieldLabel, { marginTop: spacing.md }]}>Phone Number</Text>
                  <View style={[styles.inputRow, { opacity: 0.6 }]}>
                    <Phone color={colors.textMuted} size={18} />
                    <Text style={[styles.input, { color: colors.textSub, lineHeight: 36 }]}>{user?.phone || '—'}</Text>
                  </View>

                  {/* Save */}
                  <TouchableOpacity onPress={handleSave} disabled={loading} activeOpacity={0.85} style={[styles.saveWrapper, { marginTop: spacing.lg }]}>
                    <LinearGradient colors={gradients.danger} style={styles.saveBtn} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}>
                      {loading
                        ? <ActivityIndicator color={colors.onFill} />
                        : <>
                          <Text style={styles.saveBtnText}>Save Changes</Text>
                          <ChevronRight color={colors.onFill} size={20} />
                        </>}
                    </LinearGradient>
                  </TouchableOpacity>
                </>
              }
            </View>
          </View>

          {/* Responder Section */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>COMMUNITY RESPONDER</Text>
            {fetchingResponder
              ? <View style={styles.card}><ActivityIndicator color={colors.danger} /></View>
              : !responderData
              ? (
                <TouchableOpacity
                  style={styles.applyWrapper}
                  onPress={() => setShowApplyModal(true)}
                  activeOpacity={0.85}
                >
                  <LinearGradient colors={gradients.accent} style={styles.applyBtn}>
                    <ShieldCheck color={colors.onFill} size={22} />
                    <Text style={styles.applyText}>Apply as Verified Responder</Text>
                  </LinearGradient>
                </TouchableOpacity>
              )
              : (
                <View style={styles.card}>
                  {/* Status Row */}
                  <View style={styles.rStatusRow}>
                    {rStatus === 'pending'  && <><Clock color={colors.warning} size={22} /><View><Text style={[styles.rStatusTitle, { color: colors.warning }]}>Pending Review</Text><Text style={styles.rStatusSub}>Application under review by authorities.</Text></View></>}
                    {rStatus === 'verified' && <><CheckCircle color={colors.success} size={22} /><View><Text style={[styles.rStatusTitle, { color: colors.success }]}>Verified Responder</Text><Text style={styles.rStatusSub}>You're authorized to receive alerts.</Text></View></>}
                    {rStatus === 'rejected' && <><XCircle color={colors.danger} size={22} /><View><Text style={[styles.rStatusTitle, { color: colors.danger }]}>Application Rejected</Text><Text style={styles.rStatusSub}>Contact support or reapply.</Text></View></>}
                  </View>
                  {/* Reapply if rejected */}
                  {rStatus === 'rejected' && (
                    <TouchableOpacity onPress={() => setShowApplyModal(true)} style={[styles.saveWrapper, { marginTop: spacing.md }]}>
                      <LinearGradient colors={gradients.accent} style={styles.saveBtn}>
                        <Text style={styles.saveBtnText}>Reapply</Text>
                      </LinearGradient>
                    </TouchableOpacity>
                  )}
                  {/* Availability Toggle for verified */}
                  {rStatus === 'verified' && (
                    <View style={styles.toggleRow}>
                      <View style={styles.toggleLeft}>
                        {isOnline ? <Wifi color={colors.success} size={18} /> : <WifiOff color={colors.textMuted} size={18} />}
                        <Text style={[styles.toggleText, { color: isOnline ? colors.success : colors.textMuted }]}>
                          {isOnline ? 'Online — Receiving Alerts' : 'Offline'}
                        </Text>
                      </View>
                      <Switch
                        value={isOnline}
                        onValueChange={toggleAvail}
                        trackColor={{ false: colors.surfaceAlt, true: `${colors.success}60` }}
                        thumbColor={isOnline ? colors.success : '#475569'}
                      />
                    </View>
                  )}
                </View>
              )
            }
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* ─── Apply Modal ─────────────────────────────── */}
      <Modal visible={showApplyModal} transparent animationType="slide" onRequestClose={() => setShowApplyModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Apply as Responder</Text>
            <Text style={styles.modalSub}>Fill in your details. All fields are optional but help speed up verification.</Text>

            {/* National ID */}
            <Text style={styles.fieldLabel}>National ID (NID)</Text>
            <View style={[styles.inputRow, { marginBottom: spacing.md }]}>
              <CreditCard color={colors.textMuted} size={18} />
              <TextInput
                style={styles.input}
                placeholder="e.g. 1234567890123"
                placeholderTextColor={colors.textMuted}
                value={nationalId}
                onChangeText={setNationalId}
                keyboardType="numeric"
              />
            </View>

            {/* Occupation */}
            <Text style={styles.fieldLabel}>Occupation</Text>
            <View style={[styles.inputRow, { marginBottom: spacing.md }]}>
              <Briefcase color={colors.textMuted} size={18} />
              <TextInput
                style={styles.input}
                placeholder="e.g. Doctor, Teacher"
                placeholderTextColor={colors.textMuted}
                value={occupation}
                onChangeText={setOccupation}
              />
            </View>

            {/* Organization */}
            <Text style={styles.fieldLabel}>Organization (if any)</Text>
            <View style={[styles.inputRow, { marginBottom: spacing.xl }]}>
              <ShieldCheck color={colors.textMuted} size={18} />
              <TextInput
                style={styles.input}
                placeholder="e.g. Red Crescent"
                placeholderTextColor={colors.textMuted}
                value={orgName}
                onChangeText={setOrgName}
              />
            </View>

            <TouchableOpacity onPress={handleApply} disabled={applying} style={styles.saveWrapper} activeOpacity={0.85}>
              <LinearGradient colors={gradients.accent} style={styles.saveBtn}>
                {applying ? <ActivityIndicator color={colors.onFill} /> : <><ShieldCheck color={colors.onFill} size={18} /><Text style={styles.saveBtnText}>Submit Application</Text></>}
              </LinearGradient>
            </TouchableOpacity>

            <TouchableOpacity onPress={() => setShowApplyModal(false)} style={{ marginTop: spacing.md, alignItems: 'center' }}>
              <Text style={{ color: colors.textMuted, fontSize: 14 }}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </LinearGradient>
  );
}

const makeStyles = ({ colors, shadows, gradients }: Theme) => {
  const font = {
    hero: { ...type.hero, color: colors.text },
    h1: { ...type.h1, color: colors.text },
    h2: { ...type.h2, color: colors.text },
    h3: { ...type.h3, color: colors.text },
    body: { ...type.body, color: colors.text },
    sm: { ...type.sm, color: colors.textSub },
    xs: { ...type.xs, color: colors.textMuted },
    label: { ...type.label, color: colors.textSub },
    regular: 'System' as const, medium: 'System' as const,
    semiBold: 'System' as const, bold: 'System' as const,
  };
  void gradients;
  return StyleSheet.create({
  root: { flex: 1 },
  navHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: Platform.OS === 'ios' ? 52 : 40, paddingBottom: 12,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  navBackBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  navTitle: { ...font.h3, color: colors.text },
  scroll: { flexGrow: 1, padding: spacing.lg, paddingTop: spacing.xl, paddingBottom: spacing.xxl },
  hero: { alignItems: 'center', marginBottom: spacing.xl },
  avatar: { width: 88, height: 88, borderRadius: 44, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.md, ...shadows.danger },
  avatarInit: { fontSize: 36, fontWeight: 'bold', color: colors.onFill },
  heroName: { ...font.h1, color: colors.text, textAlign: 'center' },
  phonePill: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, backgroundColor: colors.surface, borderRadius: radius.full, paddingHorizontal: spacing.md, paddingVertical: spacing.xs + 2, marginTop: spacing.sm, borderWidth: 1, borderColor: colors.border },
  phonePillText: { ...font.sm, color: colors.textMuted },
  section: { marginBottom: spacing.xl },
  sectionLabel: { ...font.label, textTransform: 'uppercase', marginBottom: spacing.sm, marginLeft: 2 },
  card: { backgroundColor: colors.surface, borderRadius: radius.xl, padding: spacing.lg, borderWidth: 1, borderColor: colors.border, ...shadows.card },
  fieldLabel: { ...font.label, marginBottom: spacing.sm },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.inputBg, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.border, paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 4 },
  inputFocused: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  input: { flex: 1, ...font.body, color: colors.text, height: 36 },
  saveWrapper: { borderRadius: radius.lg, ...shadows.danger },
  saveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingVertical: spacing.md, borderRadius: radius.lg },
  saveBtnText: { ...font.h3, color: colors.onFill },
  applyWrapper: { borderRadius: radius.xl, ...shadows.accent },
  applyBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingVertical: spacing.md, borderRadius: radius.xl },
  applyText: { ...font.h3, color: colors.onFill },
  rStatusRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, marginBottom: spacing.md },
  rStatusTitle: { ...font.h3 },
  rStatusSub: { ...font.sm, color: colors.textMuted, marginTop: 2 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.border },
  toggleLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  toggleText: { ...font.body, fontWeight: '600' },
  // Modal
  modalOverlay: { flex: 1, backgroundColor: colors.surface, justifyContent: 'flex-end' },
  modalCard: { backgroundColor: colors.bg, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: spacing.xl, paddingBottom: spacing.xxl + 16, borderWidth: 1, borderColor: colors.border },
  modalTitle: { ...font.h2, color: colors.text, marginBottom: spacing.sm },
  modalSub: { ...font.sm, color: colors.textMuted, marginBottom: spacing.xl, lineHeight: 20 },
});
};
