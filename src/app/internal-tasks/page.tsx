import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentStaff } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { listActiveStaff, listClients } from "@/lib/clients/queries";
import { listDistinctCategories, listInternalTasks } from "@/lib/internalTasks/queries";
import {
  INTERNAL_TASK_NEXT_STATUS,
  INTERNAL_TASK_NEXT_STATUS_LABEL,
  INTERNAL_TASK_PRIORITY_LABELS,
  INTERNAL_TASK_PRIORITY_OPTIONS,
  INTERNAL_TASK_STATUS_LABELS,
  INTERNAL_TASK_STATUS_OPTIONS,
} from "@/lib/internalTasks/labels";
import type {
  InternalTaskPriority,
  InternalTaskStatus,
} from "@/lib/supabase/database.types";
import { updateInternalTaskStatusAction } from "./actions";

export default async function InternalTasksPage({
  searchParams,
}: {
  searchParams: Promise<{
    scope?: string;
    assignee?: string;
    category?: string;
    status?: string;
    priority?: string;
    saved?: string;
    error?: string;
  }>;
}) {
  const { scope, assignee, category, status, priority, saved, error } = await searchParams;

  const staff = await getCurrentStaff();
  if (!staff) {
    redirect("/login");
  }

  const resolvedScope = scope === "all" ? "all" : "mine";

  const supabase = await createSupabaseServerClient();
  const [tasks, staffOptions, categories, clients] = await Promise.all([
    listInternalTasks(supabase, {
      scope: resolvedScope,
      currentStaffId: staff.id,
      assigneeStaffId: assignee || undefined,
      category: category || undefined,
      status: (status as InternalTaskStatus) || undefined,
      priority: (priority as InternalTaskPriority) || undefined,
    }),
    listActiveStaff(supabase),
    listDistinctCategories(supabase),
    listClients(supabase),
  ]);

  const staffNameById = new Map(staffOptions.map((s) => [s.id, `${s.last_name} ${s.first_name}`]));
  const clientNameById = new Map(
    clients.map((c) => [c.id, c.shop_name ? `${c.company_name}（${c.shop_name}）` : c.company_name]),
  );
  const today = new Date().toISOString().slice(0, 10);

  function buildFilterUrl(overrides: Record<string, string>) {
    const params = new URLSearchParams({
      scope: resolvedScope,
      ...(assignee ? { assignee } : {}),
      ...(category ? { category } : {}),
      ...(status ? { status } : {}),
      ...(priority ? { priority } : {}),
      ...overrides,
    });
    return `/internal-tasks?${params.toString()}`;
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-6 px-4 py-6 sm:py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-neutral-900">社内タスク</h1>
        <Link
          href="/internal-tasks/new"
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white"
        >
          ＋ 新規作成
        </Link>
      </div>

      {saved ? (
        <p className="rounded-md bg-green-50 px-4 py-2 text-sm text-green-700">更新しました。</p>
      ) : null}
      {error ? (
        <p className="rounded-md bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p>
      ) : null}

      <div className="flex flex-wrap gap-2 text-sm">
        <Link
          href={buildFilterUrl({ scope: "mine" })}
          className={`rounded-md px-3 py-1.5 ${
            resolvedScope === "mine" ? "bg-neutral-900 text-white" : "border border-neutral-300 text-neutral-700"
          }`}
        >
          自分のタスク
        </Link>
        <Link
          href={buildFilterUrl({ scope: "all" })}
          className={`rounded-md px-3 py-1.5 ${
            resolvedScope === "all" ? "bg-neutral-900 text-white" : "border border-neutral-300 text-neutral-700"
          }`}
        >
          全員
        </Link>
      </div>

      <form method="get" className="flex flex-wrap gap-2">
        <input type="hidden" name="scope" value={resolvedScope} />
        <select
          name="assignee"
          defaultValue={assignee ?? ""}
          className="rounded-md border border-neutral-300 px-2 py-2 text-sm"
        >
          <option value="">担当者: すべて</option>
          {staffOptions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.last_name} {s.first_name}
            </option>
          ))}
        </select>
        <select
          name="category"
          defaultValue={category ?? ""}
          className="rounded-md border border-neutral-300 px-2 py-2 text-sm"
        >
          <option value="">カテゴリ: すべて</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select
          name="status"
          defaultValue={status ?? ""}
          className="rounded-md border border-neutral-300 px-2 py-2 text-sm"
        >
          <option value="">状態: すべて</option>
          {INTERNAL_TASK_STATUS_OPTIONS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select
          name="priority"
          defaultValue={priority ?? ""}
          className="rounded-md border border-neutral-300 px-2 py-2 text-sm"
        >
          <option value="">優先度: すべて</option>
          {INTERNAL_TASK_PRIORITY_OPTIONS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-700"
        >
          絞り込む
        </button>
      </form>

      <div className="flex flex-col gap-2">
        {tasks.map((task) => {
          const dueDate = task.due_at ? task.due_at.slice(0, 10) : null;
          const isOverdue = dueDate && dueDate < today && task.status !== "done";
          const isDueToday = dueDate === today && task.status !== "done";
          const nextStatus = INTERNAL_TASK_NEXT_STATUS[task.status];

          return (
            <div
              key={task.id}
              className={`flex flex-col gap-2 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between ${
                isOverdue
                  ? "border-red-300 bg-red-50/40"
                  : isDueToday
                    ? "border-yellow-300 bg-yellow-50/40"
                    : "border-neutral-200 bg-white"
              }`}
            >
              <div className="flex flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={`/internal-tasks/${task.id}/edit`}
                    className="font-medium text-neutral-900 hover:underline"
                  >
                    {task.title}
                  </Link>
                  <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600">
                    {task.category}
                  </span>
                  <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600">
                    {INTERNAL_TASK_PRIORITY_LABELS[task.priority]}
                  </span>
                  <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600">
                    {INTERNAL_TASK_STATUS_LABELS[task.status]}
                  </span>
                  {isOverdue ? (
                    <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700">
                      期限超過
                    </span>
                  ) : isDueToday ? (
                    <span className="rounded-full bg-yellow-100 px-2 py-0.5 text-xs text-yellow-800">
                      今日締切
                    </span>
                  ) : null}
                </div>
                <p className="text-xs text-neutral-500">
                  担当: {staffNameById.get(task.assignee_staff_id) ?? "不明"} ／{" "}
                  {task.client_id ? clientNameById.get(task.client_id) ?? "不明な顧客" : "社内"} ／ 期限:{" "}
                  {dueDate ?? "未設定"}
                </p>
              </div>

              {nextStatus ? (
                <form action={updateInternalTaskStatusAction}>
                  <input type="hidden" name="taskId" value={task.id} />
                  <input type="hidden" name="nextStatus" value={nextStatus} />
                  <input type="hidden" name="returnTo" value={buildFilterUrl({})} />
                  <button
                    type="submit"
                    className="whitespace-nowrap rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-700"
                  >
                    {INTERNAL_TASK_NEXT_STATUS_LABEL[task.status]}
                  </button>
                </form>
              ) : null}
            </div>
          );
        })}
        {tasks.length === 0 ? (
          <p className="py-6 text-center text-sm text-neutral-400">該当するタスクはありません。</p>
        ) : null}
      </div>
    </main>
  );
}
