import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Vibration, Platform, SafeAreaView } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { MainStackParamList } from '../../navigation/MainStack';
import { Phone, PhoneOff, MessageSquare, Clock, MicOff, Grid3x3, Video } from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Theme, useTheme, useThemedStyles } from '../../theme';
import { radius, spacing, type } from '../../theme/tokens';

type Props = NativeStackScreenProps<MainStackParamList, 'FakeCall'>;

export default function FakeCallScreen({ navigation }: Props) {
    // Pinned dark: this imitates the system's incoming-call screen, and that
  // screen is dark on every phone. Theming it would break the illusion the
  // feature depends on.
  const styles = useThemedStyles(makeStyles, 'dark');
  const { colors, gradients, shadows } = useTheme('dark');
  void gradients; void shadows;
  const [callState, setCallState] = useState<'ringing' | 'active'>('ringing');
  const [seconds, setSeconds] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (callState === 'ringing') {
      // Android vibration pattern: Wait 0, vibrate 1s, wait 1s, vibrate 1s (looping)
      const pattern = [0, 1000, 1000];
      Vibration.vibrate(pattern, true);
    } else {
      Vibration.cancel();
      timerRef.current = setInterval(() => {
        setSeconds(s => s + 1);
      }, 1000);
    }

    return () => {
      Vibration.cancel();
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [callState]);

  const handleAccept = () => {
    setCallState('active');
  };

  const handleDecline = () => {
    navigation.goBack();
  };

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60).toString().padStart(2, '0');
    const s = (secs % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  return (
    <LinearGradient colors={['#1c1c1e', '#000000']} style={styles.root}>
      <SafeAreaView style={styles.safeArea}>
        
        {/* Caller Info */}
        <View style={styles.callerInfo}>
          <Text style={styles.callerName}>Dad</Text>
          <Text style={styles.callerType}>
            {callState === 'ringing' ? 'mobile' : formatTime(seconds)}
          </Text>
        </View>

        {callState === 'active' && (
          <View style={styles.activeGrid}>
            <View style={styles.gridRow}>
              <View style={styles.gridItem}>
                <View style={styles.iconCircle}><MicOff color={colors.onFill} size={28} /></View>
                <Text style={styles.gridText}>mute</Text>
              </View>
              <View style={styles.gridItem}>
                <View style={styles.iconCircle}><Grid3x3 color={colors.onFill} size={28} /></View>
                <Text style={styles.gridText}>keypad</Text>
              </View>
              <View style={styles.gridItem}>
                <View style={styles.iconCircle}><Phone color={colors.onFill} size={28} /></View>
                <Text style={styles.gridText}>audio</Text>
              </View>
            </View>
            <View style={styles.gridRow}>
              <View style={styles.gridItem}>
                <View style={[styles.iconCircle, { opacity: 0.3 }]}><View style={styles.plusIcon}><Text style={styles.plusText}>+</Text></View></View>
                <Text style={styles.gridText}>add call</Text>
              </View>
              <View style={styles.gridItem}>
                <View style={[styles.iconCircle, { opacity: 0.3 }]}><Video color={colors.onFill} size={28} /></View>
                <Text style={styles.gridText}>FaceTime</Text>
              </View>
              <View style={styles.gridItem}>
                <View style={[styles.iconCircle, { opacity: 0.3 }]}><User color={colors.onFill} size={28} /></View>
                <Text style={styles.gridText}>contacts</Text>
              </View>
            </View>
          </View>
        )}

        {/* Action Buttons */}
        <View style={styles.actionArea}>
          {callState === 'ringing' ? (
            <View style={styles.ringingRow}>
              <View style={styles.actionCol}>
                <TouchableOpacity onPress={handleDecline} style={[styles.callBtn, styles.declineBtn]} activeOpacity={0.7}>
                  <PhoneOff color={colors.onFill} size={32} />
                </TouchableOpacity>
                <Text style={styles.btnLabel}>Decline</Text>
              </View>
              <View style={styles.actionCol}>
                <TouchableOpacity onPress={handleAccept} style={[styles.callBtn, styles.acceptBtn]} activeOpacity={0.7}>
                  <Phone color={colors.onFill} size={32} />
                </TouchableOpacity>
                <Text style={styles.btnLabel}>Accept</Text>
              </View>
            </View>
          ) : (
            <View style={styles.activeRow}>
              <TouchableOpacity onPress={handleDecline} style={[styles.callBtn, styles.declineBtn]} activeOpacity={0.7}>
                <PhoneOff color={colors.onFill} size={32} />
              </TouchableOpacity>
            </View>
          )}
        </View>

      </SafeAreaView>
    </LinearGradient>
  );
}

// Just a quick stub for User icon since I didn't import it at the top
const User = ({ color, size }: any) => (
  <View style={{ width: size, height: size, borderRadius: size/2, borderWidth: 2, borderColor: color, alignItems: 'center', justifyContent: 'center' }}>
    <View style={{ width: size/2.5, height: size/2.5, borderRadius: size/2, backgroundColor: color, marginBottom: 2 }} />
    <View style={{ width: size/1.5, height: size/2.5, borderTopLeftRadius: size, borderTopRightRadius: size, backgroundColor: color }} />
  </View>
);

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
  safeArea: { flex: 1, justifyContent: 'space-between' },
  callerInfo: {
    alignItems: 'center',
    paddingTop: Platform.OS === 'ios' ? 60 : 80,
  },
  callerName: {
    color: colors.onFill,
    fontSize: 40,
    fontWeight: '300',
    marginBottom: 8,
  },
  callerType: {
    color: colors.textSub,
    fontSize: 18,
  },
  activeGrid: {
    paddingHorizontal: 40,
    marginTop: 40,
  },
  gridRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 40,
  },
  gridItem: {
    alignItems: 'center',
  },
  iconCircle: {
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  gridText: {
    color: colors.onFill,
    fontSize: 14,
  },
  plusIcon: { alignItems: 'center', justifyContent: 'center' },
  plusText: { color: colors.onFill, fontSize: 32, fontWeight: '300', marginTop: -4 },
  actionArea: {
    paddingBottom: Platform.OS === 'ios' ? 60 : 40,
  },
  ringingRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingHorizontal: 40,
  },
  activeRow: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionCol: {
    alignItems: 'center',
  },
  callBtn: {
    width: 75,
    height: 75,
    borderRadius: 37.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  declineBtn: {
    backgroundColor: colors.danger,
  },
  acceptBtn: {
    backgroundColor: '#34c759',
  },
  btnLabel: {
    color: colors.onFill,
    fontSize: 16,
  },
});
};
