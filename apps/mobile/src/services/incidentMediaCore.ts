/**
 * Pure helpers for incident attachments (no React Native imports, so they
 * can be unit-tested under plain Node).
 */
import type { ImagePickerAsset } from 'expo-image-picker';

export const MAX_ATTACHMENTS = 5;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
export const MAX_VIDEO_SECONDS = 60;

export type AttachmentKind = 'photo' | 'video';

export interface Attachment {
  key: string;
  uri: string;
  kind: AttachmentKind;
  mimeType: string;
  size?: number;
  durationMs?: number | null;
  width?: number;
  height?: number;
}

const EXT_MIME: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic', heif: 'image/heif',
  mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', '3gp': 'video/3gpp', webm: 'video/webm',
};
export const MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
  'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/3gpp': '3gp', 'video/webm': 'webm',
};
export const SUPPORTED_MIME = new Set(Object.keys(MIME_EXT));

function mimeOf(a: ImagePickerAsset): string {
  const declared = a.mimeType?.toLowerCase();
  if (declared) return declared === 'image/jpg' ? 'image/jpeg' : declared;
  const ext = (a.fileName || a.uri).split('?')[0].split('.').pop()?.toLowerCase() ?? '';
  return EXT_MIME[ext] ?? (a.type === 'video' ? 'video/mp4' : 'image/jpeg');
}

export type AssetProblem = 'format' | 'too_big';

/** Turn a picker asset into an attachment, or say why it can't be attached. */
export function toAttachment(a: ImagePickerAsset): Attachment | AssetProblem {
  const kind: AttachmentKind = a.type === 'video' ? 'video' : 'photo';
  const mimeType = mimeOf(a);
  if (!SUPPORTED_MIME.has(mimeType) || !mimeType.startsWith(kind === 'video' ? 'video/' : 'image/')) return 'format';
  const limit = kind === 'video' ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
  if (a.fileSize && a.fileSize > limit) return 'too_big';
  return {
    key: `${a.assetId ?? a.uri}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    uri: a.uri,
    kind,
    mimeType,
    size: a.fileSize,
    durationMs: a.duration,
    width: a.width,
    height: a.height,
  };
}

export function formatDuration(ms?: number | null): string {
  if (!ms) return '';
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
