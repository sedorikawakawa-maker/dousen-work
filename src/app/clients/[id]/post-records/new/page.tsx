import Link from "next/link";
import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentStaff } from "@/lib/auth/session";
import { listActiveStaff } from "@/lib/clients/queries";
import { listMaterialsForClient } from "@/lib/materials/queries";
import { listCandidateTasksForPostRecord } from "@/lib/postRecords/queries";
import { POST_TYPE_LABELS, POST_TYPE_OPTIONS, PRODUCTION_TASK_STATUS_LABELS } from "@/lib/clients/labels";
import { DriveMockNotice } from "@/components/DriveMockNotice";
import { SubmitButton } from "@/components/SubmitButton";
import type { PostType } from "@/lib/supabase/database.types";
import { registerPostRecordAction } from "./actions";

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

  const [{ data: client }, candidateTasks, staffOptions, materials] = await Promise.all([
    supabase.from("clients_view").select("id, company_name, shop_name").eq("id", id).maybeSingle(),
    listCandidateTasksForPostRecord(supabase, id, postType),
    listActiveStaff(supabase),
    listMaterialsForClient(supabase, id),
  ]);

  if (!client) {
    notFound();
  }

  const selectedTaskId = taskId && candidateTasks.some((t) => t.id === taskId) ? taskId : "";

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col gap-6 px-4 py-6 sm:py-8">
      <div>
        <Link href={`/clients/${id}?tab=posts`} className="text-sm text-neutral-500">
          ← {client.company_name} の投稿履歴に戻る
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-neutral-900">投稿実績登録</h1>
      </div>

      <div className="flex gap-2">
        {POST_TYPE_OPTIONS.map(([value, label]) => (
          <Link
            key={value}
            href={`/clients/${id}/post-records/new?type=${value}`}
            className={`flex-1 rounded-md border px-4 py-3 text-center text-sm font-medium ${
              postType === value
                ? "border-neutral-900 bg-neutral-900 text-white"
                : "border-neutral-300 text-neutral-700"
            }`}
          >
            {label}
          </Link>
        ))}
      </div>

      {error ? (
        <p className="rounded-md bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p>
      ) : null}

      <form
        action={registerPostRecordAction}
        className="flex flex-col gap-4 rounded-lg border border-neutral-200 bg-white p-4"
      >
        <input type="hidden" name="clientId" value={id} />
        <input type="hidden" name="postType" value={postType} />

        <label className="text-sm font-medium text-neutral-700">
          対象の制作タスク
          <select
            name="taskId"
            required
            defaultValue={selectedTaskId}
            className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-3 text-base"
          >
            <option value="" disabled>
              選択してください
            </option>
            {candidateTasks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.scheduled_post_date ?? "予定日未定"} ・ {PRODUCTION_TASK_STATUS_LABELS[t.status]}
                {t.status === "posting_waiting" ? "（推奨）" : ""} ・ {t.title}
              </option>
            ))}
          </select>
          {candidateTasks.length === 0 ? (
            <p className="mt-1 text-xs text-neutral-400">
              {POST_TYPE_LABELS[postType]}の未完了タスクがありません。
            </p>
          ) : null}
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm font-medium text-neutral-700">
            投稿日
            <input
              name="postedAt"
              type="date"
              required
              defaultValue={new Date().toISOString().slice(0, 10)}
              className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-3 text-base"
            />
          </label>
          <label className="text-sm font-medium text-neutral-700">
            投稿担当
            <select
              name="postedByStaffId"
              required
              defaultValue={staff?.id ?? ""}
              className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-3 text-base"
            >
              {staffOptions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.last_name} {s.first_name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="text-sm font-medium text-neutral-700">
          投稿タイトル / 内容{postType === "story" ? "（任意）" : ""}
          <textarea
            name="title"
            rows={2}
            className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-3 text-base"
          />
        </label>

        <label className="text-sm font-medium text-neutral-700">
          SNS投稿URL{postType === "story" ? "（任意）" : ""}
          <input
            name="socialPostUrl"
            type="url"
            inputMode="url"
            className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-3 text-base"
          />
        </label>

        {postType === "reel" ? (
          <>
            <label className="text-sm font-medium text-neutral-700">
              完成動画ファイル
              <input
                name="file"
                type="file"
                accept="video/*"
                className="mt-1 w-full text-sm"
              />
            </label>
            <label className="text-sm font-medium text-neutral-700">
              Google Drive保存先URL（ファイルを添付しない場合）
              <input
                name="manualDriveUrl"
                type="url"
                className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-3 text-base"
              />
            </label>
            <DriveMockNotice />
          </>
        ) : null}

        {postType === "feed" ? (
          <label className="text-sm font-medium text-neutral-700">
            Canvaリンク
            <input
              name="canvaUrl"
              type="url"
              className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-3 text-base"
            />
          </label>
        ) : null}

        {postType === "story" ? (
          <>
            <label className="text-sm font-medium text-neutral-700">
              Canvaリンク
              <input
                name="canvaUrl"
                type="url"
                className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-3 text-base"
              />
            </label>
            <label className="text-sm font-medium text-neutral-700">
              画像/動画ファイル（Canvaリンクが無い場合）
              <input name="file" type="file" accept="image/*,video/*" className="mt-1 w-full text-sm" />
            </label>
            <label className="text-sm font-medium text-neutral-700">
              Google Drive保存先URL（ファイルを添付しない場合）
              <input
                name="manualDriveUrl"
                type="url"
                className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-3 text-base"
              />
            </label>
            <DriveMockNotice />
          </>
        ) : null}

        <label className="text-sm font-medium text-neutral-700">
          元素材（任意）
          <select
            name="sourceMaterialId"
            defaultValue=""
            className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-3 text-base"
          >
            <option value="">選択しない</option>
            {materials.map((m) => (
              <option key={m.id} value={m.id}>
                {m.title}
              </option>
            ))}
          </select>
        </label>

        <SubmitButton
          pendingText="登録中..."
          className="mt-2 w-full rounded-md bg-neutral-900 px-4 py-4 text-base font-medium text-white"
        >
          登録する
        </SubmitButton>
      </form>
    </main>
  );
}
