import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";

export type CurrentStaff = Database["public"]["Tables"]["staff"]["Row"];

export async function getCurrentStaff(): Promise<CurrentStaff | null> {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  const { data: staff } = await supabase
    .from("staff")
    .select("*")
    .eq("auth_user_id", user.id)
    .eq("is_active", true)
    .maybeSingle();

  return staff ?? null;
}
