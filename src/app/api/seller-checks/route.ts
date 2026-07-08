import { NextResponse } from "next/server";
import { canUseCalculator, getCurrentProfile } from "../../../lib/auth/session";
import { createSupabaseSellerChecksDatabase, saveSellerCheck } from "../../../lib/seller-checks/repository";
import { validateSellerCheckPayload } from "../../../lib/seller-checks/validation";
import type { SellerCheckError } from "../../../lib/seller-checks/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const { supabase, profile } = await getCurrentProfile();

  if (!canUseCalculator(profile)) {
    return NextResponse.json(
      { ok: false, error: { code: "forbidden", message: "Forbidden." } },
      { status: 403 }
    );
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: { code: "invalid_json", message: "Invalid JSON body." } },
      { status: 400 }
    );
  }

  const validation = validateSellerCheckPayload(payload);
  if (!validation.ok) {
    return NextResponse.json({ ok: false, error: validation.error }, { status: 400 });
  }

  const result = await saveSellerCheck({
    database: createSupabaseSellerChecksDatabase(supabase),
    request: validation.data,
    profile
  });

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: statusForError(result.error) });
  }

  return NextResponse.json({ ok: true, data: result.data });
}

function statusForError(error: SellerCheckError) {
  switch (error.code) {
    case "forbidden":
    case "database_forbidden":
      return 403;
    case "invalid_json":
    case "validation_error":
    case "database_constraint_error":
      return 400;
    case "external_seller_conflict":
      return 409;
    default:
      return 500;
  }
}
