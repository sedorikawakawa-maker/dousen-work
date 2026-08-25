import Link from "next/link";
import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { listActiveStaff, listClients } from "@/lib/clients/queries";
import { getInternalTask } from "@/lib/internalTasks/queries";
import {
  INTERNAL_TASK_PRIORITY_OPTIONS,
  INTERNAL_TASK_STATUS_OPTIONS,
} from "@/lib/internalTasks/labels";
import { updateInternalTaskAction } from "../../actions";
import { PageContainer } from "@/components/PageContainer";

export default async function EditInternalTaskPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error } = await searchParams;

  const supabase = await createSupabaseServerClient();
  const [task, staffOptions, clients] = await Promise.all([
    getInternalTask(supabase, id),
    listActiveStaff(supabase),
    listClients(supabase),
  ]);

  if (!task) {
    notFound();
  }

  return (
    <PageContainer className="max-w-xl gap-6 bg-neutral-50 py-6 sm:py-8">
      <div>
        <Link href="/internal-tasks" className="text-sm text-neutral-500">
          ← 社内タスクに戻る
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-neutral-900">社内タスク編集</h1>
      </div>

      {error ? <p className="rounded-2xl bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p> : null}

      <form
        action={updateInternalTaskAction}
        className="flex flex-col gap-4 rounded-2xl border border-neutral-200 bg-white p-5 sm:p-6"
      >
        <input type="hidden" name="taskId" value={id} />

        <label className="text-sm font-medium text-neutral-700">
          顧客（任意）
          <select
            name="clientId"
            defaultValue={task.client_id ?? ""}
            className="mt-1.5 w-full rounded-xl border border-neutral-300 px-3.5 py-3 text-base"
          >
            <option value="">社内タスク（顧客紐づきなし）</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.company_name}
                {c.shop_name ? `（${c.shop_name}）` : ""}
              </option>
            ))}
          </select>
        </label>

        <label className="text-sm font-medium text-neutral-700">
          担当者
          <select
            name="assigneeStaffId"
            defaultValue={task.assignee_staff_id}
            className="mt-1.5 w-full rounded-xl border border-neutral-300 px-3.5 py-3 text-base"
          >
            {staffOptions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.last_name} {s.first_name}
              </option>
            ))}
          </select>
        </label>

        <label className="text-sm font-medium text-neutral-700">
          カテゴリ
          <input
            name="category"
            type="text"
            required
            defaultValue={task.category}
            className="mt-1.5 w-full rounded-xl border border-neutral-300 px-3.5 py-3 text-base"
          />
        </label>

        <label className="text-sm font-medium text-neutral-700">
          タイトル
          <input
            name="title"
            type="text"
            required
            defaultValue={task.title}
            className="mt-1.5 w-full rounded-xl border border-neutral-300 px-3.5 py-3 text-base"
          />
        </label>

        <label className="text-sm font-medium text-neutral-700">
          詳細
          <textarea
            name="description"
            rows={4}
            defaultValue={task.description ?? ""}
            className="mt-1.5 w-full rounded-xl border border-neutral-300 px-3.5 py-3 text-base"
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm font-medium text-neutral-700">
            優先度
            <select
              name="priority"
              defaultValue={task.priority}
              className="mt-1.5 w-full rounded-xl border border-neutral-300 px-3.5 py-3 text-base"
            >
              {INTERNAL_TASK_PRIORITY_OPTIONS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm font-medium text-neutral-700">
            状態
            <select
              name="status"
              defaultValue={task.status}
              className="mt-1.5 w-full rounded-xl border border-neutral-300 px-3.5 py-3 text-base"
            >
              {INTERNAL_TASK_STATUS_OPTIONS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="text-sm font-medium text-neutral-700">
          期限
          <input
            name="dueAt"
            type="date"
            defaultValue={task.due_at ? task.due_at.slice(0, 10) : ""}
            className="mt-1.5 w-full rounded-xl border border-neutral-300 px-3.5 py-3 text-base"
          />
        </label>

        <label className="text-sm font-medium text-neutral-700">
          添付URL
          <input
            name="attachmentUrl"
            type="url"
            defaultValue={task.attachment_url ?? ""}
            className="mt-1.5 w-full rounded-xl border border-neutral-300 px-3.5 py-3 text-base"
          />
        </label>

        <button
          type="submit"
          className="mt-2 w-full rounded-full bg-[var(--accent)] px-4 py-4 text-base font-semibold text-white hover:bg-[var(--accent-strong)]"
        >
          保存する
        </button>
      </form>
    </PageContainer>
  );
}
