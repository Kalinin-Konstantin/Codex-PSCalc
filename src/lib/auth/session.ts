import { createClient } from "../supabase/server";
import type { UserProfile } from "./types";

export async function getCurrentProfile() {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims.sub;

  if (!userId) {
    return { supabase, userId: null, profile: null };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("id,email,role,status,created_at,approved_at,approved_by")
    .eq("id", userId)
    .maybeSingle();

  return { supabase, userId, profile: (profile ?? null) as UserProfile | null };
}

export function canUseCalculator(profile: UserProfile | null): profile is UserProfile {
  return profile?.status === "approved";
}

export function isApprovedAdmin(profile: UserProfile | null): profile is UserProfile {
  return profile?.role === "admin" && profile.status === "approved";
}
