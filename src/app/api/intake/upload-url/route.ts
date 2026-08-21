import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import {
  allowedDocumentTypes,
  safeFilename,
  uploadRequestSchema,
} from "@/lib/validation";

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

  const { requestId, filename, contentType, kind } = parsed.data;
  if (!allowedDocumentTypes.has(contentType)) {
    return NextResponse.json(
      { error: "Unsupported file type." },
      { status: 415 },
    );
  }

  const supabase = supabaseAdmin();
  const { data: audit, error: auditError } = await supabase
    .from("audit_requests")
    .select("id, status")
    .eq("id", requestId)
    .maybeSingle();

  if (auditError || !audit || audit.status !== "intake") {
    return NextResponse.json(
      { error: "Audit request is not available for uploads." },
      { status: 404 },
    );
  }

  const path = `${requestId}/${kind}/${randomUUID()}-${safeFilename(filename)}`;
  const { data, error } = await supabase.storage
    .from("audit-documents")
    .createSignedUploadUrl(path);

  if (error || !data?.token) {
    console.error("signed_upload_failed", error?.message);
    return NextResponse.json(
      { error: "Could not prepare the secure upload." },
      { status: 500 },
    );
  }

  return NextResponse.json({
    path,
    token: data.token,
  });
}
