import { notFound } from "next/navigation";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { hashOutsourcingToken } from "@/lib/outsourcing/token";
import { DriveMockNotice } from "@/components/DriveMockNotice";
import { SubmitButton } from "@/components/SubmitButton";
import { submitOutsourcingDeliveryAction } from "./actions";

const UPLOADABLE_STATUSES = new Set(["requested", "in_progress"]);

export default async function OutsourcingUploadPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ submitted?: string; error?: string }>;
}) {
  const { token } = await params;
  const { submitted, error } = await searchParams;

  const admin = createSupabaseAdminClient();
  const tokenHash = hashOutsourcingToken(token);

  const { data: request } = await admin
    .from("outsourcing_requests")
    .select("id, title, instruction, material_link, due_date, status, client_id")
    .eq("upload_token_hash", tokenHash)
    .maybeSingle();

  if (!request) {
    notFound();
  }

  let clientName: string | null = null;
  if (request.client_id) {
    const { data: client } = await admin
      .from("clients")
      .select("company_name")
      .eq("id", request.client_id)
      .maybeSingle();
    clientName = client?.company_name ?? null;
  }

  const isUploadable = UPLOADABLE_STATUSES.has(request.status);

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col gap-6 px-4 py-8">
      <div>
        <h1 className="text-xl font-semibold text-neutral-900">外注納品フォーム</h1>
        {clientName ? <p className="mt-1 text-sm text-neutral-500">{clientName} 様案件</p> : null}
      </div>

      <section className="rounded-lg border border-neutral-200 bg-white p-6">
        <h2 className="text-lg font-medium text-neutral-900">{request.title}</h2>
        {request.due_date ? (
          <p className="mt-1 text-sm text-neutral-500">納期: {request.due_date}</p>
        ) : null}
        {request.instruction ? (
          <p className="mt-3 whitespace-pre-wrap text-sm text-neutral-700">{request.instruction}</p>
        ) : null}
        {request.material_link ? (
          <a
            href={request.material_link}
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-block text-sm underline"
          >
            素材リンクを開く
          </a>
        ) : null}
      </section>

      {submitted ? (
        <p className="rounded-md bg-green-50 px-4 py-3 text-sm text-green-700">
          納品を受け付けました。ご対応ありがとうございます。
        </p>
      ) : !isUploadable ? (
        <p className="rounded-md bg-neutral-100 px-4 py-3 text-sm text-neutral-600">
          この案件は現在アップロードを受け付けていません。
        </p>
      ) : (
        <div className="rounded-lg border border-neutral-200 bg-white p-6">
          {error ? (
            <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
          ) : null}

          <form action={submitOutsourcingDeliveryAction} className="flex flex-col gap-4">
            <input type="hidden" name="token" value={token} />

            <label className="text-sm font-medium text-neutral-700">
              完成動画/ファイル
              <input
                name="file"
                type="file"
                accept="video/*,image/*"
                className="mt-1 w-full text-sm"
              />
            </label>
            <label className="text-sm font-medium text-neutral-700">
              保存先URL（ファイルを添付しない場合）
              <input
                name="manualDriveUrl"
                type="url"
                className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-3 text-base"
              />
            </label>
            <DriveMockNotice />
            <label className="text-sm font-medium text-neutral-700">
              外注メモ
              <textarea
                name="contractorNote"
                rows={3}
                className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-3 text-base"
              />
            </label>

            <SubmitButton
              pendingText="送信中..."
              className="mt-2 w-full rounded-md bg-neutral-900 px-4 py-4 text-base font-medium text-white"
            >
              納品する
            </SubmitButton>
          </form>
        </div>
      )}
    </main>
  );
}
