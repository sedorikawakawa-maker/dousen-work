import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentStaff } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { listActiveStaff, listClients } from "@/lib/clients/queries";
import {
  listPendingClientConfirmationsWithTasks,
  type PendingConfirmationItem,
} from "@/lib/clientConfirmations/queries";
import { getLatestApprovedWCheckByTaskIds } from "@/lib/wchecks/queries";
import { POST_TYPE_LABELS, CLIENT_CURRENT_STATUS_LABELS } from "@/lib/clients/labels";
import { WCHECK_OPEN_LABEL } from "@/lib/wchecks/labels";
import {
  getClientConfirmationElapsedDays,
  getClientConfirmationLevel,
} from "@/lib/reminders/clientConfirmation";
import {
  approveClientConfirmationAction,
  requestClientConfirmationRevisionAction,
} from "../tasks/[taskId]/actions";
import { PageContainer } from "@/components/PageContainer";
import { StatusBadge } from "@/components/StatusBadge";
import { UrgencyBadge } from "@/components/UrgencyBadge";
import { ClientAvatar } from "@/components/ClientAvatar";
import type { Database } from "@/lib/supabase/database.types";

type WCheckRow = Database["public"]["Tables"]["w_checks"]["Row"];

const LEVEL_RANK: Record<"urgent" | "warning" | "none", number> = {
  urgent: 0,
  warning: 1,
  none: 2,
};

const SECTION_LABEL: Record<"urgent" | "warning" | "none", string> = {
  urgent: "14日以上（最優先）",
  warning: "7〜13日（注意）",
  none: "7日未満",
};

