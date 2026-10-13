import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as Location from 'expo-location';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { Easing, ZoomIn, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import {
  AlertTriangle,
  Eye,
  Lightbulb,
  MapPin,
  MapPinOff,
  ShieldAlert,
  ShieldCheck,
  TrendingUp,
  UserX,
  Wallet,
} from 'lucide-react-native';

import { MainStackParamList } from '../../navigation/MainStack';
import api from '../../services/api';
import { useTheme } from '../../theme';
import { useLanguage, useT } from '../../i18n';
import { radius, spacing, type } from '../../theme/tokens';
import type { Palette } from '../../theme/tokens';
import TileMap from '../../components/TileMap';
import { AppBar, Card, EmptyState, FadeIn, Screen, SectionLabel, Shimmer, Txt } from '../../components/ui';

type Props = NativeStackScreenProps<MainStackParamList, 'SafetyMap'>;

function scoreInfo(score: number, colors: Palette) {
  if (score >= 75) return { label: 'Safe area', color: colors.success, icon: ShieldCheck, gradient: [colors.success, colors.accentPressed] as const };
  if (score >= 50) return { label: 'Moderate risk', color: colors.warning, icon: ShieldAlert, gradient: [colors.warning, '#A8650C'] as const };
  return { label: 'Danger zone', color: colors.danger, icon: AlertTriangle, gradient: [colors.danger, colors.dangerPressed] as const };
}

const RISK_FACTORS = [
  { key: 'robbery', label: 'Robbery / Theft', icon: Wallet },
  { key: 'harassment', label: 'Harassment', icon: UserX },
  { key: 'suspicious_activity', label: 'Suspicious activity', icon: Eye },
  { key: 'poor_lighting', label: 'Poor lighting', icon: Lightbulb },
];

function AnimatedBar({ pct, color, track, height = 6, delay = 0 }: { pct: number; color: string; track: string; height?: number; delay?: number }) {
  const w = useSharedValue(0);
  useEffect(() => {
    w.value = withDelay(delay, withTiming(pct, { duration: 900, easing: Easing.out(Easing.cubic) }));
  }, [delay, pct, w]);
  const style = useAnimatedStyle(() => ({ width: `${w.value}%` }));
  return (
    <View style={{ height, borderRadius: height / 2, backgroundColor: track, overflow: 'hidden' }}>
      <Animated.View style={[{ height, borderRadius: height / 2, backgroundColor: color }, style]} />
    </View>
  );
}

export default function SafetyMapScreen(_props: Props) {
  const { colors, shadows } = useTheme();
  const t = useT();
  const { num } = useLanguage();
  const [safetyData, setSafetyData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [noLocation, setNoLocation] = useState(false);
  const [locationName, setLocationName] = useState<string | null>(null);
  const [position, setPosition] = useState<{ latitude: number; longitude: number } | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          setNoLocation(true);
          return;
        }
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        setPosition({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
        try {
          const [geo] = await Location.reverseGeocodeAsync({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
          if (geo) setLocationName([geo.district || geo.city, geo.region].filter(Boolean).join(', ') || null);
        } catch {
          /* name is cosmetic */
        }
        const res = await api.get('/incidents/safety-score', {
          params: { latitude: loc.coords.latitude, longitude: loc.coords.longitude },
        });
        setSafetyData(res.data.data);
      } catch {
        /* handled by the unavailable state below */
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const header = <AppBar title={t('Safety Map')} subtitle={locationName ?? t('Your area')} />;

  if (loading) {
    return (
      <Screen>
        {header}
        <Shimmer width="100%" height={210} radius={radius.xl} />
        <View style={{ height: spacing.lg }} />
        <Shimmer width="100%" height={260} radius={radius.lg} />
      </Screen>
    );
  }

  // Never invent a score for a safety decision: show that it is unavailable.
  if (noLocation || typeof safetyData?.score !== 'number') {
    return (
      <Screen>
        {header}
        <Card>
          <EmptyState
            icon={<MapPinOff color={colors.textMuted} size={30} />}
            title={noLocation ? t('Location is off') : t('Safety score unavailable')}
            message={
              noLocation
                ? t('Allow location access to see how safe your area is.')
                : t('We could not load the score right now. Check your connection and try again.')
            }
          />
        </Card>
      </Screen>
    );
  }

  const score: number = safetyData.score;
  const factors = safetyData.factors ?? {};
  const info = scoreInfo(score, colors);

  return (
    <Screen>
      {header}

      <FadeIn from="zoom">
        <LinearGradient
          colors={info.gradient}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[{ borderRadius: radius.xl, padding: spacing.lg }, shadows.card]}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.lg }}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
              <Animated.Text entering={ZoomIn.delay(150).springify()} style={{ fontSize: 76, fontWeight: '900', color: '#fff', lineHeight: 80 }}>
                {num(score)}
              </Animated.Text>
              <Text style={[type.h2, { color: 'rgba(255,255,255,0.75)', marginBottom: spacing.sm }]}>/{num(100)}</Text>
            </View>
            <View style={{ alignItems: 'flex-end', gap: spacing.xs }}>
              <View style={{ width: 62, height: 62, borderRadius: 31, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.2)' }}>
                <info.icon color="#fff" size={32} />
              </View>
              <Text style={[type.h3, { color: '#fff', fontWeight: '800' }]}>{t(info.label)}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: radius.full, paddingHorizontal: spacing.sm, paddingVertical: 2 }}>
                <TrendingUp color="#fff" size={12} />
                <Text style={[type.xs, { color: '#fff' }]}>{t('30-day average')}</Text>
              </View>
            </View>
          </View>
          <AnimatedBar pct={score} color="#fff" track="rgba(255,255,255,0.25)" delay={200} />
        </LinearGradient>
      </FadeIn>

      {position && (
        <FadeIn delay={80} style={{ marginTop: spacing.md }}>
          <TileMap latitude={position.latitude} longitude={position.longitude} color={info.color} />
        </FadeIn>
      )}

      <SectionLabel>{t('Risk factors · last 30 days · 2 km')}</SectionLabel>
      <Card padded={false} delay={120}>
        {RISK_FACTORS.map((f, i) => {
          const count: number = factors[f.key] ?? 0;
          const c = count === 0 ? colors.success : count < 3 ? colors.warning : colors.danger;
          const cText = count === 0 ? colors.successText : count < 3 ? colors.warningText : colors.dangerText;
          return (
            <View
              key={f.key}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                padding: spacing.md,
                gap: spacing.md,
                borderBottomWidth: i < RISK_FACTORS.length - 1 ? 1 : 0,
                borderBottomColor: colors.border,
              }}
            >
              <View style={{ width: 38, height: 38, borderRadius: radius.md, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' }}>
                <f.icon color={cText} size={18} />
              </View>
              <View style={{ flex: 1, gap: spacing.sm }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Txt variant="body">{t(f.label)}</Txt>
                  <Txt variant="smStrong" style={{ color: cText }}>
                    {t(count === 1 ? '{n} report' : '{n} reports', { n: count })}
                  </Txt>
                </View>
                <AnimatedBar pct={Math.min(100, count * 10)} color={c} track={colors.border} height={5} delay={300 + i * 100} />
              </View>
            </View>
          );
        })}
      </Card>

      <Card delay={220} style={{ marginTop: spacing.md, flexDirection: 'row', gap: spacing.sm }}>
        <MapPin color={colors.accentText} size={16} />
        <Txt variant="sm" tone="muted" style={{ flex: 1 }}>
          {t('Scores are based on verified community incident reports within your area.')}
        </Txt>
      </Card>
    </Screen>
  );
}
