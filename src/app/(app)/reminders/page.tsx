import Link from "next/link";
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getCurrentStaff } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  listClientConfirmationReminderCandidates,
  listMaterialReminderCandidates,
  type ClientConfirmationReminderCandidate,
  type MaterialReminderCandidate,
} from "@/lib/reminderLogs/queries";
import { CLIENT_CURRENT_STATUS_LABELS } from "@/lib/clients/labels";
import { recordReminderAction } from "./actions";
import { PageContainer } from "@/components/PageContainer";
import { StatusBadge } from "@/components/StatusBadge";
import { UrgencyBadge } from "@/components/UrgencyBadge";

type ReminderItem =
  | { kind: "material"; level: "none" | "warning" | "urgent"; elapsedDays: number | null; data: MaterialReminderCandidate }
  | {
      kind: "client_confirmation";
      level: "none" | "warning" | "urgent";
      elapsedDays: number | null;
      data: ClientConfirmationReminderCandidate;
    };

const LEVEL_RANK: Record<"urgent" | "warning" | "none", number> = {
  urgent: 0,
  warning: 1,
  none: 2,
};

const SECTION_LABEL: Record<"urgent" | "warning" | "none", string> = {
  urgent: "14日以上（最優先）",
  warning: "7〜13日（注意）",
  none: "その他の催促対象",
};

