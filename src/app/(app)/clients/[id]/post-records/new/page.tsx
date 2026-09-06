import Link from "next/link";
import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentStaff } from "@/lib/auth/session";
import { listActiveStaff } from "@/lib/clients/queries";
import { listMaterialOptionsForClient } from "@/lib/materials/queries";
import { listCandidateTasksForPostRecord } from "@/lib/postRecords/queries";
import { POST_TYPE_OPTIONS } from "@/lib/clients/labels";
import { DriveMockNotice } from "@/components/DriveMockNotice";
import type { PostType } from "@/lib/supabase/database.types";
import { PostRecordForm } from "./PostRecordForm";
import { PageContainer } from "@/components/PageContainer";

export default async function NewPostRecordPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ type?: string; taskId?: string; error?: string }>;
}) {
  const { id } = await params;
  const { type, taskId, error } = await searchParams;
  const postType: PostType = (["reel", "feed", "story"] as const).includes(type as PostType)
    ? (type as PostType)
    : "reel";

  const staff = await getCurrentStaff();
  const supabase = await createSupabaseServerClient();

  const [{ data: client }, candidateTasks, staffOptions, materialOptions] = await Promise.all([
    supabase.from("clients_view").select("id, company_name, shop_name").eq("id", id).maybeSingle(),
    listCandidateTasksForPostRecord(supabase, id, postType),
    listActiveStaff(supabase),
    listMaterialOptionsForClient(supabase, id),
  ]);

  if (!client) {
    notFound();
  }

  const selectedTaskId = taskId && candidateTasks.some((t) => t.id === taskId) ? taskId : "";

  return (
    <PageContainer className="max-w-xl gap-6 bg-neutral-50 py-6 sm:py-8">
      <div>
        <Link href={`/clients/${id}?tab=posts`} className="text-sm text-neutral-500">
          ← {client.company_name} の投稿履歴に戻る
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-neutral-900">投稿実績登録</h1>
      </div>

      <div className="flex gap-2 rounded-2xl bg-neutral-100 p-1">
        {POST_TYPE_OPTIONS.map(([value, label]) => (
          <Link
            key={value}
            href={`/clients/${id}/post-records/new?type=${value}`}
            className={`flex-1 rounded-xl px-4 py-3 text-center text-sm font-semibold ${
              postType === value ? "bg-white text-[var(--accent-strong)] shadow-sm" : "text-neutral-500"
            }`}
          >
            {label}
          </Link>
        ))}
      </div>

      {error ? <p className="rounded-2xl bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p> : null}

      <PostRecordForm
        clientId={id}
        postType={postType}
        candidateTasks={candidateTasks}
        selectedTaskId={selectedTaskId}
        staffOptions={staffOptions}
        currentStaffId={staff?.id ?? ""}
        materialOptions={materialOptions}
        driveNotice={postType !== "feed" ? <DriveMockNotice /> : null}
      />
    </PageContainer>
  );
}
