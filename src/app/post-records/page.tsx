import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentStaff } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { listClients, listActiveStaff } from "@/lib/clients/queries";
import { listRecentPostRecords } from "@/lib/postRecords/queries";
import { POST_TYPE_LABELS } from "@/lib/clients/labels";
import { PageContainer } from "@/components/PageContainer";
import type { PostType } from "@/lib/supabase/database.types";

const POST_TYPE_BADGE_STYLE: Record<PostType, { bg: string; text: string }> = {
  reel: { bg: "bg-indigo-100", text: "text-indigo-700" },
  feed: { bg: "bg-teal-100", text: "text-teal-700" },
  story: { bg: "bg-fuchsia-100", text: "text-fuchsia-700" },
};

export default async function PostRecordsPage() {
  const staff = await getCurrentStaff();
  if (!staff) {
    redirect("/login");
  }

  const supabase = await createSupabaseServerClient();
  const [records, clients, staffOptions] = await Promise.all([
    listRecentPostRecords(supabase, 50),
    listClients(supabase),
    listActiveStaff(supabase),
  ]);

  const clientNameById = new Map(
    clients.map((c) => [c.id, c.shop_name ? `${c.company_name}（${c.shop_name}）` : c.company_name]),
  );
  const staffNameById = new Map(staffOptions.map((s) => [s.id, `${s.last_name} ${s.first_name}`]));

  return (
    <PageContainer className="gap-6 bg-neutral-50 py-6 sm:py-8">
      <div>
        <Link href="/" className="text-sm text-neutral-500">
          ← ダッシュボードに戻る
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-neutral-900">投稿履歴（直近50件）</h1>
        <p className="mt-1 text-xs text-neutral-500">
          投稿実績の登録は各顧客の「投稿履歴」タブ、またはタスク詳細から行います。
        </p>
      </div>

      <div className="flex flex-col gap-3">
        {records.map((p) => {
          const isCancelled = !!p.cancelled_at;
          const typeStyle = POST_TYPE_BADGE_STYLE[p.post_type];

          return (
            <div
              key={p.id}
              className={`flex flex-col gap-2 rounded-2xl border p-4 ${
                isCancelled ? "border-neutral-200 bg-neutral-50" : "border-neutral-200 bg-white"
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Link
                  href={`/clients/${p.client_id}?tab=posts`}
                  className={`font-semibold hover:underline ${isCancelled ? "text-neutral-500" : "text-neutral-900"}`}
                >
                  {clientNameById.get(p.client_id) ?? "不明な顧客"}
                </Link>
                <span className={`text-xs ${isCancelled ? "text-neutral-400" : "text-neutral-500"}`}>
                  {new Date(p.posted_at).toLocaleString("ja-JP")}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
                    isCancelled ? "bg-neutral-100 text-neutral-500" : `${typeStyle.bg} ${typeStyle.text}`
                  }`}
                >
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" aria-hidden="true" />
                  {POST_TYPE_LABELS[p.post_type]}
                </span>
                {isCancelled ? (
                  <span className="inline-flex items-center gap-1 rounded-full border border-neutral-300 px-2.5 py-1 text-xs font-semibold text-neutral-500">
                    取消済み
                  </span>
                ) : null}
                <span className={`text-xs ${isCancelled ? "text-neutral-400" : "text-neutral-500"}`}>
                  投稿担当: {staffNameById.get(p.posted_by_staff_id) ?? "不明"}
                </span>
              </div>

              {p.title ? (
                <p className={`text-sm ${isCancelled ? "text-neutral-500" : "text-neutral-700"}`}>{p.title}</p>
              ) : null}

              {!isCancelled ? (
                <div className="flex flex-wrap gap-2">
                  {p.social_post_url ? (
                    <a
                      href={p.social_post_url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-full border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-700"
                    >
                      投稿を見る
                    </a>
                  ) : null}
                  {p.final_drive_url ? (
                    <a
                      href={p.final_drive_url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-full border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-700"
                    >
                      完成動画を開く
                    </a>
                  ) : null}
                  {p.canva_url ? (
                    <a
                      href={p.canva_url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-full border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-700"
                    >
                      Canvaを開く
                    </a>
                  ) : null}
                </div>
              ) : (
                <p className="text-xs text-neutral-500">
                  {p.cancelled_at ? new Date(p.cancelled_at).toLocaleString("ja-JP") : ""}に
                  {staffNameById.get(p.cancelled_by_staff_id ?? "") ?? "不明"}が取消
                  {p.cancel_reason ? `: ${p.cancel_reason}` : ""}
                </p>
              )}
            </div>
          );
        })}
        {records.length === 0 ? (
          <p className="rounded-2xl bg-white py-10 text-center text-sm text-neutral-400">
            投稿実績はまだありません。
          </p>
        ) : null}
      </div>
    </PageContainer>
  );
}
