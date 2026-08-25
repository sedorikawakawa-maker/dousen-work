import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentStaff } from "@/lib/auth/session";
import { STAFF_ROLE_LABELS } from "@/lib/auth/roles";
import { PageContainer } from "@/components/PageContainer";
import { ChangePasswordForm } from "./ChangePasswordForm";

/** アカウント設定。全active staff（part_time含む）が利用可能。roleによる制限は設けない。 */
export default async function AccountPage() {
  const staff = await getCurrentStaff();
  if (!staff) {
    redirect("/login");
  }

  return (
    <PageContainer className="max-w-lg gap-6 bg-neutral-50 py-6 sm:py-8">
      <div>
        <Link href="/" className="text-sm text-neutral-500">
          ← ダッシュボードに戻る
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-neutral-900">アカウント設定</h1>
        <p className="mt-1 text-sm text-neutral-500">
          {staff.last_name} {staff.first_name}（{STAFF_ROLE_LABELS[staff.role]}）
        </p>
      </div>

      <section className="rounded-2xl border border-neutral-200 bg-white p-5 sm:p-6">
        <h2 className="mb-4 text-sm font-semibold text-neutral-700">パスワード変更</h2>
        <ChangePasswordForm />
      </section>
    </PageContainer>
  );
}
