import React, { useState, useEffect, useMemo } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity, Alert,
  ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { MainStackParamList } from '../../navigation/MainStack';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Line, Circle, Rect, G } from 'react-native-svg';
import {
  Search, Navigation, ChevronLeft, ShieldCheck, ShieldAlert, AlertTriangle,
  MapPin, Clock, Route as RouteIcon, Flag, Crosshair,
} from 'lucide-react-native';
import * as Location from 'expo-location';
import { Theme, useTheme, useThemedStyles } from '../../theme';
import { radius, spacing, type } from '../../theme/tokens';
import type { Palette } from '../../theme/tokens';
import api from '../../services/api';
import { useLocationStore } from '../../store/locationStore';
import { startBackgroundLocationUpdates, stopBackgroundLocationUpdates } from '../../services/backgroundTasks';

type Props = NativeStackScreenProps<MainStackParamList, 'SafeRoute'>;


interface Waypoint { lat: number; lng: number; risk: number; }
interface Incident { lat: number; lng: number; type: string; }
interface RouteData {
  id: string;
  origin: { lat: number; lng: number };
  destination: { lat: number; lng: number };
  waypoints: Waypoint[];
  distanceMeters: number;
  durationSeconds: number;
  safetyScore: number;
  rating: 'safe' | 'moderate' | 'danger';
  incidentsNearby: number;
  incidents: Incident[];
  routingEngine: 'osrm' | 'fallback';
}

function scoreInfo(score: number, colors: Palette) {
  if (score >= 75) return { label: 'Safe Route', color: colors.success, Icon: ShieldCheck, grad: [colors.successSoft, colors.success] as [string, string] };
  if (score >= 50) return { label: 'Moderate Risk', color: colors.warning, Icon: ShieldAlert, grad: [colors.warningSoft, colors.warning] as [string, string] };
  return { label: 'High Risk', color: colors.danger, Icon: AlertTriangle, grad: [colors.dangerSoft, colors.danger] as [string, string] };
}

function riskColor(risk: number, colors: Palette) {
  if (risk >= 0.5) return colors.danger;
  if (risk > 0) return colors.warning;
  return colors.success;
}

