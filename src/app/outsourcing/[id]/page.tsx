import Link from "next/link";
import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { listActiveStaff, listClients } from "@/lib/clients/queries";
import { getOutsourcingRequest, listOutsourcingDeliveries } from "@/lib/outsourcing/queries";
import { OUTSOURCING_STATUS_LABELS } from "@/lib/outsourcing/labels";
import { buildOutsourcingUploadUrl } from "@/lib/outsourcing/token";
import { CopyButton } from "@/components/CopyButton";
import {
  cancelOutsourcingRequestAction,
  markOutsourcingCompletedAction,
  reissueOutsourcingTokenAction,
} from "../actions";

export default async function OutsourcingDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ newToken?: string; saved?: string; error?: string }>;
}) {
  const { id } = await params;
  const { newToken, saved, error } = await searchParams;

  const supabase = await createSupabaseServerClient();
  const request = await getOutsourcingRequest(supabase, id);

  if (!request) {
    notFound();
  }

  const [deliveries, clients, staffOptions] = await Promise.all([
    listOutsourcingDeliveries(supabase, id),
    listClients(supabase),
    listActiveStaff(supabase),
  ]);

  let task: { id: string; title: string; post_type: string } | null = null;
  if (request.production_task_id) {
    const { data } = await supabase
      .from("production_tasks")
      .select("id, title, post_type")
      .eq("id", request.production_task_id)
      .maybeSingle();
    task = data;
  }

  const clientNameById = new Map(
    clients.map((c) => [c.id, c.shop_name ? `${c.company_name}（${c.shop_name}）` : c.company_name]),
  );
  const staffNameById = new Map(staffOptions.map((s) => [s.id, `${s.last_name} ${s.first_name}`]));

  const newlyIssuedUrl = newToken ? await buildOutsourcingUploadUrl(newToken) : null;
  const latestDelivery = deliveries[0] ?? null;

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-4 py-6 sm:py-8">
      <div>
        <Link href="/outsourcing" className="text-sm text-neutral-500">
          ← 外注管理に戻る
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-neutral-900">{request.title}</h1>
        <span className="mt-1 inline-block rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600">
          {OUTSOURCING_STATUS_LABELS[request.status]}
        </span>
      </div>

      {saved ? (
        <p className="rounded-md bg-green-50 px-4 py-2 text-sm text-green-700">更新しました。</p>
      ) : null}
      {error ? (
        <p className="rounded-md bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p>
      ) : null}

      <section className="rounded-lg border border-neutral-200 bg-white p-6">
        <dl className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <dt className="text-xs text-neutral-400">顧客</dt>
            <dd className="text-neutral-900">
              {request.client_id ? clientNameById.get(request.client_id) ?? "不明な顧客" : "未設定"}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-neutral-400">対象タスク</dt>
            <dd className="text-neutral-900">
              {task ? (
                <Link href={`/tasks/${task.id}`} className="underline">
                  {task.title}
                </Link>
              ) : (
                "紐づけなし"
              )}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-neutral-400">外注先</dt>
            <dd className="text-neutral-900">{request.contractor_name}</dd>
          </div>
          <div>
            <dt className="text-xs text-neutral-400">社内担当者</dt>
            <dd className="text-neutral-900">
              {staffNameById.get(request.created_by_staff_id) ?? "不明"}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-neutral-400">依頼日</dt>
            <dd className="text-neutral-900">
              {new Date(request.requested_at).toLocaleDateString("ja-JP")}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-neutral-400">納期</dt>
            <dd className="text-neutral-900">{request.due_date ?? "未設定"}</dd>
          </div>
        </dl>
        {request.instruction ? (
          <p className="mt-3 whitespace-pre-wrap text-sm text-neutral-700">
            制作指示: {request.instruction}
          </p>
        ) : null}
        {request.material_link ? (
          <a
            href={request.material_link}
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-block text-sm underline"
          >
            素材リンクを開く
          </a>
        ) : null}
      </section>

      <section className="rounded-lg border border-neutral-200 bg-white p-6">
        <h2 className="mb-3 text-sm font-semibold text-neutral-700">外注アップロードURL</h2>
        {newlyIssuedUrl ? (
          <div className="mb-3 flex flex-col gap-2 rounded-md bg-yellow-50 px-3 py-2">
            <p className="text-xs text-yellow-800">
              発行しました。このURLは今だけ表示されます。必ずコピーして外注先へ共有してください。
            </p>
            <div className="flex items-center gap-2">
              <span className="flex-1 truncate font-mono text-xs">{newlyIssuedUrl}</span>
              <CopyButton text={newlyIssuedUrl} />
            </div>
          </div>
        ) : (
          <p className="mb-3 text-xs text-neutral-500">
            URLは発行・再発行の直後のみ表示されます。
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <form action={reissueOutsourcingTokenAction}>
            <input type="hidden" name="requestId" value={id} />
            <button
              type="submit"
              className="rounded-md border border-neutral-300 px-3 py-2 text-xs text-neutral-700"
            >
              URLを再発行
            </button>
          </form>
          {request.status !== "cancelled" ? (
            <form action={cancelOutsourcingRequestAction}>
              <input type="hidden" name="requestId" value={id} />
              <button
                type="submit"
                className="rounded-md border border-red-300 px-3 py-2 text-xs text-red-700"
              >
                無効化する（中止）
              </button>
            </form>
          ) : null}
        </div>
      </section>

      <section className="rounded-lg border border-neutral-200 bg-white p-6">
        <h2 className="mb-3 text-sm font-semibold text-neutral-700">納品</h2>
        {deliveries.length === 0 ? (
          <p className="text-sm text-neutral-400">まだ納品されていません。</p>
        ) : (
          <ul className="flex flex-col gap-3 text-sm">
            {deliveries.map((d) => (
              <li key={d.id} className="rounded-md border border-neutral-200 px-3 py-2">
                <p className="text-xs text-neutral-400">
                  {new Date(d.delivered_at).toLocaleString("ja-JP")}
                </p>
                {d.drive_url ? (
                  <a
                    href={d.drive_url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 inline-block rounded-md border border-neutral-300 px-4 py-3 text-center text-sm font-medium text-neutral-700"
                  >
                    制作物を開く
                  </a>
                ) : null}
                {d.contractor_note ? (
                  <p className="mt-1 text-xs text-neutral-600">外注メモ: {d.contractor_note}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        {request.status === "delivered" ? (
          <form action={markOutsourcingCompletedAction} className="mt-4">
            <input type="hidden" name="requestId" value={id} />
            <button
              type="submit"
              className="w-full rounded-md bg-green-600 px-4 py-3 text-sm font-medium text-white"
            >
              納品確認済みにする
            </button>
          </form>
        ) : null}

        {task && latestDelivery?.drive_url && request.status !== "requested" ? (
          <Link
            href={`/tasks/${task.id}?assetUrl=${encodeURIComponent(latestDelivery.drive_url)}`}
            className="mt-2 block w-full rounded-md bg-purple-600 px-4 py-3 text-center text-sm font-medium text-white"
          >
            Wチェック登録へ進む
          </Link>
        ) : null}
      </section>
    </main>
  );
}
