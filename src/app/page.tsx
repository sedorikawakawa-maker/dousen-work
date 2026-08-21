import Link from "next/link";
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getCurrentStaff } from "@/lib/auth/session";
import { canViewFinance, STAFF_ROLE_LABELS } from "@/lib/auth/roles";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { listClients } from "@/lib/clients/queries";
import { getDashboardData } from "@/lib/dashboard/queries";
import {
  ASSIGNMENT_TYPE_LABELS,
  NEXT_ACTION_BY_STATUS,
  PRODUCTION_TASK_STATUS_LABELS,
} from "@/lib/clients/labels";
import { getMaterialWaitElapsedDays } from "@/lib/reminders/material";
import type { Database } from "@/lib/supabase/database.types";
import { logoutAction } from "./logout-action";
import { StatusSelect } from "./StatusSelect";

type ProductionTaskRow = Database["public"]["Tables"]["production_tasks"]["Row"];

export default async function HomePage() {
  const staff = await getCurrentStaff();

  if (!staff) {
    redirect("/login");
  }

  const supabase = await createSupabaseServerClient();
  const [dashboard, allClients] = await Promise.all([
    getDashboardData(supabase, staff.id),
    listClients(supabase),
  ]);

  const clientNameById = new Map(
    allClients.map((c) => [c.id, c.shop_name ? `${c.company_name}（${c.shop_name}）` : c.company_name]),
  );

  const todayLabel = new Date().toLocaleDateString("ja-JP", {
    month: "long",
    day: "numeric",
    weekday: "short",
  });

  // 未割当タスクの全社警告は社長・役員・社員のみに表示する（パートには表示しない）
  const canSeeUnassignedWarning = canViewFinance(staff.role);

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-6 px-4 py-6 sm:py-8">
      <header className="flex items-center justify-between">
        <div>
          <p className="text-sm text-neutral-500">{todayLabel}</p>
          <h1 className="text-xl font-semibold text-neutral-900">
            {staff.last_name} {staff.first_name} さん（{STAFF_ROLE_LABELS[staff.role]}）
          </h1>
        </div>
        <form action={logoutAction}>
          <button
            type="submit"
            className="rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-700"
          >
            ログアウト
          </button>
        </form>
      </header>

      <nav className="flex flex-wrap gap-3">
        <Link
          href="/clients"
          className="rounded-md border border-neutral-300 px-4 py-2 text-sm text-neutral-700"
        >
          顧客一覧
        </Link>
        <Link
          href="/wchecks"
          className="rounded-md border border-neutral-300 px-4 py-2 text-sm text-neutral-700"
        >
          Wチェック待ち
        </Link>
        <Link
          href="/clients/new"
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white"
        >
          ＋ 顧客登録
        </Link>
      </nav>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <AlertSection title="今日締切" count={dashboard.dueTodayTasks.length} tone="urgent">
          <TaskList
            tasks={dashboard.dueTodayTasks}
            clientNameById={clientNameById}
            emptyText="今日締切のタスクはありません。"
          />
        </AlertSection>

        <AlertSection title="Wチェック待ち" count={dashboard.wcheckWaitingItems.length} tone="wcheck">
          <ul className="flex flex-col gap-2 text-sm">
            {dashboard.wcheckWaitingItems.map(({ wcheck, task }) => {
              const isMine = wcheck.reviewer_staff_id === staff.id;
              return (
                <li key={wcheck.id}>
                  <Link href={`/tasks/${task.id}`} className="hover:underline">
                    {clientNameById.get(task.client_id) ?? "不明な顧客"} / {task.title}
                  </Link>
                  {wcheck.reviewer_staff_id ? (
                    <span
                      className={`ml-2 rounded-full px-2 py-0.5 text-xs font-medium ${
                        isMine ? "bg-purple-600 text-white" : "bg-purple-100 text-purple-700"
                      }`}
                    >
                      {isMine ? "あなた指定" : "指定担当あり"}
                    </span>
                  ) : null}
                </li>
              );
            })}
            {dashboard.wcheckWaitingItems.length === 0 ? (
              <li className="text-neutral-400">Wチェック待ちのタスクはありません。</li>
            ) : null}
          </ul>
          <Link href="/wchecks" className="mt-3 inline-block text-xs underline">
            Wチェック待ち一覧を開く →
          </Link>
        </AlertSection>

        <AlertSection title="新着素材" count={dashboard.newMaterials.length} tone="neutral">
          <ul className="flex flex-col gap-2 text-sm">
            {dashboard.newMaterials.map((m) => (
              <li key={m.id}>
                <Link href={`/clients/${m.client_id}?tab=materials`} className="hover:underline">
                  {clientNameById.get(m.client_id) ?? "不明な顧客"} / {m.title}
                </Link>
                <span className="ml-2 text-xs text-neutral-400">
                  {new Date(m.received_at).toLocaleDateString("ja-JP")}
                </span>
              </li>
            ))}
            {dashboard.newMaterials.length === 0 ? (
              <li className="text-neutral-400">新着素材はありません。</li>
            ) : null}
          </ul>
        </AlertSection>

        <AlertSection
          title="素材待ち14日超"
          count={dashboard.materialWaiting14Clients.length}
          tone="urgent"
        >
          <ul className="flex flex-col gap-2 text-sm">
            {dashboard.materialWaiting14Clients.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-2">
                <Link href={`/clients/${c.id}`} className="underline">
                  {c.company_name}
                </Link>
                <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700">
                  {getMaterialWaitElapsedDays(c.material_wait_started_at)}日経過
                </span>
              </li>
            ))}
            {dashboard.materialWaiting14Clients.length === 0 ? (
              <li className="text-neutral-400">該当する顧客はありません。</li>
            ) : null}
          </ul>
        </AlertSection>

        <AlertSection
          title="優先タスク（今やるべきこと）"
          count={dashboard.priorityTasks.length}
          tone="warning"
        >
          <TaskList
            tasks={dashboard.priorityTasks}
            clientNameById={clientNameById}
            emptyText="直近3日以内・期限超過のタスクはありません。"
          />
        </AlertSection>

        {canSeeUnassignedWarning ? (
          <AlertSection
            title="未割当タスクの警告"
            count={dashboard.unassignedTasks.length}
            tone="warning"
          >
            <TaskList
              tasks={dashboard.unassignedTasks}
              clientNameById={clientNameById}
              emptyText="未割当のタスクはありません。"
            />
          </AlertSection>
        ) : null}
      </div>

      <section className="rounded-lg border border-neutral-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-neutral-700">担当顧客一覧（顧客登録順）</h2>

        <div className="flex flex-col gap-3">
          {dashboard.myClients.map((client) => (
            <div
              key={client.id}
              className="flex flex-col gap-3 rounded-md border border-neutral-200 p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-neutral-900">{client.company_name}</span>
                  <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600">
                    {ASSIGNMENT_TYPE_LABELS[client.assignmentType]}
                  </span>
                </div>
                <p className="text-xs text-neutral-500">
                  今月: 通常{client.progress.target}
                  {client.progress.carryover > 0 ? ` + 持越し${client.progress.carryover}` : ""}
                  {" = 必要"}
                  {client.progress.required}本 / 実績{client.progress.actual}本
                </p>
                <p className="text-xs text-neutral-500">
                  次にやること: {NEXT_ACTION_BY_STATUS[client.current_status]}
                </p>
              </div>

              <div className="flex items-center gap-2">
                <StatusSelect clientId={client.id} currentStatus={client.current_status} />
                <Link
                  href={`/clients/${client.id}`}
                  className="whitespace-nowrap rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-700"
                >
                  顧客情報を見る
                </Link>
              </div>
            </div>
          ))}
          {dashboard.myClients.length === 0 ? (
            <p className="py-4 text-center text-sm text-neutral-400">
              担当している顧客はまだありません。
            </p>
          ) : null}
        </div>
      </section>
    </main>
  );
}

