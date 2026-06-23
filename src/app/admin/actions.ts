"use server";

import { redirect } from "next/navigation";
import { getCurrentProfile, isApprovedAdmin } from "../../lib/auth/session";
import { extractCommercialSettings } from "../../lib/commercial-settings";
import { defaultSettings } from "../../lib/tariffs";
import type { CommercialSettings } from "../../lib/commercial-settings";
import type { WarehouseSupplyType } from "../../lib/types";

function field(formData: FormData, name: string) {
  return String(formData.get(name) ?? "").trim();
}

function numberField(formData: FormData, name: string) {
  const value = Number(field(formData, name).replace(",", "."));
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function warehouseSupplyTypeField(formData: FormData): WarehouseSupplyType {
  const value = field(formData, "warehouseSupplyType");
  return value === "mix_pallet" || value === "boxes" ? value : "mono_pallet";
}

export async function saveDefaultCommercialSettingsAction(formData: FormData) {
  const { supabase, profile } = await getCurrentProfile();
  if (!isApprovedAdmin(profile)) redirect("/");

  const name = field(formData, "profileName") || "Базовые коммерческие настройки";
  const settings: CommercialSettings = {
    ...extractCommercialSettings(defaultSettings),
    firstMileMarkupPercent: numberField(formData, "firstMileMarkupPercent"),
    warehouseMarkupPercent: numberField(formData, "warehouseMarkupPercent"),
    warehouseSupplyType: warehouseSupplyTypeField(formData),
    warehouseOperationGroups: {
      receiving: formData.get("warehouseOperationGroup_receiving") === "on",
      storage: formData.get("warehouseOperationGroup_storage") === "on",
      fulfillment: formData.get("warehouseOperationGroup_fulfillment") === "on",
      shipping: formData.get("warehouseOperationGroup_shipping") === "on"
    },
    warehouseOperationMarkupPercents: {
      receiving: numberField(formData, "warehouseOperationMarkupPercent_receiving"),
      storage: numberField(formData, "warehouseOperationMarkupPercent_storage"),
      fulfillment: numberField(formData, "warehouseOperationMarkupPercent_fulfillment"),
      shipping: numberField(formData, "warehouseOperationMarkupPercent_shipping")
    },
    middleMileFirstLiterMarkupPercent: numberField(formData, "middleMileFirstLiterMarkupPercent"),
    middleMileAdditionalLiterMarkupPercent: numberField(formData, "middleMileAdditionalLiterMarkupPercent"),
    middleMileOver190LiterMarkupPercent: numberField(formData, "middleMileOver190LiterMarkupPercent"),
    middleMileFrom351To1000MarkupPercent: numberField(formData, "middleMileFrom351To1000MarkupPercent"),
    middleMileFrom1001MarkupPercent: numberField(formData, "middleMileFrom1001MarkupPercent"),
    lastMileBaseMarkupPercent: numberField(formData, "lastMileBaseMarkupPercent"),
    lastMileAdditionalKgMarkupPercent: numberField(formData, "lastMileAdditionalKgMarkupPercent")
  };

  const { data: current } = await supabase
    .from("commercial_settings_profiles")
    .select("id")
    .eq("is_default", true)
    .maybeSingle();

  if (current?.id) {
    const { error } = await supabase
      .from("commercial_settings_profiles")
      .update({
        name,
        settings,
        updated_by: profile.id
      })
      .eq("id", current.id);

    if (error) redirect("/admin?commercial=save_error");
    redirect("/admin?commercial=saved");
  }

  const { error } = await supabase
    .from("commercial_settings_profiles")
    .insert({
      name,
      settings,
      is_default: true,
      updated_by: profile.id
    });

  if (error) redirect("/admin?commercial=save_error");
  redirect("/admin?commercial=saved");
}
