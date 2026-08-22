import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentStaff } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  listClientConfirmationReminderCandidates,
  listMaterialReminderCandidates,
} from "@/lib/reminderLogs/queries";
import { recordReminderAction } from "./actions";

const LEVEL_BADGE_CLASS: Record<string, string> = {
  urgent: "bg-red-600 text-white",
  warning: "bg-yellow-100 text-yellow-800",
  none: "bg-neutral-100 text-neutral-600",
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

  const sortedMaterial = [...materialCandidates].sort(
    (a, b) => (b.elapsedDays ?? 0) - (a.elapsedDays ?? 0),
  );
  const sortedConfirmation = [...confirmationCandidates].sort(
    (a, b) => (b.elapsedDays ?? 0) - (a.elapsedDays ?? 0),
  );

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-6 px-4 py-6 sm:py-8">
      <div>
        <Link href="/" className="text-sm text-neutral-500">
          ← ダッシュボードに戻る
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-neutral-900">催促</h1>
      </div>

      {saved ? (
        <p className="rounded-md bg-green-50 px-4 py-2 text-sm text-green-700">
          催促済みとして記録しました。素材待ち・顧客確認待ちの状態は自動で解除されません。
        </p>
      ) : null}

      <section className="rounded-lg border border-neutral-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-neutral-700">
          素材待ち（7日以上: 黄 / 14日以上: 赤・優先）
        </h2>
        <div className="flex flex-col gap-3">
          {sortedMaterial.map((c) => (
            <div
              key={c.clientId}
              className={`flex flex-col gap-2 rounded-md border p-3 ${
                c.level === "urgent" ? "border-red-400 bg-red-50/40" : "border-neutral-200"
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Link href={`/clients/${c.clientId}`} className="font-medium hover:underline">
                  {c.clientName}
                </Link>
                {c.elapsedDays !== null ? (
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${LEVEL_BADGE_CLASS[c.level]}`}>
                    {c.elapsedDays}日経過{c.level === "urgent" ? "（優先）" : ""}
                  </span>
                ) : null}
              </div>
              <p className="text-xs text-neutral-500">
                主担当: {c.primaryStaffName ?? "未設定"} ／ 副担当: {c.secondaryStaffName ?? "—"}
              </p>
              <p className="text-xs text-neutral-500">
                開始日: {c.startedAt ? new Date(c.startedAt).toLocaleDateString("ja-JP") : "—"} ／
                最終催促日:{" "}
                {c.lastRemindedAt ? new Date(c.lastRemindedAt).toLocaleDateString("ja-JP") : "未催促"}
              </p>
              <p className="text-xs text-neutral-500">次の推奨アクション: 素材の督促・確認</p>
              <div className="flex flex-wrap gap-2">
                {c.officialLineUrl ? (
                  <a
                    href={c.officialLineUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-md border border-green-400 bg-green-50 px-3 py-2 text-xs font-medium text-green-800"
                  >
                    公式LINEを開く
                  </a>
                ) : null}
                <Link
                  href={`/clients/${c.clientId}`}
                  className="rounded-md border border-neutral-300 px-3 py-2 text-xs text-neutral-700"
                >
                  顧客情報を見る
                </Link>
                <form action={recordReminderAction}>
                  <input type="hidden" name="clientId" value={c.clientId} />
                  <input type="hidden" name="reminderType" value="material" />
                  <button
                    type="submit"
                    className="rounded-md bg-neutral-900 px-3 py-2 text-xs font-medium text-white"
                  >
                    催促済みにする
                  </button>
                </form>
              </div>
            </div>
          ))}
          {sortedMaterial.length === 0 ? (
            <p className="py-4 text-center text-sm text-neutral-400">対象の顧客はありません。</p>
          ) : null}
        </div>
      </section>

      <section className="rounded-lg border border-neutral-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-neutral-700">
          顧客確認待ち（14日以上: 赤・最優先）
        </h2>
        <div className="flex flex-col gap-3">
          {sortedConfirmation.map((c) => (
            <div
              key={c.confirmationId}
              className={`flex flex-col gap-2 rounded-md border p-3 ${
                c.level === "urgent" ? "border-red-400 bg-red-50/40" : "border-neutral-200"
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Link href={`/tasks/${c.taskId}`} className="font-medium hover:underline">
                  {c.clientName} / {c.taskTitle}
                </Link>
                {c.elapsedDays !== null ? (
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${LEVEL_BADGE_CLASS[c.level]}`}>
                    {c.elapsedDays}日経過{c.level === "urgent" ? "（最優先）" : ""}
                  </span>
                ) : null}
              </div>
              <p className="text-xs text-neutral-500">
                主担当: {c.primaryStaffName ?? "未設定"} ／ 副担当: {c.secondaryStaffName ?? "—"}
              </p>
              <p className="text-xs text-neutral-500">
                依頼日: {new Date(c.requestedAt).toLocaleDateString("ja-JP")} ／ 最終催促日:{" "}
                {c.lastRemindedAt ? new Date(c.lastRemindedAt).toLocaleDateString("ja-JP") : "未催促"}
              </p>
              <p className="text-xs text-neutral-500">次の推奨アクション: 顧客への督促・再連絡</p>
              <div className="flex flex-wrap gap-2">
                {c.officialLineUrl ? (
                  <a
                    href={c.officialLineUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-md border border-green-400 bg-green-50 px-3 py-2 text-xs font-medium text-green-800"
                  >
                    公式LINEを開く
                  </a>
                ) : null}
                <Link
                  href={`/tasks/${c.taskId}`}
                  className="rounded-md border border-neutral-300 px-3 py-2 text-xs text-neutral-700"
                >
                  タスク詳細を見る
                </Link>
                <form action={recordReminderAction}>
                  <input type="hidden" name="clientId" value={c.clientId} />
                  <input type="hidden" name="taskId" value={c.taskId} />
                  <input type="hidden" name="reminderType" value="client_confirmation" />
                  <button
                    type="submit"
                    className="rounded-md bg-neutral-900 px-3 py-2 text-xs font-medium text-white"
                  >
                    催促済みにする
                  </button>
                </form>
              </div>
            </div>
          ))}
          {sortedConfirmation.length === 0 ? (
            <p className="py-4 text-center text-sm text-neutral-400">対象のタスクはありません。</p>
          ) : null}
        </div>
      </section>
    </main>
  );
}
