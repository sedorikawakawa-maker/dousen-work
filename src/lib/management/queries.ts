import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, PostType } from "@/lib/supabase/database.types";
import { listActiveStaff } from "@/lib/clients/queries";
import { listPendingWChecksWithTasks } from "@/lib/wchecks/queries";
import {
  listPendingClientConfirmationsWithTasks,
  filterUrgentConfirmations,
} from "@/lib/clientConfirmations/queries";
import { getMaterialWaitElapsedDays } from "@/lib/reminders/material";
import { getClientConfirmationElapsedDays } from "@/lib/reminders/clientConfirmation";

type TypedClient = SupabaseClient<Database>;
type ProductionTaskRow = Database["public"]["Tables"]["production_tasks"]["Row"];

const URGENT_THRESHOLD_DAYS = 14;

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

export interface InterventionItem {
  key: string;
  clientId: string;
  clientName: string;
  primaryStaffName: string | null;
  issueType: string;
  elapsedDays: number | null;
  nextAction: string;
  href: string;
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
}

export interface ManagementOverview {
  kpis: {
    materialWaiting14: number;
    clientConfirmationWaiting14: number;
    wcheckWaiting: number;
    dueOrOverdueTasks: number;
    unassignedTasks: number;
    pastMonthShortfallGroups: number;
  };
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
  ] = await Promise.all([
    supabase
      .from("clients_view")
      .select("id, company_name, shop_name, current_status, material_wait_started_at, material_reminder_enabled"),
    supabase
      .from("client_assignments")
      .select("client_id, staff_id")
      .eq("assignment_type", "primary")
      .is("active_to", null),
    listActiveStaff(supabase),
    listPendingWChecksWithTasks(supabase),
    listPendingClientConfirmationsWithTasks(supabase),
    supabase.from("production_tasks").select("*").neq("status", "completed"),
    supabase
      .from("production_tasks")
      .select("client_id, post_type, source_month, status, scheduled_post_date")
      .eq("task_kind", "recurring")
      .lt("source_month", currentMonthStart),
  ]);

  const staffNameById = new Map(staffOptions.map((s) => [s.id, `${s.last_name} ${s.first_name}`]));
  const primaryStaffIdByClientId = new Map((assignments ?? []).map((a) => [a.client_id, a.staff_id]));
  const clientNameById = new Map(
    (clients ?? []).map((c) => [c.id, c.shop_name ? `${c.company_name}（${c.shop_name}）` : c.company_name]),
  );

  const interventions: InterventionItem[] = [];

  // 素材待ち14日以上
  const materialWaitingClients = (clients ?? []).filter(
    (c) => c.current_status === "material_waiting" && c.material_reminder_enabled,
  );
  let materialWaiting14 = 0;
  for (const c of materialWaitingClients) {
    const days = getMaterialWaitElapsedDays(c.material_wait_started_at);
    if (days !== null && days >= URGENT_THRESHOLD_DAYS) {
      materialWaiting14 += 1;
      const primaryStaffId = primaryStaffIdByClientId.get(c.id);
      interventions.push({
        key: `material-${c.id}`,
        clientId: c.id,
        clientName: clientNameById.get(c.id) ?? c.company_name,
        primaryStaffName: primaryStaffId ? staffNameById.get(primaryStaffId) ?? null : null,
        issueType: "素材待ち14日超",
        elapsedDays: days,
        nextAction: "素材の督促・確認",
        href: `/clients/${c.id}`,
      });
    }
  }

  // 顧客確認待ち14日以上
  const urgentConfirmations = filterUrgentConfirmations(confirmationItems, URGENT_THRESHOLD_DAYS);
  for (const { confirmation, task } of urgentConfirmations) {
    const days = getClientConfirmationElapsedDays(confirmation.requested_at);
    const primaryStaffId = primaryStaffIdByClientId.get(task.client_id);
    interventions.push({
      key: `confirmation-${confirmation.id}`,
      clientId: task.client_id,
      clientName: clientNameById.get(task.client_id) ?? "不明な顧客",
      primaryStaffName: primaryStaffId ? staffNameById.get(primaryStaffId) ?? null : null,
      issueType: "顧客確認待ち14日超",
      elapsedDays: days,
      nextAction: "顧客への督促・再連絡",
      href: `/tasks/${task.id}`,
    });
  }

  // 未割当タスク
  const unassignedTasks = (incompleteTasks ?? []).filter((t) => !t.assignee_staff_id);
  for (const t of unassignedTasks) {
    interventions.push({
      key: `unassigned-${t.id}`,
      clientId: t.client_id,
      clientName: clientNameById.get(t.client_id) ?? "不明な顧客",
      primaryStaffName: null,
      issueType: "未割当タスク",
      elapsedDays: null,
      nextAction: "担当者を割り当てる",
      href: `/tasks/${t.id}`,
    });
  }

  // 今日/期限超過タスク
  const dueOrOverdueTasks = (incompleteTasks ?? []).filter((t) =>
    relevantDueDates(t).some((d) => d <= today),
  );
  for (const t of dueOrOverdueTasks) {
    const primaryStaffId = t.assignee_staff_id ?? primaryStaffIdByClientId.get(t.client_id);
    interventions.push({
      key: `due-${t.id}`,
      clientId: t.client_id,
      clientName: clientNameById.get(t.client_id) ?? "不明な顧客",
      primaryStaffName: primaryStaffId ? staffNameById.get(primaryStaffId) ?? null : null,
      issueType: "今日締切・期限超過",
      elapsedDays: null,
      nextAction: "タスクを進める",
      href: `/tasks/${t.id}`,
    });
  }

  // 前月未達・持越し（顧客×投稿種別×source_month単位で集計）
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
    }));

  return {
    kpis: {
      materialWaiting14,
      clientConfirmationWaiting14: urgentConfirmations.length,
      wcheckWaiting: wcheckItems.length,
      dueOrOverdueTasks: dueOrOverdueTasks.length,
      unassignedTasks: unassignedTasks.length,
      pastMonthShortfallGroups: pastMonthShortfalls.length,
    },
    interventions,
    pastMonthShortfalls,
  };
}
