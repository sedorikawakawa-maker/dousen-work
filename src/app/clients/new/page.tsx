import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { listActiveStaff } from "@/lib/clients/queries";
import { PageContainer } from "@/components/PageContainer";
import { RegisterClientForm } from "./RegisterClientForm";

export default async function NewClientPage() {
  const supabase = await createSupabaseServerClient();
  const staffOptions = await listActiveStaff(supabase);

  return (
    <PageContainer className="max-w-2xl gap-6 bg-neutral-50 py-8">
      <div>
        <Link href="/clients" className="text-sm text-neutral-500">
          ← 顧客一覧に戻る
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-neutral-900">顧客登録</h1>
      </div>

      <div className="rounded-2xl border border-neutral-200 bg-white p-5 sm:p-6">
        <RegisterClientForm staffOptions={staffOptions} />
      </div>
    </PageContainer>
  );
}