export default async function RemindersPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string }>;
}) {
  const { saved } = await searchParams;

  const staff = await getCurrentStaff();
  if (!staff) {
    redirect("/login");
  }

  const supabase = await createSupabaseServerClient();
  const [materialCandidates, confirmationCandidates] = await Promise.all([
    listMaterialReminderCandidates(supabase),
    listClientConfirmationReminderCandidates(supabase),
  ]);

  const items: ReminderItem[] = [
    ...materialCandidates.map(
      (data): ReminderItem => ({ kind: "material", level: data.level, elapsedDays: data.elapsedDays, data }),
    ),
    ...confirmationCandidates.map(
      (data): ReminderItem => ({
        kind: "client_confirmation",
        level: data.level,
        elapsedDays: data.elapsedDays,
        data,
      }),
    ),
  ].sort((a, b) => {
    const rankDiff = LEVEL_RANK[a.level] - LEVEL_RANK[b.level];
    if (rankDiff !== 0) return rankDiff;
    return (b.elapsedDays ?? 0) - (a.elapsedDays ?? 0);
  });

  const urgentCount = items.filter((i) => i.level === "urgent").length;
  const warningCount = items.filter((i) => i.level === "warning").length;

  const rows = items.map((item, index) => ({
    item,
    showSectionHeader: index === 0 || item.level !== items[index - 1].level,
  }));

  return (
    <PageContainer className="gap-6 bg-neutral-50 py-6 sm:py-8">
      <div>
        <Link href="/" className="text-sm text-neutral-500">
          ← ダッシュボードに戻る
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-neutral-900">催促</h1>
      </div>

      {saved ? (
        <p className="rounded-2xl bg-[var(--accent-soft-bg)] px-4 py-2 text-sm text-[var(--accent-soft-text)]">
          催促済みとして記録しました。素材待ち・顧客確認待ちの状態は自動で解除されません。
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <SummaryChip label="最優先" count={urgentCount} tone="urgent" />
        <SummaryChip label="注意" count={warningCount} tone="warning" />
        <SummaryChip label="素材待ち" count={materialCandidates.length} tone="material" />
        <SummaryChip label="顧客確認待ち" count={confirmationCandidates.length} tone="confirm" />
      </div>

      <div className="flex flex-col gap-3">
        {rows.map(({ item, showSectionHeader }) => {
          const card =
            item.kind === "material" ? (
              <MaterialReminderCard key={`material-${item.data.clientId}`} candidate={item.data} />
            ) : (
              <ConfirmationReminderCard
                key={`confirmation-${item.data.confirmationId}`}
                candidate={item.data}
              />
            );

          return (
            <div key={`${item.kind}-${item.kind === "material" ? item.data.clientId : item.data.confirmationId}`}>
              {showSectionHeader ? (
                <h2 className="mb-2 mt-2 text-xs font-semibold text-neutral-400 first:mt-0">
                  {SECTION_LABEL[item.level]}
                </h2>
              ) : null}
              {card}
            </div>
          );
        })}
        {items.length === 0 ? (
          <p className="rounded-2xl bg-white py-10 text-center text-sm text-neutral-400">
            現在、催促が必要な対象はありません。
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
  tone: "urgent" | "warning" | "material" | "confirm";
}) {
  const toneClass = {
    urgent: "text-red-600",
    warning: "text-amber-600",
    material: "text-orange-600",
    confirm: "text-pink-600",
  }[tone];

  return (
    <div className="rounded-2xl border border-neutral-200 bg-white px-2 py-2.5 text-center">
      <p className={`text-xl font-bold tabular-nums ${toneClass}`}>{count}</p>
      <p className="mt-0.5 text-[11px] text-neutral-500">{label}</p>
    </div>
  );
}

function ReminderCardShell({
  level,
  children,
}: {
  level: "none" | "warning" | "urgent";
  children: ReactNode;
}) {
  const borderClass =
    level === "urgent" ? "border-l-4 border-l-red-400" : level === "warning" ? "border-l-4 border-l-amber-300" : "";

  return (
    <div
      className={`flex flex-col gap-3 rounded-2xl border border-neutral-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between ${borderClass}`}
    >
      {children}
    </div>
  );
}

function MaterialReminderCard({ candidate: c }: { candidate: MaterialReminderCandidate }) {
  return (
    <ReminderCardShell level={c.level}>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <Link href={`/clients/${c.clientId}`} className="font-semibold text-neutral-900 hover:underline">
            {c.clientName}
          </Link>
          <StatusBadge status="material_waiting" label={CLIENT_CURRENT_STATUS_LABELS.material_waiting} />
          {c.level !== "none" ? <UrgencyBadge level={c.level} /> : null}
        </div>
        <p className="text-sm text-neutral-700">
          素材の督促・確認{c.elapsedDays !== null ? `（${c.elapsedDays}日経過）` : ""}
        </p>
        <p className="text-xs text-neutral-500">
          主担当: {c.primaryStaffName ?? "未設定"} ／ 副担当: {c.secondaryStaffName ?? "—"}
        </p>
        <p className="text-xs text-neutral-400">
          素材待ち開始: {c.startedAt ? new Date(c.startedAt).toLocaleDateString("ja-JP") : "—"} ／ 最終催促日:{" "}
          {c.lastRemindedAt ? new Date(c.lastRemindedAt).toLocaleDateString("ja-JP") : "未催促"}
        </p>
      </div>

      <div className="flex flex-wrap gap-2 sm:shrink-0">
        {c.officialLineUrl ? (
          <a
            href={c.officialLineUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded-full border border-[var(--accent)] bg-[var(--accent-soft-bg)] px-3 py-2 text-xs font-medium text-[var(--accent-soft-text)]"
          >
            公式LINEを開く
          </a>
        ) : null}
        <Link
          href={`/clients/${c.clientId}`}
          className="rounded-full border border-neutral-300 px-3 py-2 text-xs text-neutral-700"
        >
          顧客情報を見る
        </Link>
        <form action={recordReminderAction}>
          <input type="hidden" name="clientId" value={c.clientId} />
          <input type="hidden" name="reminderType" value="material" />
          <button
            type="submit"
            className="rounded-full bg-[var(--accent)] px-3 py-2 text-xs font-medium text-white hover:bg-[var(--accent-strong)]"
          >
            催促済みにする
          </button>
        </form>
      </div>
    </ReminderCardShell>
  );
}

function ConfirmationReminderCard({ candidate: c }: { candidate: ClientConfirmationReminderCandidate }) {
  return (
    <ReminderCardShell level={c.level}>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <Link href={`/tasks/${c.taskId}`} className="font-semibold text-neutral-900 hover:underline">
            {c.clientName}
          </Link>
          <StatusBadge
            status="client_confirmation_waiting"
            label={CLIENT_CURRENT_STATUS_LABELS.client_confirmation_waiting}
          />
          {c.level !== "none" ? <UrgencyBadge level={c.level} /> : null}
        </div>
        <p className="text-sm text-neutral-700">
          {c.taskTitle} の顧客への督促・再連絡
          {c.elapsedDays !== null ? `（${c.elapsedDays}日経過）` : ""}
        </p>
        <p className="text-xs text-neutral-500">
          主担当: {c.primaryStaffName ?? "未設定"} ／ 副担当: {c.secondaryStaffName ?? "—"}
        </p>
        <p className="text-xs text-neutral-400">
          確認依頼日: {new Date(c.requestedAt).toLocaleDateString("ja-JP")} ／ 最終催促日:{" "}
          {c.lastRemindedAt ? new Date(c.lastRemindedAt).toLocaleDateString("ja-JP") : "未催促"}
        </p>
      </div>

      <div className="flex flex-wrap gap-2 sm:shrink-0">
        {c.officialLineUrl ? (
          <a
            href={c.officialLineUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded-full border border-[var(--accent)] bg-[var(--accent-soft-bg)] px-3 py-2 text-xs font-medium text-[var(--accent-soft-text)]"
          >
            公式LINEを開く
          </a>
        ) : null}
        <Link
          href={`/tasks/${c.taskId}`}
          className="rounded-full border border-neutral-300 px-3 py-2 text-xs text-neutral-700"
        >
          タスク詳細を見る
        </Link>
        <form action={recordReminderAction}>
          <input type="hidden" name="clientId" value={c.clientId} />
          <input type="hidden" name="taskId" value={c.taskId} />
          <input type="hidden" name="reminderType" value="client_confirmation" />
          <button
            type="submit"
            className="rounded-full bg-[var(--accent)] px-3 py-2 text-xs font-medium text-white hover:bg-[var(--accent-strong)]"
          >
            催促済みにする
          </button>
        </form>
      </div>
    </ReminderCardShell>
  );
}
