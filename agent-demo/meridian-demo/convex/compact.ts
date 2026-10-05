// Columnar JSON keeps complete datasets under the notebook gateway's 256 KiB
// response budget. Convex storage IDs and repeated fixture tags are not metrics.
export function compact(rows: Record<string, unknown>[]) {
  const columns = Object.keys(rows[0] ?? {}).filter(
    (key) => !["_id", "_creationTime", "fixture"].includes(key),
  );
  return {
    columns,
    rows: rows.map((row) => columns.map((key) => row[key] ?? null)),
  };
}

type ReturnRow = {
  sku: string;
  batch: string;
  reason: string;
  status: string;
  refundCents: number;
  requestedRefundCents: number;
  quantity?: number;
};

export function summarizeReturns(rows: ReturnRow[]) {
  const groups = new Map<string, ReturnRow & { returnedUnits: number }>();
  for (const row of rows) {
    const key = JSON.stringify([row.sku, row.batch, row.reason, row.status]);
    const group = groups.get(key) ?? {
      sku: row.sku,
      batch: row.batch,
      reason: row.reason,
      status: row.status,
      returnedUnits: 0,
      refundCents: 0,
      requestedRefundCents: 0,
    };
    group.returnedUnits += row.quantity ?? 1;
    group.refundCents += row.refundCents;
    group.requestedRefundCents += row.requestedRefundCents;
    groups.set(key, group);
  }
  return [...groups.values()];
}
