export type RecoverableFinding = {
  source_document_id: string;
  source_row: number;
  potential_recovery_cents: number;
};

export function conservativePotentialRecoveryCents(
  findings: RecoverableFinding[],
) {
  const recoveryBySourceRow = new Map<string, number>();

  for (const finding of findings) {
    const key = `${finding.source_document_id}:${finding.source_row}`;
    const current = recoveryBySourceRow.get(key) ?? 0;
    recoveryBySourceRow.set(
      key,
      Math.max(current, Math.max(0, finding.potential_recovery_cents)),
    );
  }

  return Array.from(recoveryBySourceRow.values()).reduce(
    (sum, amount) => sum + amount,
    0,
  );
}
