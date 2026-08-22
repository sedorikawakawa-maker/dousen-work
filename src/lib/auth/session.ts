import "server-only";

import { cache } from "react";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";

export type CurrentStaff = Database["public"]["Tables"]["staff"]["Row"];

// レイアウトと各ページの両方から呼ばれるため、リクエスト単位でメモ化して
// Supabaseへの重複問い合わせを避ける。
export const getCurrentStaff = cache(async (): Promise<CurrentStaff | null> => {
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
});
