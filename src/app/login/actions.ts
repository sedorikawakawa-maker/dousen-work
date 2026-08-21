"use server";

import { redirect } from "next/navigation";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { buildStaffAuthEmail } from "@/lib/auth/staffEmail";

export interface LoginState {
  error: string | null;
}

const GENERIC_ERROR = "姓・名・パスワードの組み合わせが正しくありません。";

export async function loginAction(
  _prevState: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const lastName = String(formData.get("lastName") ?? "").trim();
  const firstName = String(formData.get("firstName") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!lastName || !firstName || !password) {
    return { error: GENERIC_ERROR };
  }

  const adminClient = createSupabaseAdminClient();
  const { data: candidates } = await adminClient
    .from("staff")
    .select("id")
    .eq("last_name", lastName)
    .eq("first_name", firstName)
    .eq("is_active", true);

  if (!candidates || candidates.length === 0) {
    return { error: GENERIC_ERROR };
  }

  const supabase = await createSupabaseServerClient();

  for (const candidate of candidates) {
    const email = buildStaffAuthEmail(candidate.id);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (!error) {
      redirect("/");
    }
  }

  return { error: GENERIC_ERROR };
}
