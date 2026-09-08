import {
  processClaimedAuditWork,
  type AuditWorkClaim,
  type AuditWorkResult,
} from "@/lib/audit-engine";
import { supabaseAdmin } from "@/lib/supabase-admin";

type AuditClaimRow = {
  audit_request_id: string;
  run_id: string;
  claim_token: string;
  attempt_number: number;
};

export type AuditSweepResult =
  | { state: "idle" }
  | ({
      state: "complete" | "retryable" | "permanently_failed";
      auditRequestId: string;
      attemptNumber: number;
    } & Pick<AuditWorkResult, "errorCode">);

export async function claimAuditWork(
  workerId: string,
): Promise<AuditWorkClaim | null> {
  const { data, error } = await supabaseAdmin().rpc(
    "billguarded_claim_audit_work",
    {
      p_worker_id: workerId,
      p_lease_seconds: 360,
    },
  );
  if (error) throw error;

  const row = ((data ?? []) as AuditClaimRow[])[0];
  if (!row) return null;

  return {
    auditRequestId: row.audit_request_id,
    runId: row.run_id,
    claimToken: row.claim_token,
    attemptNumber: row.attempt_number,
  };
}
export async function sweepOneAuditWork(
  workerId: string,
): Promise<AuditSweepResult> {
  const claim = await claimAuditWork(workerId);
  if (!claim) return { state: "idle" };

  const result = await processClaimedAuditWork(claim);
  return {
    ...result,
    auditRequestId: claim.auditRequestId,
    attemptNumber: claim.attemptNumber,
  };
}
