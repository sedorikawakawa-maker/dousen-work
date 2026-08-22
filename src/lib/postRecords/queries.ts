import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, PostType } from "@/lib/supabase/database.types";

type TypedClient = SupabaseClient<Database>;
type ProductionTaskRow = Database["public"]["Tables"]["production_tasks"]["Row"];

export async function listPostRecordsForClient(supabase: TypedClient, clientId: string) {
  const { data, error } = await supabase
    .from("post_records")
    .select("*")
    .eq("client_id", clientId)
    .order("posted_at", { ascending: false });

  if (error) throw error;
  return data ?? [];
}

export async function listRecentPostRecords(supabase: TypedClient, limit = 30) {
  const { data, error } = await supabase
    .from("post_records")
    .select("*")
    .order("posted_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data ?? [];
}

/**
 * 投稿実績登録の対象タスク候補。posting_waiting状態を優先表示する。
 * 原則としてリール実績はreelタスク、フィードはfeedタスク、ストーリーズはstoryタスクへ
 * 紐づけるため、post_typeで絞り込む。
 */
export async function listCandidateTasksForPostRecord(
  supabase: TypedClient,
  clientId: string,
  postType: PostType,
): Promise<ProductionTaskRow[]> {
  const { data, error } = await supabase
    .from("production_tasks")
    .select("*")
    .eq("client_id", clientId)
    .eq("post_type", postType)
    .neq("status", "completed")
    .order("scheduled_post_date", { ascending: true, nullsFirst: false });

  if (error) throw error;

  return (data ?? []).sort((a, b) => {
    const priorityA = a.status === "posting_waiting" ? 0 : 1;
    const priorityB = b.status === "posting_waiting" ? 0 : 1;
    if (priorityA !== priorityB) return priorityA - priorityB;
    return (a.scheduled_post_date ?? "").localeCompare(b.scheduled_post_date ?? "");
  });
}

/** 投稿カレンダー上で「投稿済み」と分かるようにするための、直近の完了タスク一覧。 */
export async function listRecentlyCompletedTasks(
  supabase: TypedClient,
  clientId: string,
  limit = 10,
): Promise<ProductionTaskRow[]> {
  const { data, error } = await supabase
    .from("production_tasks")
    .select("*")
    .eq("client_id", clientId)
    .eq("status", "completed")
    .order("completed_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data ?? [];
}
