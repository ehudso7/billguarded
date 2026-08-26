import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { intakeAccessTokenHash } from "@/lib/security/intake-access";
import { supabaseAdmin } from "@/lib/supabase-admin";
import {
  isSupportedCsvUpload,
  safeFilename,
  uploadRequestSchema,
} from "@/lib/validation";

const TERMS_KINDS = new Set(["contract", "rate_card"]);

export async function POST(request: Request) {
  const parsed = uploadRequestSchema.safeParse(
    await request.json().catch(() => null),
  );

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid upload request." },
      { status: 400 },
    );
  }

  const { requestId, accessToken, filename, contentType, size, kind } = parsed.data;
  if (!isSupportedCsvUpload(filename, contentType)) {
    return NextResponse.json(
      { error: "BillGuarded currently accepts CSV files only." },
      { status: 415 },
    );
  }

  const supabase = supabaseAdmin();
  const { data: audit, error: auditError } = await supabase
    .from("audit_requests")
    .select("id, status")
    .eq("id", requestId)
    .eq("access_token_hash", intakeAccessTokenHash(accessToken))
    .maybeSingle();

  if (auditError || !audit || audit.status !== "intake") {
    return NextResponse.json(
      { error: "Audit request is not available for uploads." },
      { status: 404 },
    );
  }

  const { data: documents, error: documentsError } = await supabase
    .from("audit_documents")
    .select(
      "id, kind, original_filename, storage_path, content_type, byte_size, upload_status",
    )
    .eq("audit_request_id", requestId);

  if (documentsError) {
    return NextResponse.json(
      { error: "Could not inspect the audit document slots." },
      { status: 500 },
    );
  }

  const reusable = documents?.find(
    (document) =>
      document.upload_status === "pending" &&
      document.kind === kind &&
      document.original_filename === filename &&
      document.content_type === contentType &&
      Number(document.byte_size) === size,
  );

  let storagePath = reusable?.storage_path ?? null;
  let reservationId = reusable?.id ?? null;
  let createdReservation = false;

  if (!storagePath) {
    if (
      TERMS_KINDS.has(kind) &&
      documents?.some((document) => TERMS_KINDS.has(document.kind))
    ) {
      return NextResponse.json(
        { error: "Only one contract or rate card may be attached to an audit." },
        { status: 409 },
      );
    }

    if (
      kind === "invoice" &&
      (documents?.filter((document) => document.kind === "invoice").length ?? 0) >=
        10
    ) {
      return NextResponse.json(
        { error: "An audit may include at most 10 invoices." },
        { status: 409 },
      );
    }

    storagePath = `${requestId}/${kind}/${randomUUID()}-${safeFilename(filename)}`;

    const { data: reservation, error: reservationError } = await supabase
      .from("audit_documents")
      .insert({
        audit_request_id: requestId,
        kind,
        original_filename: filename,
        storage_path: storagePath,
        content_type: contentType,
        byte_size: size,
        upload_status: "pending",
      })
      .select("id")
      .single();

    if (reservationError || !reservation) {
      const quotaViolation = reservationError?.code === "23514";
      return NextResponse.json(
        {
          error: quotaViolation
            ? "This audit has reached its document limit."
            : "Could not reserve the secure upload slot.",
        },
        { status: quotaViolation ? 409 : 500 },
      );
    }

    reservationId = reservation.id;
    createdReservation = true;
  }

  const { data, error } = await supabase.storage
    .from("audit-documents")
    .createSignedUploadUrl(storagePath);

  if (error || !data?.token) {
    if (createdReservation && reservationId) {
      await supabase.from("audit_documents").delete().eq("id", reservationId);
    }

    console.error("signed_upload_failed", error?.message);
    return NextResponse.json(
      { error: "Could not prepare the secure upload." },
      { status: 500 },
    );
  }

  return NextResponse.json({
    path: storagePath,
    token: data.token,
  });
}