export default async function ClientConfirmationsPage({
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
  const items = await listPendingClientConfirmationsWithTasks(supabase);
  const taskIds = items.map((i) => i.task.id);
  const clientIds = [...new Set(items.map((i) => i.task.client_id))];

  const [clients, staffOptions, latestWCheckByTaskId, lineLinksResult] = await Promise.all([
    listClients(supabase),
    listActiveStaff(supabase),
    getLatestApprovedWCheckByTaskIds(supabase, taskIds),
    clientIds.length > 0
      ? supabase
          .from("client_links")
          .select("client_id, url")
          .in("client_id", clientIds)
          .eq("link_type", "official_line")
      : Promise.resolve({ data: [] as { client_id: string; url: string }[] }),
  ]);

  const clientNameById = new Map(
    clients.map((c) => [c.id, c.shop_name ? `${c.company_name}（${c.shop_name}）` : c.company_name]),
  );
  const clientThumbnailById = new Map(clients.map((c) => [c.id, c.thumbnail_url]));
  const staffNameById = new Map(staffOptions.map((s) => [s.id, `${s.last_name} ${s.first_name}`]));
  const lineLinkByClientId = new Map((lineLinksResult.data ?? []).map((l) => [l.client_id, l.url]));

  const sorted = [...items].sort((a, b) => {
    const levelA = getClientConfirmationLevel(a.confirmation.requested_at);
    const levelB = getClientConfirmationLevel(b.confirmation.requested_at);
    const rankDiff = LEVEL_RANK[levelA] - LEVEL_RANK[levelB];
    if (rankDiff !== 0) return rankDiff;

    const daysA = getClientConfirmationElapsedDays(a.confirmation.requested_at) ?? 0;
    const daysB = getClientConfirmationElapsedDays(b.confirmation.requested_at) ?? 0;
    return daysB - daysA;
  });

  const rows = sorted.map((item, index) => {
    const level = getClientConfirmationLevel(item.confirmation.requested_at);
    const prevLevel =
      index > 0 ? getClientConfirmationLevel(sorted[index - 1].confirmation.requested_at) : null;
    return { item, level, showSectionHeader: index === 0 || level !== prevLevel };
  });

  return (
    <PageContainer className="gap-6 bg-neutral-50 py-6 sm:py-8">
      <div>
        <Link href="/" className="text-sm text-neutral-500">
          ← ダッシュボードに戻る
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-neutral-900">顧客確認待ち</h1>
      </div>

      {saved ? (
        <p className="rounded-2xl bg-[var(--accent-soft-bg)] px-4 py-2 text-sm text-[var(--accent-soft-text)]">
          更新しました。
        </p>
      ) : null}
      {error ? <p className="rounded-2xl bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p> : null}

      <div className="flex flex-col gap-3">
        {rows.map(({ item, level, showSectionHeader }) => (
          <div key={item.confirmation.id}>
            {showSectionHeader ? (
              <h2 className="mb-2 mt-2 text-sm font-semibold text-neutral-700 first:mt-0">
                {SECTION_LABEL[level]}
              </h2>
            ) : null}
            <ConfirmationCard
              item={item}
              level={level}
              clientName={clientNameById.get(item.task.client_id) ?? "不明な顧客"}
              clientThumbnailUrl={clientThumbnailById.get(item.task.client_id) ?? null}
              assigneeName={
                item.task.assignee_staff_id
                  ? staffNameById.get(item.task.assignee_staff_id) ?? "不明"
                  : "未割当"
              }
              wcheck={latestWCheckByTaskId.get(item.task.id) ?? null}
              lineUrl={lineLinkByClientId.get(item.task.client_id) ?? null}
            />
          </div>
        ))}
        {rows.length === 0 ? (
          <p className="rounded-2xl bg-white py-10 text-center text-sm text-neutral-400">
            顧客確認待ちのタスクはありません。
          </p>
        ) : null}
      </div>
    </PageContainer>
  );
}

function ConfirmationCard({
  item,
  level,
  clientName,
  clientThumbnailUrl,
  assigneeName,
  wcheck,
  lineUrl,
}: {
  item: PendingConfirmationItem;
  level: "none" | "warning" | "urgent";
  clientName: string;
  clientThumbnailUrl: string | null;
  assigneeName: string;
  wcheck: WCheckRow | null;
  lineUrl: string | null;
}) {
  const { confirmation, task } = item;
  const days = getClientConfirmationElapsedDays(confirmation.requested_at);
  const borderClass =
    level === "urgent" ? "border-l-4 border-l-red-400" : level === "warning" ? "border-l-4 border-l-amber-300" : "";

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
          {level !== "none" ? <UrgencyBadge level={level} /> : null}
          <StatusBadge
            status="client_confirmation_waiting"
            label={CLIENT_CURRENT_STATUS_LABELS.client_confirmation_waiting}
          />
        </div>
      </div>

      {days !== null ? (
        <p className="text-2xl font-bold tabular-nums text-neutral-900">
          {days}
          <span className="ml-1 text-sm font-medium text-neutral-500">日経過</span>
        </p>
      ) : null}

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
          <dt>確認依頼日</dt>
          <dd className="mt-0.5 text-sm text-neutral-800">
            {new Date(confirmation.requested_at).toLocaleDateString("ja-JP")}
          </dd>
        </div>
        <div>
          <dt>担当者</dt>
          <dd className="mt-0.5 text-sm text-neutral-800">{assigneeName}</dd>
        </div>
      </dl>

      <div className="flex flex-wrap gap-2">
        {wcheck ? (
          <a
            href={wcheck.asset_url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-full border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700"
          >
            {WCHECK_OPEN_LABEL[wcheck.asset_type]}
          </a>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-neutral-300 px-4 py-2 text-sm text-neutral-400">
            制作物リンクなし
          </span>
        )}
        {lineUrl ? (
          <a
            href={lineUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-full border border-[var(--accent)] bg-[var(--accent-soft-bg)] px-4 py-2 text-sm font-medium text-[var(--accent-soft-text)]"
          >
            公式LINEを開く
          </a>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-2 border-t border-neutral-100 pt-3 sm:grid-cols-2">
        <form action={approveClientConfirmationAction}>
          <input type="hidden" name="confirmationId" value={confirmation.id} />
          <input type="hidden" name="taskId" value={task.id} />
          <input type="hidden" name="returnTo" value="/client-confirmations" />
          <button
            type="submit"
            className="w-full rounded-full bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-white hover:bg-[var(--accent-strong)]"
          >
            顧客OK
          </button>
        </form>
        <details className="rounded-full">
          <summary className="cursor-pointer rounded-full border border-neutral-300 px-4 py-3 text-center text-sm font-medium text-neutral-500">
            修正依頼
          </summary>
          <form
            action={requestClientConfirmationRevisionAction}
            className="mt-2 flex flex-col gap-2 rounded-2xl bg-neutral-50 p-3"
          >
            <input type="hidden" name="confirmationId" value={confirmation.id} />
            <input type="hidden" name="taskId" value={task.id} />
            <input type="hidden" name="returnTo" value="/client-confirmations" />
            <textarea
              name="revisionComment"
              rows={2}
              required
              placeholder="修正内容"
              className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
            />
            <button
              type="submit"
              className="w-full rounded-full border border-red-300 px-4 py-2 text-sm font-medium text-red-700"
            >
              修正依頼を記録
            </button>
          </form>
        </details>
      </div>
    </div>
  );
}
