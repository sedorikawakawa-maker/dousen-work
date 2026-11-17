import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

type TypedClient = SupabaseClient<Database>;

// 生成済み制作タスクの個別取消。判定・更新の本体はcancel_production_task RPC側にあり
// （権限確認・行ロック・状態確認・更新を1トランザクションで実行）、ここはその唯一の呼び出し口。
// 物理DELETEは一切行わない（取消済みの行を残すことでgenerateTasksForRuleの存在チェックに
// 引っ掛かり、同じタスクが自動再生成されないようにする）。

/** 取消可否の判定に必要な最小の形（UIのボタン表示・Server Actionの事前チェックで共用する）。 */
export interface CancellableTaskFields {
  task_kind: Database["public"]["Tables"]["production_tasks"]["Row"]["task_kind"];
  status: Database["public"]["Tables"]["production_tasks"]["Row"]["status"];
  cancelled_at: string | null;
}

/**
 * 個別取消できるタスクかどうか。RPC内の判定条件と同じものをUI表示用にも使う
 * （最終的な正本はRPC側。ここでの判定はボタンの出し分けと分かりやすいエラー表示のため）。
 * 未取消であれば、status（素材待ち〜完了済み）・task_kind（recurring/spot）を問わず取消できる。
 * 取消してもstatusは変えず、Wチェック・顧客確認・投稿実績等の関連履歴も残る。
 */
export function canCancelProductionTask(task: CancellableTaskFields): boolean {
  return task.cancelled_at === null;
}

export interface CancelProductionTaskResult {
  error: string | null;
}

export async function cancelProductionTask(
  supabase: TypedClient,
  taskId: string,
  reason: string,
): Promise<CancelProductionTaskResult> {
  if (!reason.trim()) {
    return { error: "取消理由を入力してください。" };
  }

  const { error } = await supabase.rpc("cancel_production_task", {
    p_task_id: taskId,
    p_reason: reason.trim(),
  });

  if (error) return { error: error.message };
  return { error: null };
}
