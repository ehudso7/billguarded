import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { buildRecoveryPacket } from "@/lib/recovery-packet";
import {
  portalCookieName,
  verifyPortalCookie,
} from "@/lib/security/portal-cookie";
import { supabaseAdmin } from "@/lib/supabase-admin";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function filenamePart(value: string) {
  return (
    value
      .normalize("NFKD")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64) || "customer"
  );
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const requestId = url.searchParams.get("request");
  if (!requestId || !UUID_PATTERN.test(requestId)) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const cookieStore = await cookies();
  const billingAccess = verifyPortalCookie(
    cookieStore.get(portalCookieName)?.value,
  );
  if (!billingAccess) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = supabaseAdmin();
  const { data: audit, error: auditError } = await supabase
    .from("audit_requests")
    .select("id,company,stripe_customer_id")
    .eq("id", requestId)
    .eq("stripe_customer_id", billingAccess.customerId)
    .maybeSingle();

  if (auditError) {
    console.error("recovery_packet_lookup_failed", auditError.code);
    return NextResponse.json(
      { error: "packet_lookup_failed" },
      { status: 500 },
    );
  }
  if (!audit) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const { data: run, error: runError } = await supabase
    .from("audit_runs")
    .select("id,completed_at,created_at,potential_recovery_cents")
    .eq("audit_request_id", audit.id)
    .eq("status", "complete")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (runError) {
    console.error("recovery_packet_run_lookup_failed", runError.code);
    return NextResponse.json(
      { error: "packet_lookup_failed" },
      { status: 500 },
    );
  }
  if (!run) {
    return NextResponse.json({ error: "packet_not_ready" }, { status: 409 });
  }

  const [findingsResult, documentsResult] = await Promise.all([
    supabase
      .from("audit_findings")
      .select(
        "finding_type,severity,source_document_id,source_row,service_code,description,billed_amount_cents,expected_amount_cents,potential_recovery_cents",
      )
      .eq("audit_run_id", run.id)
      .order("potential_recovery_cents", { ascending: false }),
    supabase
      .from("audit_documents")
      .select("id,original_filename")
      .eq("audit_request_id", audit.id),
  ]);

  if (findingsResult.error || documentsResult.error) {
    console.error(
      "recovery_packet_generation_failed",
      findingsResult.error?.code ?? documentsResult.error?.code,
    );
    return NextResponse.json(
      { error: "packet_generation_failed" },
      { status: 500 },
    );
  }

  const filenames = new Map(
    (documentsResult.data ?? []).map((document) => [
      document.id,
      document.original_filename,
    ]),
  );
  const packet = buildRecoveryPacket({
    company: audit.company,
    generatedAt: run.completed_at ?? run.created_at,
    potentialRecoveryCents: run.potential_recovery_cents,
    findings: (findingsResult.data ?? []).map((finding) => ({
      findingType: finding.finding_type,
      severity: finding.severity,
      sourceFile: finding.source_document_id
        ? filenames.get(finding.source_document_id) ?? ""
        : "",
      sourceRow: finding.source_row,
      serviceCode: finding.service_code,
      description: finding.description,
      billedAmountCents: finding.billed_amount_cents,
      expectedAmountCents: finding.expected_amount_cents,
      potentialRecoveryCents: finding.potential_recovery_cents,
    })),
  });
  const filename = `billguarded-${filenamePart(audit.company)}-recovery-review.md`;

  return new NextResponse(packet, {
    status: 200,
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
