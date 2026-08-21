import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

type TypedClient = SupabaseClient<Database>;

export async function listClients(supabase: TypedClient, query?: string) {
  let request = supabase
    .from("clients_view")
    .select("id, client_code, company_name, shop_name, contract_status, current_status")
    .order("client_code");

  if (query && query.trim() !== "") {
    const escaped = query.trim().replace(/[%_]/g, (match) => `\\${match}`);
    request = request.or(
      `company_name.ilike.%${escaped}%,shop_name.ilike.%${escaped}%,client_code.ilike.%${escaped}%`,
    );
  }

  const { data, error } = await request;
  if (error) throw error;
  return data ?? [];
}

export async function listActiveStaff(supabase: TypedClient) {
  const { data, error } = await supabase
    .from("staff")
    .select("id, last_name, first_name, role")
    .eq("is_active", true)
    .order("last_name");

  if (error) throw error;
  return data ?? [];
}

export async function getClientDetail(supabase: TypedClient, clientId: string) {
  const [
    clientResult,
    profileResult,
    linksResult,
    credentialsResult,
    scheduleRulesResult,
    assignmentsResult,
    activityLogsResult,
  ] = await Promise.all([
    supabase.from("clients_view").select("*").eq("id", clientId).maybeSingle(),
    supabase
      .from("client_operation_profiles")
      .select("*")
      .eq("client_id", clientId)
      .maybeSingle(),
    supabase
      .from("client_links")
      .select("*")
      .eq("client_id", clientId)
      .order("link_type"),
    supabase
      .from("client_credentials")
      .select("*")
      .eq("client_id", clientId)
      .order("service_name"),
    supabase
      .from("posting_schedule_rules")
      .select("*")
      .eq("client_id", clientId)
      .order("post_type"),
    supabase
      .from("client_assignments")
      .select("*")
      .eq("client_id", clientId)
      .order("active_from", { ascending: false }),
    supabase
      .from("activity_logs")
      .select("*")
      .eq("entity_type", "client")
      .eq("entity_id", clientId)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  if (clientResult.error) throw clientResult.error;
  if (profileResult.error) throw profileResult.error;
  if (linksResult.error) throw linksResult.error;
  if (credentialsResult.error) throw credentialsResult.error;
  if (scheduleRulesResult.error) throw scheduleRulesResult.error;
  if (assignmentsResult.error) throw assignmentsResult.error;
  if (activityLogsResult.error) throw activityLogsResult.error;

  return {
    client: clientResult.data,
    profile: profileResult.data,
    links: linksResult.data ?? [],
    credentials: credentialsResult.data ?? [],
    scheduleRules: scheduleRulesResult.data ?? [],
    assignments: assignmentsResult.data ?? [],
    activityLogs: activityLogsResult.data ?? [],
  };
}

export type ClientDetail = Awaited<ReturnType<typeof getClientDetail>>;
