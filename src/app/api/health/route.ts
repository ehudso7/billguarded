import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

function deployedCommit() {
  return process.env.VERCEL_GIT_COMMIT_SHA ?? null;
}

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
        commit: deployedCommit(),
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
        commit: deployedCommit(),
      },
      {
        status: 503,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
