import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { listActiveStaff } from "@/lib/clients/queries";

type TypedClient = SupabaseClient<Database>;

function relevantDueDates(task: {
  production_start_date: string | null;
  wcheck_due_date: string | null;
  client_confirm_due_date: string | null;
  scheduled_post_date: string | null;
}): string[] {
  return [
    task.production_start_date,
    task.wcheck_due_date,
    task.client_confirm_due_date,
    task.scheduled_post_date,
  ].filter((d): d is string => d !== null);
}

function startOfWeekIso(now: Date = new Date()): string {
  const day = now.getUTCDay();
  const diff = day === 0 ? 6 : day - 1; // 月曜始まり
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - diff));
  return monday.toISOString();
}

export interface StaffProgressRow {
  staffId: string;
  staffName: string;
  primaryClientCount: number;
  secondaryClientCount: number;
  productionWaitingCount: number;
  inProductionCount: number;
  wcheckWaitingCount: number;
  clientConfirmationWaitingCount: number;
  postingWaitingCount: number;
  overdueCount: number;
  completedThisWeekCount: number;
}

export async function getStaffProgressOverview(supabase: TypedClient): Promise<StaffProgressRow[]> {
  const today = new Date().toISOString().slice(0, 10);
  const weekStart = startOfWeekIso();

  const [staffOptions, { data: assignments }, { data: tasks }, { data: recentRecords }] =
    await Promise.all([
      listActiveStaff(supabase),
      supabase.from("client_assignments").select("staff_id, assignment_type").is("active_to", null),
      supabase
        .from("production_tasks")
        .select(
          "assignee_staff_id, status, production_start_date, wcheck_due_date, client_confirm_due_date, scheduled_post_date",
        )
        .neq("status", "completed"),
      supabase
        .from("post_records")
        .select("posted_by_staff_id, posted_at")
        .is("cancelled_at", null)
        .gte("posted_at", weekStart),
    ]);

  return staffOptions.map((staff) => {
    const primaryClientCount = (assignments ?? []).filter(
      (a) => a.staff_id === staff.id && a.assignment_type === "primary",
    ).length;
    const secondaryClientCount = (assignments ?? []).filter(
      (a) => a.staff_id === staff.id && a.assignment_type === "secondary",
    ).length;

    const myTasks = (tasks ?? []).filter((t) => t.assignee_staff_id === staff.id);

    return {
      staffId: staff.id,
      staffName: `${staff.last_name} ${staff.first_name}`,
      primaryClientCount,
      secondaryClientCount,
      productionWaitingCount: myTasks.filter((t) => t.status === "production_waiting").length,
      inProductionCount: myTasks.filter((t) => t.status === "in_production").length,
      wcheckWaitingCount: myTasks.filter((t) => t.status === "wcheck_waiting").length,
      clientConfirmationWaitingCount: myTasks.filter(
        (t) => t.status === "client_confirmation_waiting",
      ).length,
      postingWaitingCount: myTasks.filter((t) => t.status === "posting_waiting").length,
      overdueCount: myTasks.filter((t) => relevantDueDates(t).some((d) => d < today)).length,
      completedThisWeekCount: (recentRecords ?? []).filter((r) => r.posted_by_staff_id === staff.id)
        .length,
    };
  });
}
