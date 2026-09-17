import React, { useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform, Image,
  ActivityIndicator, Linking, RefreshControl, Alert as RNAlert, Modal, Dimensions,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  ShieldCheck, Image as ImageIcon, Video, Music, FileText, Download, Clock, Inbox, X, Maximize2,
} from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Theme, useTheme, useThemedStyles } from '../../theme';
import { radius, spacing, type } from '../../theme/tokens';
import type { Palette } from '../../theme/tokens';
import api, { getAccessToken, evidenceRawUrl, API_BASE_URL } from '../../services/api';

interface EvidenceItem {
  id: string;
  alertId: string;
  type: 'photo' | 'audio' | 'video' | 'document';
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string;
  alertType?: string | null;
  alertDate?: string | null;
  url: string;
}

const typeMeta = (colors: Palette): Record<string, { Icon: any; color: string; label: string }> => ({
  photo: { Icon: ImageIcon, color: colors.successText, label: 'Photo' },
  video: { Icon: Video, color: colors.infoText, label: 'Video' },
  audio: { Icon: Music, color: colors.warningText, label: 'Audio' },
  document: { Icon: FileText, color: colors.accentText, label: 'File' },
});

const API_ORIGIN = API_BASE_URL.replace(/\/api\/v1\/?$/, '');

// Resolve the public (presigned) URL to the app's real origin for downloads.
function resolveMediaUrl(url: string): string {
  if (!url) return url;
  const idx = url.indexOf('/api/v1/evidence/mock-s3/');
  if (idx >= 0) return API_ORIGIN + url.slice(idx);
  return url;
}

function isImageItem(it: EvidenceItem): boolean {
  return it.type === 'photo' || (it.mimeType?.startsWith('image/') ?? false);
}

