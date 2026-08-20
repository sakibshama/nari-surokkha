/**
 * Case number allocation — one allocator for the whole system.
 *
 * There used to be two, both writing to the same UNIQUE `cases.case_number`
 * column:
 *
 *   cases.service      `CASE-${year}-${4 hex chars}`
 *   police.repository  `CASE-${Date.now()}`
 *
 * The first is the dangerous one: 4 hex characters is 65,536 values per year,
 * so by the birthday bound a collision becomes more likely than not at around
 * 300 cases. Past that point, case creation intermittently fails with a unique
 * constraint violation — and in the alert fan-out, a failed case creation means
 * an SOS that never reaches a station's case queue.
 *
 * `case_number_seq` (added in 20260819000000_spatial_index_usage) makes
 * collisions structurally impossible and produces readable, ordered numbers.
 */

import type { PrismaClient } from '@prisma/client';

/** Minimal surface needed — accepts a PrismaClient or a transaction client. */
type RawQueryable = Pick<PrismaClient, '$queryRaw'>;

/**
 * Allocate the next case number, e.g. `CASE-2026-000042`.
 *
 * nextval() is transactional-safe and never returns the same value twice, even
 * under concurrent alert fan-out across multiple API instances.
 */
export async function nextCaseNumber(db: RawQueryable): Promise<string> {
  const year = new Date().getFullYear();
  const rows = await db.$queryRaw<Array<{ n: bigint }>>`
    SELECT nextval('case_number_seq') AS n;
  `;
  const n = rows[0]?.n ?? BigInt(0);
  return `CASE-${year}-${n.toString().padStart(6, '0')}`;
}
