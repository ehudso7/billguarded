import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import {
  allowedDocumentTypes,
  confirmUploadSchema,
} from "@/lib/validation";

function storageLocation(path: string) {
  const separator = path.lastIndexOf("/");
  return {
    directory: path.slice(0, separator),
    filename: path.slice(separator + 1),
  };
}

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
  const { data: audit, error: auditError } = await supabase
    .from("audit_requests")
    .select("id, status")
    .eq("id", parsed.data.requestId)
    .maybeSingle();

  if (auditError || !audit || audit.status !== "intake") {
    return NextResponse.json(
      { error: "Audit request is not available for upload confirmation." },
      { status: 404 },
    );
  }

  const { data: reservation, error: reservationError } = await supabase
    .from("audit_documents")
    .select(
      "id, kind, original_filename, storage_path, content_type, byte_size, upload_status",
    )
    .eq("audit_request_id", parsed.data.requestId)
    .eq("storage_path", parsed.data.storagePath)
    .maybeSingle();

  if (reservationError || !reservation) {
    return NextResponse.json(
      { error: "The upload was not reserved by this audit." },
      { status: 404 },
    );
  }

  if (
    reservation.kind !== parsed.data.kind ||
    reservation.original_filename !== parsed.data.originalFilename ||
    reservation.content_type !== parsed.data.contentType ||
    Number(reservation.byte_size) !== parsed.data.size
  ) {
    return NextResponse.json(
      { error: "Uploaded document metadata did not match its reservation." },
      { status: 409 },
    );
  }

  const location = storageLocation(parsed.data.storagePath);
  const { data: objects, error: storageError } = await supabase.storage
    .from("audit-documents")
    .list(location.directory, {
      limit: 10,
      search: location.filename,
    });

  const storedObject = objects?.find(
    (object) => object.id !== null && object.name === location.filename,
  );

  if (storageError || !storedObject) {
    return NextResponse.json(
      { error: "The uploaded file could not be verified in private storage." },
      { status: 409 },
    );
  }

  const storedSize = Number(storedObject.metadata?.size);
  if (Number.isFinite(storedSize) && storedSize !== parsed.data.size) {
    return NextResponse.json(
      { error: "The stored file size did not match the reserved upload." },
      { status: 409 },
    );
  }

  if (reservation.upload_status === "uploaded") {
    return NextResponse.json({ ok: true });
  }

  const { error: updateError } = await supabase
    .from("audit_documents")
    .update({
      upload_status: "uploaded",
      uploaded_at: new Date().toISOString(),
    })
    .eq("id", reservation.id)
    .eq("upload_status", "pending");

  if (updateError) {
    console.error("document_confirmation_failed", updateError.code);
    return NextResponse.json(
      { error: "Could not confirm the uploaded document." },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
