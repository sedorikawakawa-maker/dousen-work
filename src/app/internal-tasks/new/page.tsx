import Link from "next/link";
import { getCurrentStaff } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { listActiveStaff, listClients } from "@/lib/clients/queries";
import { INTERNAL_TASK_PRIORITY_OPTIONS } from "@/lib/internalTasks/labels";
import { createInternalTaskAction } from "../actions";

export default async function NewInternalTaskPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  const staff = await getCurrentStaff();
  const supabase = await createSupabaseServerClient();
  const [staffOptions, clients] = await Promise.all([listActiveStaff(supabase), listClients(supabase)]);

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col gap-6 px-4 py-6 sm:py-8">
      <div>
        <Link href="/internal-tasks" className="text-sm text-neutral-500">
          ← 社内タスクに戻る
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-neutral-900">社内タスク作成</h1>
      </div>

      {error ? (
        <p className="rounded-md bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p>
      ) : null}

      <form
        action={createInternalTaskAction}
        className="flex flex-col gap-4 rounded-lg border border-neutral-200 bg-white p-4"
      >
        <label className="text-sm font-medium text-neutral-700">
          顧客（任意）
          <select
            name="clientId"
            defaultValue=""
            className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-3 text-base"
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
            defaultValue={staff?.id ?? ""}
            className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-3 text-base"
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
            placeholder="例: 提案資料、議事録、顧客対応"
            className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-3 text-base"
          />
        </label>

        <label className="text-sm font-medium text-neutral-700">
          タイトル
          <input
            name="title"
            type="text"
            required
            className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-3 text-base"
          />
        </label>

        <label className="text-sm font-medium text-neutral-700">
          詳細
          <textarea
            name="description"
            rows={4}
            className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-3 text-base"
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm font-medium text-neutral-700">
            優先度
            <select
              name="priority"
              defaultValue="B"
              className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-3 text-base"
            >
              {INTERNAL_TASK_PRIORITY_OPTIONS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm font-medium text-neutral-700">
            期限
            <input
              name="dueAt"
              type="date"
              className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-3 text-base"
            />
          </label>
        </div>

        <label className="text-sm font-medium text-neutral-700">
          添付URL
          <input
            name="attachmentUrl"
            type="url"
            className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-3 text-base"
          />
        </label>

        <button
          type="submit"
          className="mt-2 w-full rounded-md bg-neutral-900 px-4 py-4 text-base font-medium text-white"
        >
          作成する
        </button>
      </form>
    </main>
  );
}
