import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentStaff } from "@/lib/auth/session";
import { canAccessManagementFeatures } from "@/lib/auth/roles";
import { PageContainer } from "@/components/PageContainer";

export default async function SystemSettingsPage() {
  const staff = await getCurrentStaff();
  if (!staff) {
    redirect("/login");
  }
  if (!canAccessManagementFeatures(staff.role)) {
    redirect("/");
  }

  return (
    <PageContainer className="max-w-2xl gap-6 bg-neutral-50 py-6 sm:py-8">
      <div>
        <Link href="/management" className="text-sm text-neutral-500">
          ← 管理ダッシュボードに戻る
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-neutral-900">システム設定</h1>
      </div>

      <Link
        href="/management/settings/drive"
        className="flex items-center justify-between gap-3 rounded-2xl border border-neutral-200 bg-white p-5 hover:border-neutral-300"
      >
        <div>
          <p className="font-semibold text-neutral-900">Google Drive連携</p>
          <p className="mt-1 text-sm text-neutral-500">
            素材・完成データ・外注納品物の保存先となるGoogle Driveの接続を管理します。
          </p>
        </div>
        <span className="shrink-0 rounded-full border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-600">
          開く ›
        </span>
      </Link>
    </PageContainer>
  );
}
