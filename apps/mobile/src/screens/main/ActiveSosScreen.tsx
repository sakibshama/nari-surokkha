import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, Linking, ActivityIndicator, ScrollView, Platform } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { MainStackParamList } from '../../navigation/MainStack';
import { useLocationStore } from '../../store/locationStore';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
import { Phone, XCircle, Camera, Wifi, Users, MapPin, Shield, VideoOff, Video } from 'lucide-react-native';
import api, { ICE_SERVERS } from '../../services/api';
import { socketService } from '../../services/socket';
import { startBackgroundLocationUpdates, stopBackgroundLocationUpdates } from '../../services/backgroundTasks';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, font, spacing, radius, shadows } from '../../theme';
import Animated, { useSharedValue, useAnimatedStyle, withRepeat, withTiming, Easing } from 'react-native-reanimated';
let RTCPeerConnection: any;
let RTCIceCandidate: any;
let RTCSessionDescription: any;
let mediaDevices: any;
let RTCView: any;

if (Platform.OS === 'web') {
  RTCPeerConnection = window.RTCPeerConnection || (window as any).webkitRTCPeerConnection;
  RTCIceCandidate = window.RTCIceCandidate;
  RTCSessionDescription = window.RTCSessionDescription;
  mediaDevices = navigator.mediaDevices;
} else {
  const webrtc = require('react-native-webrtc');
  RTCPeerConnection = webrtc.RTCPeerConnection;
  RTCIceCandidate = webrtc.RTCIceCandidate;
  RTCSessionDescription = webrtc.RTCSessionDescription;
  mediaDevices = webrtc.mediaDevices;
  RTCView = webrtc.RTCView;
}

type Props = NativeStackScreenProps<MainStackParamList, 'ActiveSos'>;

