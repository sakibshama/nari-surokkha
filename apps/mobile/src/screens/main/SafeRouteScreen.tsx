import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, Alert, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { MainStackParamList } from '../../navigation/MainStack';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, font, spacing, radius } from '../../theme';
import { MapPin, Navigation, ArrowLeft } from 'lucide-react-native';
import * as Location from 'expo-location';
import api from '../../services/api';
import { useLocationStore } from '../../store/locationStore';
import { startBackgroundLocationUpdates, stopBackgroundLocationUpdates } from '../../services/backgroundTasks';

type Props = NativeStackScreenProps<MainStackParamList, 'SafeRoute'>;

export default function SafeRouteScreen({ navigation }: Props) {
  const [destLat, setDestLat] = useState('23.8103');
  const [destLng, setDestLng] = useState('90.4125');
  const [loading, setLoading] = useState(false);
  const [routeData, setRouteData] = useState<any>(null);
  const [tracking, setTracking] = useState(false);
  const { setActiveRoute } = useLocationStore();

  const requestRoute = async () => {
    setLoading(true);
    try {
      const { status } = await Location.getForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission needed', 'Location permission required.');
        setLoading(false);
        return;
      }
      const loc = await Location.getCurrentPositionAsync({});
      
      const res = await api.post('/alerts/safe-route', {
        origin: { lat: loc.coords.latitude, lng: loc.coords.longitude },
        destination: { lat: parseFloat(destLat), lng: parseFloat(destLng) }
      });
      setRouteData(res.data.data);
    } catch (err) {
      console.error(err);
      Alert.alert('Error', 'Failed to calculate safe route');
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

  useEffect(() => {
    return () => {
      stopBackgroundLocationUpdates();
      setActiveRoute(null);
    };
  }, []);

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <LinearGradient colors={['#0c1a2e', '#1e3a5f']} style={styles.root}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <ArrowLeft color="#fff" size={24} />
          </TouchableOpacity>
          <Text style={styles.title}>Safe Route</Text>
          <View style={{ width: 24 }} />
        </View>

        <View style={styles.content}>
          <Text style={styles.description}>
            Enter your destination coordinates. We'll find the safest path avoiding high-risk areas.
          </Text>

          {!routeData && (
            <View style={styles.card}>
              <View style={styles.inputGroup}>
                <Text style={styles.label}>Destination Latitude</Text>
                <TextInput style={styles.input} value={destLat} onChangeText={setDestLat} keyboardType="numeric" placeholderTextColor="rgba(255,255,255,0.4)" />
              </View>
              <View style={styles.inputGroup}>
                <Text style={styles.label}>Destination Longitude</Text>
                <TextInput style={styles.input} value={destLng} onChangeText={setDestLng} keyboardType="numeric" placeholderTextColor="rgba(255,255,255,0.4)" />
              </View>

              <TouchableOpacity style={styles.btn} onPress={requestRoute} disabled={loading}>
                {loading ? <ActivityIndicator color="#fff" /> : (
                  <>
                    <MapPin color="#fff" size={20} />
                    <Text style={styles.btnText}>Find Safe Route</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          )}

          {routeData && (
            <View style={styles.card}>
              <Text style={styles.label}>Safe Route Generated!</Text>
              <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 14, marginBottom: 16 }}>
                Waypoints: {routeData.waypoints?.length || 0}
              </Text>

              {tracking ? (
                <TouchableOpacity style={[styles.btn, { backgroundColor: colors.red }]} onPress={stopTracking}>
                  <Text style={styles.btnText}>Stop Tracking</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity style={styles.btn} onPress={startTracking}>
                  <Navigation color="#fff" size={20} />
                  <Text style={styles.btnText}>Start Journey</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>
      </LinearGradient>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.md, paddingTop: Platform.OS === 'ios' ? 60 : 40, paddingBottom: spacing.md },
  backBtn: { padding: spacing.xs },
  title: { ...font.h2, color: '#fff' },
  content: { flex: 1, padding: spacing.lg },
  description: { ...font.body, color: 'rgba(255,255,255,0.8)', marginBottom: spacing.xl, lineHeight: 22 },
  card: { backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  inputGroup: { marginBottom: spacing.md },
  label: { ...font.sm, color: 'rgba(255,255,255,0.7)', marginBottom: spacing.xs },
  input: { backgroundColor: 'rgba(0,0,0,0.3)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)', borderRadius: radius.md, padding: spacing.md, color: '#fff', fontSize: 16 },
  btn: { backgroundColor: colors.blue, padding: spacing.md, borderRadius: radius.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, marginTop: spacing.md },
  btnText: { color: '#fff', fontSize: 16, fontWeight: 'bold' }
});