function formatSize(bytes: number): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(ts?: string | null): string {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
    + ' · ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

export default function EvidenceLibraryScreen() {
  const styles = useThemedStyles(makeStyles);
  const { colors, gradients, shadows } = useTheme();
  void gradients; void shadows;
  const [items, setItems] = useState<EvidenceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failedThumbs, setFailedThumbs] = useState<Record<string, boolean>>({});
  const [token, setToken] = useState<string | null>(null);
  const [viewer, setViewer] = useState<EvidenceItem | null>(null);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    setError(null);
    try {
      const res = await api.get('/evidence/my');
      setItems(res.data?.data ?? []);
      // The list call just succeeded (refreshing the token if needed), so this
      // token is fresh — safe to attach to authenticated <Image> requests.
      setToken(await getAccessToken());
      setFailedThumbs({});
    } catch {
      setError('Could not load your evidence. Pull down to retry.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Authenticated image source — streams bytes from the API over the working
  // connection (no dependency on a public URL being reachable from the device).
  const imgSource = (it: EvidenceItem) => ({
    uri: evidenceRawUrl(it.id),
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });

  const downloadItem = async (item: EvidenceItem) => {
    const target = resolveMediaUrl(item.url);
    try {
      const ok = await Linking.canOpenURL(target);
      if (ok) await Linking.openURL(target);
      else RNAlert.alert('Unavailable', 'This file link could not be opened.');
    } catch {
      RNAlert.alert('Download failed', 'Please try again in a moment.');
    }
  };

  const openItem = (item: EvidenceItem) => {
    if (isImageItem(item)) setViewer(item);
    else downloadItem(item);
  };

  return (
    <LinearGradient colors={gradients.hero} style={styles.root}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={colors.danger} />}
      >
        <View style={styles.header}>
          <View style={styles.headerIcon}><ShieldCheck color={colors.danger} size={22} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Evidence Library</Text>
            <Text style={styles.subtitle}>Your captured SOS evidence, stored securely</Text>
          </View>
        </View>

        {loading ? (
          <View style={styles.center}><ActivityIndicator size="large" color={colors.danger} /><Text style={styles.centerText}>Loading your evidence…</Text></View>
        ) : error ? (
          <View style={styles.center}><Text style={styles.centerText}>{error}</Text></View>
        ) : items.length === 0 ? (
          <View style={styles.center}>
            <Inbox color={colors.textMuted} size={44} />
            <Text style={styles.emptyTitle}>No evidence yet</Text>
            <Text style={styles.centerText}>
              Photos and recordings you capture during an SOS are saved here privately, and you can view or download them anytime.
            </Text>
          </View>
        ) : (
          items.map((it) => {
            const TYPE_META = typeMeta(colors);
            const meta = TYPE_META[it.type] || TYPE_META.document;
            const showThumb = isImageItem(it) && !failedThumbs[it.id];
            return (
              <TouchableOpacity key={it.id} style={styles.card} activeOpacity={0.85} onPress={() => openItem(it)}>
                <View style={styles.thumb}>
                  {showThumb ? (
                    <Image
                      source={imgSource(it)}
                      style={styles.thumbImg}
                      resizeMode="cover"
                      onError={() => setFailedThumbs((p) => ({ ...p, [it.id]: true }))}
                    />
                  ) : (
                    <View style={[styles.thumbIcon, { backgroundColor: `${meta.color}22` }]}>
                      <meta.Icon color={meta.color} size={26} />
                    </View>
                  )}
                  {isImageItem(it) && showThumb && (
                    <View style={styles.thumbOverlay}><Maximize2 color={colors.onFill} size={14} /></View>
                  )}
                </View>

                <View style={styles.cardBody}>
                  <Text style={styles.cardName} numberOfLines={1}>{it.originalName || `${meta.label} evidence`}</Text>
                  <View style={styles.metaRow}>
                    <View style={[styles.typePill, { backgroundColor: `${meta.color}1f` }]}>
                      <meta.Icon color={meta.color} size={11} />
                      <Text style={[styles.typePillText, { color: meta.color }]}>{meta.label}</Text>
                    </View>
                    {!!it.sizeBytes && <Text style={styles.metaText}>{formatSize(it.sizeBytes)}</Text>}
                  </View>
                  <View style={styles.dateRow}>
                    <Clock color={colors.textMuted} size={11} />
                    <Text style={styles.dateText}>{formatDate(it.uploadedAt || it.alertDate)}</Text>
                  </View>
                </View>

                <TouchableOpacity style={styles.dlBtn} onPress={() => downloadItem(it)}>
                  <Download color={colors.danger} size={18} />
                </TouchableOpacity>
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>

      {/* Full-screen image viewer */}
      <Modal visible={!!viewer} transparent animationType="fade" onRequestClose={() => setViewer(null)}>
        <View style={styles.viewerRoot}>
          <View style={styles.viewerTop}>
            <Text style={styles.viewerName} numberOfLines={1}>{viewer?.originalName || 'Evidence'}</Text>
            <TouchableOpacity style={styles.viewerBtn} onPress={() => setViewer(null)}>
              <X color={colors.onFill} size={22} />
            </TouchableOpacity>
          </View>

          {viewer && (
            <Image source={imgSource(viewer)} style={styles.viewerImg} resizeMode="contain" />
          )}

          <TouchableOpacity style={styles.viewerDownload} activeOpacity={0.85} onPress={() => viewer && downloadItem(viewer)}>
            <Download color={colors.onFill} size={18} />
            <Text style={styles.viewerDownloadText}>Download / Save</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    </LinearGradient>
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
  scroll: { padding: spacing.lg, paddingTop: Platform.OS === 'ios' ? 60 : 48, paddingBottom: 40 },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.lg },
  headerIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(244,63,94,0.12)', borderWidth: 1, borderColor: 'rgba(244,63,94,0.25)', alignItems: 'center', justifyContent: 'center' },
  title: { ...font.h1, color: colors.text },
  subtitle: { ...font.sm, color: colors.textMuted, marginTop: 2 },

  center: { alignItems: 'center', paddingTop: 70, paddingHorizontal: spacing.lg, gap: 10 },
  centerText: { ...font.sm, color: colors.textMuted, textAlign: 'center', lineHeight: 20 },
  emptyTitle: { ...font.h3, color: colors.text, marginTop: 8 },

  card: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.surfaceAlt, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border,
    padding: spacing.sm + 2, marginBottom: spacing.md,
  },
  thumb: { width: 60, height: 60, borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.surface },
  thumbImg: { width: '100%', height: '100%' },
  thumbIcon: { width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' },
  thumbOverlay: { position: 'absolute', right: 4, bottom: 4, width: 22, height: 22, borderRadius: 11, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  cardBody: { flex: 1, gap: 5 },
  cardName: { ...font.body, color: colors.text, fontWeight: '600' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  typePill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  typePillText: { fontSize: 11, fontWeight: '700' },
  metaText: { ...font.xs, color: colors.textSub },
  dateRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  dateText: { ...font.xs, color: colors.textMuted },
  dlBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(244,63,94,0.10)', borderWidth: 1, borderColor: 'rgba(244,63,94,0.22)', alignItems: 'center', justifyContent: 'center' },

  viewerRoot: { flex: 1, backgroundColor: colors.surface, justifyContent: 'center' },
  viewerTop: { position: 'absolute', top: Platform.OS === 'ios' ? 54 : 32, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, zIndex: 2 },
  viewerName: { ...font.sm, color: colors.onFill, flex: 1, marginRight: 12 },
  viewerBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  viewerImg: { width: SCREEN_W, height: SCREEN_H * 0.75, alignSelf: 'center' },
  viewerDownload: { position: 'absolute', bottom: Platform.OS === 'ios' ? 48 : 32, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.danger, paddingHorizontal: 22, paddingVertical: 13, borderRadius: 999 },
  viewerDownloadText: { color: colors.onFill, fontWeight: '700', fontSize: 15 },
});
};
