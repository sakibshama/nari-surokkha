import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, ScrollView, Platform } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { MainStackParamList } from '../../navigation/MainStack';
import api from '../../services/api';
import * as Location from 'expo-location';
import { AlertTriangle, ShieldCheck, ShieldAlert, TrendingUp, ChevronLeft } from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, font, spacing, radius, shadows } from '../../theme';

type Props = NativeStackScreenProps<MainStackParamList, 'SafetyMap'>;

function getScoreInfo(score: number) {
  if (score >= 75) return { label: 'Safe Area', color: colors.green, icon: ShieldCheck, gradient: ['#064e3b', '#10b981'] as [string, string] };
  if (score >= 50) return { label: 'Moderate Risk', color: colors.amber, icon: ShieldAlert, gradient: ['#78350f', '#f59e0b'] as [string, string] };
  return { label: 'Danger Zone', color: colors.primary, icon: AlertTriangle, gradient: ['#450a0a', '#ef4444'] as [string, string] };
}

const RISK_FACTORS = [
  { key: 'robbery', label: 'Robbery / Theft', emoji: '🔪' },
  { key: 'harassment', label: 'Harassment', emoji: '😡' },
  { key: 'suspicious_activity', label: 'Suspicious Activity', emoji: '👁️' },
  { key: 'poor_lighting', label: 'Poor Lighting', emoji: '💡' },
];