export default function ActiveSosScreen({ navigation, route }: Props) {
  const { alertId } = route.params;
  const { setSosActive } = useLocationStore();
  const [locationSub, setLocationSub] = useState<Location.LocationSubscription | null>(null);
  const [uploading, setUploading] = useState(false);
  const [localStream, setLocalStream] = useState<any | null>(null);
  const [isAudioOnly, setIsAudioOnly] = useState(false);
  const pc = React.useRef<RTCPeerConnection | null>(null);
  const pendingOffer = React.useRef<any>(null);
  const pendingCandidates = React.useRef<any[]>([]);

  const ringScale = useSharedValue(1);
  const ringOpacity = useSharedValue(0.7);

  useEffect(() => {
    ringScale.value = withRepeat(withTiming(1.5, { duration: 1200, easing: Easing.out(Easing.quad) }), -1, false);
    ringOpacity.value = withRepeat(withTiming(0, { duration: 1200, easing: Easing.out(Easing.quad) }), -1, false);

    // Connect WebSocket — then set alert context once connected
    socketService.connect();
    
    // Ensure alert room is joined (handles both immediate connect and delayed connect)
    const alertRoomJoin = () => {
      socketService.setAlertContext(alertId);
    };
    if (socketService.socket?.connected) {
      alertRoomJoin();
    } else {
      socketService.socket?.once('connect', alertRoomJoin);
    }
    socketService.setAlertContext(alertId);

    // Setup WebRTC
    const setupWebRTC = async () => {
      let stream: any;

      // Handle incoming signals early to prevent race condition
      // Register listener now — socket is already connected or will be soon
      socketService.onWebRTCMessage(async (msg) => {
        try {
          if (!pc.current) {
            // Queue signals if PC is not ready yet
            if (msg.signal.type === 'offer') pendingOffer.current = msg.signal;
            else if (msg.signal.type === 'candidate') pendingCandidates.current.push(msg.signal.candidate);
            return;
          }
          if (msg.signal.type === 'offer') {
            await pc.current.setRemoteDescription(new RTCSessionDescription(msg.signal));
            const answer = await pc.current.createAnswer();
            await pc.current.setLocalDescription(answer);
            const desc = pc.current.localDescription;
            socketService.sendWebRTCSignal({ type: desc?.type, sdp: desc?.sdp });
          } else if (msg.signal.type === 'answer') {
            await pc.current.setRemoteDescription(new RTCSessionDescription(msg.signal));
          } else if (msg.signal.type === 'candidate') {
            await pc.current.addIceCandidate(new RTCIceCandidate(msg.signal.candidate));
          }
        } catch (e) {
          console.warn('WebRTC signal error', e);
        }
      });

      try {
        if (Platform.OS !== 'web') {
          const camPerm = await ImagePicker.requestCameraPermissionsAsync();
          if (camPerm.status !== 'granted') {
            console.warn('WebRTC requires Camera & Mic permissions');
            return;
          }
        }

        stream = await mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
          video: {
            width: 640,
            height: 480,
            frameRate: 15,
            facingMode: 'environment', // usually show what's happening
          }
        });
        setLocalStream(stream as any);

        const configuration = { iceServers: ICE_SERVERS };
        const peerConnection = new RTCPeerConnection(configuration);
        pc.current = peerConnection;

        // Process any queued signals
        if (pendingOffer.current) {
          try {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(pendingOffer.current));
            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);
            const desc = peerConnection.localDescription;
            socketService.sendWebRTCSignal({ type: desc?.type, sdp: desc?.sdp });
            pendingOffer.current = null;
          } catch (e) { console.warn('Queued offer error', e); }
        }
        for (const candidate of pendingCandidates.current) {
          try {
            await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
          } catch (e) { console.warn('Queued candidate error', e); }
        }
        pendingCandidates.current = [];

        // Add stream
        stream.getTracks().forEach((track: any) => peerConnection.addTrack(track, stream as any));

        peerConnection.onicecandidate = (event: any) => {
          if (event.candidate) {
            const cand = event.candidate;
            socketService.sendWebRTCSignal({ type: 'candidate', candidate: { candidate: cand.candidate, sdpMLineIndex: cand.sdpMLineIndex, sdpMid: cand.sdpMid } });
          }
        };

      } catch (err) {
        console.warn('Error starting WebRTC stream', err);
      }
    };
    setupWebRTC();

    (async () => {
      if (Platform.OS === 'web') {
        // Real browser geolocation — stream actual coordinates, never simulated ones.
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') { Alert.alert('Permission needed', 'Location permission required.'); return; }
        const watcher = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.Highest, timeInterval: 5000, distanceInterval: 5 },
          (pos) => {
            api.post(`/alerts/${alertId}/location`, {
              latitude: pos.coords.latitude,
              longitude: pos.coords.longitude,
              accuracy: pos.coords.accuracy ?? 10,
            }).catch(console.error);
          },
        );
        (window as any).webSosWatcher = watcher;
      } else {
        const { status } = await Location.getForegroundPermissionsAsync();
        if (status !== 'granted') { Alert.alert('Permission needed', 'Location permission required.'); return; }
        try {
          await startBackgroundLocationUpdates();
        } catch (e) { console.error(e); }
      }
    })();

    return () => {
      if ((window as any).webSosWatcher) { (window as any).webSosWatcher.remove(); (window as any).webSosWatcher = null; }
      stopBackgroundLocationUpdates();
      socketService.disconnect();
      socketService.offWebRTCMessage();
      if (localStream) {
        localStream.getTracks().forEach((track: any) => track.stop());
      }
      if (pc.current) {
        pc.current.close();
      }
    };
  }, [alertId]);

  const ringStyle = useAnimatedStyle(() => ({
    transform: [{ scale: ringScale.value }],
    opacity: ringOpacity.value,
  }));

  const captureEvidence = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') { Alert.alert('Permission needed', 'Camera permission required.'); return; }
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8 });
    if (!result.canceled && result.assets?.[0]) {
      setUploading(true);
      try {
        const fd = new FormData();
        if (Platform.OS === 'web') {
          const res = await fetch(result.assets[0].uri);
          const blob = await res.blob();
          fd.append('file', blob, result.assets[0].fileName || 'evidence.jpg');
        } else {
          // @ts-ignore
          fd.append('file', { uri: result.assets[0].uri, name: result.assets[0].fileName || 'evidence.jpg', type: 'image/jpeg' });
        }
        await api.post(`/evidence/alerts/${alertId}`, fd, {
          transformRequest: (data, headers) => {
            // Delete default JSON content-type so the browser/RN sets multipart/form-data + boundary
            delete headers['Content-Type'];
            return data;
          }
        });
        Alert.alert('Uploaded', 'Evidence secured.');
      } catch { Alert.alert('Failed', 'Upload error. Try again.'); }
      finally { setUploading(false); }
    }
  };

  const cancelSos = async () => {
    const proceedWithCancel = async () => {
      try {
        await api.patch(`/alerts/${alertId}/cancel`);
      } catch (e) {
        console.error('Failed to cancel alert on backend', e);
      }
      stopBackgroundLocationUpdates();
      setSosActive(false); 
      navigation.reset({ index: 0, routes: [{ name: 'Home' as any }] });
    };

    if (Platform.OS === 'web') {
      const confirm = window.confirm('Cancel SOS? Are you sure you are safe?');
      if (confirm) {
        await proceedWithCancel();
      }
    } else {
      Alert.alert('Cancel SOS?', 'Are you sure you are safe?', [
        { text: 'Keep Active', style: 'cancel' },
        { text: 'Yes, I\'m Safe', style: 'destructive', onPress: proceedWithCancel }
      ]);
    }
  };

  const toggleAudioOnly = () => {
    if (localStream) {
      const videoTrack = localStream.getVideoTracks()[0];
      if (videoTrack) {
        const newAudioOnlyState = !isAudioOnly;
        videoTrack.enabled = !newAudioOnlyState;
        setIsAudioOnly(newAudioOnlyState);
        socketService.socket?.emit('webrtc:mode_changed', { alertId, isAudioOnly: newAudioOnlyState });
      }
    }
  };

  const STATUS = [
    { label: 'Contacts notified via SMS', icon: Users, color: colors.green },
    { label: 'Police station alerted', icon: Shield, color: colors.green },
    { label: 'Live location transmitting', icon: Wifi, color: colors.cyan },
    { label: 'GPS tracking active', icon: MapPin, color: colors.cyan },
  ];

  return (
    <LinearGradient colors={['#0d0000', '#3b0000', '#7f1d1d']} style={styles.root} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* Pulsing Alert Ring */}
        <View style={styles.alertRingContainer}>
          <Animated.View style={[styles.alertRing, ringStyle]} />
          <View style={styles.alertIconCircle}>
            <LinearGradient colors={['rgba(255,255,255,0.2)', 'rgba(255,255,255,0.05)']} style={styles.alertIconGrad}>
              <Shield color="#fff" size={44} />
            </LinearGradient>
          </View>
        </View>

        <Text style={styles.title}>SOS ACTIVE</Text>
        <Text style={styles.subtitle}>Broadcasting your location live to authorities and trusted contacts</Text>

        {/* Status Card */}
        <View style={styles.statusCard}>
          {isAudioOnly && (
            <View style={styles.audioOnlyBanner}>
              <Text style={styles.audioOnlyText}>Audio-Only Mode Active (Saving Data & Battery)</Text>
            </View>
          )}
          {STATUS.map((s, i) => (
            <View key={i} style={[styles.statusRow, i < STATUS.length - 1 && styles.statusRowBorder]}>
              <View style={[styles.statusIconBox, { backgroundColor: `${s.color}20` }]}>
                <s.icon color={s.color} size={16} />
              </View>
              <Text style={styles.statusLabel}>{s.label}</Text>
              <View style={[styles.liveDot, { backgroundColor: s.color }]} />
            </View>
          ))}
          {localStream && Platform.OS !== 'web' && RTCView && (
            <View style={[styles.statusRow, { marginTop: 8 }]}>
              <View style={styles.streamContainer}>
                {/* @ts-ignore */}
                <RTCView streamURL={localStream.toURL()} style={styles.rtcView} objectFit="cover" />
                <View style={styles.streamOverlay}>
                  <View style={styles.liveBadge}><Text style={styles.liveBadgeText}>LIVE STREAM</Text></View>
                </View>
              </View>
            </View>
          )}
        </View>

        {/* Call 999 */}
        <TouchableOpacity onPress={() => Linking.openURL('tel:999')} style={styles.callWrapper} activeOpacity={0.85}>
          <LinearGradient colors={['#fff', '#f1f5f9']} style={styles.callBtn}>
            <Phone color="#dc2626" size={24} />
            <Text style={styles.callBtnText}>Call 999 Now</Text>
          </LinearGradient>
        </TouchableOpacity>

        {/* Capture Evidence */}
        <TouchableOpacity onPress={captureEvidence} disabled={uploading} style={styles.evidenceBtn} activeOpacity={0.8}>
          {uploading
            ? <ActivityIndicator color="#fff" />
            : <>
                <Camera color="#fff" size={20} />
                <Text style={styles.evidenceBtnText}>Capture Photo Evidence</Text>
              </>
          }
        </TouchableOpacity>

        {/* Audio Only Toggle */}
        <TouchableOpacity onPress={toggleAudioOnly} style={styles.evidenceBtn} activeOpacity={0.8}>
          {isAudioOnly ? <Video color="#fff" size={20} /> : <VideoOff color="#fff" size={20} />}
          <Text style={styles.evidenceBtnText}>{isAudioOnly ? 'Enable Video' : 'Switch to Audio-Only Mode'}</Text>
        </TouchableOpacity>

        {/* Cancel */}
        <TouchableOpacity onPress={cancelSos} style={styles.cancelBtn} activeOpacity={0.7}>
          <XCircle color="rgba(255,255,255,0.5)" size={18} />
          <Text style={styles.cancelBtnText}>I'm Safe — Cancel SOS</Text>
        </TouchableOpacity>
      </ScrollView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { flexGrow: 1, alignItems: 'center', padding: spacing.lg, paddingTop: Platform.OS === 'ios' ? 80 : 60, paddingBottom: spacing.xxl },
  alertRingContainer: { width: 160, height: 160, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.lg },
  alertRing: { position: 'absolute', width: 160, height: 160, borderRadius: 80, borderWidth: 3, borderColor: 'rgba(255,255,255,0.5)' },
  alertIconCircle: { width: 110, height: 110, borderRadius: 55, overflow: 'hidden', borderWidth: 2, borderColor: 'rgba(255,255,255,0.3)' },
  alertIconGrad: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 44, fontWeight: 'bold', color: '#fff', letterSpacing: 4, marginBottom: spacing.sm, ...Platform.select({ web: { textShadow: '0px 2px 8px rgba(0,0,0,0.5)' } as object, default: { textShadowColor: 'rgba(0,0,0,0.5)', textShadowOffset: { width: 0, height: 2 }, textShadowRadius: 8 } }) },
  subtitle: { ...font.sm, color: 'rgba(255,255,255,0.7)', textAlign: 'center', lineHeight: 22, marginBottom: spacing.xl, paddingHorizontal: spacing.md },
  statusCard: { width: '100%', backgroundColor: 'rgba(0,0,0,0.35)', borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.lg, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' },
  statusRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm + 2, gap: spacing.sm },
  statusRowBorder: { borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.07)' },
  statusIconBox: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  statusLabel: { ...font.sm, color: 'rgba(255,255,255,0.85)', flex: 1 },
  liveDot: { width: 7, height: 7, borderRadius: 4 },
  callWrapper: { width: '100%', borderRadius: radius.xl, marginBottom: spacing.md, ...shadows.card },
  callBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingVertical: spacing.md + 2, borderRadius: radius.xl },
  callBtnText: { ...font.h3, color: '#dc2626' },
  evidenceBtn: { width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, backgroundColor: 'rgba(255,255,255,0.12)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)', borderRadius: radius.xl, paddingVertical: spacing.md + 2, marginBottom: spacing.xl },
  evidenceBtnText: { ...font.body, color: '#fff', fontWeight: '600' },
  cancelBtn: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.md },
  cancelBtnText: { ...font.sm, color: 'rgba(255,255,255,0.5)' },
  // Live audio/video streaming UI (WebRTC)
  audioOnlyBanner: { width: '100%', backgroundColor: 'rgba(234,179,8,0.15)', borderWidth: 1, borderColor: 'rgba(234,179,8,0.4)', borderRadius: radius.md, paddingVertical: spacing.sm, paddingHorizontal: spacing.md, marginBottom: spacing.sm, alignItems: 'center' },
  audioOnlyText: { ...font.xs, color: '#fbbf24', fontWeight: '600', textAlign: 'center' },
  streamContainer: { width: '100%', height: 200, borderRadius: radius.lg, overflow: 'hidden', backgroundColor: '#000', position: 'relative' },
  rtcView: { width: '100%', height: '100%' },
  streamOverlay: { position: 'absolute', top: spacing.sm, left: spacing.sm },
  liveBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#dc2626', paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.sm },
  liveBadgeText: { ...font.xs, color: '#fff', fontWeight: '700', letterSpacing: 1 },
});
