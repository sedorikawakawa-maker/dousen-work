import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, PostType } from "@/lib/supabase/database.types";
import { listActiveStaff } from "@/lib/clients/queries";
import { listPendingWChecksWithTasks } from "@/lib/wchecks/queries";
import { listPendingClientConfirmationsWithTasks } from "@/lib/clientConfirmations/queries";
import { getMaterialWaitElapsedDays, getMaterialWaitLevel } from "@/lib/reminders/material";
import { getClientConfirmationElapsedDays, getClientConfirmationLevel } from "@/lib/reminders/clientConfirmation";
import { getOutsourcingKpis, listOutsourcingRequests } from "@/lib/outsourcing/queries";
import { listOverdueInternalTasks } from "@/lib/internalTasks/queries";

/**
 * /management（全社集計）とダッシュボード「要対応」（個人スコープ）の両方が、
 * ここで計算した同じ判定ロジック・同じデータを参照する。しきい値や条件式は
 * 既存のgetMaterialWaitLevel/getClientConfirmationLevel/既存management判定をそのまま使い、
 * 「管理画面とダッシュボードで判定が違う」状態を作らない。
 */

type TypedClient = SupabaseClient<Database>;
type ProductionTaskRow = Database["public"]["Tables"]["production_tasks"]["Row"];

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function monthStartIso(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
}

function relevantDueDates(task: ProductionTaskRow): string[] {
  return [
    task.production_start_date,
    task.wcheck_due_date,
    task.client_confirm_due_date,
    task.scheduled_post_date,
  ].filter((d): d is string => d !== null);
}

export type InterventionLevel = "warning" | "urgent";

/**
 * ダッシュボード「要対応」に載せてよい種別（個人スコープ）。
 * 制作タスク期限超過・社内タスク期限超過・未割当タスクは、既に「今日やること」で
 * 100%カバーされているため意図的に含めない（完全重複表示を避けるため）。
 */
const PERSONAL_INTERVENTION_TYPES = new Set([
  "素材待ち14日超",
  "素材待ち7日超",
  "顧客確認待ち14日超",
  "顧客確認待ち7日超",
  "外注納期超過",
  "外注納品確認待ち",
]);

export interface InterventionItem {
  key: string;
  clientId: string;
  clientName: string;
  clientThumbnailUrl: string | null;
  primaryStaffName: string | null;
  issueType: string;
  /** 素材待ち/顧客確認待ちのみ warning(7日+)/urgent(14日+) に分かれる。それ以外は常にurgent。 */
  level: InterventionLevel;
  elapsedDays: number | null;
  nextAction: string;
  href: string;
  /** この案件に関係するスタッフid（主担当・副担当・外注作成者等、既存の担当情報のみ）。個人スコープの絞り込みに使う。 */
  relatedStaffIds: string[];
}

export interface PastMonthShortfall {
  clientId: string;
  clientName: string;
  postType: PostType;
  sourceMonth: string;
  total: number;
  actual: number;
  shortfall: number;
  needsReschedule: boolean;
  relatedStaffIds: string[];
}

export interface ManagementOverview {
  kpis: {
    materialWaiting14: number;
    clientConfirmationWaiting14: number;
    wcheckWaiting: number;
    dueOrOverdueTasks: number;
    unassignedTasks: number;
    pastMonthShortfallGroups: number;
    outsourcingInProgress: number;
    outsourcingOverdue: number;
    outsourcingDeliveredUnconfirmed: number;
    overdueInternalTasks: number;
  };
  /** 全社分・全レベル（素材待ち/顧客確認待ちはwarning/urgent両方）を含む生データ。表示側で用途に応じて絞り込む。 */
  interventions: InterventionItem[];
  pastMonthShortfalls: PastMonthShortfall[];
}

