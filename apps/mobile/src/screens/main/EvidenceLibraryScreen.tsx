import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Image, Linking, RefreshControl, Modal, Dimensions } from 'react-native';
import { showAlert } from '../../utils/notify';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeInDown, ZoomIn } from 'react-native-reanimated';
import { useFocusEffect } from '@react-navigation/native';
import {
  Image as ImageIcon, Video, Music, FileText, Download, Clock, Inbox, X, Maximize2, AlertCircle,
} from 'lucide-react-native';
import { Theme, useTheme, useThemedStyles } from '../../theme';
import { useLanguage, useT, type TFunction } from '../../i18n';
import { AppBar, Badge, Button, EmptyState, PressableScale, Shimmer, Txt } from '../../components/ui';
import { radius, spacing, type } from '../../theme/tokens';
import type { Palette } from '../../theme/tokens';
import api, { getAccessToken, evidenceRawUrl, getApiBaseUrl } from '../../services/api';

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

const typeMeta = (colors: Palette): Record<string, { Icon: any; color: string; label: string; tone: 'success' | 'info' | 'warning' | 'accent' }> => ({
  photo: { Icon: ImageIcon, color: colors.successText, label: 'Photo', tone: 'success' },
  video: { Icon: Video, color: colors.infoText, label: 'Video', tone: 'info' },
  audio: { Icon: Music, color: colors.warningText, label: 'Audio', tone: 'warning' },
  document: { Icon: FileText, color: colors.accentText, label: 'File', tone: 'accent' },
});

// Resolve the public (presigned) URL to the app's real origin for downloads.
function resolveMediaUrl(url: string): string {
  if (!url) return url;
  const idx = url.indexOf('/api/v1/evidence/mock-s3/');
  if (idx >= 0) return getApiBaseUrl().replace(/\/api\/v1\/?$/, '') + url.slice(idx);
  return url;
}

function isImageItem(it: EvidenceItem): boolean {
  return it.type === 'photo' || (it.mimeType?.startsWith('image/') ?? false);
}

function formatSize(bytes: number, t: TFunction): string {
  if (!bytes) return '';
  if (bytes < 1024) return t('{n} B', { n: bytes });
  if (bytes < 1024 * 1024) return t('{n} KB', { n: Math.round(bytes / 1024) });
  return t('{d} MB', { d: (bytes / (1024 * 1024)).toFixed(1) });
}

function formatDate(ts: string | null | undefined, locale: string): string {
  if (!ts) return '';
  const d = new Date(ts);
  try {
    return d.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' })
      + ' · ' + d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  } catch {
    return d.toLocaleString();
  }
}

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

