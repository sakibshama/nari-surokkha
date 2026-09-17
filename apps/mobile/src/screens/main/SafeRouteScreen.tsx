import React, { useState, useEffect, useMemo } from 'react';
import { View, Text, TextInput, KeyboardAvoidingView, Platform } from 'react-native';
import { showAlert } from '../../utils/notify';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { MainStackParamList } from '../../navigation/MainStack';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Line, Circle, Rect, G } from 'react-native-svg';
import {
  Search, Navigation, ShieldCheck, ShieldAlert, AlertTriangle,
  MapPin, Clock, Route as RouteIcon, Flag, Crosshair, Square,
} from 'lucide-react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import * as Location from 'expo-location';
import { useTheme } from '../../theme';
import { useLanguage, useT, type TFunction } from '../../i18n';
import { AppBar, Breathing, Button, Card, EmptyState, FadeIn, Screen, Txt } from '../../components/ui';
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
  if (score >= 75) return { label: 'Safe route', color: colors.success, Icon: ShieldCheck, grad: [colors.success, colors.accentPressed] as const };
  if (score >= 50) return { label: 'Moderate risk', color: colors.warning, Icon: ShieldAlert, grad: [colors.warning, '#A8650C'] as const };
  return { label: 'High risk', color: colors.danger, Icon: AlertTriangle, grad: [colors.danger, colors.dangerPressed] as const };
}

function riskColor(risk: number, colors: Palette) {
  if (risk >= 0.5) return colors.danger;
  if (risk > 0) return colors.warning;
  return colors.success;
}

