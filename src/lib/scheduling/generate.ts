import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { POST_TYPE_LABELS } from "@/lib/clients/labels";
import { computeCandidateDates, isWeekdayRule, type WeekdayRule } from "./weekdayRule";

type TypedClient = SupabaseClient<Database>;
type ScheduleRule = Database["public"]["Tables"]["posting_schedule_rules"]["Row"];

function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function startOfMonthIso(year: number, month0: number): string {
  return new Date(Date.UTC(year, month0, 1)).toISOString().slice(0, 10);
}

function endOfMonthIso(year: number, month0: number): string {
  return new Date(Date.UTC(year, month0 + 1, 0)).toISOString().slice(0, 10);
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** 現在月を含む3か月分（現在月＋2か月先）の {year, month0} 一覧。 */
export function rollingWindowMonths(base: Date = new Date()): { year: number; month0: number }[] {
  const months: { year: number; month0: number }[] = [];
  for (let i = 0; i < 3; i += 1) {
    const d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + i, 1));
    months.push({ year: d.getUTCFullYear(), month0: d.getUTCMonth() });
  }
  return months;
}

async function getPrimaryAssigneeId(
  supabase: TypedClient,
  clientId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("client_assignments")
    .select("staff_id")
    .eq("client_id", clientId)
    .eq("assignment_type", "primary")
    .is("active_to", null)
    .maybeSingle();

  return data?.staff_id ?? null;
}

/**
 * 指定ルールについて、現在月+2か月先までの3か月ローリング分の
 * production_tasks を不足分だけ生成する（重複生成防止つき）。
 */
export async function generateTasksForRule(
  supabase: TypedClient,
  rule: ScheduleRule,
): Promise<void> {
  if (!rule.is_active) return;
  if (!isWeekdayRule(rule.weekday_rule)) return;

  const weekdayRule = rule.weekday_rule as WeekdayRule;
  const assigneeStaffId = await getPrimaryAssigneeId(supabase, rule.client_id);

  for (const { year, month0 } of rollingWindowMonths()) {
    const monthStart = startOfMonthIso(year, month0);
    const monthEnd = endOfMonthIso(year, month0);

    if (rule.valid_from > monthEnd) continue;
    if (rule.valid_to && rule.valid_to < monthStart) continue;

    const candidates = computeCandidateDates(weekdayRule, year, month0)
      .filter((iso) => iso >= rule.valid_from && (!rule.valid_to || iso <= rule.valid_to))
      .slice(0, rule.monthly_target);

    for (const scheduledDate of candidates) {
      const { data: existing } = await supabase
        .from("production_tasks")
        .select("id")
        .eq("client_id", rule.client_id)
        .eq("schedule_rule_id", rule.id)
        .eq("scheduled_post_date", scheduledDate)
        .eq("post_type", rule.post_type)
        .maybeSingle();

      if (existing) continue;

      await supabase.from("production_tasks").insert({
        client_id: rule.client_id,
        schedule_rule_id: rule.id,
        post_type: rule.post_type,
        task_kind: "recurring",
        source_month: monthStart,
        scheduled_post_date: scheduledDate,
        original_scheduled_post_date: scheduledDate,
        // 自動生成時の初期状態は「制作待ち」。「素材待ち」は担当者/社員/役員/社長が
        // 素材が無いと判断した際に手動で設定する特別な状態であり、自動生成では使わない。
        status: "production_waiting",
        assignee_staff_id: assigneeStaffId,
        secondary_staff_id: null,
        title: `${POST_TYPE_LABELS[rule.post_type]}（${scheduledDate}）`,
        production_start_date:
          rule.production_lead_days != null
            ? addDaysIso(scheduledDate, -rule.production_lead_days)
            : null,
        wcheck_due_date:
          rule.wcheck_lead_days != null
            ? addDaysIso(scheduledDate, -rule.wcheck_lead_days)
            : null,
        client_confirm_due_date:
          rule.client_confirm_lead_days != null
            ? addDaysIso(scheduledDate, -rule.client_confirm_lead_days)
            : null,
        is_carryover: false,
        carried_from_task_id: null,
      });
    }
  }
}

/**
 * 削除→再生成の対象となる「安全に触ってよいタスク」のID一覧を取得する。
 * 条件: 未来の production_waiting（制作未着手）かつ、1件だけの日付変更もされていない。
 * 「素材待ち(material_waiting)」は担当者が意図的に設定した特別な状態のため、
 * ルール変更・無効化による自動削除・再生成の対象には含めない。
 * 同様に制作開始済み・Wチェック以降のタスクにも一切触れない。
 */
async function findSafelyRemovableTaskIds(
  supabase: TypedClient,
  ruleId: string,
): Promise<string[]> {
  const today = todayIso();

  const { data: candidates } = await supabase
    .from("production_tasks")
    .select("id, scheduled_post_date, original_scheduled_post_date")
    .eq("schedule_rule_id", ruleId)
    .eq("task_kind", "recurring")
    .eq("status", "production_waiting")
    .gte("scheduled_post_date", today);

  return (candidates ?? [])
    .filter((t) => t.scheduled_post_date === t.original_scheduled_post_date)
    .map((t) => t.id);
}

/**
 * ルール変更時の安全な再生成。未来の production_waiting・未手動変更のタスクのみ
 * 削除→再生成する。material_waiting・制作開始済み・Wチェック以降・手動日付変更済みの
 * タスクには一切触れない。
 */
