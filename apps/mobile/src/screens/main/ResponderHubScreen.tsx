import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, FlatList, Alert, Platform } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import api from '../../services/api';
import { formatDistanceToNow } from 'date-fns';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, font, spacing, radius, shadows, gradients } from '../../theme';
import { ShieldAlert, CheckCircle, XCircle, RefreshCw, Clock, ChevronLeft } from 'lucide-react-native';

export default function ResponderHubScreen() {
  const navigation = useNavigation();
  const [dispatches, setDispatches] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [notResponder, setNotResponder] = useState(false);

  const fetchDispatches = async () => {
    setLoading(true);
    try { setDispatches((await api.get('/responders/dispatches')).data.data); }
    catch (err: any) {
      if (err.response?.status === 404) setNotResponder(true);
      else console.error(err);
    } finally { setLoading(false); }
  };

  useEffect(() => { fetchDispatches(); }, []);

  const respond = async (id: string, action: 'accept' | 'reject') => {
    try {
      await api.patch(`/responders/dispatches/${id}/response`, { action });
      fetchDispatches();
      if (action === 'accept') Alert.alert('✅ Accepted', 'Details unlocked below.');
    } catch (e: any) { Alert.alert('Error', e.response?.data?.error?.message || 'Failed'); }
  };

  const renderItem = ({ item }: { item: any }) => (
    <View style={styles.card}>
      {/* Card Header */}
      <View style={styles.cardHeader}>
        <View style={styles.cardHeaderLeft}>
          {item.status === 'pending'  && <ShieldAlert color={colors.amber} size={20} />}
          {item.status === 'accepted' && <CheckCircle color={colors.green} size={20} />}
          {item.status === 'rejected' && <XCircle color={colors.textMuted} size={20} />}
          <View style={[styles.statusPill,
            item.status === 'pending'  ? styles.pillAmber :
            item.status === 'accepted' ? styles.pillGreen  : styles.pillMuted
          ]}>
            <Text style={[styles.statusPillText,
              item.status === 'pending'  ? { color: colors.amber } :
              item.status === 'accepted' ? { color: colors.green } : { color: colors.textMuted }
            ]}>{item.status.toUpperCase()}</Text>
          </View>
        </View>
        <View style={styles.timeRow}>
          <Clock color={colors.textMuted} size={12} />
          <Text style={styles.timeText}>{formatDistanceToNow(new Date(item.dispatchedAt))} ago</Text>
        </View>
      </View>

      {/* Pending */}
      {item.status === 'pending' && (
        <>
          <Text style={styles.cardTitle}>🚨 Nearby Emergency</Text>
          <Text style={styles.cardField}>Victim: <Text style={styles.cardValue}>{item.alert.victimName}</Text></Text>
          <Text style={styles.cardField}>Distance: <Text style={styles.cardValue}>~{item.alert.latitude} (Masked)</Text></Text>
          <View style={styles.actionRow}>
            <TouchableOpacity style={styles.acceptWrap} onPress={() => respond(item.id, 'accept')} activeOpacity={0.85}>
              <LinearGradient colors={gradients.green} style={styles.acceptBtn}>
                <CheckCircle color="#fff" size={18} />
                <Text style={styles.acceptText}>Accept</Text>
              </LinearGradient>
            </TouchableOpacity>
            <TouchableOpacity style={styles.rejectBtn} onPress={() => respond(item.id, 'reject')} activeOpacity={0.8}>
              <XCircle color={colors.textMuted} size={18} />
              <Text style={styles.rejectText}>Reject</Text>
            </TouchableOpacity>
          </View>
        </>
      )}

      {/* Accepted */}
      {item.status === 'accepted' && (
        <>
          <Text style={styles.cardTitle}>Dispatch Details</Text>
          {[
            ['Victim', item.alert.victimName],
            ['Phone', item.alert.victimPhone],
            ['Blood Group', item.alert.bloodGroup],
            ['Latitude', item.alert.latitude],
            ['Longitude', item.alert.longitude],
          ].map(([k, v]) => (
            <View key={k} style={styles.detailRow}>
              <Text style={styles.detailKey}>{k}</Text>
              <Text style={styles.detailVal}>{v || '—'}</Text>
            </View>
          ))}
        </>
      )}

      {/* Rejected */}
      {item.status === 'rejected' && (
        <Text style={styles.rejectedNote}>This dispatch was rejected.</Text>
      )}
    </View>
  );

  return (
    <LinearGradient colors={['#060d1f', '#0a1428', '#0d1b35']} style={styles.root}>
      {/* Nav Header */}
      <View style={styles.navHeader}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.navBackBtn} activeOpacity={0.7}>
          <ChevronLeft color={colors.text} size={24} />
        </TouchableOpacity>
        <View style={styles.navCenter}>
          <Text style={styles.navTitle}>Responder Hub</Text>
          <Text style={styles.navSub}>Community dispatches</Text>
        </View>
        <TouchableOpacity style={styles.navRefreshBtn} onPress={fetchDispatches} activeOpacity={0.7}>
          <RefreshCw color={colors.textSub} size={18} />
        </TouchableOpacity>
      </View>

      {notResponder ? (
        <View style={styles.notResponderCard}>
          <LinearGradient colors={[colors.bgCard, colors.bgCardAlt]} style={styles.notResponderInner}>
            <ShieldAlert color={colors.amber} size={52} style={{ marginBottom: spacing.lg }} />
            <Text style={styles.nrTitle}>Not Yet a Responder</Text>
            <Text style={styles.nrBody}>Go to your Profile and apply to become a verified community responder. Once approved, you'll receive nearby emergency alerts.</Text>
          </LinearGradient>
        </View>
      ) : (
        <FlatList
          data={dispatches}
          keyExtractor={i => i.id}
          renderItem={renderItem}
          refreshing={loading}
          onRefresh={fetchDispatches}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={!loading ? (
            <View style={styles.empty}>
              <ShieldAlert color={colors.border} size={52} />
              <Text style={styles.emptyTitle}>No Dispatches</Text>
              <Text style={styles.emptySub}>You'll be notified when a nearby emergency needs your help.</Text>
            </View>
          ) : null}
        />
      )}
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  navHeader: {
    flexDirection: 'row', alignItems: 'center',
    paddingTop: Platform.OS === 'ios' ? 52 : 40, paddingBottom: 12,
    paddingHorizontal: spacing.md, gap: spacing.sm,
    backgroundColor: 'rgba(6,13,31,0.98)',
    borderBottomWidth: 1, borderBottomColor: colors.glassBorder,
  },
  navBackBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: colors.bgCard, borderWidth: 1, borderColor: colors.glassBorder,
    alignItems: 'center', justifyContent: 'center',
  },
  navCenter: { flex: 1 },
  navTitle: { ...font.h3, color: colors.text },
  navSub: { ...font.xs, color: colors.textMuted, marginTop: 2 },
  navRefreshBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: colors.bgCard, borderWidth: 1, borderColor: colors.glassBorder,
    alignItems: 'center', justifyContent: 'center',
  },
  list: { padding: spacing.md, paddingBottom: spacing.xxl },
  card: { backgroundColor: colors.bgCard, borderRadius: radius.xl, padding: spacing.lg, marginBottom: spacing.md, borderWidth: 1, borderColor: colors.glassBorder, ...shadows.card },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md },
  cardHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  statusPill: { borderRadius: radius.full, paddingHorizontal: spacing.sm, paddingVertical: 2, borderWidth: 1 },
  pillAmber: { backgroundColor: `${colors.amber}15`, borderColor: `${colors.amber}40` },
  pillGreen: { backgroundColor: `${colors.green}15`, borderColor: `${colors.green}40` },
  pillMuted: { backgroundColor: colors.bgCardAlt, borderColor: colors.border },
  statusPillText: { ...font.xs, fontWeight: '700', letterSpacing: 0.5 },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  timeText: { ...font.xs, color: colors.textMuted },
  cardTitle: { ...font.h3, color: colors.text, marginBottom: spacing.sm },
  cardField: { ...font.sm, color: colors.textMuted, marginBottom: 4 },
  cardValue: { color: colors.text, fontWeight: '600' },
  actionRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  acceptWrap: { flex: 1, borderRadius: radius.lg, ...shadows.card },
  acceptBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingVertical: spacing.md, borderRadius: radius.lg },
  acceptText: { ...font.body, color: '#fff', fontWeight: '700' },
  rejectBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingVertical: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgCardAlt },
  rejectText: { ...font.body, color: colors.textMuted, fontWeight: '600' },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  detailKey: { ...font.sm, color: colors.textMuted },
  detailVal: { ...font.sm, color: colors.text, fontWeight: '600' },
  rejectedNote: { ...font.sm, color: colors.textMuted, fontStyle: 'italic' },
  notResponderCard: { flex: 1, padding: spacing.lg },
  notResponderInner: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, borderRadius: radius.xl, borderWidth: 1, borderColor: colors.glassBorder },
  nrTitle: { ...font.h2, color: colors.text, textAlign: 'center', marginBottom: spacing.md },
  nrBody: { ...font.body, color: colors.textMuted, textAlign: 'center', lineHeight: 24 },
  empty: { alignItems: 'center', paddingTop: spacing.xxl + spacing.xl },
  emptyTitle: { ...font.h3, color: colors.textMuted, marginTop: spacing.lg },
  emptySub: { ...font.sm, color: colors.textMuted, textAlign: 'center', marginTop: spacing.sm, lineHeight: 22, paddingHorizontal: spacing.xl },
});
