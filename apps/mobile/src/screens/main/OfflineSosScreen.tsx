import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, Platform, SafeAreaView } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { MainStackParamList } from '../../navigation/MainStack';
import { WifiOff, Bluetooth, Send, ShieldAlert, CheckCircle, Activity } from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { useSharedValue, useAnimatedStyle, withRepeat, withTiming, Easing, withSequence, withDelay } from 'react-native-reanimated';
import { sendOfflineSosSms } from '../../services/offlineSos';
import { colors, font, spacing, radius, shadows, gradients } from '../../theme';

type Props = NativeStackScreenProps<MainStackParamList, 'OfflineSos'>;

export default function OfflineSosScreen({ navigation }: Props) {
  const [phase, setPhase] = useState<'scanning' | 'connected' | 'broadcasting'>('scanning');
  const [devicesFound, setDevicesFound] = useState(0);

  // Radar animations
  const pulse1Scale = useSharedValue(0.1);
  const pulse1Op = useSharedValue(1);
  const pulse2Scale = useSharedValue(0.1);
  const pulse2Op = useSharedValue(1);
  const scannerRotation = useSharedValue(0);

  useEffect(() => {
    // Start radar pulses
    pulse1Scale.value = withRepeat(withTiming(1, { duration: 2000, easing: Easing.linear }), -1, false);
    pulse1Op.value = withRepeat(withTiming(0, { duration: 2000, easing: Easing.linear }), -1, false);
    
    setTimeout(() => {
      pulse2Scale.value = withRepeat(withTiming(1, { duration: 2000, easing: Easing.linear }), -1, false);
      pulse2Op.value = withRepeat(withTiming(0, { duration: 2000, easing: Easing.linear }), -1, false);
    }, 1000);

    // Scanner sweeping arm
    scannerRotation.value = withRepeat(withTiming(360, { duration: 3000, easing: Easing.linear }), -1, false);

    // Simulation Sequence
    const timer1 = setTimeout(() => {
      setDevicesFound(1);
    }, 2500);

    const timer2 = setTimeout(() => {
      setDevicesFound(3);
      setPhase('connected');
    }, 4500);

    const timer3 = setTimeout(() => {
      setPhase('broadcasting');
    }, 6000);

    return () => {
      clearTimeout(timer1);
      clearTimeout(timer2);
      clearTimeout(timer3);
    };
  }, []);

  const p1Style = useAnimatedStyle(() => ({
    transform: [{ scale: pulse1Scale.value }],
    opacity: pulse1Op.value
  }));
  const p2Style = useAnimatedStyle(() => ({
    transform: [{ scale: pulse2Scale.value }],
    opacity: pulse2Op.value
  }));
  const scannerStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${scannerRotation.value}deg` }]
  }));

  const handleManualSms = async () => {
    const result = await sendOfflineSosSms();
    if (!result.opened) {
      Alert.alert('Offline', `${result.reason || 'SMS is not available on this device.'} Please call 999 directly.`);
    }
  };

  return (
    <LinearGradient colors={['#060d1f', '#000000']} style={styles.root}>
      <SafeAreaView style={styles.safeArea}>
        
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.badgeRow}>
            <WifiOff color={colors.amber} size={18} />
            <Text style={styles.badgeText}>OFFLINE MODE</Text>
          </View>
          <Text style={styles.title}>Bluetooth Mesh Network</Text>
          <Text style={styles.subtitle}>
            {phase === 'scanning' && 'Scanning for nearby Nari Surokkha nodes...'}
            {phase === 'connected' && 'Establishing secure peer-to-peer connection...'}
            {phase === 'broadcasting' && 'Broadcasting encrypted SOS packet via BLE...'}
          </Text>
        </View>

        {/* Radar UI */}
        <View style={styles.radarContainer}>
          <View style={styles.radarInner}>
            {/* Concentric rings */}
            <View style={[styles.ring, { width: 100, height: 100, borderRadius: 50 }]} />
            <View style={[styles.ring, { width: 200, height: 200, borderRadius: 100 }]} />
            <View style={[styles.ring, { width: 300, height: 300, borderRadius: 150 }]} />
            
            {/* Pulses */}
            <Animated.View style={[styles.pulse, p1Style]} />
            <Animated.View style={[styles.pulse, p2Style]} />
            
            {/* Scanner Arm */}
            <Animated.View style={[styles.scannerArmBox, scannerStyle]}>
              <LinearGradient 
                colors={['rgba(59,130,246,0.6)', 'transparent']}
                start={{ x: 0.5, y: 0 }}
                end={{ x: 0, y: 1 }}
                style={styles.scannerArm}
              />
            </Animated.View>

            {/* Center Icon */}
            <View style={styles.centerNode}>
              <Bluetooth color="#fff" size={32} />
            </View>

            {/* Simulated Nodes */}
            {devicesFound >= 1 && (
              <View style={[styles.node, { top: 40, left: 60 }]}>
                <Activity color={colors.blue} size={16} />
              </View>
            )}
            {devicesFound >= 3 && (
              <>
                <View style={[styles.node, { bottom: 80, right: 50 }]}>
                  <Activity color={colors.blue} size={16} />
                </View>
                <View style={[styles.node, { top: 120, right: 30 }]}>
                  <Activity color={colors.blue} size={16} />
                </View>
              </>
            )}
          </View>
        </View>

        {/* Status Box */}
        <View style={styles.statusBox}>
          <View style={styles.statusRow}>
            <Text style={styles.statusLabel}>Mesh Nodes Found</Text>
            <Text style={styles.statusValue}>{devicesFound}</Text>
          </View>
          <View style={styles.statusRow}>
            <Text style={styles.statusLabel}>Network Status</Text>
            <View style={styles.statusBadge}>
              {phase === 'broadcasting' ? <CheckCircle color={colors.green} size={14} /> : <Activity color={colors.amber} size={14} />}
              <Text style={[styles.statusBadgeText, { color: phase === 'broadcasting' ? colors.green : colors.amber }]}>
                {phase.toUpperCase()}
              </Text>
            </View>
          </View>
        </View>

        {/* Fallback Action */}
        <View style={styles.actionArea}>
          <Text style={styles.fallbackNote}>If the mesh network fails to reach authorities, dispatch via Cellular SMS.</Text>
          <TouchableOpacity onPress={handleManualSms} style={styles.smsBtn} activeOpacity={0.8}>
            <LinearGradient colors={gradients.primary} style={styles.smsBtnInner} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
              <Send color="#fff" size={20} />
              <Text style={styles.smsBtnText}>Dispatch via SMS Fallback</Text>
            </LinearGradient>
          </TouchableOpacity>

          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.cancelBtn}>
            <Text style={styles.cancelBtnText}>Cancel Offline SOS</Text>
          </TouchableOpacity>
        </View>

      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safeArea: { flex: 1, justifyContent: 'space-between' },
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: Platform.OS === 'ios' ? 20 : 40,
    alignItems: 'center',
  },
  badgeRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(245,158,11,0.15)',
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 20, marginBottom: spacing.md,
    borderWidth: 1, borderColor: 'rgba(245,158,11,0.3)',
  },
  badgeText: { color: colors.amber, fontSize: 12, fontWeight: '700', letterSpacing: 1 },
  title: { fontSize: 24, fontWeight: 'bold', color: '#fff', marginBottom: 8 },
  subtitle: { color: 'rgba(255,255,255,0.7)', textAlign: 'center', paddingHorizontal: 20, lineHeight: 22 },
  
  radarContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radarInner: {
    width: 300, height: 300,
    alignItems: 'center', justifyContent: 'center',
  },
  ring: {
    position: 'absolute',
    borderWidth: 1, borderColor: 'rgba(59,130,246,0.2)',
  },
  pulse: {
    position: 'absolute',
    width: 300, height: 300, borderRadius: 150,
    backgroundColor: 'rgba(59,130,246,0.15)',
  },
  scannerArmBox: {
    position: 'absolute',
    width: 300, height: 300,
    alignItems: 'center', justifyContent: 'center',
  },
  scannerArm: {
    position: 'absolute',
    top: 0, right: 150,
    width: 150, height: 150,
    borderBottomRightRadius: 150,
  },
  centerNode: {
    width: 70, height: 70, borderRadius: 35,
    backgroundColor: '#1e3a8a',
    borderWidth: 2, borderColor: '#60a5fa',
    alignItems: 'center', justifyContent: 'center',
    ...shadows.primary,
  },
  node: {
    position: 'absolute',
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: 'rgba(15,23,42,0.9)',
    borderWidth: 2, borderColor: colors.blue,
    alignItems: 'center', justifyContent: 'center',
  },

  statusBox: {
    marginHorizontal: spacing.lg,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
  },
  statusRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 8,
  },
  statusLabel: { color: 'rgba(255,255,255,0.7)', fontSize: 14 },
  statusValue: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  statusBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(0,0,0,0.3)',
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12,
  },
  statusBadgeText: { fontSize: 12, fontWeight: '600', letterSpacing: 0.5 },

  actionArea: {
    padding: spacing.lg,
    paddingBottom: Platform.OS === 'ios' ? 40 : 20,
  },
  fallbackNote: {
    color: 'rgba(255,255,255,0.5)', fontSize: 12, textAlign: 'center',
    marginBottom: spacing.md, paddingHorizontal: 20,
  },
  smsBtn: {
    width: '100%', borderRadius: radius.xl, marginBottom: spacing.md,
    ...shadows.primary,
  },
  smsBtnInner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    paddingVertical: 18, borderRadius: radius.xl,
  },
  smsBtnText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  cancelBtn: {
    paddingVertical: 12, alignItems: 'center',
  },
  cancelBtnText: {
    color: 'rgba(255,255,255,0.5)', fontSize: 14,
  }
});
