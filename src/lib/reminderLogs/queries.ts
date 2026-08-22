import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { listActiveStaff } from "@/lib/clients/queries";
import { listPendingClientConfirmationsWithTasks } from "@/lib/clientConfirmations/queries";
import { getMaterialWaitElapsedDays, getMaterialWaitLevel } from "@/lib/reminders/material";
import {
  getClientConfirmationElapsedDays,
  getClientConfirmationLevel,
} from "@/lib/reminders/clientConfirmation";

type TypedClient = SupabaseClient<Database>;

export interface MaterialReminderCandidate {
  clientId: string;
  clientName: string;
  primaryStaffName: string | null;
  secondaryStaffName: string | null;
  startedAt: string | null;
  elapsedDays: number | null;
  level: "none" | "warning" | "urgent";
  lastRemindedAt: string | null;
  officialLineUrl: string | null;
}

export interface ClientConfirmationReminderCandidate {
  confirmationId: string;
  taskId: string;
  taskTitle: string;
  clientId: string;
  clientName: string;
  primaryStaffName: string | null;
  secondaryStaffName: string | null;
  requestedAt: string;
  elapsedDays: number | null;
  level: "none" | "warning" | "urgent";
  lastRemindedAt: string | null;
  officialLineUrl: string | null;
}

async function getAssignmentNameMaps(supabase: TypedClient) {
  const [staffOptions, { data: assignments }] = await Promise.all([
    listActiveStaff(supabase),
    supabase.from("client_assignments").select("client_id, staff_id, assignment_type").is("active_to", null),
  ]);
  const staffNameById = new Map(staffOptions.map((s) => [s.id, `${s.last_name} ${s.first_name}`]));
  const primaryByClientId = new Map(
    (assignments ?? []).filter((a) => a.assignment_type === "primary").map((a) => [a.client_id, a.staff_id]),
  );
  const secondaryByClientId = new Map(
    (assignments ?? []).filter((a) => a.assignment_type === "secondary").map((a) => [a.client_id, a.staff_id]),
  );
  return { staffNameById, primaryByClientId, secondaryByClientId };
}

export async function listMaterialReminderCandidates(
  supabase: TypedClient,
): Promise<MaterialReminderCandidate[]> {
  const [{ data: clients }, { staffNameById, primaryByClientId, secondaryByClientId }, { data: links }] =
    await Promise.all([
      supabase
        .from("clients_view")
        .select("id, company_name, shop_name, current_status, material_wait_started_at, material_reminder_enabled")
        .eq("current_status", "material_waiting")
        .eq("material_reminder_enabled", true),
      getAssignmentNameMaps(supabase),
      supabase.from("client_links").select("client_id, url").eq("link_type", "official_line"),
    ]);

  const clientIds = (clients ?? []).map((c) => c.id);
  const lastRemindedByClientId = await getLatestReminderMap(supabase, "material", clientIds, null);
  const lineUrlByClientId = new Map((links ?? []).map((l) => [l.client_id, l.url]));

  return (clients ?? []).map((c) => {
    const primaryStaffId = primaryByClientId.get(c.id);
    const secondaryStaffId = secondaryByClientId.get(c.id);
    return {
      clientId: c.id,
      clientName: c.shop_name ? `${c.company_name}（${c.shop_name}）` : c.company_name,
      primaryStaffName: primaryStaffId ? staffNameById.get(primaryStaffId) ?? null : null,
      secondaryStaffName: secondaryStaffId ? staffNameById.get(secondaryStaffId) ?? null : null,
      startedAt: c.material_wait_started_at,
      elapsedDays: getMaterialWaitElapsedDays(c.material_wait_started_at),
      level: getMaterialWaitLevel(c.material_wait_started_at),
      lastRemindedAt: lastRemindedByClientId.get(c.id) ?? null,
      officialLineUrl: lineUrlByClientId.get(c.id) ?? null,
    };
  });
}

export async function listClientConfirmationReminderCandidates(
  supabase: TypedClient,
): Promise<ClientConfirmationReminderCandidate[]> {
  const [pendingItems, { staffNameById, primaryByClientId, secondaryByClientId }] = await Promise.all([
    listPendingClientConfirmationsWithTasks(supabase),
    getAssignmentNameMaps(supabase),
  ]);

  const clientIds = [...new Set(pendingItems.map((i) => i.task.client_id))];
  const { data: enabledClients } = clientIds.length
    ? await supabase
        .from("clients_view")
        .select("id, company_name, shop_name, client_confirmation_reminder_enabled")
        .in("id", clientIds)
    : {
        data: [] as {
          id: string;
          company_name: string;
          shop_name: string | null;
          client_confirmation_reminder_enabled: boolean;
        }[],
      };
  const enabledByClientId = new Map((enabledClients ?? []).map((c) => [c.id, c.client_confirmation_reminder_enabled]));
  const clientNameById = new Map(
    (enabledClients ?? []).map((c) => [c.id, c.shop_name ? `${c.company_name}（${c.shop_name}）` : c.company_name]),
  );

  const { data: links } = clientIds.length
    ? await supabase.from("client_links").select("client_id, url").eq("link_type", "official_line").in("client_id", clientIds)
    : { data: [] as { client_id: string; url: string }[] };
  const lineUrlByClientId = new Map((links ?? []).map((l) => [l.client_id, l.url]));

  const taskIds = pendingItems.map((i) => i.task.id);
  const lastRemindedByTaskId = await getLatestReminderMap(supabase, "client_confirmation", null, taskIds);

  return pendingItems
    .filter((item) => enabledByClientId.get(item.task.client_id) !== false)
    .map(({ confirmation, task }) => {
      const primaryStaffId = primaryByClientId.get(task.client_id);
      const secondaryStaffId = secondaryByClientId.get(task.client_id);
      return {
        confirmationId: confirmation.id,
        taskId: task.id,
        taskTitle: task.title,
        clientId: task.client_id,
        clientName: clientNameById.get(task.client_id) ?? "不明な顧客",
        primaryStaffName: primaryStaffId ? staffNameById.get(primaryStaffId) ?? null : null,
        secondaryStaffName: secondaryStaffId ? staffNameById.get(secondaryStaffId) ?? null : null,
        requestedAt: confirmation.requested_at,
        elapsedDays: getClientConfirmationElapsedDays(confirmation.requested_at),
        level: getClientConfirmationLevel(confirmation.requested_at),
        lastRemindedAt: lastRemindedByTaskId.get(task.id) ?? null,
        officialLineUrl: lineUrlByClientId.get(task.client_id) ?? null,
      };
    });
}

async function getLatestReminderMap(
  supabase: TypedClient,
  reminderType: "material" | "client_confirmation",
  clientIds: string[] | null,
  taskIds: string[] | null,
): Promise<Map<string, string>> {
  const result = new Map<string, string>();

  let query = supabase
    .from("reminder_logs")
    .select("client_id, production_task_id, reminded_at")
    .eq("reminder_type", reminderType)
    .order("reminded_at", { ascending: true });

  if (clientIds) {
    if (clientIds.length === 0) return result;
    query = query.in("client_id", clientIds);
  }
  if (taskIds) {
    if (taskIds.length === 0) return result;
    query = query.in("production_task_id", taskIds);
  }

  const { data } = await query;
  for (const log of data ?? []) {
    const key = reminderType === "material" ? log.client_id : log.production_task_id;
    if (key) result.set(key, log.reminded_at);
  }
  return result;
}
