import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Linking, ActivityIndicator, ScrollView, Platform } from 'react-native';
import { showAlert } from '../../utils/notify';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { MainStackParamList } from '../../navigation/MainStack';
import { useLocationStore } from '../../store/locationStore';
import * as ImagePicker from 'expo-image-picker';
import { Phone, XCircle, Camera, Wifi, Users, MapPin, Shield, ShieldAlert, VideoOff, Video, Radio } from 'lucide-react-native';
import api, { fetchIceServers } from '../../services/api';
import { socketService } from '../../services/socket';
import { endSos } from '../../services/sosSession';
import { formatDistance, type AlertResponder } from '../../services/responderDispatch';
import { usePreventRemove } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { Theme, useTheme, useThemedStyles } from '../../theme';
import { radius, spacing, type } from '../../theme/tokens';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Breathing, FadeIn, PressableScale, PulseRings } from '../../components/ui';
import { useT } from '../../i18n';
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
    // Pinned dark in both themes: this is a full-bleed alarm state. A pale
  // version would be far harder to read at night and would stop looking
  // like an emergency, which is the only thing this screen has to do.
  const styles = useThemedStyles(makeStyles, 'dark');
  const { colors, gradients, shadows } = useTheme('dark');
  void shadows;
  const t = useT();
  const insets = useSafeAreaInsets();
  const { alertId } = route.params;
  const isSosActive = useLocationStore((st) => st.isSosActive);
  const activeAlertId = useLocationStore((st) => st.activeAlertId);
  const trackingMode = useLocationStore((st) => st.trackingMode);
  const lastPingAt = useLocationStore((st) => st.lastPingAt);
  const queuedPings = useLocationStore((st) => st.queuedPings);
  const sosLive = isSosActive && activeAlertId === alertId;
  const ending = React.useRef(false);
  const [socketUp, setSocketUp] = useState(socketService.isConnected());
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(id);
  }, []);
  const [uploading, setUploading] = useState(false);
  const [localStream, setLocalStream] = useState<any | null>(null);
  const [isAudioOnly, setIsAudioOnly] = useState(false);
  const pc = React.useRef<RTCPeerConnection | null>(null);
  const streamRef = React.useRef<any>(null);
  const pendingOffer = React.useRef<any>(null);
  const pendingCandidates = React.useRef<any[]>([]);

  /**
   * Fully release the camera + microphone and tear down the peer connection.
   * Uses a ref (not the localStream state) so it always sees the CURRENT
   * stream — the effect-cleanup closure would otherwise capture a stale null.
   */
  const stopMedia = React.useCallback(() => {
    try {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t: any) => { try { t.stop(); } catch { /* noop */ } });
        streamRef.current = null;
      }
      setLocalStream(null);
      if (pc.current) {
        try { pc.current.close(); } catch { /* noop */ }
        pc.current = null;
      }
    } catch (e) {
      if (__DEV__) console.warn('stopMedia error', e);
    }
  }, []);

  // Realtime link state for the status rows. The socket itself is app-wide:
  // the room join and live tracking follow the SOS state (sosSession.ts), so
  // leaving this screen does not stop them.
  useEffect(() => socketService.onConnectionChange(setSocketUp), []);

  useEffect(() => {
    void socketService.connect();

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
        streamRef.current = stream;
        setLocalStream(stream as any);

        // Pull the ICE servers (with the real TURN credential) from the server
        // so cross-network relaying works; falls back to STUN-only if offline.
        const iceServers = await fetchIceServers();
        const peerConnection = new RTCPeerConnection({ iceServers });
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

    return () => {
      socketService.offWebRTCMessage();
      stopMedia(); // release camera + mic + peer connection
    };
  }, [alertId]);

  // Community responders who accepted this SOS ("help is coming").
  const [responders, setResponders] = useState<AlertResponder[]>([]);
  useEffect(() => {
    let alive = true;
    let seq = 0;
    const load = async () => {
      const mine = ++seq;
      try {
        const res = await api.get(`/alerts/${alertId}/responders`, { timeout: 10000 });
        if (alive && mine === seq && Array.isArray(res.data?.data)) setResponders(res.data.data);
      } catch {
        /* offline / older server: keep what we have, never an error on this screen */
      }
    };
    void load();
    const onUpdate = (msg: { alertId?: string } | null) => {
      if (msg?.alertId === alertId) void load();
    };
    socketService.on('responder:dispatch_update', onUpdate);
    socketService.on('responder_accepted', onUpdate);
    // Catch up on anything missed while the realtime link was down.
    const unsubConn = socketService.onConnectionChange((up) => {
      if (up) void load();
    });
    return () => {
      alive = false;
      socketService.off('responder:dispatch_update', onUpdate);
      socketService.off('responder_accepted', onUpdate);
      unsubConn();
    };
  }, [alertId]);

  // While this SOS is live, Back / swipe / header-back asks first.
  usePreventRemove(sosLive, ({ data }) => {
    if (ending.current) {
      navigation.dispatch(data.action);
      return;
    }
    showAlert(t('SOS is still active'), t('Your location keeps being shared until you end the SOS.'), [
      { text: t('Stay here'), style: 'cancel' },
      { text: t('Keep SOS running'), onPress: () => navigation.dispatch(data.action) },
      {
        text: t("I'm safe — end SOS"),
        style: 'destructive',
        onPress: () => void finishSos().then(() => navigation.dispatch(data.action)),
      },
    ]);
  });

  const captureEvidence = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') { showAlert(t('Permission needed'), t('Camera permission required.')); return; }
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
            // Clear the default JSON content-type so RN/browser sets
            // multipart/form-data WITH the boundary. Cover every axios-version
            // shape (plain object, lowercase key, AxiosHeaders.delete) — if this
            // header leaks through, the server rejects the upload and nothing
            // gets saved.
            if (headers) {
              const h = headers as any;
              delete h['Content-Type'];
              delete h['content-type'];
              if (typeof h.delete === 'function') { h.delete('Content-Type'); h.delete('content-type'); }
            }
            return data;
          },
        });
        showAlert(t('Uploaded'), t('Evidence secured.'));
      } catch (e) {
        if (__DEV__) console.warn('[Evidence] upload failed', e);
        showAlert(t('Failed'), t('Upload error. Try again.'));
      }
      finally { setUploading(false); }
    }
  };

  /** "I'm safe": resolve on the server, stop tracking (via the SOS state). */
  const finishSos = async () => {
    ending.current = true;
    stopMedia(); // release camera + mic immediately
    const { serverOk } = await endSos(alertId);
    if (!serverOk) {
      showAlert(t('Could not reach the server'), t('Tracking stopped on this phone, but your contacts may still see the alert as active.'));
    }
  };

  const cancelSos = () => {
    showAlert(t('End SOS?'), t('Are you sure you are safe?'), [
      { text: t('Keep active'), style: 'cancel' },
      {
        text: t("Yes, I'm safe"),
        style: 'destructive',
        onPress: async () => {
          await finishSos();
          navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
        },
      },
    ]);
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

  // Status rows from real state, never a hard-coded "transmitting".
  const pingAge = lastPingAt ? Math.round((now - lastPingAt) / 1000) : null;
  const locationRow =
    pingAge !== null && pingAge < 90
      ? { label: t('Live location sent {n}s ago', { n: pingAge }), color: colors.success }
      : queuedPings > 0
        ? { label: t('No signal — {n} locations queued', { n: queuedPings }), color: colors.warning }
        : { label: t('Waiting for the first location fix…'), color: colors.warning };
  const gpsRow =
    trackingMode === 'background'
      ? { label: t('GPS tracking active, also in the background'), color: colors.info }
      : trackingMode === 'foreground'
        ? { label: t('GPS tracking only while the app is open'), color: colors.warning }
        : { label: t('Location permission is off — tracking stopped'), color: colors.danger };
  const STATUS = [
    { label: t('Contacts notified via SMS'), icon: Users, color: colors.success },
    { label: t('Nearby responders alerted'), icon: Shield, color: colors.success },
    { ...locationRow, icon: Wifi },
    { ...gpsRow, icon: MapPin },
    socketUp
      ? { label: t('Live link to responders connected'), icon: Radio, color: colors.success }
      : { label: t('Live link reconnecting…'), icon: Radio, color: colors.warning },
  ];

  return (
    <LinearGradient colors={gradients.dangerBackdrop} style={styles.root} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + spacing.xl }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Pulsing alert beacon */}
        <FadeIn from="zoom" style={styles.alertRingContainer}>
          <PulseRings color={colors.danger} size={150} count={3} duration={1600} />
          <Breathing min={0.95} max={1.05} duration={700}>
            <LinearGradient colors={gradients.danger} style={styles.alertIconCircle}>
              <ShieldAlert color={colors.onDanger} size={48} />
            </LinearGradient>
          </Breathing>
        </FadeIn>

        <FadeIn delay={80} style={{ alignItems: 'center' }}>
          <Text style={styles.title}>{t('SOS ACTIVE')}</Text>
          <Text style={styles.subtitle}>
            {t('Broadcasting your location live to your trusted contacts and nearby responders')}
          </Text>
        </FadeIn>

        {/* Status */}
        <FadeIn delay={140} style={styles.statusCard}>
          {isAudioOnly && (
            <View style={styles.audioOnlyBanner}>
              <Text style={styles.audioOnlyText}>{t('Audio-only mode (saving data & battery)')}</Text>
            </View>
          )}
          {STATUS.map((s, i) => (
            <FadeIn key={i} delay={200 + i * 70} style={[styles.statusRow, i < STATUS.length - 1 && styles.statusRowBorder]}>
              <View style={[styles.statusIconBox, { backgroundColor: `${s.color}22` }]}>
                <s.icon color={s.color} size={16} />
              </View>
              <Text style={styles.statusLabel}>{s.label}</Text>
              <Breathing min={0.7} max={1.2} duration={900 + i * 120}>
                <View style={[styles.liveDot, { backgroundColor: s.color }]} />
              </Breathing>
            </FadeIn>
          ))}
          {localStream && Platform.OS !== 'web' && RTCView && (
            <View style={[styles.statusRow, { marginTop: 8 }]}>
              <View style={styles.streamContainer}>
                {/* @ts-ignore */}
                <RTCView streamURL={localStream.toURL()} style={styles.rtcView} objectFit="cover" />
                <View style={styles.streamOverlay}>
                  <View style={styles.liveBadge}>
                    <Breathing min={0.6} max={1.2} duration={600}>
                      <View style={styles.liveBadgeDot} />
                    </Breathing>
                    <Text style={styles.liveBadgeText}>{t('LIVE')}</Text>
                  </View>
                </View>
              </View>
            </View>
          )}
        </FadeIn>

        {/* Responders who accepted */}
        {responders.length > 0 && (
          <FadeIn delay={120} style={styles.statusCard}>
            <Text style={styles.respondersTitle}>
              {t('{n} responder(s) coming to help', { n: responders.length })}
            </Text>
            {responders.map((r, i) => {
              const distance = formatDistance(r.distanceMeters);
              const label =
                r.status === 'arrived'
                  ? t('On scene')
                  : r.status === 'completed'
                    ? t('Completed')
                    : distance
                      ? t('On the way · {d}', { d: distance })
                      : t('On the way');
              return (
                <View key={r.dispatchId} style={[styles.statusRow, i < responders.length - 1 && styles.statusRowBorder]}>
                  <View style={[styles.statusIconBox, { backgroundColor: `${colors.success}22` }]}>
                    <Shield color={colors.success} size={16} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.statusLabel}>{r.name || t('Community responder')}</Text>
                    <Text style={styles.responderSub}>{label}</Text>
                  </View>
                  {r.phone ? (
                    <PressableScale
                      accessibilityRole="button"
                      accessibilityLabel={t('Call')}
                      onPress={() => void Linking.openURL(`tel:${r.phone}`).catch(() => {})}
                      style={styles.responderCall}
                    >
                      <Phone color={colors.onFill} size={16} />
                    </PressableScale>
                  ) : null}
                </View>
              );
            })}
          </FadeIn>
        )}

        {/* Call 999 */}
        <FadeIn delay={380} style={{ width: '100%' }}>
          <PressableScale onPress={() => Linking.openURL('tel:999')} style={styles.callWrapper} accessibilityRole="button">
            <View style={styles.callBtn}>
              <Phone color={colors.danger} size={22} />
              <Text style={styles.callBtnText}>{t('Call 999 now')}</Text>
            </View>
          </PressableScale>
        </FadeIn>

        {/* Evidence + stream mode */}
        <FadeIn delay={440} style={styles.actionRow}>
          <PressableScale onPress={captureEvidence} disabled={uploading} style={styles.actionBtn} accessibilityRole="button">
            {uploading ? (
              <ActivityIndicator color={colors.onFill} />
            ) : (
              <>
                <Camera color={colors.onFill} size={20} />
                <Text style={styles.actionBtnText}>{t('Photo evidence')}</Text>
              </>
            )}
          </PressableScale>
          <PressableScale onPress={toggleAudioOnly} style={styles.actionBtn} accessibilityRole="button">
            {isAudioOnly ? <Video color={colors.onFill} size={20} /> : <VideoOff color={colors.onFill} size={20} />}
            <Text style={styles.actionBtnText}>{isAudioOnly ? t('Enable video') : t('Audio only')}</Text>
          </PressableScale>
        </FadeIn>

        {/* Cancel */}
        <FadeIn delay={500}>
          <PressableScale onPress={cancelSos} style={styles.cancelBtn} accessibilityRole="button">
            <XCircle color={colors.textSub} size={18} />
            <Text style={styles.cancelBtnText}>{t("I'm safe — end SOS")}</Text>
          </PressableScale>
        </FadeIn>
      </ScrollView>
    </LinearGradient>
  );
}

