import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { listClients } from "@/lib/clients/queries";
import {
  CONTRACT_STATUS_LABELS,
  CLIENT_CURRENT_STATUS_LABELS,
} from "@/lib/clients/labels";

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const supabase = await createSupabaseServerClient();
  const clients = await listClients(supabase, q);

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-6 px-4 py-8">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-neutral-900">顧客一覧</h1>
        <Link
          href="/clients/new"
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white"
        >
          ＋ 顧客登録
        </Link>
      </header>

      <form method="get" className="flex gap-2">
        <input
          type="text"
          name="q"
          defaultValue={q ?? ""}
          placeholder="顧客名・店舗名・顧客IDで検索"
          className="flex-1 rounded-md border border-neutral-300 px-3 py-2 text-base"
        />
        <button
          type="submit"
          className="rounded-md border border-neutral-300 px-4 py-2 text-sm text-neutral-700"
        >
          検索
        </button>
      </form>

      {clients.length === 0 ? (
        <p className="rounded-lg border border-neutral-200 bg-white py-6 text-center text-sm text-neutral-400">
          該当する顧客がありません。検索条件を変えてお試しください。
        </p>
      ) : (
        <>
          {/* PC: テーブル表示 */}
          <div className="hidden overflow-x-auto rounded-lg border border-neutral-200 bg-white md:block">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead>
                <tr className="border-b border-neutral-200 text-neutral-500">
                  <th className="px-4 py-2">顧客ID</th>
                  <th className="px-4 py-2">顧客名</th>
                  <th className="px-4 py-2">店舗名</th>
                  <th className="px-4 py-2">契約状況</th>
                  <th className="px-4 py-2">現在ステータス</th>
                </tr>
              </thead>
              <tbody>
                {clients.map((client) => (
                  <tr key={client.id} className="border-b border-neutral-100 hover:bg-neutral-50">
                    <td className="px-4 py-2">
                      <Link href={`/clients/${client.id}`} className="text-neutral-900 underline">
                        {client.client_code}
                      </Link>
                    </td>
                    <td className="px-4 py-2">{client.company_name}</td>
                    <td className="px-4 py-2">{client.shop_name ?? "—"}</td>
                    <td className="px-4 py-2">{CONTRACT_STATUS_LABELS[client.contract_status]}</td>
                    <td className="px-4 py-2">{CLIENT_CURRENT_STATUS_LABELS[client.current_status]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* スマホ: カード表示 */}
          <div className="flex flex-col gap-2 md:hidden">
            {clients.map((client) => (
              <Link
                key={client.id}
                href={`/clients/${client.id}`}
                className="flex flex-col gap-1 rounded-lg border border-neutral-200 bg-white p-4"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-neutral-900">{client.company_name}</span>
                  <span className="text-xs text-neutral-400">{client.client_code}</span>
                </div>
                {client.shop_name ? (
                  <p className="text-xs text-neutral-500">{client.shop_name}</p>
                ) : null}
                <div className="flex flex-wrap gap-2 text-xs text-neutral-600">
                  <span className="rounded-full bg-neutral-100 px-2 py-0.5">
                    {CONTRACT_STATUS_LABELS[client.contract_status]}
                  </span>
                  <span className="rounded-full bg-neutral-100 px-2 py-0.5">
                    {CLIENT_CURRENT_STATUS_LABELS[client.current_status]}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </>
      )}
    </main>
  );
}
