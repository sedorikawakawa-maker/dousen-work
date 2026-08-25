import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Database,
  InternalTaskPriority,
  InternalTaskStatus,
} from "@/lib/supabase/database.types";

type TypedClient = SupabaseClient<Database>;
type InternalTaskRow = Database["public"]["Tables"]["internal_tasks"]["Row"];

/**
 * 「今日」は日本時間の暦日で判定する。サーバーの実行環境がUTCの場合、
 * 単純なnew Date().toISOString().slice(0,10)ではJST 0:00〜8:59の間
 * 前日の日付になってしまい、「今日期限」のタスクが期限当日の朝に
 * 表示されないというズレが生じるため、Asia/Tokyoで明示的に計算する。
 */
function todayIso(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const lookup = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${lookup.year}-${lookup.month}-${lookup.day}`;
}

/** 期限超過 → 今日 → 優先度A → その他 の順に並べ替える。 */
function sortInternalTasks(tasks: InternalTaskRow[]): InternalTaskRow[] {
  const today = todayIso();

  function rank(t: InternalTaskRow): number {
    if (t.status === "done") return 9;
    const dueDate = t.due_at ? t.due_at.slice(0, 10) : null;
    if (dueDate && dueDate < today) return 0;
    if (dueDate === today) return 1;
    if (t.priority === "A") return 2;
    return 3;
  }

  return [...tasks].sort((a, b) => {
    const diff = rank(a) - rank(b);
    if (diff !== 0) return diff;
    const dueA = a.due_at ?? "9999-12-31";
    const dueB = b.due_at ?? "9999-12-31";
    return dueA.localeCompare(dueB);
  });
}

export interface InternalTaskFilters {
  scope: "mine" | "all";
  currentStaffId: string;
  assigneeStaffId?: string;
  category?: string;
  status?: InternalTaskStatus;
  priority?: InternalTaskPriority;
}

export async function listInternalTasks(
  supabase: TypedClient,
  filters: InternalTaskFilters,
): Promise<InternalTaskRow[]> {
  let query = supabase.from("internal_tasks").select("*");

  if (filters.scope === "mine") {
    query = query.eq("assignee_staff_id", filters.currentStaffId);
  } else if (filters.assigneeStaffId) {
    query = query.eq("assignee_staff_id", filters.assigneeStaffId);
  }
  if (filters.category) query = query.eq("category", filters.category);
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.priority) query = query.eq("priority", filters.priority);

  const { data, error } = await query;
  if (error) throw error;

  return sortInternalTasks(data ?? []);
}

export async function listDistinctCategories(supabase: TypedClient): Promise<string[]> {
  const { data } = await supabase.from("internal_tasks").select("category");
  return [...new Set((data ?? []).map((t) => t.category))].sort();
}

export async function getInternalTask(supabase: TypedClient, id: string) {
  const { data, error } = await supabase.from("internal_tasks").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * ダッシュボード向け: 自分の担当分で未完了の社内タスク全件（期限の有無・遠近を問わない）。
 * 「今日やること」への採用可否、および担当社内タスク一覧への表示は呼び出し側（todayActions.ts）で判定する。
 */
export async function listMyIncompleteInternalTasks(
  supabase: TypedClient,
  staffId: string,
): Promise<InternalTaskRow[]> {
  const { data, error } = await supabase
    .from("internal_tasks")
    .select("*")
    .eq("assignee_staff_id", staffId)
    .neq("status", "done");
  if (error) throw error;

  return sortInternalTasks(data ?? []);
}

export async function countOverdueInternalTasks(supabase: TypedClient): Promise<number> {
  const today = todayIso();
  const { data } = await supabase
    .from("internal_tasks")
    .select("due_at")
    .neq("status", "done")
    .not("due_at", "is", null)
    .lt("due_at", today);

  return (data ?? []).length;
}

export async function listOverdueInternalTasks(
  supabase: TypedClient,
): Promise<InternalTaskRow[]> {
  const today = todayIso();
  const { data } = await supabase
    .from("internal_tasks")
    .select("*")
    .neq("status", "done")
    .not("due_at", "is", null)
    .lt("due_at", today)
    .order("due_at", { ascending: true });

  return data ?? [];
}