function AlertSection({
  title,
  count,
  tone,
  children,
}: {
  title: string;
  count: number;
  tone: "urgent" | "warning" | "wcheck" | "neutral";
  children: ReactNode;
}) {
  const toneClass = {
    urgent: "bg-red-100 text-red-700",
    warning: "bg-yellow-100 text-yellow-800",
    wcheck: "bg-purple-100 text-purple-700",
    neutral: "bg-neutral-100 text-neutral-600",
  }[tone];

  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-neutral-700">{title}</h2>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${toneClass}`}>
          {count}
        </span>
      </div>
      {children}
    </section>
  );
}

function TaskList({
  tasks,
  clientNameById,
  emptyText,
}: {
  tasks: ProductionTaskRow[];
  clientNameById: Map<string, string>;
  emptyText: string;
}) {
  return (
    <ul className="flex flex-col gap-2 text-sm">
      {tasks.map((task) => (
        <li key={task.id}>
          <Link href={`/tasks/${task.id}`} className="hover:underline">
            {clientNameById.get(task.client_id) ?? "不明な顧客"} / {task.title}
          </Link>
          <span className="ml-2 text-xs text-neutral-400">
            {PRODUCTION_TASK_STATUS_LABELS[task.status]}
          </span>
          {!task.assignee_staff_id ? (
            <span className="ml-2 rounded-full bg-yellow-100 px-2 py-0.5 text-xs text-yellow-800">
              未割当
            </span>
          ) : null}
        </li>
      ))}
      {tasks.length === 0 ? <li className="text-neutral-400">{emptyText}</li> : null}
    </ul>
  );
}
