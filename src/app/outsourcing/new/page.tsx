import Link from "next/link";
import { getCurrentStaff } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { listClients, listActiveStaff } from "@/lib/clients/queries";
import { createOutsourcingRequestAction } from "../actions";

export default async function NewOutsourcingRequestPage({
  searchParams,
}: {
  searchParams: Promise<{ clientId?: string; error?: string }>;
}) {
  const { clientId, error } = await searchParams;

  const staff = await getCurrentStaff();
  const supabase = await createSupabaseServerClient();

  const [clients, staffOptions] = await Promise.all([listClients(supabase), listActiveStaff(supabase)]);

  let candidateTasks: { id: string; title: string; post_type: string; scheduled_post_date: string | null }[] = [];
  if (clientId) {
    const { data } = await supabase
      .from("production_tasks")
      .select("id, title, post_type, scheduled_post_date")
      .eq("client_id", clientId)
      .neq("status", "completed")
      .order("scheduled_post_date", { ascending: true, nullsFirst: false });
    candidateTasks = data ?? [];
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col gap-6 px-4 py-6 sm:py-8">
      <div>
        <Link href="/outsourcing" className="text-sm text-neutral-500">
          ← 外注管理に戻る
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-neutral-900">外注依頼作成</h1>
      </div>

      {error ? (
        <p className="rounded-md bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p>
      ) : null}

      <form method="get" className="rounded-lg border border-neutral-200 bg-white p-4">
        <label className="text-sm font-medium text-neutral-700">
          顧客（対象タスクを選ぶ場合は先に選択してください）
          <div className="mt-1 flex gap-2">
            <select
              name="clientId"
              defaultValue={clientId ?? ""}
              className="flex-1 rounded-md border border-neutral-300 px-3 py-3 text-base"
            >
              <option value="">顧客未設定で進める</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.company_name}
                  {c.shop_name ? `（${c.shop_name}）` : ""}
                </option>
              ))}
            </select>
            <button
              type="submit"
              className="rounded-md border border-neutral-300 px-4 py-2 text-sm text-neutral-700"
            >
              選択
            </button>
          </div>
        </label>
      </form>

      <form
        action={createOutsourcingRequestAction}
        className="flex flex-col gap-4 rounded-lg border border-neutral-200 bg-white p-4"
      >
        <input type="hidden" name="clientId" value={clientId ?? ""} />

        {clientId ? (
          <label className="text-sm font-medium text-neutral-700">
            対象の制作タスク（任意）
            <select
              name="productionTaskId"
              defaultValue=""
              className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-3 text-base"
            >
              <option value="">紐づけない</option>
              {candidateTasks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.scheduled_post_date ?? "予定日未定"} ・ {t.title}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <label className="text-sm font-medium text-neutral-700">
          案件名
          <input
            name="title"
            type="text"
            required
            className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-3 text-base"
          />
        </label>

        <label className="text-sm font-medium text-neutral-700">
          外注先名
          <input
            name="contractorName"
            type="text"
            required
            className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-3 text-base"
          />
        </label>

        <label className="text-sm font-medium text-neutral-700">
          制作指示
          <textarea
            name="instruction"
            rows={4}
            className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-3 text-base"
          />
        </label>

        <label className="text-sm font-medium text-neutral-700">
          素材リンク
          <input
            name="materialLink"
            type="url"
            className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-3 text-base"
          />
        </label>

        <label className="text-sm font-medium text-neutral-700">
          納期
          <input
            name="dueDate"
            type="date"
            className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-3 text-base"
          />
        </label>

        <label className="text-sm font-medium text-neutral-700">
          社内担当者
          <select
            name="createdByStaffId"
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

        <button
          type="submit"
          className="mt-2 w-full rounded-md bg-neutral-900 px-4 py-4 text-base font-medium text-white"
        >
          作成してアップロードURLを発行
        </button>
      </form>
    </main>
  );
}
