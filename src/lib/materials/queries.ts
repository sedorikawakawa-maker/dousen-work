import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

type TypedClient = SupabaseClient<Database>;
type MaterialSubmissionRow = Database["public"]["Tables"]["material_submissions"]["Row"];
type MaterialRow = Database["public"]["Tables"]["materials"]["Row"];

export async function listMaterialsForClient(supabase: TypedClient, clientId: string) {
  const { data, error } = await supabase
    .from("materials")
    .select("*")
    .eq("client_id", clientId)
    .order("received_at", { ascending: false });

  if (error) throw error;
  return data ?? [];
}

export interface MaterialSubmissionWithFiles {
  submission: MaterialSubmissionRow;
  files: MaterialRow[];
}

/** 顧客詳細「素材」タブ向け: 提出(親)ごとにファイル(子)をまとめて取得する。 */
export async function listMaterialSubmissionsWithFilesForClient(
  supabase: TypedClient,
  clientId: string,
): Promise<MaterialSubmissionWithFiles[]> {
  const [{ data: submissions, error: submissionsError }, { data: files, error: filesError }] = await Promise.all([
    supabase
      .from("material_submissions")
      .select("*")
      .eq("client_id", clientId)
      .order("received_at", { ascending: false }),
    supabase.from("materials").select("*").eq("client_id", clientId).order("created_at", { ascending: true }),
  ]);

  if (submissionsError) throw submissionsError;
  if (filesError) throw filesError;

  const filesBySubmissionId = new Map<string, MaterialRow[]>();
  for (const file of files ?? []) {
    const list = filesBySubmissionId.get(file.material_submission_id) ?? [];
    list.push(file);
    filesBySubmissionId.set(file.material_submission_id, list);
  }

  return (submissions ?? []).map((submission) => ({
    submission,
    files: filesBySubmissionId.get(submission.id) ?? [],
  }));
}

export interface MaterialOption {
  id: string;
  label: string;
}

/**
 * 投稿実績登録「元素材」選択などで使う、ファイル単位の分かりやすい表示名一覧。
 * 「提出タイトル / ファイル名」の形式にする（ファイル名が無い旧データはタイトルのみ）。
 */
export async function listMaterialOptionsForClient(
  supabase: TypedClient,
  clientId: string,
): Promise<MaterialOption[]> {
  const grouped = await listMaterialSubmissionsWithFilesForClient(supabase, clientId);
  const options: MaterialOption[] = [];

  for (const { submission, files } of grouped) {
    for (const file of files) {
      options.push({
        id: file.id,
        label: file.file_name ? `${submission.title} / ${file.file_name}` : submission.title,
      });
    }
  }

  return options;
}

/** 主担当・副担当へ新着素材の通知を作成する（顧客向けフォーム・スタッフ登録の両方から呼び出す）。 */
export async function notifyAssignedStaffOfNewMaterialSubmission(
  supabase: TypedClient,
  params: { clientId: string; clientName: string; submissionId: string; submissionTitle: string },
): Promise<void> {
  const { data: assignments } = await supabase
    .from("client_assignments")
    .select("staff_id")
    .eq("client_id", params.clientId)
    .is("active_to", null);

  const recipientIds = [...new Set((assignments ?? []).map((a) => a.staff_id))];
  if (recipientIds.length === 0) return;

  await supabase.from("notifications").insert(
    recipientIds.map((staffId) => ({
      recipient_staff_id: staffId,
      notification_type: "new_material",
      title: `新着素材: ${params.clientName}`,
      body: params.submissionTitle,
      entity_type: "material_submission",
      entity_id: params.submissionId,
    })),
  );
}
