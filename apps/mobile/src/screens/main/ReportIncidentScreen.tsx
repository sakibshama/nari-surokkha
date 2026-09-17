import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ActivityIndicator, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { MainStackParamList } from '../../navigation/MainStack';
import api from '../../services/api';
import * as Location from 'expo-location';
import { AlertTriangle, Send, Lock, ChevronLeft } from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Theme, useTheme, useThemedStyles } from '../../theme';
import { radius, spacing, type } from '../../theme/tokens';
import type { Palette } from '../../theme/tokens';
import { useNavigation } from '@react-navigation/native';

type Props = NativeStackScreenProps<MainStackParamList, 'ReportIncident'>;

const TYPES: { label: string; value: string; icon: string; tone: 'danger' | 'warning' | 'textSub' }[] = [
  { label: 'Harassment',           value: 'harassment',         icon: '😡', tone: 'danger' as const },
  { label: 'Robbery / Theft',      value: 'robbery',            icon: '🔪', tone: 'danger' as const },
  { label: 'Suspicious Activity',  value: 'suspicious_activity',icon: '👁️', tone: 'warning' as const },
  { label: 'Poor Lighting',        value: 'poor_lighting',      icon: '💡', tone: 'warning' as const },
  { label: 'Other',                value: 'other',              icon: '📋', tone: 'textSub' as const },
];