function fmtDistance(m: number) {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}
function fmtEta(s: number) {
  const min = Math.round(s / 60);
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)}h ${min % 60}m`;
}

/** Project lat/lng points into an SVG box with equirectangular correction. */
function useProjection(rd: RouteData | null, W: number, H: number, pad = 18) {
  return useMemo(() => {
    if (!rd || !rd.waypoints?.length) return null;
    const pts = [...rd.waypoints, rd.origin, rd.destination, ...rd.incidents];
    const lats = pts.map((p) => p.lat);
    const lngs = pts.map((p) => p.lng);
    let minLat = Math.min(...lats), maxLat = Math.max(...lats);
    let minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
    const midLat = (minLat + maxLat) / 2;
    const kx = Math.cos((midLat * Math.PI) / 180); // lng compression
    let spanLat = maxLat - minLat || 1e-4;
    let spanLng = (maxLng - minLng || 1e-4) * kx;
    // keep aspect ratio square-ish
    const span = Math.max(spanLat, spanLng);
    const cLat = midLat, cLng = (minLng + maxLng) / 2;
    minLat = cLat - span / 2; maxLat = cLat + span / 2;
    minLng = cLng - span / (2 * kx); maxLng = cLng + span / (2 * kx);
    const project = (lat: number, lng: number) => {
      const x = pad + ((lng - minLng) / (maxLng - minLng)) * (W - 2 * pad);
      const y = pad + (1 - (lat - minLat) / (maxLat - minLat)) * (H - 2 * pad);
      return { x, y };
    };
    return { project };
  }, [rd, W, H, pad]);
}

export default function SafeRouteScreen({ navigation }: Props) {
  const styles = useThemedStyles(makeStyles);
  const { colors, gradients, shadows } = useTheme();
  void gradients; void shadows;
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [routeData, setRouteData] = useState<RouteData | null>(null);
  const [tracking, setTracking] = useState(false);
  const { setActiveRoute } = useLocationStore();

  const MAP_W = 320, MAP_H = 240;
  const proj = useProjection(routeData, MAP_W, MAP_H);

  async function resolveDestination(): Promise<{ lat: number; lng: number } | null> {
    const q = query.trim();
    if (!q) { Alert.alert('Destination needed', 'Enter a place name or "latitude, longitude".'); return null; }
    // direct "lat, lng"
    const m = q.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };
    try {
      const results = await Location.geocodeAsync(q);
      if (results?.length) return { lat: results[0].latitude, lng: results[0].longitude };
      Alert.alert('Not found', `Could not locate "${q}". Try a more specific place or coordinates.`);
    } catch {
      Alert.alert('Search failed', 'Could not search that place. Try coordinates like "23.81, 90.41".');
    }
    return null;
  }

  const requestRoute = async () => {
    setLoading(true);
    try {
      const { status } = await Location.getForegroundPermissionsAsync();
      const perm = status === 'granted' ? status : (await Location.requestForegroundPermissionsAsync()).status;
      if (perm !== 'granted') { Alert.alert('Permission needed', 'Location permission is required.'); setLoading(false); return; }

      const dest = await resolveDestination();
      if (!dest) { setLoading(false); return; }

      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const res = await api.post('/alerts/safe-route', {
        origin: { lat: loc.coords.latitude, lng: loc.coords.longitude },
        destination: { lat: dest.lat, lng: dest.lng },
      });
      setRouteData(res.data.data as RouteData);
    } catch (err) {
      console.error(err);
      Alert.alert('Error', 'Failed to calculate the safe route. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const startTracking = async () => {
    if (!routeData) return;
    setTracking(true);
    setActiveRoute(routeData.id);
    try {
      await startBackgroundLocationUpdates();
    } catch (e) {
      console.error(e);
      Alert.alert('Error', 'Failed to start tracking');
      setTracking(false); setActiveRoute(null);
    }
  };

  const stopTracking = async () => {
    await stopBackgroundLocationUpdates();
    setTracking(false); setActiveRoute(null); setRouteData(null);
  };

  useEffect(() => () => { stopBackgroundLocationUpdates(); setActiveRoute(null); }, []);

  const si = routeData ? scoreInfo(routeData.safetyScore, colors) : null;

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <LinearGradient colors={gradients.hero} style={styles.root}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          {/* Header */}
          <View style={styles.header}>
            <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} activeOpacity={0.7}>
              <ChevronLeft color={colors.text} size={24} />
            </TouchableOpacity>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Safe Route</Text>
              <Text style={styles.subtitle}>Routed around reported-incident hotspots</Text>
            </View>
          </View>

          {/* Search */}
          <View style={styles.searchCard}>
            <View style={styles.searchRow}>
              <Search color={colors.textMuted} size={18} />
              <TextInput
                style={styles.searchInput}
                value={query}
                onChangeText={setQuery}
                placeholder="Destination — place name or lat, lng"
                placeholderTextColor="rgba(255,255,255,0.4)"
                returnKeyType="search"
                onSubmitEditing={requestRoute}
              />
            </View>
            <View style={styles.originRow}>
              <Crosshair color={colors.dangerText} size={13} />
              <Text style={styles.originText}>Starting from your current location</Text>
            </View>
            <TouchableOpacity style={styles.findBtn} onPress={requestRoute} disabled={loading} activeOpacity={0.85}>
              <LinearGradient colors={[colors.govGreen, '#00926b']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.findBtnGrad}>
                {loading ? <ActivityIndicator color={colors.onFill} /> : (
                  <><MapPin color={colors.onFill} size={18} /><Text style={styles.findBtnText}>Find Safe Route</Text></>
                )}
              </LinearGradient>
            </TouchableOpacity>
          </View>

          {routeData && si && (
            <>
              {/* Safety score */}
              <LinearGradient colors={si.grad} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.scoreCard}>
                <View style={styles.scoreLeft}>
                  <Text style={styles.scoreNum}>{routeData.safetyScore}</Text>
                  <Text style={styles.scoreSlash}>/100</Text>
                </View>
                <View style={styles.scoreRight}>
                  <View style={styles.scoreIconCircle}><si.Icon color={colors.onFill} size={30} /></View>
                  <Text style={styles.scoreLabel}>{si.label}</Text>
                  <Text style={styles.scoreSub}>{routeData.incidentsNearby} incident{routeData.incidentsNearby !== 1 ? 's' : ''} near route</Text>
                </View>
              </LinearGradient>

              {/* Route map */}
              <View style={styles.mapCard}>
                <Svg width="100%" height={MAP_H} viewBox={`0 0 ${MAP_W} ${MAP_H}`}>
                  <Rect x={0} y={0} width={MAP_W} height={MAP_H} rx={16} fill="#0a1424" />
                  {/* subtle grid */}
                  <G opacity={0.25}>
                    {[1, 2, 3].map((i) => (
                      <Line key={`h${i}`} x1={0} y1={(MAP_H / 4) * i} x2={MAP_W} y2={(MAP_H / 4) * i} stroke="#1e3050" strokeWidth={1} />
                    ))}
                    {[1, 2, 3].map((i) => (
                      <Line key={`v${i}`} x1={(MAP_W / 4) * i} y1={0} x2={(MAP_W / 4) * i} y2={MAP_H} stroke="#1e3050" strokeWidth={1} />
                    ))}
                  </G>

                  {proj && (() => {
                    const p = proj.project;
                    const wp = routeData.waypoints;
                    // route segments coloured by risk
                    const segs = [];
                    for (let i = 0; i < wp.length - 1; i++) {
                      const a = p(wp[i].lat, wp[i].lng);
                      const b = p(wp[i + 1].lat, wp[i + 1].lng);
                      const rk = Math.max(wp[i].risk, wp[i + 1].risk);
                      segs.push(<Line key={`s${i}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={riskColor(rk, colors)} strokeWidth={5} strokeLinecap="round" />);
                    }
                    const o = p(routeData.origin.lat, routeData.origin.lng);
                    const d = p(routeData.destination.lat, routeData.destination.lng);
                    return (
                      <>
                        {/* incident hotspots */}
                        {routeData.incidents.map((inc, i) => {
                          const c = p(inc.lat, inc.lng);
                          return <G key={`i${i}`}><Circle cx={c.x} cy={c.y} r={12} fill={RED} opacity={0.16} /><Circle cx={c.x} cy={c.y} r={4} fill={RED} opacity={0.9} /></G>;
                        })}
                        {segs}
                        {/* origin */}
                        <Circle cx={o.x} cy={o.y} r={9} fill={GREEN} opacity={0.25} />
                        <Circle cx={o.x} cy={o.y} r={5} fill={GREEN} />
                        {/* destination */}
                        <Circle cx={d.x} cy={d.y} r={9} fill={colors.dangerText} opacity={0.25} />
                        <Circle cx={d.x} cy={d.y} r={5} fill={colors.dangerText} />
                      </>
                    );
                  })()}
                </Svg>
                {/* legend */}
                <View style={styles.legend}>
                  <View style={styles.legendItem}><View style={[styles.dot, { backgroundColor: GREEN }]} /><Text style={styles.legendText}>Start</Text></View>
                  <View style={styles.legendItem}><View style={[styles.dot, { backgroundColor: colors.dangerText }]} /><Text style={styles.legendText}>Destination</Text></View>
                  <View style={styles.legendItem}><View style={[styles.dot, { backgroundColor: RED }]} /><Text style={styles.legendText}>Incident</Text></View>
                </View>
                {routeData.routingEngine === 'fallback' && (
                  <Text style={styles.fallbackNote}>Live routing unavailable — showing a direct line, still scored against real incidents.</Text>
                )}
              </View>

              {/* Stats */}
              <View style={styles.statsRow}>
                <View style={styles.statCard}><RouteIcon color={colors.textSub} size={18} /><Text style={styles.statVal}>{fmtDistance(routeData.distanceMeters)}</Text><Text style={styles.statLbl}>Distance</Text></View>
                <View style={styles.statCard}><Clock color={colors.textSub} size={18} /><Text style={styles.statVal}>{fmtEta(routeData.durationSeconds)}</Text><Text style={styles.statLbl}>Walk time</Text></View>
                <View style={styles.statCard}><AlertTriangle color={si.color} size={18} /><Text style={styles.statVal}>{routeData.incidentsNearby}</Text><Text style={styles.statLbl}>Near route</Text></View>
              </View>

              {/* Actions */}
              {tracking ? (
                <TouchableOpacity style={[styles.journeyBtn, { backgroundColor: RED }]} onPress={stopTracking} activeOpacity={0.85}>
                  <Text style={styles.journeyText}>Stop Tracking</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity onPress={startTracking} activeOpacity={0.85}>
                  <LinearGradient colors={[colors.govGreen, '#00926b']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.journeyBtn}>
                    <Navigation color={colors.onFill} size={18} /><Text style={styles.journeyText}>Start Journey · Share Live Location</Text>
                  </LinearGradient>
                </TouchableOpacity>
              )}
              <View style={styles.trackHint}>
                <Flag color={colors.textMuted} size={13} />
                <Text style={styles.trackHintText}>While tracking, your trusted contacts can follow you and you'll be alerted if you stray far off the route.</Text>
              </View>
            </>
          )}

          {!routeData && !loading && (
            <View style={styles.emptyHint}>
              <ShieldCheck color={colors.textMuted} size={40} />
              <Text style={styles.emptyText}>
                Enter where you're heading. We'll draw the walking route and colour it by how many verified incidents were reported nearby in the last 90 days.
              </Text>
            </View>
          )}
        </ScrollView>
      </LinearGradient>
    </KeyboardAvoidingView>
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
  scroll: { padding: spacing.lg, paddingTop: Platform.OS === 'ios' ? 56 : 40, paddingBottom: 48 },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.lg },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  title: { ...font.h2, color: colors.text },
  subtitle: { ...font.xs, color: colors.textMuted, marginTop: 2 },

  searchCard: { backgroundColor: colors.surfaceAlt, borderRadius: radius.xl, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.lg },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md, height: 50 },
  searchInput: { flex: 1, color: colors.onFill, fontSize: 15 },
  originRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10, marginLeft: 2 },
  originText: { ...font.xs, color: colors.textMuted },
  findBtn: { marginTop: spacing.md, borderRadius: radius.md, overflow: 'hidden' },
  findBtnGrad: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingVertical: 14 },
  findBtnText: { color: colors.onFill, fontSize: 16, fontWeight: '700' },

  scoreCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: radius.xl, padding: spacing.lg, marginBottom: spacing.md, ...shadows.card },
  scoreLeft: { flexDirection: 'row', alignItems: 'flex-end' },
  scoreNum: { fontSize: 64, fontWeight: 'bold', color: colors.onFill, lineHeight: 66 },
  scoreSlash: { ...font.h3, color: colors.textSub, marginBottom: 8 },
  scoreRight: { alignItems: 'flex-end' },
  scoreIconCircle: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  scoreLabel: { ...font.h3, color: colors.onFill },
  scoreSub: { ...font.xs, color: colors.textSub, marginTop: 2 },

  mapCard: { backgroundColor: colors.surfaceAlt, borderRadius: radius.xl, borderWidth: 1, borderColor: colors.border, padding: spacing.sm, marginBottom: spacing.md, overflow: 'hidden' },
  legend: { flexDirection: 'row', justifyContent: 'center', gap: spacing.lg, paddingVertical: spacing.sm },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  dot: { width: 9, height: 9, borderRadius: 5 },
  legendText: { ...font.xs, color: colors.textSub },
  fallbackNote: { ...font.xs, color: colors.warning, textAlign: 'center', paddingHorizontal: spacing.sm, paddingBottom: spacing.sm },

  statsRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  statCard: { flex: 1, backgroundColor: colors.surfaceAlt, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.md, alignItems: 'center', gap: 4 },
  statVal: { ...font.h3, color: colors.text },
  statLbl: { ...font.xs, color: colors.textMuted },

  journeyBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingVertical: 15, borderRadius: radius.md, marginBottom: spacing.sm },
  journeyText: { color: colors.onFill, fontSize: 15, fontWeight: '700' },
  trackHint: { flexDirection: 'row', gap: 8, backgroundColor: colors.surfaceAlt, borderRadius: radius.md, padding: spacing.md, alignItems: 'flex-start' },
  trackHintText: { ...font.xs, color: colors.textMuted, flex: 1, lineHeight: 18 },

  emptyHint: { alignItems: 'center', gap: spacing.md, paddingTop: spacing.xxl, paddingHorizontal: spacing.md },
  emptyText: { ...font.sm, color: colors.textMuted, textAlign: 'center', lineHeight: 21 },
});
};