export async function getManagementOverview(supabase: TypedClient): Promise<ManagementOverview> {
  const today = todayIso();
  const currentMonthStart = monthStartIso();

  const [
    { data: clients },
    { data: assignments },
    staffOptions,
    wcheckItems,
    confirmationItems,
    { data: incompleteTasks },
    { data: pastTasks },
    outsourcingKpis,
    outsourcingRequests,
    overdueInternalTasks,
  ] = await Promise.all([
    supabase
      .from("clients_view")
      .select("id, company_name, shop_name, current_status, material_wait_started_at, material_reminder_enabled, thumbnail_url"),
    supabase.from("client_assignments").select("client_id, staff_id, assignment_type").is("active_to", null),
    listActiveStaff(supabase),
    listPendingWChecksWithTasks(supabase),
    listPendingClientConfirmationsWithTasks(supabase),
    supabase.from("production_tasks").select("*").neq("status", "completed"),
    supabase
      .from("production_tasks")
      .select("client_id, post_type, source_month, status, scheduled_post_date")
      .eq("task_kind", "recurring")
      .lt("source_month", currentMonthStart),
    getOutsourcingKpis(supabase),
    listOutsourcingRequests(supabase),
    listOverdueInternalTasks(supabase),
  ]);

  const staffNameById = new Map(staffOptions.map((s) => [s.id, `${s.last_name} ${s.first_name}`]));
  const primaryStaffIdByClientId = new Map(
    (assignments ?? []).filter((a) => a.assignment_type === "primary").map((a) => [a.client_id, a.staff_id]),
  );
  const secondaryStaffIdByClientId = new Map(
    (assignments ?? []).filter((a) => a.assignment_type === "secondary").map((a) => [a.client_id, a.staff_id]),
  );
  const clientNameById = new Map(
    (clients ?? []).map((c) => [c.id, c.shop_name ? `${c.company_name}（${c.shop_name}）` : c.company_name]),
  );
  const clientThumbnailById = new Map((clients ?? []).map((c) => [c.id, c.thumbnail_url]));

  function assignedStaffIds(clientId: string): string[] {
    const ids = [primaryStaffIdByClientId.get(clientId), secondaryStaffIdByClientId.get(clientId)];
    return ids.filter((id): id is string => !!id);
  }

  const interventions: InterventionItem[] = [];

  // 素材待ち（7日以上=注意/14日以上=最優先、既存getMaterialWaitLevelをそのまま使用）
  const materialWaitingClients = (clients ?? []).filter(
    (c) => c.current_status === "material_waiting" && c.material_reminder_enabled,
  );
  let materialWaiting14 = 0;
  for (const c of materialWaitingClients) {
    const days = getMaterialWaitElapsedDays(c.material_wait_started_at);
    const level = getMaterialWaitLevel(c.material_wait_started_at);
    if (level === "none") continue;
    if (level === "urgent") materialWaiting14 += 1;
    interventions.push({
      key: `material-${c.id}`,
      clientId: c.id,
      clientName: clientNameById.get(c.id) ?? c.company_name,
      clientThumbnailUrl: clientThumbnailById.get(c.id) ?? null,
      primaryStaffName: (() => {
        const id = primaryStaffIdByClientId.get(c.id);
        return id ? staffNameById.get(id) ?? null : null;
      })(),
      issueType: level === "urgent" ? "素材待ち14日超" : "素材待ち7日超",
      level,
      elapsedDays: days,
      nextAction: "素材の督促・確認",
      href: `/clients/${c.id}`,
      relatedStaffIds: assignedStaffIds(c.id),
    });
  }

  // 顧客確認待ち（同上のしきい値、既存getClientConfirmationLevelをそのまま使用）
  let clientConfirmationWaiting14 = 0;
  for (const { confirmation, task } of confirmationItems) {
    const days = getClientConfirmationElapsedDays(confirmation.requested_at);
    const level = getClientConfirmationLevel(confirmation.requested_at);
    if (level === "none") continue;
    if (level === "urgent") clientConfirmationWaiting14 += 1;
    interventions.push({
      key: `confirmation-${confirmation.id}`,
      clientId: task.client_id,
      clientName: clientNameById.get(task.client_id) ?? "不明な顧客",
      clientThumbnailUrl: clientThumbnailById.get(task.client_id) ?? null,
      primaryStaffName: (() => {
        const id = primaryStaffIdByClientId.get(task.client_id);
        return id ? staffNameById.get(id) ?? null : null;
      })(),
      issueType: level === "urgent" ? "顧客確認待ち14日超" : "顧客確認待ち7日超",
      level,
      elapsedDays: days,
      nextAction: "顧客への督促・再連絡",
      href: `/tasks/${task.id}`,
      relatedStaffIds: assignedStaffIds(task.client_id),
    });
  }

  // 未割当タスク（個人に紐づかない概念のため要対応(個人)には出さず、/managementのみで使用）
  const unassignedTasks = (incompleteTasks ?? []).filter((t) => !t.assignee_staff_id);
  for (const t of unassignedTasks) {
    interventions.push({
      key: `unassigned-${t.id}`,
      clientId: t.client_id,
      clientName: clientNameById.get(t.client_id) ?? "不明な顧客",
      clientThumbnailUrl: clientThumbnailById.get(t.client_id) ?? null,
      primaryStaffName: null,
      issueType: "未割当タスク",
      level: "urgent",
      elapsedDays: null,
      nextAction: "担当者を割り当てる",
      href: `/tasks/${t.id}`,
      relatedStaffIds: [],
    });
  }

  // 今日/期限超過タスク（「今日やること」で自分の分は既にカバー済みのため、要対応(個人)には出さない）
  const dueOrOverdueTasks = (incompleteTasks ?? []).filter((t) => relevantDueDates(t).some((d) => d <= today));
  for (const t of dueOrOverdueTasks) {
    const relatedId = t.assignee_staff_id ?? primaryStaffIdByClientId.get(t.client_id) ?? null;
    interventions.push({
      key: `due-${t.id}`,
      clientId: t.client_id,
      clientName: clientNameById.get(t.client_id) ?? "不明な顧客",
      clientThumbnailUrl: clientThumbnailById.get(t.client_id) ?? null,
      primaryStaffName: relatedId ? staffNameById.get(relatedId) ?? null : null,
      issueType: "今日締切・期限超過",
      level: "urgent",
      elapsedDays: null,
      nextAction: "タスクを進める",
      href: `/tasks/${t.id}`,
      relatedStaffIds: relatedId ? [relatedId] : [],
    });
  }

  // 前月未達・持越し（顧客×投稿種別×source_month単位で集計、既存担当情報で関係者を判定）
  const groups = new Map<
    string,
    { clientId: string; postType: PostType; sourceMonth: string; total: number; actual: number; needsReschedule: boolean }
  >();
  for (const t of pastTasks ?? []) {
    const key = `${t.client_id}|${t.post_type}|${t.source_month}`;
    const entry = groups.get(key) ?? {
      clientId: t.client_id,
      postType: t.post_type,
      sourceMonth: t.source_month,
      total: 0,
      actual: 0,
      needsReschedule: false,
    };
    entry.total += 1;
    if (t.status === "completed") {
      entry.actual += 1;
    } else if (!t.scheduled_post_date || t.scheduled_post_date < today) {
      entry.needsReschedule = true;
    }
    groups.set(key, entry);
  }

  const pastMonthShortfalls: PastMonthShortfall[] = [...groups.values()]
    .filter((g) => g.total > g.actual)
    .map((g) => ({
      clientId: g.clientId,
      clientName: clientNameById.get(g.clientId) ?? "不明な顧客",
      postType: g.postType,
      sourceMonth: g.sourceMonth,
      total: g.total,
      actual: g.actual,
      shortfall: g.total - g.actual,
      needsReschedule: g.needsReschedule,
      relatedStaffIds: assignedStaffIds(g.clientId),
    }));

  // 外注: 納期超過・納品済み未確認（作成者=既存のcreated_by_staff_id列のみを関係者とする）
  const activeOutsourcingStatuses = new Set(["requested", "in_progress"]);
  for (const r of outsourcingRequests) {
    if (activeOutsourcingStatuses.has(r.status) && r.due_date && r.due_date < today) {
      interventions.push({
        key: `outsourcing-overdue-${r.id}`,
        clientId: r.client_id ?? "",
        clientName: r.client_id ? clientNameById.get(r.client_id) ?? "不明な顧客" : "顧客未設定",
        clientThumbnailUrl: r.client_id ? clientThumbnailById.get(r.client_id) ?? null : null,
        primaryStaffName: staffNameById.get(r.created_by_staff_id) ?? null,
        issueType: "外注納期超過",
        level: "urgent",
        elapsedDays: null,
        nextAction: "外注先へ確認・督促",
        href: `/outsourcing/${r.id}`,
        relatedStaffIds: [r.created_by_staff_id],
      });
    }
    if (r.status === "delivered") {
      interventions.push({
        key: `outsourcing-unconfirmed-${r.id}`,
        clientId: r.client_id ?? "",
        clientName: r.client_id ? clientNameById.get(r.client_id) ?? "不明な顧客" : "顧客未設定",
        clientThumbnailUrl: r.client_id ? clientThumbnailById.get(r.client_id) ?? null : null,
        primaryStaffName: staffNameById.get(r.created_by_staff_id) ?? null,
        issueType: "外注納品確認待ち",
        level: "urgent",
        elapsedDays: null,
        nextAction: "納品内容を確認する",
        href: `/outsourcing/${r.id}`,
        relatedStaffIds: [r.created_by_staff_id],
      });
    }
  }

  // 社内タスク期限超過（「今日やること」で自分の分は既にカバー済みのため、要対応(個人)には出さない）
  for (const t of overdueInternalTasks) {
    interventions.push({
      key: `internal-task-${t.id}`,
      clientId: t.client_id ?? "",
      clientName: t.client_id ? clientNameById.get(t.client_id) ?? "不明な顧客" : "社内タスク",
      clientThumbnailUrl: t.client_id ? clientThumbnailById.get(t.client_id) ?? null : null,
      primaryStaffName: staffNameById.get(t.assignee_staff_id) ?? null,
      issueType: "社内タスク期限超過",
      level: "urgent",
      elapsedDays: null,
      nextAction: "社内タスクを進める",
      href: `/internal-tasks/${t.id}/edit`,
      relatedStaffIds: [t.assignee_staff_id],
    });
  }

  return {
    kpis: {
      materialWaiting14,
      clientConfirmationWaiting14,
      wcheckWaiting: wcheckItems.length,
      dueOrOverdueTasks: dueOrOverdueTasks.length,
      unassignedTasks: unassignedTasks.length,
      pastMonthShortfallGroups: pastMonthShortfalls.length,
      outsourcingInProgress: outsourcingKpis.inProgressCount,
      outsourcingOverdue: outsourcingKpis.overdueCount,
      outsourcingDeliveredUnconfirmed: outsourcingKpis.deliveredUnconfirmedCount,
      overdueInternalTasks: overdueInternalTasks.length,
    },
    interventions,
    pastMonthShortfalls,
  };
}

/** /management向け: 既存の表示内容と完全に同じ集合（素材待ち/顧客確認待ちはurgentのみ、他は全件）。 */
export function selectManagementInterventions(overview: ManagementOverview): InterventionItem[] {
  return overview.interventions.filter((item) => {
    const isGraduated = item.issueType.startsWith("素材待ち") || item.issueType.startsWith("顧客確認待ち");
    return isGraduated ? item.level === "urgent" : true;
  });
}

/** ダッシュボード「要対応」向け: 本人に関係する分のみ、かつ今日やることと重複しない種別のみ。 */
export function selectPersonalInterventions(overview: ManagementOverview, staffId: string): InterventionItem[] {
  return overview.interventions
    .filter((item) => PERSONAL_INTERVENTION_TYPES.has(item.issueType))
    .filter((item) => item.relatedStaffIds.includes(staffId))
    .sort((a, b) => (a.level === b.level ? 0 : a.level === "urgent" ? -1 : 1));
}

export function selectPersonalPastMonthShortfalls(
  overview: ManagementOverview,
  staffId: string,
): PastMonthShortfall[] {
  return overview.pastMonthShortfalls.filter((s) => s.relatedStaffIds.includes(staffId));
}
