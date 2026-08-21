import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { listActiveStaff } from "@/lib/clients/queries";
import { RegisterClientForm } from "./RegisterClientForm";

export default async function NewClientPage() {
  const supabase = await createSupabaseServerClient();
  const staffOptions = await listActiveStaff(supabase);

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-4 py-8">
      <div>
        <Link href="/clients" className="text-sm text-neutral-500">
          ← 顧客一覧に戻る
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-neutral-900">顧客登録</h1>
      </div>

      <div className="rounded-lg border border-neutral-200 bg-white p-6">
        <RegisterClientForm staffOptions={staffOptions} />
      </div>
    </main>
  );
}
