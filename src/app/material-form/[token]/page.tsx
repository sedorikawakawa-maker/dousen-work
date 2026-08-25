import { notFound } from "next/navigation";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { hashMaterialFormToken } from "@/lib/materials/formToken";
import { DriveMockNotice } from "@/components/DriveMockNotice";
import { SubmitButton } from "@/components/SubmitButton";
import { POST_TYPE_OPTIONS, REQUESTED_POST_TIMING_OPTIONS } from "@/lib/clients/labels";
import { submitClientMaterialAction } from "./actions";

export default async function MaterialFormPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ submitted?: string; error?: string }>;
}) {
  const { token } = await params;
  const { submitted, error } = await searchParams;

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

      {submitted ? (
        <p className="rounded-2xl bg-[var(--accent-soft-bg)] px-4 py-3.5 text-sm text-[var(--accent-soft-text)]">
          送信しました。ご協力ありがとうございます。
        </p>
      ) : (
        <div className="rounded-2xl border border-neutral-200 bg-white p-5 sm:p-6">
          {error ? <p className="mb-4 rounded-2xl bg-red-50 px-3.5 py-2.5 text-sm text-red-700">{error}</p> : null}

          <form action={submitClientMaterialAction} className="flex flex-col gap-4">
            <input type="hidden" name="token" value={token} />

            <Field label="素材の内容（タイトル）" name="title" required />

            <label className="text-sm font-medium text-neutral-700">
              投稿用途
              <select
                name="postUsage"
                defaultValue=""
                className="mt-1.5 w-full rounded-xl border border-neutral-300 px-3.5 py-3 text-base"
              >
                <option value="">選択しない</option>
                {POST_TYPE_OPTIONS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-sm font-medium text-neutral-700">
              投稿希望時期
              <select
                name="requestedPostTiming"
                defaultValue=""
                className="mt-1.5 w-full rounded-xl border border-neutral-300 px-3.5 py-3 text-base"
              >
                <option value="">選択しない</option>
                {REQUESTED_POST_TIMING_OPTIONS.map((label) => (
                  <option key={label} value={label}>
                    {label}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-sm font-medium text-neutral-700">
              編集指示
              <textarea
                name="editingInstructions"
                rows={3}
                className="mt-1.5 w-full rounded-xl border border-neutral-300 px-3.5 py-3 text-base"
              />
            </label>
            <label className="text-sm font-medium text-neutral-700">
              キャプション指定
              <textarea
                name="captionInstructions"
                rows={2}
                className="mt-1.5 w-full rounded-xl border border-neutral-300 px-3.5 py-3 text-base"
              />
            </label>
            <label className="text-sm font-medium text-neutral-700">
              その他連絡事項
              <textarea
                name="contactNotes"
                rows={2}
                className="mt-1.5 w-full rounded-xl border border-neutral-300 px-3.5 py-3 text-base"
              />
            </label>
            <Field label="撮影日" name="shotDate" type="date" />

            <label className="text-sm font-medium text-neutral-700">
              ファイル（複数選択できます。任意。大きな動画等は別途Google Driveでの共有も可能です）
              <input
                name="files"
                type="file"
                accept="image/*,video/*"
                multiple
                className="mt-1 w-full text-sm"
              />
            </label>
            <DriveMockNotice />

            <SubmitButton
              pendingText="送信中..."
              className="mt-2 w-full rounded-full bg-[var(--accent)] px-4 py-3.5 text-base font-semibold text-white hover:bg-[var(--accent-strong)]"
            >
              送信する
            </SubmitButton>
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
        className="mt-1.5 w-full rounded-xl border border-neutral-300 px-3.5 py-3 text-base"
      />
    </label>
  );
}