const makeStyles = ({ colors, shadows }: Theme) =>
  StyleSheet.create({
    root: { flex: 1 },
    scroll: { flexGrow: 1, alignItems: 'center', paddingHorizontal: spacing.lg },
    alertRingContainer: { width: 200, height: 200, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.md },
    alertIconCircle: {
      width: 116,
      height: 116,
      borderRadius: 58,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 3,
      borderColor: 'rgba(255,255,255,0.25)',
      ...shadows.danger,
    },
    title: {
      fontSize: 38,
      fontWeight: '900',
      color: colors.onFill,
      letterSpacing: 3,
      marginBottom: spacing.sm,
      textAlign: 'center',
      ...Platform.select({
        web: { textShadow: '0px 2px 8px rgba(0,0,0,0.5)' } as object,
        default: { textShadowColor: 'rgba(0,0,0,0.5)', textShadowOffset: { width: 0, height: 2 }, textShadowRadius: 8 },
      }),
    },
    subtitle: { ...type.sm, color: colors.textSub, textAlign: 'center', lineHeight: 22, marginBottom: spacing.lg, paddingHorizontal: spacing.md },
    statusCard: {
      width: '100%',
      backgroundColor: 'rgba(24,33,29,0.85)',
      borderRadius: radius.xl - 6,
      padding: spacing.md,
      marginBottom: spacing.lg,
      borderWidth: 1,
      borderColor: colors.border,
    },
    statusRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm + 2, gap: spacing.sm },
    statusRowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.borderStrong },
    statusIconBox: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
    statusLabel: { ...type.sm, color: colors.text, flex: 1 },
    liveDot: { width: 8, height: 8, borderRadius: 4 },
    respondersTitle: { ...type.smStrong, color: colors.onFill, marginBottom: spacing.xs },
    responderSub: { ...type.xs, color: colors.textSub, marginTop: 2 },
    responderCall: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'rgba(255,255,255,0.12)',
    },
    callWrapper: { width: '100%', borderRadius: radius.xl, marginBottom: spacing.md, ...shadows.card },
    callBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.sm,
      paddingVertical: spacing.md + 2,
      borderRadius: radius.xl,
      backgroundColor: '#FFFFFF',
    },
    callBtnText: { ...type.h3, fontWeight: '800', color: colors.danger },
    actionRow: { width: '100%', flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.lg },
    actionBtn: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.sm,
      backgroundColor: 'rgba(255,255,255,0.08)',
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.16)',
      borderRadius: radius.lg,
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.sm,
      minHeight: 54,
    },
    actionBtnText: { ...type.smStrong, color: colors.onFill, flexShrink: 1 },
    cancelBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingVertical: spacing.sm + 2,
      paddingHorizontal: spacing.lg,
      borderRadius: radius.full,
      borderWidth: 1,
      borderColor: colors.borderStrong,
    },
    cancelBtnText: { ...type.smStrong, color: colors.textSub },
    audioOnlyBanner: {
      width: '100%',
      backgroundColor: colors.warningSoft,
      borderWidth: 1,
      borderColor: colors.warning,
      borderRadius: radius.md,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
      marginBottom: spacing.sm,
      alignItems: 'center',
    },
    audioOnlyText: { ...type.xs, color: colors.warningText, fontWeight: '600', textAlign: 'center' },
    streamContainer: { width: '100%', height: 200, borderRadius: radius.lg, overflow: 'hidden', backgroundColor: '#000', position: 'relative' },
    rtcView: { width: '100%', height: '100%' },
    streamOverlay: { position: 'absolute', top: spacing.sm, left: spacing.sm },
    liveBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      backgroundColor: colors.danger,
      paddingHorizontal: spacing.sm,
      paddingVertical: 4,
      borderRadius: radius.sm,
    },
    liveBadgeDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#fff' },
    liveBadgeText: { ...type.xs, color: colors.onFill, fontWeight: '800', letterSpacing: 1 },
  });
