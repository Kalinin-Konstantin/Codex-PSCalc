"use server";

import { redirect } from "next/navigation";
import { getCurrentProfile, canUseCalculator } from "../../lib/auth/session";
import { isCalculationSnapshot } from "../../lib/saved-calculations";

function field(formData: FormData, name: string) {
  return String(formData.get(name) ?? "").trim();
}

export async function createSellerAction(formData: FormData) {
  const { supabase, profile } = await getCurrentProfile();
  if (!canUseCalculator(profile)) redirect("/");

  const name = field(formData, "sellerName");
  if (!name) redirect("/?workspace=missing_seller_name");

  const { data, error } = await supabase
    .from("sellers")
    .insert({ owner_id: profile.id, name })
    .select("id")
    .single();

  if (error || !data?.id) {
    redirect("/?workspace=seller_error");
  }

  redirect(`/?seller=${data.id}&workspace=seller_created`);
}

export async function saveCalculationAction(formData: FormData) {
  const { supabase, profile } = await getCurrentProfile();
  if (!canUseCalculator(profile)) redirect("/");

  const sellerId = field(formData, "sellerId");
  const calculationId = field(formData, "calculationId");
  const calculationName = field(formData, "calculationName") || `Расчёт ${new Date().toLocaleDateString("ru-RU")}`;
  const snapshotRaw = field(formData, "snapshot");

  if (!sellerId || !snapshotRaw) {
    redirect("/?workspace=save_missing_data");
  }

  let snapshot: unknown;
  try {
    snapshot = JSON.parse(snapshotRaw);
  } catch {
    redirect(`/?seller=${sellerId}&workspace=save_bad_snapshot`);
  }

  if (!isCalculationSnapshot(snapshot)) {
    redirect(`/?seller=${sellerId}&workspace=save_bad_snapshot`);
  }

  const { data: seller } = await supabase
    .from("sellers")
    .select("id")
    .eq("id", sellerId)
    .eq("owner_id", profile.id)
    .maybeSingle();

  if (!seller?.id) {
    redirect("/?workspace=save_forbidden");
  }

  if (calculationId) {
    const { data: calculation } = await supabase
      .from("calculations")
      .select("id,seller_id")
      .eq("id", calculationId)
      .eq("owner_id", profile.id)
      .maybeSingle();

    if (!calculation?.id || calculation.seller_id !== sellerId) {
      redirect(`/?seller=${sellerId}&workspace=save_forbidden`);
    }

    const { error } = await supabase
      .from("calculations")
      .update({
        name: calculationName,
        snapshot
      })
      .eq("id", calculationId)
      .eq("owner_id", profile.id);

    if (error) redirect(`/?seller=${sellerId}&calculation=${calculationId}&workspace=save_error`);
    redirect(`/?seller=${sellerId}&calculation=${calculationId}&workspace=saved`);
  }

  const { data, error } = await supabase
    .from("calculations")
    .insert({
      seller_id: sellerId,
      owner_id: profile.id,
      name: calculationName,
      snapshot
    })
    .select("id")
    .single();

  if (error || !data?.id) {
    redirect(`/?seller=${sellerId}&workspace=save_error`);
  }

  redirect(`/?seller=${sellerId}&calculation=${data.id}&workspace=saved`);
}
