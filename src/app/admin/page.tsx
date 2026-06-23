import Link from "next/link";
import { redirect } from "next/navigation";
import {
  AdminCalculationsTable,
  AdminCommercialSettingsForm,
  AdminSellersTable,
  AdminUsersTable,
  UserBar,
  type AdminCalculationRow,
  type AdminSellerRow
} from "../../components/auth-panel";
import { defaultCommercialSettings, parseCommercialSettings, type CommercialSettingsProfile } from "../../lib/commercial-settings";
import { getCurrentProfile, isApprovedAdmin } from "../../lib/auth/session";
import { isSupabaseConfigured } from "../../lib/supabase/env";
import type { UserProfile } from "../../lib/auth/types";

export const dynamic = "force-dynamic";

type AdminPageProps = {
  searchParams?: Promise<{ commercial?: string }>;
};

export default async function AdminPage({ searchParams }: AdminPageProps) {
  const params = searchParams ? await searchParams : {};

  if (!isSupabaseConfigured()) redirect("/");

  const { supabase, profile } = await getCurrentProfile();

  if (!isApprovedAdmin(profile)) {
    redirect("/");
  }

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id,email,role,status,created_at,approved_at,approved_by")
    .order("created_at", { ascending: false });
  const profileRows = (profiles ?? []) as UserProfile[];
  const emailByUserId = new Map(profileRows.map((item) => [item.id, item.email]));

  const { data: sellers } = await supabase
    .from("sellers")
    .select("id,owner_id,name,updated_at")
    .order("updated_at", { ascending: false });
  const sellerRows: AdminSellerRow[] = (sellers ?? []).map((seller) => ({
    id: String(seller.id),
    ownerId: String(seller.owner_id),
    ownerEmail: emailByUserId.get(String(seller.owner_id)) ?? "—",
    name: String(seller.name),
    updatedAt: String(seller.updated_at)
  }));
  const sellerNameById = new Map(sellerRows.map((seller) => [seller.id, seller.name]));

  const { data: calculations } = await supabase
    .from("calculations")
    .select("id,owner_id,seller_id,name,updated_at")
    .order("updated_at", { ascending: false });
  const calculationRows: AdminCalculationRow[] = (calculations ?? []).map((calculation) => ({
    id: String(calculation.id),
    ownerId: String(calculation.owner_id),
    ownerEmail: emailByUserId.get(String(calculation.owner_id)) ?? "—",
    sellerId: String(calculation.seller_id),
    sellerName: sellerNameById.get(String(calculation.seller_id)) ?? "—",
    name: String(calculation.name),
    updatedAt: String(calculation.updated_at)
  }));

  const { data: commercialProfileRow } = await supabase
    .from("commercial_settings_profiles")
    .select("id,name,settings,updated_at")
    .eq("is_default", true)
    .maybeSingle();
  const commercialProfile: CommercialSettingsProfile = commercialProfileRow
    ? {
        id: String(commercialProfileRow.id),
        name: String(commercialProfileRow.name),
        settings: parseCommercialSettings(commercialProfileRow.settings),
        updatedAt: String(commercialProfileRow.updated_at)
      }
    : {
        id: "local-default",
        name: "Базовые коммерческие настройки",
        settings: defaultCommercialSettings
      };

  return (
    <>
      <UserBar profile={profile} />
      <main className="admin-page">
        <div className="admin-page-header">
          <div>
            <p className="eyebrow">Администрирование</p>
            <h1>Пользователи</h1>
          </div>
          <Link className="secondary-link" href="/">Вернуться к калькулятору</Link>
        </div>
        <section className="admin-page-card">
          <AdminUsersTable profiles={profileRows} />
        </section>

        <div className="admin-section-header">
          <div>
            <p className="eyebrow">Коммерческие настройки</p>
            <h2>Дефолты для новых расчётов</h2>
          </div>
        </div>
        <section className="admin-page-card">
          <AdminCommercialSettingsForm message={params.commercial} profile={commercialProfile} />
        </section>

        <div className="admin-section-header">
          <div>
            <p className="eyebrow">Сохранённые данные</p>
            <h2>Расчёты</h2>
          </div>
        </div>
        <section className="admin-page-card">
          <AdminCalculationsTable calculations={calculationRows} />
        </section>

        <div className="admin-section-header">
          <div>
            <p className="eyebrow">Справочник</p>
            <h2>Селлеры</h2>
          </div>
        </div>
        <section className="admin-page-card">
          <AdminSellersTable sellers={sellerRows} />
        </section>
      </main>
    </>
  );
}
