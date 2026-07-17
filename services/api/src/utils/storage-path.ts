/**
 * Single source of truth for the local-disk storage directory.
 *
 * Used by both the storage plugin (writing evidence) and the mock-s3 route
 * (serving it) so they never disagree. Configurable via STORAGE_LOCAL_DIR
 * (absolute path recommended on a VPS); falls back to "<cwd>/uploads".
 */

import fs from 'fs';
import path from 'path';
import { env } from '@/config/env';

export function getLocalUploadDir(): string {
  return env.STORAGE_LOCAL_DIR
    ? path.resolve(env.STORAGE_LOCAL_DIR)
    : path.join(process.cwd(), 'uploads');
}

/** True when evidence is stored on the Node server's local disk (no S3). */
export function isLocalStorage(): boolean {
  return !env.AWS_S3_BUCKET;
}

/**
 * Create the upload dir if needed and confirm it is writable by writing and
 * deleting a probe file. Used at startup to fail loudly on misconfiguration.
 */
export function ensureUploadDirWritable(): { ok: boolean; dir: string; error?: string } {
  const dir = getLocalUploadDir();
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, `.write-test-${process.pid}`);
    fs.writeFileSync(probe, 'ok');
    fs.unlinkSync(probe);
    return { ok: true, dir };
  } catch (e) {
    return { ok: false, dir, error: (e as Error).message };
  }
}

/** Lightweight writability check (no file created) — for the health endpoint. */
export function isUploadDirWritable(): boolean {
  try {
    fs.accessSync(getLocalUploadDir(), fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}
