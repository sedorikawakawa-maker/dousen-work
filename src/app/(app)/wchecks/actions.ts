"use server";

import { revalidatePath } from "next/cache";
import { getCurrentStaff } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * 「Wチェック待ち一覧を開いたこと」を記録する専用Server Action。
 * Sidebar新着バッジ(wcheck_list_views)専用の副作用のため、一覧の描画(Server Component)
 * とは分離し、クライアント側から明示的に1度だけ呼び出す想定。
 *
 * このActionはredirect()を伴わず、呼び出し後にユーザーが別ページへ通常のLinkクリックで
 * 移動する（=このActionのレスポンス自体はそのページを再描画しない）。Sidebarバッジは
 * 共有layoutが持つ状態なので、以前アクセス済みのページ（例: 直前にいたダッシュボード）へ
 * 戻ったときに古いクライアント側キャッシュが再利用されないよう、layout配下のキャッシュを
 * 明示的に無効化する。
 */
export async function markWCheckListViewedAction(): Promise<void> {
  const staff = await getCurrentStaff();
  if (!staff) return;

  const supabase = await createSupabaseServerClient();
  await supabase
    .from("wcheck_list_views")
    .upsert({ staff_id: staff.id, last_viewed_at: new Date().toISOString() });

  revalidatePath("/", "layout");
}
