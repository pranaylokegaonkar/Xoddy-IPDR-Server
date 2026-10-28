import assert from "node:assert/strict";
import { test } from "node:test";
import { PgDialect } from "drizzle-orm/pg-core";
import { db } from "@workspace/db";
import { deleteExpiredArchivedFlowRows } from "./flow-retention";

test("both retention queries exclude imported backups as deletion evidence", async (t) => {
  const results = [
    [{ periodStart: new Date("2026-01-01T06:30:00Z"), periodEnd: new Date("2026-01-01T08:30:00Z"),
      latestArchiveAt: new Date("2026-01-01T09:00:00Z"), archiveRecordCount: 1 }],
    [{ id: 10 }], [{ count: 1 }], [],
  ];
  const conditions: Array<Parameters<PgDialect["sqlToQuery"]>[0]> = [];
  let selects = 0;
  t.mock.method(db, "select", () => {
    const result = results[selects++];
    const chain = {
      from: () => chain, groupBy: () => chain, having: () => chain, orderBy: () => chain, limit: () => chain,
      where: (condition: Parameters<PgDialect["sqlToQuery"]>[0]) => { conditions.push(condition); return chain; },
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve),
    };
    return chain;
  });
  t.mock.method(db, "insert", () => {
    const chain = {
      values: () => chain, returning: () => chain,
      then: (resolve: (value: unknown) => unknown) => Promise.resolve([]).then(resolve),
    };
    return chain; // Any archive-log writes stay synthetic too.
  });
  t.mock.method(db, "delete", () => { throw new Error("No real flow deletion is permitted in this test."); });
  assert.equal(await deleteExpiredArchivedFlowRows(), 0);
  assert.equal(selects, 4);
  const dialect = new PgDialect();
  for (const condition of [conditions[0], conditions.at(-1)!]) {
    const query = dialect.sqlToQuery(condition);
    assert.match(query.sql, /"is_imported"/);
    assert.ok(query.params.includes(false));
  }
});
