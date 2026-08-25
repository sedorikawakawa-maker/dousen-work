import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, PostType, ProductionTaskStatus } from "@/lib/supabase/database.types";

type TypedClient = SupabaseClient<Database>;
type InternalTaskRow = Database["public"]["Tables"]["internal_tasks"]["Row"];

export interface CalendarMonth {
  year: number;
  month0: number;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * 日本時間の「今日」を基準にカレンダーの各種計算を行う。既存のinternalTasks/queries.ts・
 * dashboard/todayActions.tsと同じIntl.DateTimeFormatベースのJST計算方法をこのモジュール用に用意する。
 */
export function todayIsoJST(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const lookup = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${lookup.year}-${lookup.month}-${lookup.day}`;
}

/** 日本時間の「今日」が属する年・月（カレンダー初期表示用）。 */
export function currentCalendarMonthJST(): CalendarMonth {
  const [year, month] = todayIsoJST().split("-").map(Number);
  return { year, month0: month - 1 };
}

export function monthStartIso(month: CalendarMonth): string {
  return `${month.year}-${pad2(month.month0 + 1)}-01`;
}

/** カレンダー計算専用の純粋な日付演算（Date.UTCはタイムゾーンに依存しない暦計算のトリックとして使用）。 */
export function monthEndIso(month: CalendarMonth): string {
  const d = new Date(Date.UTC(month.year, month.month0 + 1, 0));
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

export function addMonths(month: CalendarMonth, delta: number): CalendarMonth {
  const d = new Date(Date.UTC(month.year, month.month0 + delta, 1));
  return { year: d.getUTCFullYear(), month0: d.getUTCMonth() };
}

export interface CalendarPostEvent {
  id: string;
  clientId: string;
  clientName: string;
  clientThumbnailUrl: string | null;
  postType: PostType;
  status: ProductionTaskStatus;
  scheduledPostDate: string;
}

export interface CalendarInternalTaskEvent {
  task: InternalTaskRow;
  clientName: string | null;
  clientThumbnailUrl: string | null;
}

export interface CalendarDayEvents {
  posts: CalendarPostEvent[];
  internalTasks: CalendarInternalTaskEvent[];
}

/**
 * 担当顧客（主担当・副担当）の投稿予定を、指定月分のみ取得する。
 * scheduled_post_dateが存在する全ステータス（completed含む）が対象。
 * production_tasks.statusは投稿実績取消時にRPC側で自動的に現況へ戻される設計のため、
 * ここでの追加のキャンセル除外は不要（既存のcancel_post_record RPCには一切触れない）。
 */
export async function listScheduledPostsForMonth(
  supabase: TypedClient,
  clientIds: string[],
  month: CalendarMonth,
): Promise<Database["public"]["Tables"]["production_tasks"]["Row"][]> {
  if (clientIds.length === 0) return [];

  const { data, error } = await supabase
    .from("production_tasks")
    .select("*")
    .in("client_id", clientIds)
    .not("scheduled_post_date", "is", null)
    .gte("scheduled_post_date", monthStartIso(month))
    .lte("scheduled_post_date", monthEndIso(month));
  if (error) throw error;

  return data ?? [];
}

/**
 * 自分担当の未完了社内タスク（listMyIncompleteInternalTasksの結果）のうち、
 * 締切(due_at)が指定月内のものだけを抽出する。新しいクエリは発行しない。
 */
export function filterInternalTasksForMonth(
  myIncompleteInternalTasks: InternalTaskRow[],
  month: CalendarMonth,
): InternalTaskRow[] {
  const start = monthStartIso(month);
  const end = monthEndIso(month);
  return myIncompleteInternalTasks.filter((task) => {
    if (!task.due_at) return false;
    const dueDate = task.due_at.slice(0, 10);
    return dueDate >= start && dueDate <= end;
  });
}

/** 投稿予定・社内タスクを日付（YYYY-MM-DD）ごとにまとめる。 */
export function buildCalendarEventsByDate(params: {
  posts: CalendarPostEvent[];
  internalTasks: CalendarInternalTaskEvent[];
}): Record<string, CalendarDayEvents> {
  const map: Record<string, CalendarDayEvents> = {};

  for (const post of params.posts) {
    const key = post.scheduledPostDate;
    if (!map[key]) map[key] = { posts: [], internalTasks: [] };
    map[key].posts.push(post);
  }
  for (const event of params.internalTasks) {
    const key = event.task.due_at!.slice(0, 10);
    if (!map[key]) map[key] = { posts: [], internalTasks: [] };
    map[key].internalTasks.push(event);
  }

  return map;
}
