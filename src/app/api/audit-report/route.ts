import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  portalCookieName,
  verifyPortalCookie,
} from "@/lib/security/portal-cookie";
import { supabaseAdmin } from "@/lib/supabase-admin";

function spreadsheetSafe(value: string) {
  const normalized = value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  return /^[=+\-@]/.test(normalized) ? `'${normalized}` : normalized;
}

function csvCell(value: string | number | null | undefined) {
  if (value === null || value === undefined) return "";
  const text = spreadsheetSafe(String(value));
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

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

function dollars(cents: number | null | undefined) {
  if (cents === null || cents === undefined) return "";
  return (cents / 100).toFixed(2);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const requestId = url.searchParams.get("request");
  if (!requestId) {
    return NextResponse.json({ error: "request_required" }, { status: 400 });
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
    .select("id,company,status,stripe_customer_id")
    .eq("id", requestId)
    .eq("stripe_customer_id", billingAccess.customerId)
    .maybeSingle();

  if (auditError || !audit) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const { data: run, error: runError } = await supabase
    .from("audit_runs")
    .select("id,status")
    .eq("audit_request_id", audit.id)
    .eq("status", "complete")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (runError || !run) {
    return NextResponse.json(
      { error: "report_not_ready" },
      { status: 409 },
    );
  }

  const [{ data: findings, error: findingsError }, { data: documents }] =
    await Promise.all([
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

  if (findingsError) {
    return NextResponse.json(
      { error: "report_generation_failed" },
      { status: 500 },
    );
  }

  const filenames = new Map(
    (documents ?? []).map((document) => [document.id, document.original_filename]),
  );
  const header = [
    "finding_type",
    "severity",
    "source_file",
    "source_row",
    "service_code",
    "description",
    "billed_usd",
    "expected_usd",
    "potential_recovery_usd",
  ];

  const lines = [header.map(csvCell).join(",")];
  for (const finding of findings ?? []) {
    lines.push(
      [
        finding.finding_type,
        finding.severity,
        finding.source_document_id
          ? filenames.get(finding.source_document_id) ?? ""
          : "",
        finding.source_row,
        finding.service_code,
        finding.description,
        dollars(finding.billed_amount_cents),
        dollars(finding.expected_amount_cents),
        dollars(finding.potential_recovery_cents),
      ]
        .map(csvCell)
        .join(","),
    );
  }

  const csv = `\uFEFF${lines.join("\r\n")}\r\n`;
  const filename = `billguarded-${filenamePart(audit.company)}-findings.csv`;

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
