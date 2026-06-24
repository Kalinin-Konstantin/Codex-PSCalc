import { tariffData } from "./tariffs";
import type { LogisticsAssumptions, TariffData } from "./types";

type TariffSnapshotRow = {
  data: unknown;
};

type SupabaseReader = {
  from(table: string): any;
};

export async function loadRuntimeTariffData(supabase: SupabaseReader): Promise<TariffData> {
  const { data, error } = await supabase
    .from("marketplace_tariff_snapshots")
    .select("data")
    .eq("marketplace", "wildberries")
    .eq("status", "success")
    .order("snapshot_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data?.data || !isWildberriesLogisticsSnapshot(data.data)) {
    return tariffData;
  }

  return {
    ...tariffData,
    logistics: {
      ...tariffData.logistics,
      wildberriesLogistics: data.data
    }
  };
}

function isWildberriesLogisticsSnapshot(value: unknown): value is LogisticsAssumptions["wildberriesLogistics"] {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Partial<LogisticsAssumptions["wildberriesLogistics"]>;

  return (
    typeof snapshot.firstLiterRub === "number" &&
    typeof snapshot.extraLiterRub === "number" &&
    typeof snapshot.storagePalletDayRub === "number" &&
    Array.isArray(snapshot.warehouses)
  );
}
