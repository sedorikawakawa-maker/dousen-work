import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentStaff } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { listClients, listActiveStaff } from "@/lib/clients/queries";
import { listOutsourcingRequests } from "@/lib/outsourcing/queries";
import { OUTSOURCING_STATUS_LABELS } from "@/lib/outsourcing/labels";

export default async function OutsourcingListPage() {
  const staff = await getCurrentStaff();
  if (!staff) {
    redirect("/login");
  }

  const supabase = await createSupabaseServerClient();
  const [requests, clients, staffOptions] = await Promise.all([
    listOutsourcingRequests(supabase),
    listClients(supabase),
    listActiveStaff(supabase),
  ]);

  const clientNameById = new Map(
    clients.map((c) => [c.id, c.shop_name ? `${c.company_name}（${c.shop_name}）` : c.company_name]),
  );
  const staffNameById = new Map(staffOptions.map((s) => [s.id, `${s.last_name} ${s.first_name}`]));
  const today = new Date().toISOString().slice(0, 10);

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-6 px-4 py-6 sm:py-8">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/" className="text-sm text-neutral-500">
            ← ダッシュボードに戻る
          </Link>
          <h1 className="mt-2 text-xl font-semibold text-neutral-900">外注管理</h1>
        </div>
        <Link
          href="/outsourcing/new"
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white"
        >
          ＋ 外注依頼作成
        </Link>
      </div>

      <div className="flex flex-col gap-2">
        {requests.map((r) => {
          const isOverdue =
            r.due_date &&
            r.due_date < today &&
            (r.status === "requested" || r.status === "in_progress");
          return (
            <Link
              key={r.id}
              href={`/outsourcing/${r.id}`}
              className={`flex flex-col gap-1 rounded-lg border p-4 hover:bg-neutral-50 ${
                isOverdue ? "border-red-300 bg-red-50/40" : "border-neutral-200 bg-white"
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium text-neutral-900">{r.title}</span>
                <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600">
                  {OUTSOURCING_STATUS_LABELS[r.status]}
                </span>
              </div>
              <p className="text-xs text-neutral-500">
                {r.client_id ? clientNameById.get(r.client_id) ?? "不明な顧客" : "顧客未設定"} ・ 外注先:{" "}
                {r.contractor_name}
              </p>
              <p className="text-xs text-neutral-500">
                担当: {staffNameById.get(r.created_by_staff_id) ?? "不明"} ・ 納期:{" "}
                {r.due_date ?? "未設定"}
                {isOverdue ? (
                  <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700">
                    納期超過
                  </span>
                ) : null}
              </p>
            </Link>
          );
        })}
        {requests.length === 0 ? (
          <p className="py-6 text-center text-sm text-neutral-400">外注案件はまだありません。</p>
        ) : null}
      </div>
    </main>
  );
}
