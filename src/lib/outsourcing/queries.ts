import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

type TypedClient = SupabaseClient<Database>;

export async function listOutsourcingRequests(supabase: TypedClient) {
  const { data, error } = await supabase
    .from("outsourcing_requests")
    .select("*")
    .order("requested_at", { ascending: false });

  if (error) throw error;
  return data ?? [];
}

export async function getOutsourcingRequest(supabase: TypedClient, id: string) {
  const { data, error } = await supabase
    .from("outsourcing_requests")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function listOutsourcingDeliveries(supabase: TypedClient, requestId: string) {
  const { data, error } = await supabase
    .from("outsourcing_deliveries")
    .select("*")
    .eq("outsourcing_request_id", requestId)
    .order("delivered_at", { ascending: false });

  if (error) throw error;
  return data ?? [];
}

export interface OutsourcingKpis {
  inProgressCount: number;
  overdueCount: number;
  awaitingDeliveryCount: number;
  deliveredUnconfirmedCount: number;
}

export async function getOutsourcingKpis(supabase: TypedClient): Promise<OutsourcingKpis> {
  const today = new Date().toISOString().slice(0, 10);
  const requests = await listOutsourcingRequests(supabase);

  const activeStatuses = new Set(["requested", "in_progress"]);
  const active = requests.filter((r) => activeStatuses.has(r.status));

  return {
    inProgressCount: active.length,
    overdueCount: active.filter((r) => r.due_date && r.due_date < today).length,
    awaitingDeliveryCount: active.length,
    deliveredUnconfirmedCount: requests.filter((r) => r.status === "delivered").length,
  };
}
