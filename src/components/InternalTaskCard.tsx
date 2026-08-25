import Link from "next/link";
import type { Database } from "@/lib/supabase/database.types";
import { INTERNAL_TASK_PRIORITY_LABELS, INTERNAL_TASK_STATUS_LABELS } from "@/lib/internalTasks/labels";
import { StatusBadge } from "@/components/StatusBadge";
import { UrgencyBadge } from "@/components/UrgencyBadge";
import { ClientAvatar } from "@/components/ClientAvatar";
import { LinkifiedText } from "@/components/LinkifiedText";

type InternalTaskRow = Database["public"]["Tables"]["internal_tasks"]["Row"];

function isHttpUrl(url: string | null): url is string {
  return !!url && /^https?:\/\//.test(url);
}

/** 既存internalTasks/queries.ts等と同じJST基準の「今日」計算（期限超過バッジ表示専用）。 */
function todayIsoJST(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const lookup = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${lookup.year}-${lookup.month}-${lookup.day}`;
}

/** ダッシュボード「担当社内タスク」・カレンダー日別詳細など、複数箇所で使い回す社内タスクカード。 */
export function InternalTaskCard({
  task,
  clientName,
  clientThumbnailUrl,
}: {
  task: InternalTaskRow;
  clientName: string | null;
  clientThumbnailUrl: string | null;
}) {
  const dueDate = task.due_at ? task.due_at.slice(0, 10) : null;
  const isOverdue = dueDate !== null && task.status !== "done" && dueDate < todayIsoJST();

  return (
    <div className="flex flex-col gap-2.5 rounded-2xl border border-neutral-200 bg-white p-3.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2">
          {clientName ? <ClientAvatar thumbnailUrl={clientThumbnailUrl} name={clientName} size="xs" /> : null}
          <div className="min-w-0">
            <p className="font-semibold text-neutral-900">{task.title}</p>
            {clientName ? <p className="text-xs text-neutral-500">{clientName}</p> : null}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {isOverdue ? <UrgencyBadge level="overdue" /> : null}
          <StatusBadge status={task.status} label={INTERNAL_TASK_STATUS_LABELS[task.status]} />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 text-xs text-neutral-600">
        <span className="rounded-full bg-neutral-100 px-2.5 py-1">{task.category}</span>
        <span className="rounded-full bg-neutral-100 px-2.5 py-1">
          優先度{INTERNAL_TASK_PRIORITY_LABELS[task.priority]}
        </span>
        <span className="font-medium tabular-nums text-neutral-500">期限: {dueDate ?? "未設定"}</span>
      </div>

      {task.description ? (
        <div>
          <p className="line-clamp-2 whitespace-pre-wrap text-sm text-neutral-700">
            <LinkifiedText text={task.description} />
          </p>
          <details className="mt-1">
            <summary className="cursor-pointer text-xs font-medium text-[var(--accent-strong)] underline">
              詳細を見る
            </summary>
            <p className="mt-1.5 whitespace-pre-wrap text-sm text-neutral-700">
              <LinkifiedText text={task.description} />
            </p>
          </details>
        </div>
      ) : null}

      <div className="mt-1 flex flex-wrap items-center gap-2">
        {isHttpUrl(task.attachment_url) ? (
          <a
            href={task.attachment_url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded-full border border-neutral-300 px-3.5 py-1.5 text-xs font-medium text-neutral-700"
          >
            資料を開く ↗
          </a>
        ) : null}
        <Link
          href={`/internal-tasks/${task.id}/edit`}
          className="inline-flex items-center gap-1 rounded-full border border-neutral-300 px-3.5 py-1.5 text-xs font-medium text-neutral-700"
        >
          タスクを確認 ›
        </Link>
      </div>
    </div>
  );
}
