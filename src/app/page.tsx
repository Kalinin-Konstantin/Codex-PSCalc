import { CalculatorApp } from "../components/calculator-app";
import { AccessStatusPanel, AuthPanel, SupabaseSetupPanel, UserBar } from "../components/auth-panel";
import { canUseCalculator, getCurrentProfile, isApprovedAdmin } from "../lib/auth/session";
import { applyCommercialSettings, parseCommercialSettings } from "../lib/commercial-settings";
import { isCalculationSnapshot, type CalculatorWorkspace, type LoadedCalculation, type SavedCalculationRecord, type SellerRecord } from "../lib/saved-calculations";
import { isSupabaseConfigured } from "../lib/supabase/env";
import { defaultSettings } from "../lib/tariffs";
import type { CalculatorSettings } from "../lib/types";

export const dynamic = "force-dynamic";

type HomeProps = {
  searchParams?: Promise<{ auth?: string; owner?: string; seller?: string; calculation?: string; workspace?: string }>;
};

export default async function Home({ searchParams }: HomeProps) {
  const params = searchParams ? await searchParams : {};

  if (!isSupabaseConfigured()) {
    return <SupabaseSetupPanel />;
  }

  const { supabase, profile } = await getCurrentProfile();

  if (!profile) {
    return <AuthPanel message={params.auth} />;
  }

  if (!canUseCalculator(profile)) {
    return <AccessStatusPanel profile={profile} />;
  }

  return (
    <>
      <UserBar profile={profile} />
      <CalculatorApp
        key={`${params.owner ?? profile.id}:${params.calculation ?? params.seller ?? "new"}`}
        workspace={await loadWorkspace(supabase, profile.id, isApprovedAdmin(profile), params)}
      />
    </>
  );
}

async function loadWorkspace(
  supabase: Awaited<ReturnType<typeof getCurrentProfile>>["supabase"],
  userId: string,
  isAdmin: boolean,
  params: { owner?: string; seller?: string; calculation?: string; workspace?: string }
): Promise<CalculatorWorkspace> {
  const ownerId = isAdmin && params.owner ? params.owner : userId;
  const canEdit = ownerId === userId;
  const defaultSettingsForNewCalculation = await loadDefaultSettings(supabase);
  let ownerEmail: string | undefined;

  if (isAdmin && ownerId !== userId) {
    const { data: ownerProfile } = await supabase
      .from("profiles")
      .select("email")
      .eq("id", ownerId)
      .maybeSingle();
    ownerEmail = ownerProfile?.email ? String(ownerProfile.email) : undefined;
  }

  const { data: sellerRows } = await supabase
    .from("sellers")
    .select("id,owner_id,name")
    .eq("owner_id", ownerId)
    .order("name", { ascending: true });

  const sellers: SellerRecord[] = (sellerRows ?? []).map((seller) => ({
    id: String(seller.id),
    ownerId: String(seller.owner_id),
    ownerEmail,
    name: String(seller.name)
  }));

  const selectedSellerId = sellers.some((seller) => seller.id === params.seller)
    ? String(params.seller)
    : sellers[0]?.id ?? "";

  const { data: calculationRows } = selectedSellerId
    ? await supabase
        .from("calculations")
        .select("id,seller_id,name,updated_at")
        .eq("owner_id", ownerId)
        .eq("seller_id", selectedSellerId)
        .order("updated_at", { ascending: false })
    : { data: [] };

  const calculations: SavedCalculationRecord[] = (calculationRows ?? []).map((calculation) => ({
    id: String(calculation.id),
    sellerId: String(calculation.seller_id),
    name: String(calculation.name),
    updatedAt: String(calculation.updated_at)
  }));

  const selectedCalculationId = calculations.some((calculation) => calculation.id === params.calculation)
    ? String(params.calculation)
    : "";

  let loadedCalculation: LoadedCalculation | null = null;
  if (selectedCalculationId) {
    const { data } = await supabase
      .from("calculations")
      .select("id,seller_id,name,updated_at,snapshot")
      .eq("owner_id", ownerId)
      .eq("id", selectedCalculationId)
      .maybeSingle();

    if (data && isCalculationSnapshot(data.snapshot)) {
      loadedCalculation = {
        id: String(data.id),
        sellerId: String(data.seller_id),
        name: String(data.name),
        updatedAt: String(data.updated_at),
        snapshot: data.snapshot
      };
    }
  }

  return {
    sellers,
    calculations,
    defaultSettings: defaultSettingsForNewCalculation,
    ownerId,
    ownerEmail,
    canEdit,
    selectedSellerId,
    selectedCalculationId,
    loadedCalculation,
    notice: params.workspace
  };
}

async function loadDefaultSettings(supabase: Awaited<ReturnType<typeof getCurrentProfile>>["supabase"]): Promise<CalculatorSettings> {
  const { data } = await supabase
    .from("commercial_settings_profiles")
    .select("settings")
    .eq("is_default", true)
    .maybeSingle();

  return data?.settings ? applyCommercialSettings(defaultSettings, parseCommercialSettings(data.settings)) : defaultSettings;
}