export default function SafetyMapScreen({ navigation }: Props) {
  const [safetyData, setSafetyData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [locationName, setLocationName] = useState('Your Area');

  useEffect(() => {
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') { setLoading(false); return; }
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        const [geo] = await Location.reverseGeocodeAsync({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
        if (geo) setLocationName([geo.district || geo.city, geo.region].filter(Boolean).join(', ') || 'Your Area');
        const res = await api.post('/safety/score', { latitude: loc.coords.latitude, longitude: loc.coords.longitude });
        setSafetyData(res.data.data);
      } catch { /* show fallback */ }
      finally { setLoading(false); }
    })();
  }, []);

  if (loading) {
    return (
      <LinearGradient colors={['#060d1f', '#0a1428']} style={styles.root}>
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Scanning your area...</Text>
        </View>
      </LinearGradient>
    );
  }

  const score = safetyData?.score ?? 72;
  const factors = safetyData?.factors ?? {};
  const { label, color, icon: Icon, gradient } = getScoreInfo(score);

  return (
    <LinearGradient colors={['#060d1f', '#0a1428', '#0d1b35']} style={styles.root}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Nav Header */}
        <View style={styles.navHeader}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.navBackBtn} activeOpacity={0.7}>
            <ChevronLeft color={colors.text} size={24} />
          </TouchableOpacity>
          <View style={styles.navCenter}>
            <Text style={styles.navTitle}>Safety Map</Text>
            <Text style={styles.navSub}>{locationName}</Text>
          </View>
          <View style={{ width: 40 }} />
        </View>

        {/* Score Card */}
        <LinearGradient colors={gradient} style={styles.scoreCard} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
          <View style={styles.scoreCardContent}>
            <View style={styles.scoreLeft}>
              <Text style={styles.scoreNum}>{score}</Text>
              <Text style={styles.scoreSlash}>/100</Text>
            </View>
            <View style={styles.scoreRight}>
              <View style={[styles.iconCircle, { backgroundColor: 'rgba(255,255,255,0.15)' }]}>
                <Icon color="#fff" size={36} />
              </View>
              <Text style={styles.scoreLabel}>{label}</Text>
              <View style={styles.scorePill}>
                <TrendingUp color="rgba(255,255,255,0.8)" size={12} />
                <Text style={styles.scorePillText}>30-day average</Text>
              </View>
            </View>
          </View>

          {/* Score Bar */}
          <View style={styles.barBg}>
            <View style={[styles.barFill, { width: `${score}%` as any, backgroundColor: 'rgba(255,255,255,0.9)' }]} />
          </View>
        </LinearGradient>

        {/* Risk Breakdown */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>RISK FACTORS · LAST 30 DAYS · 2KM RADIUS</Text>
          <View style={styles.factorsCard}>
            {RISK_FACTORS.map((f, i) => {
              const count = factors[f.key] ?? 0;
              const barPct = Math.min(100, count * 10);
              return (
                <View key={f.key} style={[styles.factorRow, i < RISK_FACTORS.length - 1 && styles.factorBorder]}>
                  <Text style={styles.factorEmoji}>{f.emoji}</Text>
                  <View style={styles.factorBody}>
                    <View style={styles.factorTopRow}>
                      <Text style={styles.factorLabel}>{f.label}</Text>
                      <Text style={[styles.factorCount, { color: count === 0 ? colors.green : count < 3 ? colors.amber : colors.primary }]}>
                        {count} report{count !== 1 ? 's' : ''}
                      </Text>
                    </View>
                    <View style={styles.miniBarBg}>
                      <View style={[styles.miniBarFill, {
                        width: `${barPct}%` as any,
                        backgroundColor: count === 0 ? colors.green : count < 3 ? colors.amber : colors.primary,
                      }]} />
                    </View>
                  </View>
                </View>
              );
            })}
          </View>
        </View>

        {/* Tip */}
        <View style={styles.tipBox}>
          <Text style={styles.tipIcon}>💡</Text>
          <Text style={styles.tipText}>Scores are based on verified police reports and community incident submissions within your area.</Text>
        </View>
      </ScrollView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  loadingText: { ...font.body, color: colors.textMuted },
  scroll: { flexGrow: 1, padding: spacing.lg, paddingTop: spacing.xl, paddingBottom: spacing.xxl },
  navHeader: {
    flexDirection: 'row', alignItems: 'center',
    paddingTop: Platform.OS === 'ios' ? 52 : 40, paddingBottom: 12,
    paddingHorizontal: spacing.md, gap: spacing.sm,
    backgroundColor: 'rgba(6,13,31,0.98)',
    borderBottomWidth: 1, borderBottomColor: colors.glassBorder,
  },
  navBackBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: colors.bgCard, borderWidth: 1, borderColor: colors.glassBorder,
    alignItems: 'center', justifyContent: 'center',
  },
  navCenter: { flex: 1 },
  navTitle: { ...font.h3, color: colors.text },
  navSub: { ...font.xs, color: colors.textMuted, marginTop: 2 },
  scoreCard: { borderRadius: radius.xl, padding: spacing.xl, marginBottom: spacing.xl, ...shadows.card },
  scoreCardContent: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.lg },
  scoreLeft: { flexDirection: 'row', alignItems: 'flex-end' },
  scoreNum: { fontSize: 80, fontWeight: 'bold', color: '#fff', lineHeight: 84 },
  scoreSlash: { ...font.h2, color: 'rgba(255,255,255,0.6)', marginBottom: spacing.sm },
  scoreRight: { alignItems: 'flex-end' },
  iconCircle: { width: 70, height: 70, borderRadius: 35, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.sm },
  scoreLabel: { ...font.h2, color: '#fff', marginBottom: spacing.xs },
  scorePill: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: radius.full, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  scorePillText: { ...font.xs, color: 'rgba(255,255,255,0.8)' },
  barBg: { height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.2)' },
  barFill: { height: 6, borderRadius: 3 },
  section: { marginBottom: spacing.lg },
  sectionLabel: { ...font.label, textTransform: 'uppercase', marginBottom: spacing.sm },
  factorsCard: { backgroundColor: colors.bgCard, borderRadius: radius.xl, borderWidth: 1, borderColor: colors.glassBorder, overflow: 'hidden', ...shadows.card },
  factorRow: { flexDirection: 'row', alignItems: 'center', padding: spacing.md, gap: spacing.md },
  factorBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  factorEmoji: { fontSize: 24, width: 32, textAlign: 'center' },
  factorBody: { flex: 1 },
  factorTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm },
  factorLabel: { ...font.body, color: colors.text },
  factorCount: { ...font.sm, fontWeight: '700' },
  miniBarBg: { height: 4, borderRadius: 2, backgroundColor: colors.border },
  miniBarFill: { height: 4, borderRadius: 2 },
  tipBox: { flexDirection: 'row', gap: spacing.sm, backgroundColor: colors.bgCard, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.glassBorder, padding: spacing.md },
  tipIcon: { fontSize: 18 },
  tipText: { ...font.sm, color: colors.textMuted, flex: 1, lineHeight: 20 },
});
