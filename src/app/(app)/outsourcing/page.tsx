import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentStaff } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { listClients, listActiveStaff } from "@/lib/clients/queries";
import { listOutsourcingRequests } from "@/lib/outsourcing/queries";
import { OUTSOURCING_STATUS_LABELS } from "@/lib/outsourcing/labels";
import { PageContainer } from "@/components/PageContainer";
import { StatusBadge } from "@/components/StatusBadge";
import { UrgencyBadge } from "@/components/UrgencyBadge";

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

  const activeStatuses = new Set(["requested", "in_progress"]);
  const inProgressCount = requests.filter((r) => activeStatuses.has(r.status)).length;
  const overdueCount = requests.filter(
    (r) => activeStatuses.has(r.status) && r.due_date && r.due_date < today,
  ).length;
  const deliveredUnconfirmedCount = requests.filter((r) => r.status === "delivered").length;
  const completedCount = requests.filter((r) => r.status === "completed").length;

  return (
    <PageContainer className="gap-6 bg-neutral-50 py-6 sm:py-8">
      <div className="flex items-center justify-between gap-3">
        <div>
          <Link href="/" className="text-sm text-neutral-500">
            ← ダッシュボードに戻る
          </Link>
          <h1 className="mt-2 text-xl font-semibold text-neutral-900">外注管理</h1>
        </div>
        <Link
          href="/outsourcing/new"
          className="whitespace-nowrap rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--accent-strong)]"
        >
          ＋ 外注依頼作成
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <SummaryChip label="進行中" count={inProgressCount} tone="progress" />
        <SummaryChip label="期限超過" count={overdueCount} tone="urgent" />
        <SummaryChip label="納品済み未確認" count={deliveredUnconfirmedCount} tone="delivered" />
        <SummaryChip label="完了" count={completedCount} tone="done" />
      </div>

      <div className="flex flex-col gap-3">
        {requests.map((r) => {
          const isOverdue = !!(
            r.due_date &&
            r.due_date < today &&
            (r.status === "requested" || r.status === "in_progress")
          );
          return (
            <Link
              key={r.id}
              href={`/outsourcing/${r.id}`}
              className={`flex flex-col gap-2 rounded-2xl border border-neutral-200 bg-white p-4 hover:border-neutral-300 sm:flex-row sm:items-center sm:justify-between ${
                isOverdue ? "border-l-4 border-l-red-400" : ""
              }`}
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-semibold text-neutral-900">{r.title}</span>
                  <StatusBadge status={r.status} label={OUTSOURCING_STATUS_LABELS[r.status]} />
                  {isOverdue ? <UrgencyBadge level="overdue" /> : null}
                </div>
                <p className="mt-1 text-xs text-neutral-500">
                  {r.client_id ? clientNameById.get(r.client_id) ?? "不明な顧客" : "顧客未設定"} ／ 外注先:{" "}
                  {r.contractor_name}
                </p>
                <p className="mt-1 text-xs text-neutral-500">
                  社内担当: {staffNameById.get(r.created_by_staff_id) ?? "不明"} ／ 納期: {r.due_date ?? "未設定"}
                </p>
              </div>
              <span className="inline-flex shrink-0 items-center gap-1 self-start rounded-full border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-600 sm:self-center">
                詳細を見る ›
              </span>
            </Link>
          );
        })}
        {requests.length === 0 ? (
          <p className="rounded-2xl bg-white py-10 text-center text-sm text-neutral-400">
            外注案件はまだありません。
          </p>
        ) : null}
      </div>
    </PageContainer>
  );
}

function SummaryChip({
  label,
  count,
  tone,
}: {
  label: string;
  count: number;
  tone: "progress" | "urgent" | "delivered" | "done";
}) {
  const toneClass = {
    progress: "text-indigo-600",
    urgent: "text-red-600",
    delivered: "text-orange-600",
    done: "text-neutral-500",
  }[tone];

  return (
    <div className="rounded-2xl border border-neutral-200 bg-white px-2 py-2.5 text-center">
      <p className={`text-xl font-bold tabular-nums ${toneClass}`}>{count}</p>
      <p className="mt-0.5 text-[11px] text-neutral-500">{label}</p>
    </div>
  );
}
