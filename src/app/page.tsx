import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentStaff } from "@/lib/auth/session";
import { canViewFinance, STAFF_ROLE_LABELS } from "@/lib/auth/roles";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { listClients } from "@/lib/clients/queries";
import { CLIENT_CURRENT_STATUS_LABELS } from "@/lib/clients/labels";
import { logoutAction } from "./logout-action";

export default async function HomePage() {
  const staff = await getCurrentStaff();

  if (!staff) {
    redirect("/login");
  }

  const supabase = await createSupabaseServerClient();
  const clients = await listClients(supabase);
  const financeVisible = canViewFinance(staff.role);

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 px-4 py-8">
      <header className="flex items-center justify-between">
        <div>
          <p className="text-sm text-neutral-500">ようこそ</p>
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

      <nav className="flex gap-3">
        <Link
          href="/clients"
          className="rounded-md border border-neutral-300 px-4 py-2 text-sm text-neutral-700"
        >
          顧客一覧
        </Link>
        <Link
          href="/clients/new"
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white"
        >
          ＋ 顧客登録
        </Link>
      </nav>

      <section className="rounded-lg border border-neutral-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-neutral-700">最近の顧客</h2>
        {financeVisible ? (
          <p className="mb-3 text-xs text-neutral-500">料金・売上を閲覧できる権限です。</p>
        ) : (
          <p className="mb-3 text-xs text-neutral-500">
            パート権限のため料金・売上は表示されません。
          </p>
        )}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] text-left text-sm">
            <thead>
              <tr className="border-b border-neutral-200 text-neutral-500">
                <th className="py-2 pr-4">顧客ID</th>
                <th className="py-2 pr-4">顧客名</th>
                <th className="py-2 pr-4">状態</th>
              </tr>
            </thead>
            <tbody>
              {clients.slice(0, 10).map((client) => (
                <tr key={client.id} className="border-b border-neutral-100">
                  <td className="py-2 pr-4">
                    <Link href={`/clients/${client.id}`} className="underline">
                      {client.client_code}
                    </Link>
                  </td>
                  <td className="py-2 pr-4">{client.company_name}</td>
                  <td className="py-2 pr-4">
                    {CLIENT_CURRENT_STATUS_LABELS[client.current_status]}
                  </td>
                </tr>
              ))}
              {clients.length === 0 ? (
                <tr>
                  <td colSpan={3} className="py-4 text-center text-neutral-400">
                    顧客データがありません
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