export async function regenerateTasksForRule(
  supabase: TypedClient,
  rule: ScheduleRule,
): Promise<void> {
  const removableIds = await findSafelyRemovableTaskIds(supabase, rule.id);

  if (removableIds.length > 0) {
    await supabase.from("production_tasks").delete().in("id", removableIds);
  }

  await generateTasksForRule(supabase, rule);
}

/**
 * ルールを無効化する際、未来の production_waiting・未手動変更のタスクのみ削除する
 * （material_waiting・制作開始済み等は残す）。
 */
export async function removeUnstartedFutureTasksForRule(
  supabase: TypedClient,
  ruleId: string,
): Promise<void> {
  const removableIds = await findSafelyRemovableTaskIds(supabase, ruleId);

  if (removableIds.length > 0) {
    await supabase.from("production_tasks").delete().in("id", removableIds);
  }
}

/**
 * 月末を過ぎても未完了の recurring タスクを持越し(is_carryover=true)としてマークする。
 * 常駐cronがない構成のため、ローリング生成の実行タイミングで併せて評価する。
 */
export async function flagCarryoverForClient(
  supabase: TypedClient,
  clientId: string,
): Promise<void> {
  const now = new Date();
  const currentMonthStart = startOfMonthIso(now.getUTCFullYear(), now.getUTCMonth());

  await supabase
    .from("production_tasks")
    .update({ is_carryover: true })
    .eq("client_id", clientId)
    .eq("task_kind", "recurring")
    .neq("status", "completed")
    .lt("source_month", currentMonthStart)
    .eq("is_carryover", false);
}

/** 顧客の全アクティブルールについて、3か月ローリング生成と持越し判定を実行する。 */
export async function ensureRollingTasksForClient(
  supabase: TypedClient,
  clientId: string,
): Promise<void> {
  const { data: rules } = await supabase
    .from("posting_schedule_rules")
    .select("*")
    .eq("client_id", clientId)
    .eq("is_active", true);

  for (const rule of rules ?? []) {
    await generateTasksForRule(supabase, rule);
  }

  await flagCarryoverForClient(supabase, clientId);
}

export interface MonthlySummaryRow {
  year: number;
  month0: number;
  label: string;
  byPostType: Record<
    Database["public"]["Tables"]["production_tasks"]["Row"]["post_type"],
    {
      target: number;
      carryover: number;
      /** 持越しのうち、まだ新しい投稿予定日が設定されていない件数 */
      carryoverNeedsReschedule: number;
      actual: number;
      required: number;
    }
  >;
}

const EMPTY_POST_TYPE_COUNTS = () => ({ reel: 0, feed: 0, story: 0 });

export async function getMonthlySummary(
  supabase: TypedClient,
  clientId: string,
): Promise<MonthlySummaryRow[]> {
  const { data: activeRules } = await supabase
    .from("posting_schedule_rules")
    .select("post_type, monthly_target")
    .eq("client_id", clientId)
    .eq("is_active", true);

  const targetByPostType = EMPTY_POST_TYPE_COUNTS();
  for (const rule of activeRules ?? []) {
    targetByPostType[rule.post_type] += rule.monthly_target;
  }

  const months = rollingWindowMonths();
  const rows: MonthlySummaryRow[] = [];
  const today = todayIso();

  for (const { year, month0 } of months) {
    const monthStart = startOfMonthIso(year, month0);

    // 実績の正本は post_records。production_tasks.status=completed は
    // 業務フロー上の完了状態であり、月間の投稿本数集計には使わない。
    const { data: monthTasks } = await supabase
      .from("production_tasks")
      .select("id, post_type")
      .eq("client_id", clientId)
      .eq("task_kind", "recurring")
      .eq("source_month", monthStart);

    const postTypeByTaskId = new Map((monthTasks ?? []).map((t) => [t.id, t.post_type]));
    const taskIds = (monthTasks ?? []).map((t) => t.id);

    const actualByPostType = EMPTY_POST_TYPE_COUNTS();
    if (taskIds.length > 0) {
      const { data: records } = await supabase
        .from("post_records")
        .select("production_task_id")
        .in("production_task_id", taskIds)
        .is("cancelled_at", null);

      for (const record of records ?? []) {
        const postType = record.production_task_id
          ? postTypeByTaskId.get(record.production_task_id)
          : undefined;
        if (postType) actualByPostType[postType] += 1;
      }
    }

    const { data: carryoverTasks } = await supabase
      .from("production_tasks")
      .select("post_type, scheduled_post_date")
      .eq("client_id", clientId)
      .eq("task_kind", "recurring")
      .lt("source_month", monthStart)
      .neq("status", "completed");

    const carryoverByPostType = EMPTY_POST_TYPE_COUNTS();
    const carryoverNeedsRescheduleByPostType = EMPTY_POST_TYPE_COUNTS();
    for (const t of carryoverTasks ?? []) {
      carryoverByPostType[t.post_type] += 1;
      if (!t.scheduled_post_date || t.scheduled_post_date < today) {
        carryoverNeedsRescheduleByPostType[t.post_type] += 1;
      }
    }

    const byPostType = {} as MonthlySummaryRow["byPostType"];
    for (const postType of ["reel", "feed", "story"] as const) {
      byPostType[postType] = {
        target: targetByPostType[postType],
        carryover: carryoverByPostType[postType],
        carryoverNeedsReschedule: carryoverNeedsRescheduleByPostType[postType],
        actual: actualByPostType[postType],
        required: targetByPostType[postType] + carryoverByPostType[postType],
      };
    }

    rows.push({ year, month0, label: `${year}年${month0 + 1}月`, byPostType });
  }

  return rows;
}
