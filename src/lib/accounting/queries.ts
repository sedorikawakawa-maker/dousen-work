import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

type TypedClient = SupabaseClient<Database>;
type AccountingDocumentRow = Database["public"]["Tables"]["accounting_documents"]["Row"];
type ExpenseRow = Database["public"]["Tables"]["expenses"]["Row"];

export interface AccountingDocumentListRow extends AccountingDocumentRow {
  uploadedByName: string;
  voidedByName: string | null;
}

/** 書類BOX一覧。新しい順。staff名はJSで結合する（clientsと同様、直接JOINではなくバッチ取得）。 */
export async function listAccountingDocuments(supabase: TypedClient): Promise<AccountingDocumentListRow[]> {
  const { data, error } = await supabase
    .from("accounting_documents")
    .select("*")
    .order("uploaded_at", { ascending: false });
  if (error) throw error;
  return attachStaffNames(supabase, data ?? []);
}

async function attachStaffNames(
  supabase: TypedClient,
  rows: AccountingDocumentRow[],
): Promise<AccountingDocumentListRow[]> {
  const staffIds = [
    ...new Set(rows.flatMap((r) => [r.uploaded_by_staff_id, r.voided_by_staff_id].filter((id): id is string => !!id))),
  ];
  const { data: staffRows } =
    staffIds.length > 0
      ? await supabase.from("staff").select("id, last_name, first_name").in("id", staffIds)
      : { data: [] as { id: string; last_name: string; first_name: string }[] };
  const nameById = new Map((staffRows ?? []).map((s) => [s.id, `${s.last_name} ${s.first_name}`]));

  return rows.map((r) => ({
    ...r,
    uploadedByName: nameById.get(r.uploaded_by_staff_id) ?? "不明なスタッフ",
    voidedByName: r.voided_by_staff_id ? nameById.get(r.voided_by_staff_id) ?? "不明なスタッフ" : null,
  }));
}

export async function getAccountingDocumentById(
  supabase: TypedClient,
  id: string,
): Promise<AccountingDocumentListRow | null> {
  const { data, error } = await supabase.from("accounting_documents").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const [withName] = await attachStaffNames(supabase, [data]);
  return withName;
}

/** file_hashが既存の未取消書類と一致するか確認する（重複検出。完全一致のみ。Phase1範囲）。 */
export async function hasDuplicateByHash(
  supabase: TypedClient,
  fileHash: string,
  excludeDocumentId?: string,
): Promise<boolean> {
  let query = supabase
    .from("accounting_documents")
    .select("id")
    .eq("file_hash", fileHash)
    .neq("status", "voided")
    .limit(1);
  if (excludeDocumentId) {
    query = query.neq("id", excludeDocumentId);
  }
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).length > 0;
}

export interface ExpenseListRow extends ExpenseRow {
  confirmedByName: string;
  cancelledByName: string | null;
  document: { drive_url: string; file_name: string } | null;
}

export interface ExpenseListFilters {
  /** 'YYYY-MM'形式。指定時はtransaction_dateがその月のものだけに絞る。 */
  month?: string;
  /** 取引先名の部分一致検索。 */
  q?: string;
}

/** 経費一覧。月フィルタ・取引先検索に対応。 */
export async function listExpenses(supabase: TypedClient, filters: ExpenseListFilters = {}): Promise<ExpenseListRow[]> {
  let query = supabase
    .from("expenses")
    .select("*, accounting_documents(drive_url, file_name)")
    .order("transaction_date", { ascending: false });

  if (filters.month) {
    const monthStart = `${filters.month}-01`;
    const [y, m] = filters.month.split("-").map(Number);
    const nextMonth = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
    query = query.gte("transaction_date", monthStart).lt("transaction_date", nextMonth);
  }
  if (filters.q && filters.q.trim() !== "") {
    const escaped = filters.q.trim().replace(/[%_]/g, (match) => `\\${match}`);
    query = query.ilike("vendor_name", `%${escaped}%`);
  }

  const { data, error } = await query;
  if (error) throw error;

  const rows = (data ?? []) as unknown as (ExpenseRow & {
    accounting_documents: { drive_url: string; file_name: string } | null;
  })[];

  const staffIds = [
    ...new Set(rows.flatMap((r) => [r.confirmed_by_staff_id, r.cancelled_by_staff_id].filter((id): id is string => !!id))),
  ];
  const { data: staffRows } =
    staffIds.length > 0
      ? await supabase.from("staff").select("id, last_name, first_name").in("id", staffIds)
      : { data: [] as { id: string; last_name: string; first_name: string }[] };
  const nameById = new Map((staffRows ?? []).map((s) => [s.id, `${s.last_name} ${s.first_name}`]));

  return rows.map((r) => {
    const { accounting_documents, ...rest } = r;
    return {
      ...rest,
      confirmedByName: nameById.get(r.confirmed_by_staff_id) ?? "不明なスタッフ",
      cancelledByName: r.cancelled_by_staff_id ? nameById.get(r.cancelled_by_staff_id) ?? "不明なスタッフ" : null,
      document: accounting_documents,
    };
  });
}
