import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ClientCurrentStatus, ContractStatus, Database } from "@/lib/supabase/database.types";

type TypedClient = SupabaseClient<Database>;

export interface ClientListFilters {
  /** 顧客名・店舗名・顧客IDの部分一致検索。 */
  q?: string;
  currentStatus?: ClientCurrentStatus;
  contractStatus?: ContractStatus;
  /** 主担当・副担当のいずれかにこのスタッフが割り当てられている顧客のみに絞り込む。 */
  assigneeStaffId?: string;
  /** このスタッフがログイン者として登録されている顧客のみに絞り込む。 */
  loginStaffId?: string;
}

export async function listClients(
  supabase: TypedClient,
  filters: ClientListFilters | string = {},
) {
  // 既存呼び出し（第2引数に検索文字列を直接渡す）との後方互換のため、string指定も受け付ける。
  const { q, currentStatus, contractStatus, assigneeStaffId, loginStaffId } =
    typeof filters === "string"
      ? {
          q: filters,
          currentStatus: undefined,
          contractStatus: undefined,
          assigneeStaffId: undefined,
          loginStaffId: undefined,
        }
      : filters;

  let request = supabase
    .from("clients_view")
    .select(
      "id, client_code, company_name, shop_name, contract_status, current_status, material_wait_started_at, services, thumbnail_url",
    )
    .order("client_code");

  if (q && q.trim() !== "") {
    const escaped = q.trim().replace(/[%_]/g, (match) => `\\${match}`);
    request = request.or(
      `company_name.ilike.%${escaped}%,shop_name.ilike.%${escaped}%,client_code.ilike.%${escaped}%`,
    );
  }
  if (currentStatus) request = request.eq("current_status", currentStatus);
  if (contractStatus) request = request.eq("contract_status", contractStatus);

  if (assigneeStaffId) {
    const { data: assignments } = await supabase
      .from("client_assignments")
      .select("client_id")
      .eq("staff_id", assigneeStaffId)
      .is("active_to", null);
    const clientIds = [...new Set((assignments ?? []).map((a) => a.client_id))];
    if (clientIds.length === 0) return [];
    request = request.in("id", clientIds);
  }

  if (loginStaffId) {
    const { data: loginRows } = await supabase
      .from("client_login_staff")
      .select("client_id")
      .eq("staff_id", loginStaffId);
    const clientIds = [...new Set((loginRows ?? []).map((r) => r.client_id))];
    if (clientIds.length === 0) return [];
    request = request.in("id", clientIds);
  }

  const { data, error } = await request;
  if (error) throw error;
  return data ?? [];
}

/** 顧客一覧画面の表示用に、顧客ごとの主担当/副担当の氏名をまとめて引く。 */
export async function getClientAssignmentNames(
  supabase: TypedClient,
  clientIds: string[],
): Promise<Map<string, { primaryName: string | null; secondaryName: string | null }>> {
  const result = new Map<string, { primaryName: string | null; secondaryName: string | null }>();
  if (clientIds.length === 0) return result;

  const [{ data: assignments }, staffOptions] = await Promise.all([
    supabase
      .from("client_assignments")
      .select("client_id, staff_id, assignment_type")
      .in("client_id", clientIds)
      .is("active_to", null),
    listActiveStaff(supabase),
  ]);

  const staffNameById = new Map(staffOptions.map((s) => [s.id, `${s.last_name} ${s.first_name}`]));

  for (const clientId of clientIds) result.set(clientId, { primaryName: null, secondaryName: null });
  for (const a of assignments ?? []) {
    const entry = result.get(a.client_id);
    if (!entry) continue;
    const name = staffNameById.get(a.staff_id) ?? null;
    if (a.assignment_type === "primary") entry.primaryName = name;
    if (a.assignment_type === "secondary") entry.secondaryName = name;
  }
  return result;
}

/**
 * 顧客一覧カード用に、顧客ごとのログイン者の姓一覧をまとめて引く。
 * client_assignments系と異なり、inactiveなstaffが登録済みでも「不明」にせず
 * 姓を表示する（一覧はコンパクト表示のため active/inactive の区別まではしない。
 * 区別が必要な顧客詳細・編集画面は listClientLoginStaffForClient を使う）。
 */
export async function getClientLoginStaffNames(
  supabase: TypedClient,
  clientIds: string[],
): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  if (clientIds.length === 0) return result;

  const { data: rows } = await supabase
    .from("client_login_staff")
    .select("client_id, staff_id")
    .in("client_id", clientIds);
  if (!rows || rows.length === 0) return result;

  const staffIds = [...new Set(rows.map((r) => r.staff_id))];
  const { data: staffRows } = await supabase.from("staff").select("id, last_name").in("id", staffIds);
  const lastNameById = new Map((staffRows ?? []).map((s) => [s.id, s.last_name]));

  for (const row of rows) {
    const list = result.get(row.client_id) ?? [];
    list.push(lastNameById.get(row.staff_id) ?? "不明");
    result.set(row.client_id, list);
  }
  return result;
}

export interface ClientLoginStaffEntry {
  staffId: string;
  name: string;
  isActive: boolean;
}

