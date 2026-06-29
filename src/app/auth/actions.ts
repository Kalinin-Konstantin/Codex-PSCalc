"use server";

import { redirect } from "next/navigation";
import { createClient } from "../../lib/supabase/server";
import { getCurrentProfile, isApprovedAdmin } from "../../lib/auth/session";
import { sendApprovalEmail } from "../../lib/email/approval-email";
import { isSupabaseConfigured } from "../../lib/supabase/env";

function field(formData: FormData, name: string) {
  return String(formData.get(name) ?? "").trim();
}

export async function signInAction(formData: FormData) {
  if (!isSupabaseConfigured()) redirect("/?auth=supabase_not_configured");

  const email = field(formData, "email").toLowerCase();
  const password = field(formData, "password");

  if (!email || !password) {
    redirect("/?auth=missing_credentials");
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    redirect("/?auth=signin_error");
  }

  redirect("/");
}

export async function registerAction(formData: FormData) {
  if (!isSupabaseConfigured()) redirect("/?auth=supabase_not_configured");

  const email = field(formData, "email").toLowerCase();
  const password = field(formData, "password");

  if (!email || password.length < 8) {
    redirect("/?auth=registration_invalid");
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({ email, password });

  if (error) {
    redirect("/?auth=registration_error");
  }

  redirect("/?auth=registered");
}

export async function signOutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/");
}

export async function approveUserAction(formData: FormData) {
  const { supabase, profile } = await getCurrentProfile();
  if (!isApprovedAdmin(profile)) redirect("/");

  const userId = field(formData, "userId");
  if (!userId) redirect("/admin");

  const { data: targetProfile } = await supabase
    .from("profiles")
    .select("email,status")
    .eq("id", userId)
    .maybeSingle();

  const { error } = await supabase
    .from("profiles")
    .update({
      status: "approved",
      approved_at: new Date().toISOString(),
      approved_by: profile.id
    })
    .eq("id", userId);

  if (!error && targetProfile?.email && targetProfile.status !== "approved") {
    await sendApprovalEmail(String(targetProfile.email));
  }

  redirect("/admin");
}

export async function blockUserAction(formData: FormData) {
  const { supabase, profile } = await getCurrentProfile();
  if (!isApprovedAdmin(profile)) redirect("/");

  const userId = field(formData, "userId");
  if (!userId || userId === profile.id) redirect("/admin");

  await supabase
    .from("profiles")
    .update({
      status: "blocked"
    })
    .eq("id", userId);

  redirect("/admin");
}