export default function ReportIncidentScreen({ navigation }: Props) {
  const toneColor = (t: 'danger' | 'warning' | 'textSub') =>
    t === 'danger' ? colors.danger : t === 'warning' ? colors.warning : colors.textSub;
  const styles = useThemedStyles(makeStyles);
  const { colors, gradients, shadows } = useTheme();
  void gradients; void shadows;
  const [selected, setSelected] = useState(TYPES[0].value);
  const [desc, setDesc] = useState('');
  const [loading, setLoading] = useState(false);
  const [descFocused, setDescFocused] = useState(false);

  const activeType = TYPES.find(t => t.value === selected)!;

  const handleSubmit = async () => {
    setLoading(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') { Alert.alert('Permission Denied', 'Location required.'); setLoading(false); return; }
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      await api.post('/incidents', { type: selected, description: desc, latitude: loc.coords.latitude, longitude: loc.coords.longitude });
      Alert.alert('✅ Report Submitted', 'Your anonymous report has been sent for verification.', [{ text: 'OK', onPress: () => navigation.goBack() }]);
    } catch (e: any) {
      Alert.alert('Failed', e.response?.data?.message || 'Please try again.');
    } finally { setLoading(false); }
  };

  return (
    <LinearGradient colors={gradients.hero} style={styles.root}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        {/* Nav Header */}
        <View style={styles.navHeader}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.navBackBtn} activeOpacity={0.7}>
            <ChevronLeft color={colors.text} size={24} />
          </TouchableOpacity>
          <Text style={styles.navTitle}>Report Incident</Text>
          <View style={{ width: 40 }} />
        </View>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>

          {/* Header */}
          <View style={styles.hdr}>
            <View style={[styles.hdrIcon, { backgroundColor: `${toneColor(activeType.tone)}18`, borderColor: `${toneColor(activeType.tone)}40` }]}>
              <Text style={{ fontSize: 36 }}>{activeType.icon}</Text>
            </View>
            <Text style={styles.hdrTitle}>Report Incident</Text>
            <View style={styles.anonBadge}>
              <Lock color={colors.success} size={14} />
              <Text style={styles.anonText}>100% Anonymous</Text>
            </View>
          </View>

          {/* Type chips */}
          <Text style={styles.sectionLabel}>INCIDENT TYPE</Text>
          <View style={styles.chipGrid}>
            {TYPES.map(t => {
              const active = selected === t.value;
              return (
                <TouchableOpacity
                  key={t.value}
                  style={[
                    styles.chip,
                    active && { borderColor: toneColor(t.tone), backgroundColor: `${toneColor(t.tone)}18` }
                  ]}
                  onPress={() => setSelected(t.value)}
                  activeOpacity={0.75}
                >
                  <Text style={styles.chipIcon}>{t.icon}</Text>
                  <Text style={[styles.chipLabel, active && { color: toneColor(t.tone), fontWeight: '700' }]}>{t.label}</Text>
                  {active && <View style={[styles.chipDot, { backgroundColor: toneColor(t.tone) }]} />}
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Description */}
          <Text style={styles.sectionLabel}>DETAILS <Text style={styles.optional}>(OPTIONAL)</Text></Text>
          <View style={[styles.textAreaWrapper, descFocused && { borderColor: toneColor(activeType.tone) }]}>
            <TextInput
              style={styles.textArea}
              placeholder="Any additional details about the incident..."
              placeholderTextColor={colors.textMuted}
              multiline
              numberOfLines={5}
              value={desc}
              onChangeText={setDesc}
              textAlignVertical="top"
              onFocus={() => setDescFocused(true)}
              onBlur={() => setDescFocused(false)}
            />
          </View>

          {/* Privacy notice */}
          <View style={styles.privacyBox}>
            <Lock color={colors.success} size={16} />
            <Text style={styles.privacyText}>Your identity is never shared. Reports are reviewed by local police before affecting the Safety Score.</Text>
          </View>

          {/* Submit */}
          <TouchableOpacity onPress={handleSubmit} disabled={loading} activeOpacity={0.85} style={[styles.submitWrapper, { boxShadow: `0px 8px 16px ${toneColor(activeType.tone)}80` }]}>
            <LinearGradient colors={[toneColor(activeType.tone) + 'dd', toneColor(activeType.tone)]} style={styles.submitBtn} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}>
              {loading
                ? <ActivityIndicator color={colors.onFill} />
                : <>
                    <Send color={colors.onFill} size={20} />
                    <Text style={styles.submitText}>Submit Anonymously</Text>
                  </>
              }
            </LinearGradient>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
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
    sm: { ...type.sm, tone: 'textSub' as const },
    xs: { ...type.xs, color: colors.textMuted },
    label: { ...type.label, tone: 'textSub' as const },
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
  hdr: { alignItems: 'center', marginBottom: spacing.xl },
  hdrIcon: { width: 84, height: 84, borderRadius: 42, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.md },
  hdrTitle: { ...font.h1, color: colors.text, marginBottom: spacing.sm },
  anonBadge: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, backgroundColor: `${colors.success}18`, borderWidth: 1, borderColor: `${colors.success}40`, borderRadius: radius.full, paddingHorizontal: spacing.md, paddingVertical: spacing.xs + 1 },
  anonText: { ...font.xs, color: colors.success, fontWeight: '700' },
  sectionLabel: { ...font.label, textTransform: 'uppercase', marginBottom: spacing.sm },
  chipGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.xl },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.border,
    borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 2,
    position: 'relative', minWidth: '45%', flexGrow: 1,
  },
  chipIcon: { fontSize: 20 },
  chipLabel: { ...font.sm, tone: 'textSub' as const, flex: 1 },
  chipDot: { width: 8, height: 8, borderRadius: 4 },
  textAreaWrapper: {
    backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1.5, borderColor: colors.border,
    padding: spacing.md, marginBottom: spacing.md, minHeight: 120,
  },
  textArea: { ...font.body, color: colors.text, minHeight: 90 },
  privacyBox: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, backgroundColor: `${colors.success}10`, borderRadius: radius.md, borderWidth: 1, borderColor: `${colors.success}25`, padding: spacing.md, marginBottom: spacing.xl },
  privacyText: { ...font.sm, color: colors.textMuted, flex: 1, lineHeight: 20 },
  submitWrapper: { borderRadius: radius.xl },
  submitBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingVertical: spacing.md + 4, borderRadius: radius.xl },
  submitText: { ...font.h3, color: colors.onFill },
  optional: { ...font.xs, color: colors.textMuted, fontWeight: 'normal' },
});
};