/** 顧客詳細・編集画面用に、この顧客の現在のログイン者一覧を氏名・active状態つきで返す。 */
export async function listClientLoginStaffForClient(
  supabase: TypedClient,
  clientId: string,
): Promise<ClientLoginStaffEntry[]> {
  const { data: rows } = await supabase
    .from("client_login_staff")
    .select("staff_id")
    .eq("client_id", clientId);
  if (!rows || rows.length === 0) return [];

  const staffIds = [...new Set(rows.map((r) => r.staff_id))];
  const { data: staffRows } = await supabase
    .from("staff")
    .select("id, last_name, first_name, is_active")
    .in("id", staffIds);
  const staffById = new Map((staffRows ?? []).map((s) => [s.id, s]));

  return staffIds.map((staffId) => {
    const s = staffById.get(staffId);
    return {
      staffId,
      name: s ? `${s.last_name} ${s.first_name}` : "不明なスタッフ",
      isActive: s?.is_active ?? false,
    };
  });
}

/**
 * 顧客編集画面のログイン者チェックボックス候補。active staff全員に加えて、
 * 既にこの顧客のログイン者として登録済みのinactive staffも（選択解除できるように）含める。
 * 新規に選べるのはactive staffのみ。
 */
export async function listLoginStaffCandidates(
  supabase: TypedClient,
  clientId: string,
): Promise<ClientLoginStaffEntry[]> {
  const [activeStaff, currentEntries] = await Promise.all([
    listActiveStaff(supabase),
    listClientLoginStaffForClient(supabase, clientId),
  ]);

  const options: ClientLoginStaffEntry[] = activeStaff.map((s) => ({
    staffId: s.id,
    name: `${s.last_name} ${s.first_name}`,
    isActive: true,
  }));

  const activeIds = new Set(activeStaff.map((s) => s.id));
  for (const entry of currentEntries) {
    if (!activeIds.has(entry.staffId)) options.push(entry);
  }

  return options;
}

/** 顧客一覧画面の「利用サービス」表示用に、有効な投稿ルールの投稿種別をまとめて引く。 */
export async function getActiveServicePostTypes(
  supabase: TypedClient,
  clientIds: string[],
): Promise<Map<string, Database["public"]["Tables"]["posting_schedule_rules"]["Row"]["post_type"][]>> {
  const result = new Map<
    string,
    Database["public"]["Tables"]["posting_schedule_rules"]["Row"]["post_type"][]
  >();
  if (clientIds.length === 0) return result;

  const { data } = await supabase
    .from("posting_schedule_rules")
    .select("client_id, post_type")
    .in("client_id", clientIds)
    .eq("is_active", true);

  for (const rule of data ?? []) {
    const list = result.get(rule.client_id) ?? [];
    if (!list.includes(rule.post_type)) list.push(rule.post_type);
    result.set(rule.client_id, list);
  }
  return result;
}

export async function listActiveStaff(supabase: TypedClient) {
  const { data, error } = await supabase
    .from("staff")
    .select("id, last_name, first_name, role")
    .eq("is_active", true)
    .order("last_name");

  if (error) throw error;
  return data ?? [];
}

export async function getClientDetail(supabase: TypedClient, clientId: string) {
  const [
    clientResult,
    profileResult,
    linksResult,
    credentialsResult,
    scheduleRulesResult,
    assignmentsResult,
    activityLogsResult,
  ] = await Promise.all([
    supabase.from("clients_view").select("*").eq("id", clientId).maybeSingle(),
    supabase
      .from("client_operation_profiles")
      .select("*")
      .eq("client_id", clientId)
      .maybeSingle(),
    supabase
      .from("client_links")
      .select("*")
      .eq("client_id", clientId)
      .order("link_type"),
    supabase
      .from("client_credentials")
      .select("*")
      .eq("client_id", clientId)
      .order("service_name"),
    supabase
      .from("posting_schedule_rules")
      .select("*")
      .eq("client_id", clientId)
      .order("post_type"),
    supabase
      .from("client_assignments")
      .select("*")
      .eq("client_id", clientId)
      .order("active_from", { ascending: false }),
    supabase
      .from("activity_logs")
      .select("*")
      .eq("entity_type", "client")
      .eq("entity_id", clientId)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  if (clientResult.error) throw clientResult.error;
  if (profileResult.error) throw profileResult.error;
  if (linksResult.error) throw linksResult.error;
  if (credentialsResult.error) throw credentialsResult.error;
  if (scheduleRulesResult.error) throw scheduleRulesResult.error;
  if (assignmentsResult.error) throw assignmentsResult.error;
  if (activityLogsResult.error) throw activityLogsResult.error;

  return {
    client: clientResult.data,
    profile: profileResult.data,
    links: linksResult.data ?? [],
    credentials: credentialsResult.data ?? [],
    scheduleRules: scheduleRulesResult.data ?? [],
    assignments: assignmentsResult.data ?? [],
    activityLogs: activityLogsResult.data ?? [],
  };
}

export type ClientDetail = Awaited<ReturnType<typeof getClientDetail>>;

export async function listUpcomingProductionTasks(supabase: TypedClient, clientId: string) {
  const { data, error } = await supabase
    .from("production_tasks")
    .select("*")
    .eq("client_id", clientId)
    .neq("status", "completed")
    .order("scheduled_post_date", { ascending: true, nullsFirst: false });

  if (error) throw error;
  return data ?? [];
}
