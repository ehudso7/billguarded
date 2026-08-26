import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { error } = await supabaseAdmin()
      .from("audit_requests")
      .select("id")
      .limit(1);

    if (error) throw error;

    return NextResponse.json(
      {
        ok: true,
        service: "billguarded",
        database: "ok",
      },
      {
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch {
    return NextResponse.json(
      {
        ok: false,
        service: "billguarded",
        database: "unavailable",
      },
      {
        status: 503,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
