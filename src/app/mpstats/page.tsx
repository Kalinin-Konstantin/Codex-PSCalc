import Link from "next/link";
import { AccessStatusPanel, AuthPanel, SupabaseSetupPanel, UserBar } from "../../components/auth-panel";
import { MpstatsSellerPage } from "../../components/mpstats/MpstatsSellerPage";
import { canUseCalculator, getCurrentProfile } from "../../lib/auth/session";
import { isSupabaseConfigured } from "../../lib/supabase/env";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams?: Promise<{ message?: string }>;
};

export default async function MpstatsPage({ searchParams }: PageProps) {
  const params = await searchParams;

  if (!isSupabaseConfigured()) {
    return <SupabaseSetupPanel />;
  }

  const { profile } = await getCurrentProfile();

  if (!profile) {
    return <AuthPanel message={params?.message} />;
  }

  if (!canUseCalculator(profile)) {
    return <AccessStatusPanel profile={profile} />;
  }

  return (
    <main className="mpstats-page">
      <UserBar profile={profile} />
      <div className="mpstats-shell">
        <div className="mpstats-page-top">
          <div>
            <p className="eyebrow">MPStats</p>
            <h1>Оценка селлера по MPStats</h1>
            <p>
              Вставьте ссылку на товар WB/Ozon, чтобы получить сводку по продавцу за последние 30 дней.
            </p>
          </div>
          <Link className="secondary-link" href="/">
            К калькулятору
          </Link>
        </div>
        <MpstatsSellerPage />
      </div>
    </main>
  );
}
