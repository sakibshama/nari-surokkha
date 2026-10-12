/**
 * Photos and videos attached to an anonymous incident report.
 *
 * The report is created first (POST /incidents); its response carries a
 * short-lived upload token, which authorises each file upload without the
 * report being tied to the user's account.
 */
import { Platform } from 'react-native';
import api from './api';

import { Attachment, MIME_EXT } from './incidentMediaCore';

export * from './incidentMediaCore';

/** Upload one attachment. `onProgress` gets 0..1. Throws with a readable message on failure. */
export async function uploadAttachment(
  incidentId: string,
  uploadToken: string,
  item: Attachment,
  onProgress?: (fraction: number) => void,
): Promise<void> {
  const name = `${item.kind}.${MIME_EXT[item.mimeType] ?? 'bin'}`; // neutral name: the server renames anyway
  const fd = new FormData();
  if (Platform.OS === 'web') {
    const blob = await (await fetch(item.uri)).blob();
    fd.append('file', blob, name);
  } else {
    // React Native's FormData accepts { uri, name, type } for files.
    fd.append('file', { uri: item.uri, name, type: item.mimeType } as unknown as Blob);
  }
  try {
    await api.post(`/incidents/${incidentId}/media`, fd, {
      headers: { 'X-Upload-Token': uploadToken },
      timeout: item.kind === 'video' ? 180_000 : 60_000,
      onUploadProgress: (e) => {
        if (onProgress && e.total) onProgress(Math.min(1, e.loaded / e.total));
      },
      transformRequest: (data, headers) => {
        // Let RN / the browser set multipart/form-data with its boundary.
        if (headers) {
          const h = headers as any;
          delete h['Content-Type'];
          delete h['content-type'];
          if (typeof h.delete === 'function') { h.delete('Content-Type'); h.delete('content-type'); }
        }
        return data;
      },
    });
    onProgress?.(1);
  } catch (e: any) {
    const msg = e?.response?.data?.error?.message || e?.response?.data?.message;
    throw new Error(msg || (e?.code === 'ECONNABORTED' ? 'The upload timed out.' : 'Upload failed.'));
  }
}
