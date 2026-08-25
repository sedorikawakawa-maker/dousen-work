import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentStaff } from "@/lib/auth/session";
import { canAccessManagementFeatures } from "@/lib/auth/roles";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PageContainer } from "@/components/PageContainer";
import { ConfirmSubmitButton } from "@/components/ConfirmSubmitButton";
import {
  startGoogleDriveConnectAction,
  testDriveConnectionAction,
  disconnectDriveAction,
  setDriveRootFolderAction,
} from "./actions";

const STATUS_LABEL: Record<string, string> = {
  not_connected: "未接続",
  connected: "接続済み",
  error: "エラー",
};

const STATUS_STYLE: Record<string, { bg: string; text: string }> = {
  not_connected: { bg: "bg-neutral-100", text: "text-neutral-500" },
  connected: { bg: "bg-green-100", text: "text-green-700" },
  error: { bg: "bg-red-100", text: "text-red-700" },
};

export default async function DriveSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; disconnected?: string; tested?: string; saved?: string; error?: string }>;
}) {
  const { connected, disconnected, tested, saved, error } = await searchParams;

  const staff = await getCurrentStaff();
  if (!staff) {
    redirect("/login");
  }
  if (!canAccessManagementFeatures(staff.role)) {
    redirect("/");
  }

  const supabase = await createSupabaseServerClient();
  const { data: integration } = await supabase
    .from("drive_integration_status_view")
    .select("*")
    .eq("id", 1)
    .maybeSingle();

  const status = integration?.status ?? "not_connected";
  const statusStyle = STATUS_STYLE[status];
  const isConnected = status !== "not_connected";

  return (
    <PageContainer className="max-w-2xl gap-6 bg-neutral-50 py-6 sm:py-8">
      <div>
        <Link href="/management/settings" className="text-sm text-neutral-500">
          ← システム設定に戻る
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-neutral-900">Google Drive連携</h1>
      </div>

      {connected ? (
        <p className="rounded-2xl bg-[var(--accent-soft-bg)] px-4 py-2.5 text-sm text-[var(--accent-soft-text)]">
          Googleアカウントとの連携が完了しました。続けて保存先フォルダを設定してください。
        </p>
      ) : null}
      {disconnected ? (
        <p className="rounded-2xl bg-neutral-100 px-4 py-2.5 text-sm text-neutral-600">連携を解除しました。</p>
      ) : null}
      {tested ? (
        <p className="rounded-2xl bg-[var(--accent-soft-bg)] px-4 py-2.5 text-sm text-[var(--accent-soft-text)]">
          Google Driveに正常に接続されています。
        </p>
      ) : null}
      {saved ? (
        <p className="rounded-2xl bg-[var(--accent-soft-bg)] px-4 py-2.5 text-sm text-[var(--accent-soft-text)]">
          保存先フォルダを更新しました。
        </p>
      ) : null}
      {error ? <p className="rounded-2xl bg-red-50 px-4 py-2.5 text-sm text-red-700">{error}</p> : null}

      <section className="rounded-2xl border border-neutral-200 bg-white p-5 sm:p-6">
        <h2 className="mb-3 text-xs font-semibold text-neutral-500">連携状態</h2>
        <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs text-neutral-400">状態</dt>
            <dd className="mt-1">
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${statusStyle.bg} ${statusStyle.text}`}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
                {STATUS_LABEL[status]}
              </span>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-neutral-400">接続しているGoogleアカウント</dt>
            <dd className="mt-1 text-neutral-900">{integration?.google_account_email ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-neutral-400">現在のルートフォルダ</dt>
            <dd className="mt-1 text-neutral-900">
              {integration?.root_folder_id ? (
                <a
                  href={`https://drive.google.com/drive/folders/${integration.root_folder_id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="underline"
                >
                  {integration.root_folder_name || integration.root_folder_id}
                </a>
              ) : (
                "未設定"
              )}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-neutral-400">最終接続確認日時</dt>
            <dd className="mt-1 text-neutral-900">
              {integration?.last_verified_at
                ? `${new Date(integration.last_verified_at).toLocaleString("ja-JP")}（${
                    integration.last_verified_status === "ok" ? "成功" : "失敗"
                  }）`
                : "未確認"}
            </dd>
          </div>
        </dl>
        {integration?.last_error_message ? (
          <p className="mt-3 rounded-xl bg-red-50 px-3.5 py-2.5 text-xs text-red-700">
            前回のエラー: {integration.last_error_message}
          </p>
        ) : null}
      </section>

      <section className="rounded-2xl border border-neutral-200 bg-white p-5 sm:p-6">
        <h2 className="mb-3 text-xs font-semibold text-neutral-500">操作</h2>
        <div className="flex flex-wrap gap-2">
          <form action={startGoogleDriveConnectAction}>
            <button
              type="submit"
              className="rounded-full bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[var(--accent-strong)]"
            >
              {isConnected ? "Google Driveへ再接続" : "Google Driveと連携"}
            </button>
          </form>

          {isConnected ? (
            <>
              <form action={testDriveConnectionAction}>
                <button
                  type="submit"
                  className="rounded-full border border-neutral-300 px-4 py-2.5 text-sm font-medium text-neutral-700"
                >
                  接続テスト
                </button>
              </form>
              <form action={disconnectDriveAction}>
                <ConfirmSubmitButton
                  confirmMessage="Google Driveとの連携を解除します。よろしいですか？"
                  className="rounded-full border border-red-300 px-4 py-2.5 text-sm font-medium text-red-700"
                >
                  連携解除
                </ConfirmSubmitButton>
              </form>
            </>
          ) : null}
        </div>
      </section>

      {isConnected ? (
        <section className="rounded-2xl border border-neutral-200 bg-white p-5 sm:p-6">
          <h2 className="mb-3 text-xs font-semibold text-neutral-500">保存先フォルダ変更</h2>
          <div className="flex flex-col gap-4">
            <form action={setDriveRootFolderAction} className="flex flex-col gap-2">
              <input type="hidden" name="mode" value="create" />
              <p className="text-xs text-neutral-500">
                接続中のGoogleアカウントのマイドライブ直下に「DOUSEN WORK 制作データ」フォルダを新規作成します。
              </p>
              <button
                type="submit"
                className="w-fit rounded-full border border-neutral-300 px-4 py-2.5 text-sm font-medium text-neutral-700"
              >
                新規フォルダを自動作成
              </button>
            </form>

            <form action={setDriveRootFolderAction} className="flex flex-col gap-2 border-t border-neutral-100 pt-4">
              <input type="hidden" name="mode" value="existing" />
              <label className="text-sm font-medium text-neutral-700">
                既存フォルダを指定（フォルダIDまたはURL）
                <input
                  name="folderId"
                  type="text"
                  placeholder="https://drive.google.com/drive/folders/..."
                  className="mt-1.5 w-full rounded-xl border border-neutral-300 px-3.5 py-3 text-base"
                />
              </label>
              <button
                type="submit"
                className="w-fit rounded-full border border-neutral-300 px-4 py-2.5 text-sm font-medium text-neutral-700"
              >
                このフォルダを保存先にする
              </button>
            </form>
          </div>
        </section>
      ) : null}
    </PageContainer>
  );
}
