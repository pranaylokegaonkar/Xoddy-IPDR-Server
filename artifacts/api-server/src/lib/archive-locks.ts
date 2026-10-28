import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

// Both workspace readers and archive deletion writers use this namespace.
export const ARCHIVE_LOCK_NAMESPACE = 1480873042;
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export class ArchiveLockedError extends Error {
  constructor() {
    super("A selected archive is protected by an Old Search workspace. Release that workspace before deleting it.");
  }
}

export function withArchiveDeletionLocks<T>(
  ids: number[],
  work: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    if (ids.length) {
      const locks = await tx.execute<{ locked: boolean }>(sql`
        SELECT pg_try_advisory_xact_lock(${ARCHIVE_LOCK_NAMESPACE}::int, archive_id) AS locked
        FROM unnest(${`{${ids.join(",")}}`}::int[]) AS archive_id
      `);
      if (locks.rows.some((row) => !row.locked)) throw new ArchiveLockedError();
    }
    return work(tx);
  });
}