function fmtDistance(m: number, t: TFunction) {
  return m >= 1000 ? t('{d} km', { d: (m / 1000).toFixed(1) }) : t('{d} m', { d: Math.round(m) });
}
function fmtEta(s: number, t: TFunction) {
  const min = Math.round(s / 60);
  if (min < 60) return t('{n} min', { n: min });
  return t('{h}h {m}m', { h: Math.floor(min / 60), m: min % 60 });
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

export default function SafeRouteScreen(_props: Props) {
  const { colors, shadows } = useTheme();
  const t = useT();
  const { num } = useLanguage();
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);
  const [loading, setLoading] = useState(false);
  const [routeData, setRouteData] = useState<RouteData | null>(null);
  const [tracking, setTracking] = useState(false);
  const { setActiveRoute } = useLocationStore();

  const MAP_W = 320, MAP_H = 240;
  const proj = useProjection(routeData, MAP_W, MAP_H);

  async function resolveDestination(): Promise<{ lat: number; lng: number } | null> {
    const q = query.trim();
    if (!q) {
      showAlert(t('Destination needed'), t('Enter a place name or "latitude, longitude".'));
      return null;
    }
    const m = q.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };
    try {
      const results = await Location.geocodeAsync(q);
      if (results?.length) return { lat: results[0].latitude, lng: results[0].longitude };
      showAlert(t('Not found'), t('Could not locate "{q}". Try a more specific place or coordinates.', { q }));
    } catch {
      showAlert(t('Search failed'), t('Could not search that place. Try coordinates like "23.81, 90.41".'));
    }
    return null;
  }

  const requestRoute = async () => {
    setLoading(true);
    try {
      const { status } = await Location.getForegroundPermissionsAsync();
      const perm = status === 'granted' ? status : (await Location.requestForegroundPermissionsAsync()).status;
      if (perm !== 'granted') {
        showAlert(t('Permission needed'), t('Location permission is required.'));
        return;
      }
      const dest = await resolveDestination();
      if (!dest) return;

      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const res = await api.post('/alerts/safe-route', {
        origin: { lat: loc.coords.latitude, lng: loc.coords.longitude },
        destination: { lat: dest.lat, lng: dest.lng },
      });
      setRouteData(res.data.data as RouteData);
    } catch (err) {
      if (__DEV__) console.error(err);
      showAlert(t('Error'), t('Failed to calculate the safe route. Please try again.'));
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
      if (__DEV__) console.error(e);
      showAlert(t('Error'), t('Failed to start tracking'));
      setTracking(false);
      setActiveRoute(null);
    }
  };

  const stopTracking = async () => {
    await stopBackgroundLocationUpdates();
    setTracking(false);
    setActiveRoute(null);
    setRouteData(null);
  };

  useEffect(() => () => { stopBackgroundLocationUpdates(); setActiveRoute(null); }, []);

  const si = routeData ? scoreInfo(routeData.safetyScore, colors) : null;
  const START = colors.success;
  const END = colors.info;
  const HOT = colors.danger;

  const stat = (Icon: React.ComponentType<{ color: string; size: number }>, iconColor: string, value: string, label: string, delay: number) => (
    <FadeIn delay={delay} style={{ flex: 1 }}>
      <View style={{ backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.md, alignItems: 'center', gap: 4 }}>
        <Icon color={iconColor} size={18} />
        <Txt variant="h3">{value}</Txt>
        <Txt variant="xs" tone="muted">{label}</Txt>
      </View>
    </FadeIn>
  );

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen>
        <AppBar title={t('Safe Route')} subtitle={t('Routed around reported-incident hotspots')} />

        {/* Search */}
        <Card elevation="raised" delay={40}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: spacing.sm,
              backgroundColor: colors.inputBg,
              borderRadius: radius.md,
              borderWidth: 1.5,
              borderColor: focused ? colors.accent : colors.border,
              paddingHorizontal: spacing.md,
              minHeight: 52,
            }}
          >
            <Search color={focused ? colors.accent : colors.textMuted} size={18} />
            <TextInput
              style={{ flex: 1, color: colors.text, fontSize: 15, paddingVertical: 10 }}
              value={query}
              onChangeText={setQuery}
              placeholder={t('Destination — place name or lat, lng')}
              placeholderTextColor={colors.textMuted}
              returnKeyType="search"
              onSubmitEditing={requestRoute}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
            />
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10, marginBottom: spacing.md }}>
            <Crosshair color={colors.accentText} size={13} />
            <Txt variant="xs" tone="muted">{t('Starting from your current location')}</Txt>
          </View>
          <Button
            label={t('Find safe route')}
            onPress={requestRoute}
            loading={loading}
            icon={<MapPin color={colors.onAccent} size={18} />}
          />
        </Card>

        {routeData && si && (
          <Animated.View entering={FadeInDown.duration(400)} style={{ marginTop: spacing.lg, gap: spacing.md }}>
            {/* Safety score */}
            <LinearGradient
              colors={si.grad}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={[{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: radius.xl, padding: spacing.lg }, shadows.card]}
            >
              <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
                <Text style={{ fontSize: 60, fontWeight: '900', color: '#fff', lineHeight: 64 }}>{num(routeData.safetyScore)}</Text>
                <Text style={[type.h3, { color: 'rgba(255,255,255,0.75)', marginBottom: 8 }]}>/{num(100)}</Text>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 4 }}>
                <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' }}>
                  <si.Icon color="#fff" size={28} />
                </View>
                <Text style={[type.h3, { color: '#fff', fontWeight: '800' }]}>{t(si.label)}</Text>
                <Text style={[type.xs, { color: 'rgba(255,255,255,0.85)' }]}>
                  {t(routeData.incidentsNearby === 1 ? '{n} incident near route' : '{n} incidents near route', { n: routeData.incidentsNearby })}
                </Text>
              </View>
            </LinearGradient>

            {/* Route map */}
            <Card padded={false} style={{ padding: spacing.sm }}>
              <Svg width="100%" height={MAP_H} viewBox={`0 0 ${MAP_W} ${MAP_H}`}>
                <Rect x={0} y={0} width={MAP_W} height={MAP_H} rx={16} fill={colors.surfaceAlt} />
                <G opacity={0.6}>
                  {[1, 2, 3].map((i) => (
                    <Line key={`h${i}`} x1={0} y1={(MAP_H / 4) * i} x2={MAP_W} y2={(MAP_H / 4) * i} stroke={colors.border} strokeWidth={1} />
                  ))}
                  {[1, 2, 3].map((i) => (
                    <Line key={`v${i}`} x1={(MAP_W / 4) * i} y1={0} x2={(MAP_W / 4) * i} y2={MAP_H} stroke={colors.border} strokeWidth={1} />
                  ))}
                </G>
                {proj && (() => {
                  const p = proj.project;
                  const wp = routeData.waypoints;
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
                      {routeData.incidents.map((inc, i) => {
                        const c = p(inc.lat, inc.lng);
                        return (
                          <G key={`i${i}`}>
                            <Circle cx={c.x} cy={c.y} r={12} fill={HOT} opacity={0.16} />
                            <Circle cx={c.x} cy={c.y} r={4} fill={HOT} opacity={0.9} />
                          </G>
                        );
                      })}
                      {segs}
                      <Circle cx={o.x} cy={o.y} r={9} fill={START} opacity={0.25} />
                      <Circle cx={o.x} cy={o.y} r={5} fill={START} />
                      <Circle cx={d.x} cy={d.y} r={9} fill={END} opacity={0.25} />
                      <Circle cx={d.x} cy={d.y} r={5} fill={END} />
                    </>
                  );
                })()}
              </Svg>
              <View style={{ flexDirection: 'row', justifyContent: 'center', gap: spacing.lg, paddingVertical: spacing.sm }}>
                {[
                  [START, t('Start')],
                  [END, t('Destination')],
                  [HOT, t('Incident')],
                ].map(([c, l]) => (
                  <View key={l} style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                    <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: c }} />
                    <Txt variant="xs" tone="sub">{l}</Txt>
                  </View>
                ))}
              </View>
              {routeData.routingEngine === 'fallback' && (
                <Txt variant="xs" tone="warning" center style={{ paddingHorizontal: spacing.sm, paddingBottom: spacing.sm }}>
                  {t('Live routing unavailable — showing a direct line, still scored against real incidents.')}
                </Txt>
              )}
            </Card>

            {/* Stats */}
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              {stat(RouteIcon, colors.accentText, fmtDistance(routeData.distanceMeters, t), t('Distance'), 80)}
              {stat(Clock, colors.accentText, fmtEta(routeData.durationSeconds, t), t('Walk time'), 140)}
              {stat(AlertTriangle, si.color, num(routeData.incidentsNearby), t('Near route'), 200)}
            </View>

            {/* Actions */}
            {tracking ? (
              <Breathing min={0.99} max={1.01} duration={900}>
                <Button
                  label={t('Stop tracking')}
                  variant="danger"
                  onPress={stopTracking}
                  icon={<Square color={colors.onDanger} size={16} />}
                />
              </Breathing>
            ) : (
              <Button
                label={t('Start journey · share live location')}
                onPress={startTracking}
                icon={<Navigation color={colors.onAccent} size={18} />}
              />
            )}
            <Card tone="info" style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
              <Flag color={colors.infoText} size={14} />
              <Txt variant="xs" tone="sub" style={{ flex: 1 }}>
                {t("While tracking, your trusted contacts can follow you and you'll be alerted if you stray far off the route.")}
              </Txt>
            </Card>
          </Animated.View>
        )}

        {!routeData && !loading && (
          <EmptyState
            icon={<ShieldCheck color={colors.accentText} size={30} />}
            title={t('Where are you heading?')}
            message={t("We'll draw the walking route and colour it by how many verified incidents were reported nearby in the last 90 days.")}
          />
        )}
      </Screen>
    </KeyboardAvoidingView>
  );
}
