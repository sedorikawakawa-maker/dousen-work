import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

type TypedClient = SupabaseClient<Database>;

export async function getClientBillingProfile(supabase: TypedClient, clientId: string) {
  const { data, error } = await supabase
    .from("client_billing_profiles")
    .select("*")
    .eq("client_id", clientId)
    .maybeSingle();

  if (error) throw error;
  return data;
}
