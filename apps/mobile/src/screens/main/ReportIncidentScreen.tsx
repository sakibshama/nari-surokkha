import React, { useRef, useState } from 'react';
import { ActivityIndicator, Image, Pressable, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { showAlert } from '../../utils/notify';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as Location from 'expo-location';
import Animated, { ZoomIn } from 'react-native-reanimated';
import { AlertCircle, Camera, Check, Eye, FileText, Film, ImagePlus, Lightbulb, Lock, Send, UserX, Video, Wallet, X } from 'lucide-react-native';

import { MainStackParamList } from '../../navigation/MainStack';
import api from '../../services/api';
import {
  Attachment, MAX_ATTACHMENTS, MAX_IMAGE_BYTES, MAX_VIDEO_BYTES, MAX_VIDEO_SECONDS,
  formatDuration, toAttachment, uploadAttachment,
} from '../../services/incidentMedia';
import { useTheme } from '../../theme';
import { useT } from '../../i18n';
import { radius, spacing, type } from '../../theme/tokens';
import { AppBar, Badge, Button, Card, FadeIn, KeyboardAwareTextInput, PressableScale, Screen, SectionLabel, Txt } from '../../components/ui';

type Props = NativeStackScreenProps<MainStackParamList, 'ReportIncident'>;

type Tone = 'danger' | 'warning' | 'neutral';

const TYPES: { label: string; value: string; icon: React.ComponentType<{ color: string; size: number }>; tone: Tone }[] = [
  { label: 'Harassment', value: 'harassment', icon: UserX, tone: 'danger' },
  { label: 'Robbery / Theft', value: 'robbery', icon: Wallet, tone: 'danger' },
  { label: 'Suspicious activity', value: 'suspicious_activity', icon: Eye, tone: 'warning' },
  { label: 'Poor lighting', value: 'poor_lighting', icon: Lightbulb, tone: 'warning' },
  { label: 'Other', value: 'other', icon: FileText, tone: 'neutral' },
];

export default function ReportIncidentScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const t = useT();
  const [selected, setSelected] = useState(TYPES[0].value);
  const [desc, setDesc] = useState('');
  const [loading, setLoading] = useState(false);
  const [descFocused, setDescFocused] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  // Per-attachment upload state while sending: progress 0..1, 'done' or an error message.
  const [uploadState, setUploadState] = useState<Record<string, number | 'done' | { error: string }>>({});
  const [phase, setPhase] = useState<'idle' | 'locating' | 'sending' | 'uploading'>('idle');
  // Once the report exists, retries only re-send the files, never the report.
  const created = useRef<{ id: string; token: string } | null>(null);
  // Uploaded keys live in a ref so a retry (run from an alert's closure) never re-sends them.
  const uploaded = useRef(new Set<string>());

  const remaining = MAX_ATTACHMENTS - attachments.length;

  const addAssets = (assets: ImagePicker.ImagePickerAsset[]) => {
    const accepted: Attachment[] = [];
    let tooBig = 0;
    let badFormat = 0;
    for (const a of assets) {
      const r = toAttachment(a);
      if (r === 'too_big') tooBig++;
      else if (r === 'format') badFormat++;
      else accepted.push(r);
    }
    const room = Math.max(0, MAX_ATTACHMENTS - attachments.length);
    const overflow = Math.max(0, accepted.length - room);
    if (accepted.length) setAttachments((cur) => [...cur, ...accepted.slice(0, room)]);
    const notes: string[] = [];
    if (tooBig) notes.push(t('Photos can be up to {img} MB and videos up to {vid} MB.', { img: MAX_IMAGE_BYTES / 1048576, vid: MAX_VIDEO_BYTES / 1048576 }));
    if (badFormat) notes.push(t('Some files are in a format that can\u2019t be attached (use JPEG, PNG, MP4 or MOV).'));
    if (overflow) notes.push(t('You can attach up to {n} files.', { n: MAX_ATTACHMENTS }));
    if (notes.length) showAlert(t('Some files were not added'), notes.join('\n\n'));
  };

  const pickerBase = {
    quality: 0.8,
    exif: false,
    preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
    videoMaxDuration: MAX_VIDEO_SECONDS,
  } as const;

  const takePhoto = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) { showAlert(t('Permission needed'), t('Camera permission required.')); return; }
    const r = await ImagePicker.launchCameraAsync({ ...pickerBase, mediaTypes: ['images'] });
    if (!r.canceled) addAssets(r.assets);
  };

  const recordVideo = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) { showAlert(t('Permission needed'), t('Camera permission required.')); return; }
    const r = await ImagePicker.launchCameraAsync({
      ...pickerBase,
      mediaTypes: ['videos'],
      videoQuality: ImagePicker.UIImagePickerControllerQualityType.Medium,
    });
    if (!r.canceled) addAssets(r.assets);
  };

  const pickFromGallery = async () => {
    const r = await ImagePicker.launchImageLibraryAsync({
      ...pickerBase,
      mediaTypes: ['images', 'videos'],
      allowsMultipleSelection: true,
      selectionLimit: remaining,
      orderedSelection: true,
    });
    if (!r.canceled) addAssets(r.assets);
  };

  const removeAttachment = (key: string) => {
    setAttachments((cur) => cur.filter((a) => a.key !== key));
    setUploadState((cur) => { const n = { ...cur }; delete n[key]; return n; });
  };

  /** Upload every attachment not yet uploaded; returns how many failed. */
  const uploadAll = async (items: Attachment[]): Promise<number> => {
    const target = created.current!;
    let failed = 0;
    for (const item of items) {
      if (uploaded.current.has(item.key)) continue;
      setUploadState((s) => ({ ...s, [item.key]: 0 }));
      try {
        await uploadAttachment(target.id, target.token, item, (f) => setUploadState((s) => ({ ...s, [item.key]: f })));
        uploaded.current.add(item.key);
        setUploadState((s) => ({ ...s, [item.key]: 'done' }));
      } catch (e: any) {
        failed++;
        setUploadState((s) => ({ ...s, [item.key]: { error: e?.message || t('Upload failed.') } }));
      }
    }
    return failed;
  };

  const finishUploads = async () => {
    setPhase('uploading');
    const failed = await uploadAll(attachments);
    setPhase('idle');
    setLoading(false);
    if (!failed) {
      showAlert(t('Report submitted'), t('Your anonymous report and {n} attachment(s) have been sent for verification.', { n: attachments.length }), [
        { text: t('OK'), onPress: () => navigation.goBack() },
      ]);
      return;
    }
    showAlert(
      t('Report submitted'),
      t('{failed} of {total} attachment(s) could not be uploaded. Your report itself was sent.', { failed, total: attachments.length }),
      [
        { text: t('Skip'), style: 'cancel', onPress: () => navigation.goBack() },
        { text: t('Retry'), onPress: () => { setLoading(true); void finishUploads(); } },
      ],
    );
  };

  const tone = (x: Tone) =>
    x === 'danger'
      ? { fg: colors.dangerText, bg: colors.dangerSoft, border: colors.danger }
      : x === 'warning'
        ? { fg: colors.warningText, bg: colors.warningSoft, border: colors.warning }
        : { fg: colors.textSub, bg: colors.surfaceAlt, border: colors.borderStrong };

  const activeType = TYPES.find((x) => x.value === selected)!;
  const activeTone = tone(activeType.tone);

  const handleSubmit = async () => {
    setLoading(true);
    // A retry after a partial upload: the report already exists.
    if (created.current) { void finishUploads(); return; }
    try {
      setPhase('locating');
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        showAlert(t('Permission denied'), t('Location required.'));
        setLoading(false);
        setPhase('idle');
        return;
      }
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setPhase('sending');
      const res = await api.post('/incidents', {
        type: selected,
        description: desc,
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
      });
      const d = res.data?.data;
      if (attachments.length && d?.id && d?.uploadToken) {
        created.current = { id: d.id, token: d.uploadToken };
        await finishUploads();
        return;
      }
      if (attachments.length) {
        // An older server without media support: the report is in, the files are not.
        showAlert(t('Report submitted'), t('Your report was sent, but this server does not accept attachments yet.'), [
          { text: t('OK'), onPress: () => navigation.goBack() },
        ]);
      } else {
        showAlert(t('Report submitted'), t('Your anonymous report has been sent for verification.'), [
          { text: t('OK'), onPress: () => navigation.goBack() },
        ]);
      }
      setLoading(false);
      setPhase('idle');
    } catch (e: any) {
      showAlert(t('Failed'), e.response?.data?.error?.message || e.response?.data?.message || t('Please try again.'));
      setLoading(false);
      setPhase('idle');
    }
  };

  const doneCount = attachments.filter((a) => uploadState[a.key] === 'done').length;
  const submitLabel =
    phase === 'locating' ? t('Getting your location…')
      : phase === 'sending' ? t('Sending report…')
        : phase === 'uploading' ? t('Uploading {done} of {total}…', { done: Math.min(doneCount + 1, attachments.length), total: attachments.length })
          : created.current ? t('Retry uploads')
            : t('Submit anonymously');
  const busy = phase !== 'idle';

  return (
    <Screen>
      <AppBar title={t('Report Incident')} subtitle={t('Help make your area safer for everyone.')} />

      <FadeIn style={{ alignItems: 'center', marginVertical: spacing.md }}>
        <Animated.View
          key={selected}
          entering={ZoomIn.springify().damping(14)}
          style={{
            width: 88,
            height: 88,
            borderRadius: 44,
            borderWidth: 1.5,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: activeTone.bg,
            borderColor: activeTone.border,
          }}
        >
          <activeType.icon color={activeTone.fg} size={38} />
        </Animated.View>
        <Badge
          label={t('100% anonymous')}
          tone="success"
          icon={<Lock color={colors.successText} size={12} />}
          style={{ marginTop: spacing.md, alignSelf: 'center' }}
        />
      </FadeIn>

      <SectionLabel>{t('Incident type')}</SectionLabel>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        {TYPES.map((x, i) => {
          const active = selected === x.value;
          const tn = tone(x.tone);
          return (
            <FadeIn key={x.value} delay={60 + i * 45} style={{ flexGrow: 1, minWidth: '45%' }}>
              <PressableScale
                accessibilityRole="radio"
                accessibilityState={{ checked: active }}
                onPress={() => setSelected(x.value)}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: spacing.sm,
                  borderWidth: 1.5,
                  borderRadius: radius.md,
                  paddingHorizontal: spacing.md,
                  paddingVertical: spacing.sm + 4,
                  backgroundColor: active ? tn.bg : colors.surface,
                  borderColor: active ? tn.border : colors.border,
                }}
              >
                <x.icon color={active ? tn.fg : colors.textMuted} size={18} />
                <Text style={[type.sm, { flex: 1, color: active ? tn.fg : colors.textSub, fontWeight: active ? '700' : '500' }]}>
                  {t(x.label)}
                </Text>
              </PressableScale>
            </FadeIn>
          );
        })}
      </View>

      <SectionLabel>{t('Details (optional)')}</SectionLabel>
      <FadeIn delay={300}>
        <KeyboardAwareTextInput
          style={{
            ...type.body,
            color: colors.text,
            minHeight: 120,
            backgroundColor: colors.inputBg,
            borderRadius: radius.md,
            borderWidth: 1.5,
            borderColor: descFocused ? colors.accent : colors.border,
            padding: spacing.md,
          }}
          placeholder={t('Any additional details about the incident...')}
          placeholderTextColor={colors.textMuted}
          multiline
          value={desc}
          onChangeText={setDesc}
          textAlignVertical="top"
          onFocus={() => setDescFocused(true)}
          onBlur={() => setDescFocused(false)}
        />
      </FadeIn>

      <SectionLabel>{t('Photos & videos (optional)')}</SectionLabel>
      <FadeIn delay={330}>
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          {[
            { key: 'photo', label: t('Photo'), Icon: Camera, onPress: takePhoto },
            { key: 'video', label: t('Video'), Icon: Video, onPress: recordVideo },
            { key: 'gallery', label: t('Gallery'), Icon: ImagePlus, onPress: pickFromGallery },
          ].map(({ key, label, Icon, onPress }) => {
            const disabled = remaining <= 0 || busy || !!created.current;
            return (
              <PressableScale
                key={key}
                accessibilityRole="button"
                accessibilityLabel={label}
                accessibilityState={{ disabled }}
                disabled={disabled}
                onPress={onPress}
                style={{
                  flex: 1,
                  alignItems: 'center',
                  gap: 6,
                  paddingVertical: spacing.md,
                  borderRadius: radius.md,
                  borderWidth: 1.5,
                  borderStyle: 'dashed',
                  borderColor: colors.borderStrong,
                  backgroundColor: colors.surface,
                  opacity: disabled ? 0.45 : 1,
                }}
              >
                <Icon color={colors.accentText} size={22} />
                <Text style={[type.sm, { color: colors.text, fontWeight: '600' }]}>{label}</Text>
              </PressableScale>
            );
          })}
        </View>

        {attachments.length > 0 && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md }}>
            {attachments.map((a) => {
              const st = uploadState[a.key];
              const failed = typeof st === 'object';
              return (
                <View
                  key={a.key}
                  style={{
                    width: '31%',
                    aspectRatio: 1,
                    borderRadius: radius.md,
                    overflow: 'hidden',
                    backgroundColor: colors.surfaceAlt,
                    borderWidth: failed ? 2 : 1,
                    borderColor: failed ? colors.danger : colors.border,
                  }}
                >
                  {a.kind === 'photo' ? (
                    <Image source={{ uri: a.uri }} style={{ width: '100%', height: '100%' }} resizeMode="cover" accessibilityLabel={t('Photo')} />
                  ) : (
                    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#111' }}>
                      <Film color="#fff" size={26} />
                      <Text style={[type.xs, { color: '#fff', marginTop: 4, fontWeight: '700' }]}>
                        {formatDuration(a.durationMs) || t('Video')}
                      </Text>
                    </View>
                  )}

                  {/* Upload status overlay */}
                  {st !== undefined && (
                    <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, top: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: st === 'done' ? 'rgba(0,0,0,0.25)' : 'rgba(0,0,0,0.5)' }}>
                      {st === 'done' ? (
                        <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: colors.success, alignItems: 'center', justifyContent: 'center' }}>
                          <Check color="#fff" size={18} />
                        </View>
                      ) : failed ? (
                        <AlertCircle color="#fff" size={26} />
                      ) : (
                        <>
                          <ActivityIndicator color="#fff" />
                          <Text style={[type.xs, { color: '#fff', marginTop: 4, fontWeight: '700' }]}>{Math.round((st as number) * 100)}%</Text>
                        </>
                      )}
                    </View>
                  )}

                  {!busy && st !== 'done' && !created.current && (
                    <Pressable
                      onPress={() => removeAttachment(a.key)}
                      accessibilityRole="button"
                      accessibilityLabel={t('Remove')}
                      hitSlop={8}
                      style={{ position: 'absolute', top: 6, right: 6, width: 26, height: 26, borderRadius: 13, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' }}
                    >
                      <X color="#fff" size={15} />
                    </Pressable>
                  )}
                  {a.kind === 'video' && st === undefined && (
                    <View style={{ position: 'absolute', left: 6, top: 6, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, backgroundColor: 'rgba(0,0,0,0.6)' }}>
                      <Text style={[type.xs, { color: '#fff', fontWeight: '700' }]}>{t('Video')}</Text>
                    </View>
                  )}
                </View>
              );
            })}
          </View>
        )}

        <Txt variant="xs" tone="muted" style={{ marginTop: spacing.sm }}>
          {t('{n} of {max} · photos up to {img} MB, videos up to {sec} s / {vid} MB.', {
            n: attachments.length, max: MAX_ATTACHMENTS, img: MAX_IMAGE_BYTES / 1048576, sec: MAX_VIDEO_SECONDS, vid: MAX_VIDEO_BYTES / 1048576,
          })}
        </Txt>
      </FadeIn>

      <Card tone="success" delay={360} style={{ marginTop: spacing.md, flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' }}>
        <Lock color={colors.successText} size={16} />
        <Txt variant="sm" tone="sub" style={{ flex: 1 }}>
          {t('Your identity is never shared. Reports are reviewed by moderators before affecting the Safety Score.')}
          {attachments.length > 0 ? ` ${t('Location data is removed from photos and videos before they are stored, and only moderators can see them.')}` : ''}
        </Txt>
      </Card>

      <FadeIn delay={420} style={{ marginTop: spacing.lg }}>
        <Button
          label={submitLabel}
          size="lg"
          onPress={handleSubmit}
          loading={loading}
          icon={<Send color={colors.onAccent} size={19} />}
        />
      </FadeIn>
    </Screen>
  );
}
