import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, SafeAreaView, Alert as RNAlert, Platform, Vibration } from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { MainStackParamList } from '../../navigation/MainStack';
import api from '../../services/api';
import * as Location from 'expo-location';
import * as SMS from 'expo-sms';
import { useAuthStore } from '../../store/authStore';
import { uploadMotionSample, uploadConfirmedEmergencySample } from '../../services/ml/motionSampleUploader';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, font, spacing, radius, shadows } from '../../theme';
import Animated, { useSharedValue, useAnimatedStyle, withRepeat, withTiming, Easing } from 'react-native-reanimated';
import { AlertTriangle, CheckCircle } from 'lucide-react-native';

type NavigationProp = NativeStackNavigationProp<MainStackParamList>;

export default function SoftAlertScreen() {
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<RouteProp<MainStackParamList, 'SoftAlert'>>();
  const manual = route.params?.manual ?? false;
  const { user } = useAuthStore();
  const [countdown, setCountdown] = useState(15);
  const [alertId, setAlertId] = useState<string | null>(null);

  const ringScale = useSharedValue(1);
  const ringOp = useSharedValue(0.7);

  useEffect(() => {
    ringScale.value = withRepeat(withTiming(1.4, { duration: 800, easing: Easing.out(Easing.quad) }), -1, false);
    ringOp.value = withRepeat(withTiming(0, { duration: 800, easing: Easing.out(Easing.quad) }), -1, false);

    // Vibrate urgently to alert the user (pattern: vibrate 500ms, pause 300ms, repeat)
    if (Platform.OS !== 'web') {
      Vibration.vibrate([0, 500, 300, 500, 300, 500], true);
    }

    createBackendAlert();

    return () => {
      Vibration.cancel();
    };
  }, []);

  useEffect(() => {
    if (countdown > 0) {
      const t = setTimeout(() => setCountdown(c => c - 1), 1000);
      return () => clearTimeout(t);
    } else confirmEmergency();
  }, [countdown]);

  const ringStyle = useAnimatedStyle(() => ({
    transform: [{ scale: ringScale.value }],
    opacity: ringOp.value,
  }));

  const createBackendAlert = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      const loc = await Location.getCurrentPositionAsync({});
      const res = await api.post('/alerts/soft', { latitude: loc.coords.latitude, longitude: loc.coords.longitude, accuracy: loc.coords.accuracy });
      setAlertId(res.data.data.id);
    } catch (e) { console.error(e); }
  };

  const cancelAlert = async () => {
    Vibration.cancel();
    // False alarm → capture this window as a "normal" negative training sample.
    void uploadMotionSample('normal', 'false_alarm');
    if (alertId) { try { await api.patch(`/alerts/${alertId}/soft/cancel`); } catch { /* ignore */ } }
    navigation.goBack();
  };

  const confirmEmergency = async () => {
    Vibration.cancel();
    // Confirmed emergency → capture this window as a positive training sample.
    void uploadConfirmedEmergencySample();
    if (!alertId) return;
    try {
      const res = await api.patch(`/alerts/${alertId}/soft/confirm`);
      const alertData = res.data.data;
      
      navigation.replace('ActiveSos', { alertId });

      if (alertData?.contactPhones && alertData.contactPhones.length > 0) {
        const isAvailable = await SMS.isAvailableAsync();
        if (isAvailable) {
          const name = user?.profile?.fullName || 'A user';
          const link = alertData.trackingToken ? `https://narisurokkha.app/track?token=${alertData.trackingToken}` : '';
          const message = `EMERGENCY: ${name} has triggered an SOS! Track live location here: ${link}`;
          
          setTimeout(async () => {
             try {
               await SMS.sendSMSAsync(alertData.contactPhones, message);
             } catch (smsErr) {
               if (__DEV__) console.error('Failed to open SMS composer', smsErr);
             }
          }, 500);
        }
      }
    } catch {
      RNAlert.alert('Error', 'Connection failed. Check your network.');
      navigation.goBack();
    }
  };

  // Urgency colors
  const urgencyColor = countdown > 10 ? colors.amber : countdown > 5 ? '#f97316' : colors.primary;
  const urgencyGrad: [string, string] = countdown > 10
    ? ['#92400e', '#d97706']
    : countdown > 5
    ? ['#9a3412', '#ea580c']
    : [colors.primaryDark, colors.primary];

  return (
    <LinearGradient colors={['#060d1f', '#0a1428', '#1a0505']} style={styles.root}>
      <SafeAreaView style={styles.safe}>
        <View style={styles.content}>

          {/* Alert Badge */}
          <View style={styles.badge}>
            <AlertTriangle color={urgencyColor} size={22} />
            <Text style={[styles.badgeText, { color: urgencyColor }]}>{manual ? 'Silent Alert Armed' : 'Fall / Danger Detected'}</Text>
          </View>

          <Text style={styles.title}>{manual ? 'Stay safe' : 'Are you okay?'}</Text>
          <Text style={styles.sub}>
            {manual
              ? 'A silent countdown is running. If you don’t cancel, we’ll alert your contacts and police.'
              : 'We detected an unusual event. Tap to confirm if you need help.'}
          </Text>

          {/* Timer */}
          <View style={styles.timerArea}>
            <Animated.View style={[styles.timerRing, { borderColor: `${urgencyColor}60` }, ringStyle]} />
            <LinearGradient colors={urgencyGrad} style={styles.timerCircle}>
              <Text style={styles.timerCount}>{countdown}</Text>
              <Text style={styles.timerLabel}>SEC</Text>
            </LinearGradient>
          </View>

          <Text style={styles.warningLine}>
            Alerting contacts & police in <Text style={{ color: urgencyColor, fontWeight: 'bold' }}>{countdown}s</Text> unless cancelled
          </Text>

          {/* Need Help */}
          <TouchableOpacity onPress={confirmEmergency} activeOpacity={0.85} style={[styles.helpWrapper, { ...shadows.primary }]}>
            <LinearGradient colors={urgencyGrad} style={styles.helpBtn} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}>
              <AlertTriangle color="#fff" size={22} />
              <Text style={styles.helpText}>I Need Help NOW</Text>
            </LinearGradient>
          </TouchableOpacity>

          {/* I'm okay */}
          <TouchableOpacity onPress={cancelAlert} activeOpacity={0.8} style={styles.okBtn}>
            <CheckCircle color={colors.green} size={22} />
            <Text style={styles.okText}>I'm Okay — Cancel Alert</Text>
          </TouchableOpacity>

        </View>
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1 },
  content: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  badge: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: 'rgba(245,158,11,0.12)', borderWidth: 1, borderColor: 'rgba(245,158,11,0.3)',
    borderRadius: radius.full, paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    marginBottom: spacing.lg,
  },
  badgeText: { ...font.label, fontWeight: '700' },
  title: { ...font.hero, color: colors.text, marginBottom: spacing.sm, textAlign: 'center' },
  sub: { ...font.sm, color: colors.textMuted, textAlign: 'center', lineHeight: 22, marginBottom: spacing.xl },
  timerArea: { width: 180, height: 180, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.xl },
  timerRing: { position: 'absolute', width: 180, height: 180, borderRadius: 90, borderWidth: 3 },
  timerCircle: { width: 140, height: 140, borderRadius: 70, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'rgba(255,255,255,0.15)' },
  timerCount: { fontSize: 56, fontWeight: 'bold', color: '#fff', lineHeight: 60 },
  timerLabel: { ...font.xs, color: 'rgba(255,255,255,0.7)', fontWeight: '700', letterSpacing: 2 },
  warningLine: { ...font.sm, color: colors.textMuted, textAlign: 'center', marginBottom: spacing.xl },
  helpWrapper: { width: '100%', borderRadius: radius.xl, marginBottom: spacing.md },
  helpBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingVertical: spacing.md + 4, borderRadius: radius.xl },
  helpText: { ...font.h3, color: '#fff' },
  okBtn: { width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingVertical: spacing.md + 4, borderRadius: radius.xl, borderWidth: 1.5, borderColor: `${colors.green}60`, backgroundColor: `${colors.green}12` },
  okText: { ...font.body, color: colors.green, fontWeight: '700' },
});
