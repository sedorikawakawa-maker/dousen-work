import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

type TypedClient = SupabaseClient<Database>;
export type ProductionVideoRow = Database["public"]["Tables"]["production_videos"]["Row"];

/** 制作動画ページ「閲覧」タブ向け。clientIdを渡すとその顧客だけに絞り込む。 */
export async function listProductionVideos(
  supabase: TypedClient,
  clientId?: string,
): Promise<ProductionVideoRow[]> {
  let query = supabase.from("production_videos").select("*").order("created_at", { ascending: false });
  if (clientId) {
    query = query.eq("client_id", clientId);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

/** 顧客詳細「制作動画」タブ向け。 */
export async function listProductionVideosForClient(
  supabase: TypedClient,
  clientId: string,
): Promise<ProductionVideoRow[]> {
  return listProductionVideos(supabase, clientId);
}
