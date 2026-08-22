import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentStaff } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { listClients, listActiveStaff } from "@/lib/clients/queries";
import { listRecentPostRecords } from "@/lib/postRecords/queries";
import { POST_TYPE_LABELS } from "@/lib/clients/labels";

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
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 px-4 py-6 sm:py-8">
      <div>
        <Link href="/" className="text-sm text-neutral-500">
          ← ダッシュボードに戻る
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-neutral-900">投稿履歴（直近50件）</h1>
        <p className="mt-1 text-xs text-neutral-500">
          投稿実績の登録は各顧客の「投稿履歴」タブ、またはタスク詳細から行います。
        </p>
      </div>

      <div className="flex flex-col gap-2">
        {records.map((p) => (
          <div key={p.id} className="rounded-lg border border-neutral-200 bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Link href={`/clients/${p.client_id}?tab=posts`} className="font-medium hover:underline">
                {clientNameById.get(p.client_id) ?? "不明な顧客"}
              </Link>
              <span className="text-xs text-neutral-400">
                {new Date(p.posted_at).toLocaleString("ja-JP")}
              </span>
            </div>
            <p className="mt-1 text-xs text-neutral-500">
              {POST_TYPE_LABELS[p.post_type]} ・ 投稿担当:{" "}
              {staffNameById.get(p.posted_by_staff_id) ?? "不明"}
            </p>
            {p.title ? <p className="mt-1 text-sm text-neutral-700">{p.title}</p> : null}
            <div className="mt-2 flex flex-wrap gap-3 text-xs">
              {p.social_post_url ? (
                <a href={p.social_post_url} target="_blank" rel="noreferrer" className="underline">
                  SNS投稿
                </a>
              ) : null}
              {p.canva_url ? (
                <a href={p.canva_url} target="_blank" rel="noreferrer" className="underline">
                  Canva
                </a>
              ) : null}
              {p.final_drive_url ? (
                <a href={p.final_drive_url} target="_blank" rel="noreferrer" className="underline">
                  制作物（Drive）
                </a>
              ) : null}
            </div>
          </div>
        ))}
        {records.length === 0 ? (
          <p className="py-6 text-center text-sm text-neutral-400">投稿実績はまだありません。</p>
        ) : null}
      </div>
    </main>
  );
}