export default function EvidenceLibraryScreen() {
  const styles = useThemedStyles(makeStyles);
  const { colors, shadows } = useTheme();
  const t = useT();
  const { isBangla } = useLanguage();
  const insets = useSafeAreaInsets();
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
      else showAlert(t('Unavailable'), t('This file link could not be opened.'));
    } catch {
      showAlert(t('Download failed'), t('Please try again in a moment.'));
    }
  };

  const openItem = (item: EvidenceItem) => {
    if (isImageItem(item)) setViewer(item);
    else downloadItem(item);
  };

  const locale = isBangla ? 'bn-BD' : 'en-GB';

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={colors.accent} colors={[colors.accent]} />}
      >
        <AppBar title={t('Evidence Library')} subtitle={t('Your captured SOS evidence, stored securely')} />

        {loading ? (
          <View style={{ gap: spacing.md }}>
            {[0, 1, 2].map((i) => (
              <Shimmer key={i} width="100%" height={82} radius={radius.lg} />
            ))}
          </View>
        ) : error ? (
          <EmptyState
            icon={<AlertCircle color={colors.dangerText} size={30} />}
            title={t('Something went wrong')}
            message={t(error)}
            action={<Button label={t('Try again')} full={false} onPress={() => load()} />}
          />
        ) : items.length === 0 ? (
          <EmptyState
            icon={<Inbox color={colors.textMuted} size={30} />}
            title={t('No evidence yet')}
            message={t('Photos and recordings you capture during an SOS are saved here privately, and you can view or download them anytime.')}
          />
        ) : (
          items.map((it, index) => {
            const TYPE_META = typeMeta(colors);
            const meta = TYPE_META[it.type] || TYPE_META.document;
            const showThumb = isImageItem(it) && !failedThumbs[it.id];
            return (
              <Animated.View key={it.id} entering={FadeInDown.delay(Math.min(index, 8) * 60).duration(350)}>
                <PressableScale style={[styles.card, shadows.soft]} scaleTo={0.98} onPress={() => openItem(it)}>
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
                      <View style={styles.thumbOverlay}><Maximize2 color="#fff" size={12} /></View>
                    )}
                  </View>

                  <View style={styles.cardBody}>
                    <Txt variant="bodyStrong" numberOfLines={1}>{it.originalName || t(meta.label)}</Txt>
                    <View style={styles.metaRow}>
                      <Badge label={t(meta.label)} tone={meta.tone} icon={<meta.Icon color={meta.color} size={11} />} />
                      {!!it.sizeBytes && <Txt variant="xs" tone="sub">{formatSize(it.sizeBytes, t)}</Txt>}
                    </View>
                    <View style={styles.dateRow}>
                      <Clock color={colors.textMuted} size={11} />
                      <Txt variant="xs" tone="muted">{formatDate(it.uploadedAt || it.alertDate, locale)}</Txt>
                    </View>
                  </View>

                  <PressableScale
                    accessibilityRole="button"
                    accessibilityLabel={t('Download')}
                    style={styles.dlBtn}
                    onPress={() => downloadItem(it)}
                  >
                    <Download color={colors.accentText} size={18} />
                  </PressableScale>
                </PressableScale>
              </Animated.View>
            );
          })
        )}
      </ScrollView>

      {/* Full-screen image viewer — always dark, like a photo app. */}
      <Modal visible={!!viewer} transparent animationType="fade" onRequestClose={() => setViewer(null)}>
        <View style={styles.viewerRoot}>
          <View style={[styles.viewerTop, { top: insets.top + spacing.sm }]}>
            <Text style={styles.viewerName} numberOfLines={1}>{viewer?.originalName || t('Evidence')}</Text>
            <PressableScale style={styles.viewerBtn} onPress={() => setViewer(null)} accessibilityLabel={t('Close')}>
              <X color="#fff" size={22} />
            </PressableScale>
          </View>

          {viewer && (
            <Animated.View entering={ZoomIn.duration(250)}>
              <Image source={imgSource(viewer)} style={styles.viewerImg} resizeMode="contain" />
            </Animated.View>
          )}

          <PressableScale
            style={[styles.viewerDownload, { bottom: insets.bottom + spacing.xl }]}
            onPress={() => viewer && downloadItem(viewer)}
          >
            <Download color={colors.onAccent} size={18} />
            <Text style={styles.viewerDownloadText}>{t('Download / save')}</Text>
          </PressableScale>
        </View>
      </Modal>
    </View>
  );
}

const makeStyles = ({ colors }: Theme) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bg },
    scroll: { paddingHorizontal: spacing.md, paddingBottom: spacing.xxl },
    card: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing.sm + 2,
      marginBottom: spacing.md,
    },
    thumb: { width: 62, height: 62, borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.surfaceAlt },
    thumbImg: { width: '100%', height: '100%' },
    thumbIcon: { width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' },
    thumbOverlay: {
      position: 'absolute',
      right: 4,
      bottom: 4,
      width: 22,
      height: 22,
      borderRadius: 11,
      backgroundColor: 'rgba(0,0,0,0.55)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    cardBody: { flex: 1, gap: 5 },
    metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    dateRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    dlBtn: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: colors.accentSoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    viewerRoot: { flex: 1, backgroundColor: '#050505', justifyContent: 'center' },
    viewerTop: {
      position: 'absolute',
      left: 0,
      right: 0,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.lg,
      zIndex: 2,
    },
    viewerName: { ...type.sm, color: '#fff', flex: 1, marginRight: 12 },
    viewerBtn: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: 'rgba(255,255,255,0.14)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    viewerImg: { width: SCREEN_W, height: SCREEN_H * 0.75, alignSelf: 'center' },
    viewerDownload: {
      position: 'absolute',
      alignSelf: 'center',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      backgroundColor: colors.accent,
      paddingHorizontal: 22,
      paddingVertical: 13,
      borderRadius: 999,
    },
    viewerDownloadText: { color: colors.onAccent, fontWeight: '700', fontSize: 15 },
  });
