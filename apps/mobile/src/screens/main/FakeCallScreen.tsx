import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, Vibration, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { FadeIn as RFadeIn, FadeInDown } from 'react-native-reanimated';
import { Grid3x3, MicOff, Phone, PhoneOff, Plus, UserRound, Video, Volume2 } from 'lucide-react-native';

import { MainStackParamList } from '../../navigation/MainStack';
import { Theme, useTheme, useThemedStyles } from '../../theme';
import { spacing, type } from '../../theme/tokens';
import { Breathing, FadeIn, PressableScale, PulseRings } from '../../components/ui';
import { useLanguage, useT } from '../../i18n';

type Props = NativeStackScreenProps<MainStackParamList, 'FakeCall'>;

export default function FakeCallScreen({ navigation }: Props) {
  // Pinned dark: this imitates the system incoming-call screen, which is dark
  // on every phone. Theming it would break the illusion the feature relies on.
  const styles = useThemedStyles(makeStyles, 'dark');
  const { colors } = useTheme('dark');
  const t = useT();
  const { num } = useLanguage();
  const insets = useSafeAreaInsets();
  const [callState, setCallState] = useState<'ringing' | 'active'>('ringing');
  const [seconds, setSeconds] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (callState === 'ringing') {
      // Vibrate 1s, pause 1s, looping.
      Vibration.vibrate([0, 1000, 1000], true);
    } else {
      Vibration.cancel();
      timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
    }
    return () => {
      Vibration.cancel();
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [callState]);

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60).toString().padStart(2, '0');
    const s = (secs % 60).toString().padStart(2, '0');
    return num(`${m}:${s}`);
  };

  const GRID = [
    { icon: MicOff, label: t('mute'), dim: false },
    { icon: Grid3x3, label: t('keypad'), dim: false },
    { icon: Volume2, label: t('speaker'), dim: false },
    { icon: Plus, label: t('add call'), dim: true },
    { icon: Video, label: t('video'), dim: true },
    { icon: UserRound, label: t('contacts'), dim: true },
  ];

  return (
    <LinearGradient colors={['#1c1c1e', '#050505']} style={styles.root}>
      <View style={[styles.safeArea, { paddingTop: insets.top + spacing.xxl, paddingBottom: insets.bottom + spacing.xl }]}>
        {/* Caller */}
        <View style={styles.callerInfo}>
          <View style={styles.avatarWrap}>
            {callState === 'ringing' && <PulseRings color="#34c759" size={128} count={3} duration={2000} />}
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{t('Dad').charAt(0)}</Text>
            </View>
          </View>
          <FadeIn delay={80} style={{ alignItems: 'center' }}>
            <Text style={styles.callerName}>{t('Dad')}</Text>
            <Animated.Text key={callState} entering={RFadeIn} style={styles.callerType}>
              {callState === 'ringing' ? t('mobile · calling…') : formatTime(seconds)}
            </Animated.Text>
          </FadeIn>
        </View>

        {callState === 'active' && (
          <View style={styles.activeGrid}>
            {GRID.map((g, i) => (
              <Animated.View key={g.label} entering={FadeInDown.delay(i * 50).duration(300)} style={styles.gridItem}>
                <View style={[styles.iconCircle, g.dim && { opacity: 0.35 }]}>
                  <g.icon color={colors.onFill} size={26} />
                </View>
                <Text style={styles.gridText}>{g.label}</Text>
              </Animated.View>
            ))}
          </View>
        )}

        {/* Actions */}
        {callState === 'ringing' ? (
          <View style={styles.ringingRow}>
            <View style={styles.actionCol}>
              <PressableScale onPress={() => navigation.goBack()} style={[styles.callBtn, styles.declineBtn]} accessibilityRole="button">
                <PhoneOff color={colors.onFill} size={30} />
              </PressableScale>
              <Text style={styles.btnLabel}>{t('Decline')}</Text>
            </View>
            <View style={styles.actionCol}>
              <Breathing min={0.94} max={1.08} duration={500}>
                <PressableScale onPress={() => setCallState('active')} style={[styles.callBtn, styles.acceptBtn]} accessibilityRole="button">
                  <Phone color={colors.onFill} size={30} />
                </PressableScale>
              </Breathing>
              <Text style={styles.btnLabel}>{t('Accept')}</Text>
            </View>
          </View>
        ) : (
          <View style={styles.activeRow}>
            <PressableScale onPress={() => navigation.goBack()} style={[styles.callBtn, styles.declineBtn]} accessibilityRole="button">
              <PhoneOff color={colors.onFill} size={30} />
            </PressableScale>
          </View>
        )}
      </View>
    </LinearGradient>
  );
}

const makeStyles = ({ colors }: Theme) =>
  StyleSheet.create({
    root: { flex: 1 },
    safeArea: { flex: 1, justifyContent: 'space-between' },
    callerInfo: { alignItems: 'center' },
    avatarWrap: { width: 170, height: 170, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.md },
    avatar: {
      width: 104,
      height: 104,
      borderRadius: 52,
      backgroundColor: '#3a3a3c',
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarText: { color: colors.onFill, fontSize: 44, fontWeight: '300' },
    callerName: { color: colors.onFill, fontSize: 38, fontWeight: '300', marginBottom: 6 },
    callerType: { ...type.body, color: '#aeaeb2', fontSize: 17 },
    activeGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      paddingHorizontal: spacing.xl,
      rowGap: spacing.xl,
    },
    gridItem: { width: '33.33%', alignItems: 'center' },
    iconCircle: {
      width: 70,
      height: 70,
      borderRadius: 35,
      backgroundColor: 'rgba(255,255,255,0.14)',
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 8,
    },
    gridText: { color: colors.onFill, fontSize: 13 },
    ringingRow: { flexDirection: 'row', justifyContent: 'space-around', paddingHorizontal: spacing.xl },
    activeRow: { alignItems: 'center', justifyContent: 'center' },
    actionCol: { alignItems: 'center' },
    callBtn: { width: 76, height: 76, borderRadius: 38, alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
    declineBtn: { backgroundColor: '#ff3b30' },
    acceptBtn: { backgroundColor: '#34c759' },
    btnLabel: { color: colors.onFill, fontSize: 15 },
  });
