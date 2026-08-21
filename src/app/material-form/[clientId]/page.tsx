import { notFound } from "next/navigation";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { submitClientMaterialAction } from "./actions";

export default async function MaterialFormPage({
  params,
  searchParams,
}: {
  params: Promise<{ clientId: string }>;
  searchParams: Promise<{ submitted?: string; error?: string }>;
}) {
  const { clientId } = await params;
  const { submitted, error } = await searchParams;

  const admin = createSupabaseAdminClient();
  const { data: client } = await admin
    .from("clients")
    .select("id, company_name, shop_name")
    .eq("id", clientId)
    .maybeSingle();

  if (!client) {
    notFound();
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col gap-6 px-4 py-8">
      <div>
        <h1 className="text-xl font-semibold text-neutral-900">素材アップロードフォーム</h1>
        <p className="mt-1 text-sm text-neutral-500">
          {client.company_name}
          {client.shop_name ? `（${client.shop_name}）` : ""} 様
        </p>
      </div>

      {submitted ? (
        <p className="rounded-md bg-green-50 px-4 py-3 text-sm text-green-700">
          送信しました。ご協力ありがとうございます。
        </p>
      ) : (
        <div className="rounded-lg border border-neutral-200 bg-white p-6">
          {error ? (
            <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
          ) : null}

          <form action={submitClientMaterialAction} className="flex flex-col gap-4">
            <input type="hidden" name="clientId" value={clientId} />

            <Field label="素材の内容（タイトル）" name="title" required />
            <Field label="投稿用途（リール/フィード/ストーリーズなど）" name="postUsage" />
            <Field label="投稿希望時期" name="requestedPostTiming" />
            <label className="text-sm font-medium text-neutral-700">
              編集指示
              <textarea
                name="editingInstructions"
                rows={3}
                className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-base"
              />
            </label>
            <label className="text-sm font-medium text-neutral-700">
              キャプション指定
              <textarea
                name="captionInstructions"
                rows={2}
                className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-base"
              />
            </label>
            <label className="text-sm font-medium text-neutral-700">
              その他連絡事項
              <textarea
                name="contactNotes"
                rows={2}
                className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-base"
              />
            </label>
            <Field label="撮影日" name="shotDate" type="date" />

            <label className="text-sm font-medium text-neutral-700">
              ファイル（任意。大きな動画等は別途Google Driveでの共有も可能です）
              <input
                name="file"
                type="file"
                accept="image/*,video/*"
                className="mt-1 w-full text-sm"
              />
            </label>

            <button
              type="submit"
              className="mt-2 w-full rounded-md bg-neutral-900 px-4 py-2 text-base font-medium text-white"
            >
              送信する
            </button>
          </form>
        </div>
      )}
    </main>
  );
}

function Field({
  label,
  name,
  type = "text",
  required = false,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
}) {
  return (
    <label className="text-sm font-medium text-neutral-700">
      {label}
      <input
        name={name}
        type={type}
        required={required}
        className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-base"
      />
    </label>
  );
}
