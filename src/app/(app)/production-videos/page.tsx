import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentStaff } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { listClients, listActiveStaff } from "@/lib/clients/queries";
import { listProductionVideos } from "@/lib/productionVideos/queries";
import { POST_TYPE_LABELS } from "@/lib/clients/labels";
import { PageContainer } from "@/components/PageContainer";
import { ClientAvatar } from "@/components/ClientAvatar";
import { DriveMockNotice } from "@/components/DriveMockNotice";
import { ProductionVideoUploadForm } from "@/components/ProductionVideoUploadForm";

type TabKey = "upload" | "view";

export default async function ProductionVideosPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; clientId?: string; saved?: string; error?: string }>;
}) {
  const staff = await getCurrentStaff();
  if (!staff) {
    redirect("/login");
  }

  const { tab, clientId, saved, error } = await searchParams;
  const activeTab: TabKey = tab === "view" ? "view" : "upload";
  const filterClientId = clientId ?? "";

  const supabase = await createSupabaseServerClient();
  const [clients, staffOptions, videos] = await Promise.all([
    listClients(supabase),
    listActiveStaff(supabase),
    activeTab === "view" ? listProductionVideos(supabase, filterClientId || undefined) : Promise.resolve([]),
  ]);

  const clientNameById = new Map(
    clients.map((c) => [c.id, c.shop_name ? `${c.company_name}（${c.shop_name}）` : c.company_name]),
  );
  const clientThumbnailById = new Map(clients.map((c) => [c.id, c.thumbnail_url]));
  const staffNameById = new Map(staffOptions.map((s) => [s.id, `${s.last_name} ${s.first_name}`]));

  function tabHref(key: TabKey) {
    const params = new URLSearchParams();
    params.set("tab", key);
    if (key === "view" && filterClientId) params.set("clientId", filterClientId);
    return `/production-videos?${params.toString()}`;
  }

  return (
    <PageContainer className="gap-6 bg-neutral-50 py-6 sm:py-8">
      <div>
        <Link href="/" className="text-sm text-neutral-500">
          ← ダッシュボードに戻る
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-neutral-900">制作動画</h1>
        <p className="mt-1 text-xs text-neutral-500">
          完成した納品用・投稿用動画の保管庫です。制作途中の動画や投稿完了フローとは連動しません。
        </p>
      </div>

      <div className="flex gap-2 border-b border-neutral-200">
        {(
          [
            { key: "upload", label: "アップロード" },
            { key: "view", label: "閲覧" },
          ] as { key: TabKey; label: string }[]
        ).map((t) => (
          <Link
            key={t.key}
            href={tabHref(t.key)}
            className={`px-3 py-2 text-sm font-medium ${
              activeTab === t.key
                ? "border-b-2 border-[var(--accent)] text-[var(--accent-strong)]"
                : "text-neutral-500 hover:text-neutral-800"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {saved ? (
        <p className="rounded-2xl bg-[var(--accent-soft-bg)] px-4 py-2 text-sm text-[var(--accent-soft-text)]">
          アップロードしました。
        </p>
      ) : null}
      {error ? <p className="rounded-2xl bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p> : null}

      {activeTab === "upload" ? (
        <div className="flex max-w-xl flex-col gap-3">
          <DriveMockNotice />
          <ProductionVideoUploadForm
            clients={clients.map((c) => ({
              id: c.id,
              label: `${c.client_code} ${c.company_name}${c.shop_name ? `（${c.shop_name}）` : ""}`,
            }))}
          />
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <form action="/production-videos" method="get" className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="tab" value="view" />
            <label className="text-sm font-medium text-neutral-700">
              顧客で絞り込み
              <select
                name="clientId"
                defaultValue={filterClientId}
                className="mt-1.5 min-w-[240px] rounded-xl border border-neutral-300 px-3.5 py-2.5 text-sm"
              >
                <option value="">すべての顧客</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.client_code} {c.company_name}
                    {c.shop_name ? `（${c.shop_name}）` : ""}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              className="rounded-full border border-neutral-300 px-4 py-2.5 text-sm font-medium text-neutral-700"
            >
              絞り込む
            </button>
            {filterClientId ? (
              <Link href="/production-videos?tab=view" className="text-xs text-neutral-500 underline">
                絞り込み解除
              </Link>
            ) : null}
          </form>

          <ul className="flex flex-col gap-2">
            {videos.map((video) => (
              <li
                key={video.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-neutral-200 bg-white px-4 py-3"
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <ClientAvatar
                    thumbnailUrl={clientThumbnailById.get(video.client_id) ?? null}
                    name={clientNameById.get(video.client_id) ?? "不明な顧客"}
                    size="sm"
                  />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span className="font-medium text-neutral-900">
                        {clientNameById.get(video.client_id) ?? "不明な顧客"}
                      </span>
                      {video.post_type ? (
                        <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600">
                          {POST_TYPE_LABELS[video.post_type]}
                        </span>
                      ) : null}
                    </div>
                    <p className="truncate text-sm text-neutral-700">
                      {video.file_name ?? "（ファイル名不明）"}
                    </p>
                    <p className="text-xs text-neutral-500">
                      <span className="font-medium tabular-nums">
                        {new Date(video.created_at).toLocaleString("ja-JP")}
                      </span>{" "}
                      / {staffNameById.get(video.uploaded_by_staff_id) ?? "不明"}
                    </p>
                    {video.memo ? <p className="mt-0.5 text-xs text-neutral-500">メモ: {video.memo}</p> : null}
                  </div>
                </div>
                <a
                  href={video.drive_url}
                  target="_blank"
                  rel="noreferrer"
                  className="shrink-0 rounded-full border border-neutral-300 px-3.5 py-2 text-xs font-medium text-neutral-700"
                >
                  Google Driveで開く
                </a>
              </li>
            ))}
            {videos.length === 0 ? (
              <li className="rounded-2xl bg-white py-10 text-center text-sm text-neutral-400">
                制作動画はまだありません。
              </li>
            ) : null}
          </ul>
        </div>
      )}
    </PageContainer>
  );
}
