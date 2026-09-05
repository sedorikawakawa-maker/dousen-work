import { notFound } from "next/navigation";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { hashOutsourcingToken } from "@/lib/outsourcing/token";
import { DriveMockNotice } from "@/components/DriveMockNotice";
import { OutsourcingUploadForm } from "./OutsourcingUploadForm";

const UPLOADABLE_STATUSES = new Set(["requested", "in_progress"]);

export default async function OutsourcingUploadPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

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
    <main className="mx-auto flex min-h-screen max-w-lg flex-col gap-6 bg-neutral-50 px-4 py-8">
      <div>
        <h1 className="text-xl font-semibold text-neutral-900">外注納品フォーム</h1>
        {clientName ? <p className="mt-1 text-sm text-neutral-500">{clientName} 様案件</p> : null}
      </div>

      <section className="rounded-2xl border border-neutral-200 bg-white p-5 sm:p-6">
        <h2 className="text-lg font-semibold text-neutral-900">{request.title}</h2>
        {request.due_date ? <p className="mt-1 text-sm text-neutral-500">納期: {request.due_date}</p> : null}
        {request.instruction ? (
          <p className="mt-3 whitespace-pre-wrap text-sm text-neutral-700">{request.instruction}</p>
        ) : null}
        {request.material_link ? (
          <a
            href={request.material_link}
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-neutral-300 px-3.5 py-2 text-sm font-medium text-neutral-700"
          >
            素材リンクを開く
          </a>
        ) : null}
      </section>

      {!isUploadable ? (
        <p className="rounded-2xl bg-neutral-100 px-4 py-3.5 text-sm text-neutral-600">
          この案件は現在アップロードを受け付けていません。
        </p>
      ) : (
        <>
          <DriveMockNotice />
          <OutsourcingUploadForm token={token} />
        </>
      )}
    </main>
  );
}
