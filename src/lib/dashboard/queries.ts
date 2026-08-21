import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AssignmentType, Database } from "@/lib/supabase/database.types";

type TypedClient = SupabaseClient<Database>;
type ProductionTaskRow = Database["public"]["Tables"]["production_tasks"]["Row"];
type ClientViewRow = Database["public"]["Views"]["clients_view"]["Row"];
type MaterialRow = Database["public"]["Tables"]["materials"]["Row"];

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function monthStartIso(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
}

export interface MonthProgress {
  target: number;
  carryover: number;
  actual: number;
  required: number;
}

/** 指定顧客群について、今月分の 通常目標/持越し/実績(post_records正本)/必要本数 を集計する（投稿種別合算）。 */
export async function getCurrentMonthClientProgress(
  supabase: TypedClient,
  clientIds: string[],
): Promise<Map<string, MonthProgress>> {
  const result = new Map<string, MonthProgress>();
  for (const id of clientIds) result.set(id, { target: 0, carryover: 0, actual: 0, required: 0 });
  if (clientIds.length === 0) return result;

  const monthStart = monthStartIso();

  const { data: activeRules } = await supabase
    .from("posting_schedule_rules")
    .select("client_id, monthly_target")
    .in("client_id", clientIds)
    .eq("is_active", true);
  for (const rule of activeRules ?? []) {
    const entry = result.get(rule.client_id);
    if (entry) entry.target += rule.monthly_target;
  }

  const { data: carryoverTasks } = await supabase
    .from("production_tasks")
    .select("client_id")
    .in("client_id", clientIds)
    .eq("task_kind", "recurring")
    .lt("source_month", monthStart)
    .neq("status", "completed");
  for (const task of carryoverTasks ?? []) {
    const entry = result.get(task.client_id);
    if (entry) entry.carryover += 1;
  }

  const { data: monthTasks } = await supabase
    .from("production_tasks")
    .select("id, client_id")
    .in("client_id", clientIds)
    .eq("task_kind", "recurring")
    .eq("source_month", monthStart);
  const clientIdByTaskId = new Map((monthTasks ?? []).map((t) => [t.id, t.client_id]));
  const taskIds = (monthTasks ?? []).map((t) => t.id);

  if (taskIds.length > 0) {
    const { data: records } = await supabase
      .from("post_records")
      .select("production_task_id")
      .in("production_task_id", taskIds);
    for (const record of records ?? []) {
      const clientId = record.production_task_id
        ? clientIdByTaskId.get(record.production_task_id)
        : undefined;
      if (clientId) {
        const entry = result.get(clientId);
        if (entry) entry.actual += 1;
      }
    }
  }

  for (const entry of result.values()) {
    entry.required = entry.target + entry.carryover;
  }

  return result;
}

export interface DashboardClientRow extends ClientViewRow {
  assignmentType: AssignmentType;
  progress: MonthProgress;
}

export interface DashboardData {
  myClients: DashboardClientRow[];
  dueTodayTasks: ProductionTaskRow[];
  priorityTasks: ProductionTaskRow[];
  wcheckWaitingTasks: ProductionTaskRow[];
  materialWaiting14Clients: DashboardClientRow[];
  unassignedTasks: ProductionTaskRow[];
  newMaterials: MaterialRow[];
}

function relevantDueDates(task: ProductionTaskRow): string[] {
  return [
    task.production_start_date,
    task.wcheck_due_date,
    task.client_confirm_due_date,
    task.scheduled_post_date,
  ].filter((d): d is string => d !== null);
}

export async function getDashboardData(
  supabase: TypedClient,
  staffId: string,
): Promise<DashboardData> {
  const { data: assignments } = await supabase
    .from("client_assignments")
    .select("client_id, assignment_type")
    .eq("staff_id", staffId)
    .is("active_to", null);

  const assignmentByClientId = new Map(
    (assignments ?? []).map((a) => [a.client_id, a.assignment_type]),
  );
  const myClientIds = [...assignmentByClientId.keys()];

  let myClientsRaw: ClientViewRow[] = [];
  if (myClientIds.length > 0) {
    const { data } = await supabase
      .from("clients_view")
      .select("*")
      .in("id", myClientIds)
      .order("created_at", { ascending: true });
    myClientsRaw = data ?? [];
  }

  const progressByClientId = await getCurrentMonthClientProgress(supabase, myClientIds);

  const myClients: DashboardClientRow[] = myClientsRaw.map((c) => ({
    ...c,
    assignmentType: assignmentByClientId.get(c.id) ?? "primary",
    progress: progressByClientId.get(c.id) ?? { target: 0, carryover: 0, actual: 0, required: 0 },
  }));

  const today = todayIso();
  const threeDaysAhead = new Date();
  threeDaysAhead.setUTCDate(threeDaysAhead.getUTCDate() + 3);
  const threeDaysAheadIso = threeDaysAhead.toISOString().slice(0, 10);

  let myIncompleteTasks: ProductionTaskRow[] = [];
  if (staffId) {
    const { data } = await supabase
      .from("production_tasks")
      .select("*")
      .neq("status", "completed")
      .or(`assignee_staff_id.eq.${staffId},secondary_staff_id.eq.${staffId}`);
    myIncompleteTasks = data ?? [];
  }

  const dueTodayTasks = myIncompleteTasks.filter((t) => relevantDueDates(t).includes(today));

  const priorityTasks = myIncompleteTasks
    .map((t) => {
      const dates = relevantDueDates(t);
      const earliest = dates.length > 0 ? dates.sort()[0] : null;
      return { task: t, earliest };
    })
    .filter((x): x is { task: ProductionTaskRow; earliest: string } => x.earliest !== null)
    .filter((x) => x.earliest <= threeDaysAheadIso)
    .sort((a, b) => a.earliest.localeCompare(b.earliest))
    .slice(0, 5)
    .map((x) => x.task);

  const { data: wcheckWaitingTasks } = await supabase
    .from("production_tasks")
    .select("*")
    .eq("status", "wcheck_waiting")
    .order("wcheck_due_date", { ascending: true, nullsFirst: false })
    .limit(20);

  const materialWaiting14Clients = myClients.filter((c) => {
    if (c.current_status !== "material_waiting" || !c.material_wait_started_at) return false;
    const days = Math.floor(
      (Date.now() - new Date(c.material_wait_started_at).getTime()) / (1000 * 60 * 60 * 24),
    );
    return days >= 14;
  });

  const { data: unassignedTasks } = await supabase
    .from("production_tasks")
    .select("*")
    .is("assignee_staff_id", null)
    .neq("status", "completed")
    .order("scheduled_post_date", { ascending: true, nullsFirst: false })
    .limit(10);

  let newMaterials: MaterialRow[] = [];
  if (myClientIds.length > 0) {
    const { data } = await supabase
      .from("materials")
      .select("*")
      .in("client_id", myClientIds)
      .order("received_at", { ascending: false })
      .limit(5);
    newMaterials = data ?? [];
  }

  return {
    myClients,
    dueTodayTasks,
    priorityTasks,
    wcheckWaitingTasks: wcheckWaitingTasks ?? [],
    materialWaiting14Clients,
    unassignedTasks: unassignedTasks ?? [],
    newMaterials,
  };
}
