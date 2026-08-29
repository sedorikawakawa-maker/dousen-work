import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentStaff } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { listActiveStaff, listClients } from "@/lib/clients/queries";
import { listPendingWChecksWithTasks, type PendingWCheckItem } from "@/lib/wchecks/queries";
import { POST_TYPE_LABELS } from "@/lib/clients/labels";
import { WCHECK_CRITERIA, WCHECK_OPEN_LABEL } from "@/lib/wchecks/labels";
import { PageContainer } from "@/components/PageContainer";
import { StatusBadge } from "@/components/StatusBadge";
import { UrgencyBadge } from "@/components/UrgencyBadge";
import { ClientAvatar } from "@/components/ClientAvatar";
import type { UrgencyLevel } from "@/lib/clients/statusStyles";
import { approveWCheckAction, requestWCheckRevisionAction } from "../tasks/[taskId]/actions";

function dueUrgency(dueDate: string | null, today: string): "overdue" | "due_today" | null {
  if (!dueDate) return null;
  if (dueDate < today) return "overdue";
  if (dueDate === today) return "due_today";
  return null;
}

export default async function WChecksPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const { saved, error } = await searchParams;

  const staff = await getCurrentStaff();
  if (!staff) {
    redirect("/login");
  }

  const supabase = await createSupabaseServerClient();
  const [items, clients, staffOptions] = await Promise.all([
    listPendingWChecksWithTasks(supabase),
    listClients(supabase),
    listActiveStaff(supabase),
  ]);

  const clientNameById = new Map(
    clients.map((c) => [c.id, c.shop_name ? `${c.company_name}（${c.shop_name}）` : c.company_name]),
  );
  const clientThumbnailById = new Map(clients.map((c) => [c.id, c.thumbnail_url]));
  const staffNameById = new Map(staffOptions.map((s) => [s.id, `${s.last_name} ${s.first_name}`]));

  const today = new Date().toISOString().slice(0, 10);

  const urgencyRank: Record<"overdue" | "due_today" | "none", number> = {
    overdue: 0,
    due_today: 1,
    none: 2,
  };

  const sorted = [...items].sort((a, b) => {
    const aMine = a.wcheck.reviewer_staff_id === staff.id ? 0 : 1;
    const bMine = b.wcheck.reviewer_staff_id === staff.id ? 0 : 1;
    if (aMine !== bMine) return aMine - bMine;

    const aUrgency = dueUrgency(a.task.wcheck_due_date, today) ?? "none";
    const bUrgency = dueUrgency(b.task.wcheck_due_date, today) ?? "none";
    const rankDiff = urgencyRank[aUrgency] - urgencyRank[bUrgency];
    if (rankDiff !== 0) return rankDiff;

    return a.wcheck.requested_at.localeCompare(b.wcheck.requested_at);
  });

  return (
    <PageContainer className="gap-6 bg-neutral-50 py-6 sm:py-8">
      <div>
        <Link href="/" className="text-sm text-neutral-500">
          ← ダッシュボードに戻る
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-neutral-900">Wチェック待ち</h1>
      </div>

      <div className="rounded-2xl bg-purple-50 px-4 py-2.5 text-xs text-purple-800">
        チェック基準: {WCHECK_CRITERIA.join(" / ")}
      </div>

      {saved ? (
        <p className="rounded-2xl bg-[var(--accent-soft-bg)] px-4 py-2 text-sm text-[var(--accent-soft-text)]">
          更新しました。
        </p>
      ) : null}
      {error ? <p className="rounded-2xl bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p> : null}

      <div className="flex flex-col gap-3">
        {sorted.map((item) => (
          <WCheckCard
            key={item.wcheck.id}
            item={item}
            isMine={item.wcheck.reviewer_staff_id === staff.id}
            urgency={dueUrgency(item.task.wcheck_due_date, today)}
            clientName={clientNameById.get(item.task.client_id) ?? "不明な顧客"}
            clientThumbnailUrl={clientThumbnailById.get(item.task.client_id) ?? null}
            requestedByName={staffNameById.get(item.wcheck.requested_by_staff_id) ?? "不明"}
            reviewerName={
              item.wcheck.reviewer_staff_id ? staffNameById.get(item.wcheck.reviewer_staff_id) ?? "不明" : null
            }
          />
        ))}
        {sorted.length === 0 ? (
          <p className="rounded-2xl bg-white py-10 text-center text-sm text-neutral-400">
            Wチェック待ちのタスクはありません。
          </p>
        ) : null}
      </div>
    </PageContainer>
  );
}

