import Link from "next/link";
import { getCurrentStaff } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { listClients, listActiveStaff } from "@/lib/clients/queries";
import { SubmitButton } from "@/components/SubmitButton";
import { PageContainer } from "@/components/PageContainer";
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
    <PageContainer className="max-w-2xl gap-6 bg-neutral-50 py-6 sm:py-8">
      <div>
        <Link href="/outsourcing" className="text-sm text-neutral-500">
          ← 外注管理に戻る
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-neutral-900">外注依頼作成</h1>
      </div>

      {error ? <p className="rounded-2xl bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p> : null}

      <form method="get" className="rounded-2xl border border-neutral-200 bg-white p-4">
        <label className="text-sm font-medium text-neutral-700">
          顧客（対象タスクを選ぶ場合は先に選択してください）
          <div className="mt-1.5 flex gap-2">
            <select
              name="clientId"
              defaultValue={clientId ?? ""}
              className="flex-1 rounded-xl border border-neutral-300 px-3.5 py-3 text-base"
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
              className="rounded-full border border-neutral-300 px-4 py-2 text-sm text-neutral-700"
            >
              選択
            </button>
          </div>
        </label>
      </form>

      <form
        action={createOutsourcingRequestAction}
        className="flex flex-col gap-5 rounded-2xl border border-neutral-200 bg-white p-5 sm:p-6"
      >
        <input type="hidden" name="clientId" value={clientId ?? ""} />

        <div>
          <h2 className="mb-3 text-xs font-semibold text-neutral-500">依頼内容</h2>
          <div className="flex flex-col gap-4">
            <label className="text-sm font-medium text-neutral-700">
              案件名
              <input
                name="title"
                type="text"
                required
                className="mt-1.5 w-full rounded-xl border border-neutral-300 px-3.5 py-3 text-base"
              />
            </label>

            {clientId ? (
              <label className="text-sm font-medium text-neutral-700">
                対象の制作タスク（任意）
                <select
                  name="productionTaskId"
                  defaultValue=""
                  className="mt-1.5 w-full rounded-xl border border-neutral-300 px-3.5 py-3 text-base"
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
              制作指示
              <textarea
                name="instruction"
                rows={4}
                className="mt-1.5 w-full rounded-xl border border-neutral-300 px-3.5 py-3 text-base"
              />
            </label>

            <label className="text-sm font-medium text-neutral-700">
              素材リンク
              <input
                name="materialLink"
                type="url"
                className="mt-1.5 w-full rounded-xl border border-neutral-300 px-3.5 py-3 text-base"
              />
            </label>
          </div>
        </div>

        <div className="border-t border-neutral-100 pt-5">
          <h2 className="mb-3 text-xs font-semibold text-neutral-500">外注先・納期</h2>
          <div className="flex flex-col gap-4">
            <label className="text-sm font-medium text-neutral-700">
              外注先名
              <input
                name="contractorName"
                type="text"
                required
                className="mt-1.5 w-full rounded-xl border border-neutral-300 px-3.5 py-3 text-base"
              />
            </label>

            <label className="text-sm font-medium text-neutral-700">
              納期
              <input
                name="dueDate"
                type="date"
                className="mt-1.5 w-full rounded-xl border border-neutral-300 px-3.5 py-3 text-base"
              />
            </label>

            <label className="text-sm font-medium text-neutral-700">
              社内担当者
              <select
                name="createdByStaffId"
                defaultValue={staff?.id ?? ""}
                className="mt-1.5 w-full rounded-xl border border-neutral-300 px-3.5 py-3 text-base"
              >
                {staffOptions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.last_name} {s.first_name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        <SubmitButton
          pendingText="作成中..."
          className="mt-1 w-full rounded-full bg-[var(--accent)] px-4 py-4 text-base font-semibold text-white hover:bg-[var(--accent-strong)]"
        >
          作成してアップロードURLを発行
        </SubmitButton>
      </form>
    </PageContainer>
  );
}
