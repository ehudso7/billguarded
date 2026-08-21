import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import {
  allowedDocumentTypes,
  confirmUploadSchema,
} from "@/lib/validation";

export async function POST(request: Request) {
  const parsed = confirmUploadSchema.safeParse(
    await request.json().catch(() => null),
  );

  if (!parsed.success || !allowedDocumentTypes.has(parsed.data.contentType)) {
    return NextResponse.json(
      { error: "Invalid uploaded document." },
      { status: 400 },
    );
  }

  const expectedPrefix = `${parsed.data.requestId}/${parsed.data.kind}/`;
  if (!parsed.data.storagePath.startsWith(expectedPrefix)) {
    return NextResponse.json(
      { error: "Upload path did not match the audit request." },
      { status: 400 },
    );
  }

  const supabase = supabaseAdmin();
  const { error } = await supabase.from("audit_documents").insert({
    audit_request_id: parsed.data.requestId,
    kind: parsed.data.kind,
    original_filename: parsed.data.originalFilename,
    storage_path: parsed.data.storagePath,
    content_type: parsed.data.contentType,
    byte_size: parsed.data.size,
  });

  if (error) {
    console.error("document_insert_failed", error.code);
    return NextResponse.json(
      { error: "Could not register the uploaded document." },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
