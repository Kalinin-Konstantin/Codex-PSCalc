import { NextResponse } from "next/server";
import { createAdminClient } from "../../../../lib/supabase/admin";
import { currentMoscowDate, fetchWildberriesLogisticsSnapshot } from "../../../../lib/wb-tariffs-refresh";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const token = process.env.WB_API_TOKEN || process.env.WILDBERRIES_API_TOKEN;
  if (!token) {
    return NextResponse.json({ ok: false, error: "WB_API_TOKEN is not configured" }, { status: 500 });
  }

  const date = new URL(request.url).searchParams.get("date") || currentMoscowDate();

  try {
    const wildberriesLogistics = await fetchWildberriesLogisticsSnapshot({ date, token });
    const supabase = createAdminClient();
    const { error } = await supabase
      .from("marketplace_tariff_snapshots")
      .upsert(
        {
          marketplace: "wildberries",
          snapshot_date: date,
          status: "success",
          source: wildberriesLogistics.source ?? "WB API",
          imported_at: wildberriesLogistics.importedAt ?? new Date().toISOString(),
          data: wildberriesLogistics
        },
        { onConflict: "marketplace,snapshot_date" }
      );

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      marketplace: "wildberries",
      snapshotDate: date,
      warehouses: wildberriesLogistics.warehouses.length,
      importedAt: wildberriesLogistics.importedAt
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown WB tariff import error"
      },
      { status: 502 }
    );
  }
}

function isAuthorizedCronRequest(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  return request.headers.get("authorization") === `Bearer ${secret}`;
}
