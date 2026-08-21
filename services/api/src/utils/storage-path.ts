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

/**
 * True when evidence is stored on the Node server's local disk.
 *
 * This MUST stay in agreement with the same decision in plugins/storage.ts —
 * they were allowed to drift when object storage gained S3_BUCKET_EVIDENCE and
 * STORAGE_PROVIDER, and the consequence was quiet but bad: a correctly
 * configured R2/MinIO deployment would still be judged "local" here, so /health
 * would check a directory nothing writes to, find it missing, and report the
 * service degraded forever. A permanently red health check on an emergency
 * service is worse than no health check, because people stop believing it.
 */
export function isLocalStorage(): boolean {
  const bucket = env.AWS_S3_BUCKET || env.S3_BUCKET_EVIDENCE;
  const hasCredentials = Boolean(env.AWS_ACCESS_KEY_ID || env.S3_ACCESS_KEY);
  return !(bucket && hasCredentials && env.STORAGE_PROVIDER !== 'local');
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
    const dir = getLocalUploadDir();
    if (fs.existsSync(dir)) {
      fs.accessSync(dir, fs.constants.W_OK);
      return true;
    }
    // Not created yet. The storage plugin creates it at boot, so "missing"
    // before that means "not started", not "broken" — what matters is whether
    // the PARENT is writable, i.e. whether it can be created at all.
    fs.accessSync(path.dirname(dir), fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}