function WCheckCard({
  item,
  isMine,
  urgency,
  clientName,
  clientThumbnailUrl,
  requestedByName,
  reviewerName,
}: {
  item: PendingWCheckItem;
  isMine: boolean;
  urgency: UrgencyLevel | null;
  clientName: string;
  clientThumbnailUrl: string | null;
  requestedByName: string;
  reviewerName: string | null;
}) {
  const { wcheck, task } = item;
  const borderClass =
    urgency === "overdue"
      ? "border-l-4 border-l-red-400"
      : urgency === "due_today"
        ? "border-l-4 border-l-red-300"
        : isMine
          ? "border-l-4 border-l-[var(--accent)]"
          : "";

  return (
    <div className={`flex flex-col gap-3 rounded-2xl border border-neutral-200 bg-white p-4 ${borderClass}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2">
          <ClientAvatar thumbnailUrl={clientThumbnailUrl} name={clientName} size="xs" />
          <div className="min-w-0">
            <Link href={`/tasks/${task.id}`} className="font-semibold text-neutral-900 hover:underline">
              {clientName}
            </Link>
            <p className="mt-0.5 text-sm text-neutral-600">{task.title}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {urgency ? <UrgencyBadge level={urgency} /> : null}
          <StatusBadge status="wcheck_waiting" label="Wチェック待ち" />
        </div>
      </div>

      {isMine ? (
        <span className="inline-flex w-fit items-center gap-1 rounded-full bg-[var(--accent)] px-2.5 py-1 text-xs font-bold text-white">
          あなたに依頼
        </span>
      ) : reviewerName ? (
        <span className="inline-flex w-fit items-center gap-1 rounded-full bg-purple-100 px-2.5 py-1 text-xs font-medium text-purple-700">
          指定: {reviewerName}
        </span>
      ) : (
        <span className="inline-flex w-fit items-center gap-1 rounded-full bg-neutral-100 px-2.5 py-1 text-xs font-medium text-neutral-500">
          指定なし（誰でも確認可）
        </span>
      )}

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs text-neutral-500 sm:grid-cols-4">
        <div>
          <dt>投稿種別</dt>
          <dd className="mt-0.5 text-sm text-neutral-800">{POST_TYPE_LABELS[task.post_type]}</dd>
        </div>
        <div>
          <dt>投稿予定日</dt>
          <dd className="mt-0.5 text-sm text-neutral-800">{task.scheduled_post_date ?? "未定"}</dd>
        </div>
        <div>
          <dt>Wチェック期限</dt>
          <dd className="mt-0.5 text-sm text-neutral-800">{task.wcheck_due_date ?? "未設定"}</dd>
        </div>
        <div>
          <dt>依頼者</dt>
          <dd className="mt-0.5 text-sm text-neutral-800">{requestedByName}</dd>
        </div>
      </dl>

      <a
        href={wcheck.asset_url}
        target="_blank"
        rel="noreferrer"
        className="inline-flex w-fit items-center gap-1.5 rounded-full border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700"
      >
        {WCHECK_OPEN_LABEL[wcheck.asset_type]}
      </a>

      {wcheck.notes ? <p className="text-xs text-neutral-500">補足: {wcheck.notes}</p> : null}

      <div className="grid grid-cols-1 gap-2 border-t border-neutral-100 pt-3 sm:grid-cols-2">
        <form action={approveWCheckAction}>
          <input type="hidden" name="wcheckId" value={wcheck.id} />
          <input type="hidden" name="taskId" value={task.id} />
          <input type="hidden" name="returnTo" value="/wchecks" />
          <button
            type="submit"
            className="w-full rounded-full bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-white hover:bg-[var(--accent-strong)]"
          >
            確認する（OK）
          </button>
        </form>
        <details className="rounded-full">
          <summary className="cursor-pointer rounded-full border border-neutral-300 px-4 py-3 text-center text-sm font-medium text-neutral-500">
            修正依頼
          </summary>
          <form
            action={requestWCheckRevisionAction}
            className="mt-2 flex flex-col gap-2 rounded-2xl bg-neutral-50 p-3"
          >
            <input type="hidden" name="wcheckId" value={wcheck.id} />
            <input type="hidden" name="taskId" value={task.id} />
            <input type="hidden" name="returnTo" value="/wchecks" />
            <textarea
              name="revisionComment"
              rows={2}
              required
              placeholder="修正コメント"
              className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
            />
            <button
              type="submit"
              className="w-full rounded-full border border-red-300 px-4 py-2 text-sm font-medium text-red-700"
            >
              修正依頼を送る
            </button>
          </form>
        </details>
      </div>
    </div>
  );
}
