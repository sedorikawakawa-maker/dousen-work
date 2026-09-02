import { notFound } from "next/navigation";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { hashMaterialFormToken } from "@/lib/materials/formToken";
import { DriveMockNotice } from "@/components/DriveMockNotice";
import { MaterialUploadForm } from "./MaterialUploadForm";

export default async function MaterialFormPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const admin = createSupabaseAdminClient();
  const tokenHash = hashMaterialFormToken(token);

  const { data: tokenRow } = await admin
    .from("material_form_tokens")
    .select("client_id")
    .eq("token_hash", tokenHash)
    .eq("is_active", true)
    .maybeSingle();

  if (!tokenRow) {
    notFound();
  }

  // 公開フォームからは顧客名のみ取得可能にする（他の詳細情報は一切返さない）
  const { data: client } = await admin
    .from("clients")
    .select("company_name")
    .eq("id", tokenRow.client_id)
    .maybeSingle();

  if (!client) {
    notFound();
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col gap-6 bg-neutral-50 px-4 py-8">
      <div>
        <h1 className="text-xl font-semibold text-neutral-900">素材アップロードフォーム</h1>
        <p className="mt-1 text-sm text-neutral-500">{client.company_name} 様</p>
      </div>

      <DriveMockNotice />
      <MaterialUploadForm token={token} />
    </main>
  );
}
