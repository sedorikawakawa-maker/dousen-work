import Link from "next/link";
import { requireStaffManagementAccess } from "@/lib/staff/authGuard";
import { listAllStaffForManagement, isAdminRole } from "@/lib/staff/queries";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { STAFF_ROLE_LABELS } from "@/lib/auth/roles";
import { PageContainer } from "@/components/PageContainer";
import { ConfirmSubmitButton } from "@/components/ConfirmSubmitButton";
import type { StaffRole } from "@/lib/supabase/database.types";
import { CreateStaffForm } from "./CreateStaffForm";
import { StaffPasswordResetForm } from "./StaffPasswordResetForm";
import { deactivateStaffAction, reactivateStaffAction, updateStaffProfileAction } from "./actions";

const ROLE_OPTIONS: StaffRole[] = ["president", "executive", "employee", "part_time"];

export default async function StaffManagementPage({
  searchParams,
}: {
  searchParams: Promise<{
    updated?: string;
    deactivated?: string;
    reactivated?: string;
    error?: string;
  }>;
}) {
  const actor = await requireStaffManagementAccess();
  const { updated, deactivated, reactivated, error } = await searchParams;

  const supabase = await createSupabaseServerClient();
  const staffList = await listAllStaffForManagement(supabase);
  const activeStaff = staffList.filter((s) => s.is_active);
  const inactiveStaff = staffList.filter((s) => !s.is_active);

  return (
    <PageContainer className="gap-5 bg-neutral-50 py-6 sm:py-8">
      <div>
        <Link href="/management" className="text-sm text-neutral-500">
          ← 管理ダッシュボードに戻る
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-neutral-900">スタッフ管理</h1>
      </div>

      {error ? <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p> : null}
      {updated ? (
        <p className="rounded-2xl bg-green-50 px-4 py-3 text-sm text-green-700">更新しました。</p>
      ) : null}
      {deactivated ? (
        <p className="rounded-2xl bg-green-50 px-4 py-3 text-sm text-green-700">退職処理しました。</p>
      ) : null}
      {reactivated ? (
        <p className="rounded-2xl bg-green-50 px-4 py-3 text-sm text-green-700">再有効化しました。</p>
      ) : null}

      <section className="rounded-2xl border border-neutral-200 bg-white p-5 sm:p-6">
        <h2 className="mb-3 text-sm font-semibold text-neutral-700">スタッフ追加</h2>
        <CreateStaffForm />
      </section>

      <section className="rounded-2xl border border-neutral-200 bg-white p-5 sm:p-6">
        <h2 className="mb-3 text-sm font-semibold text-neutral-700">在籍中のスタッフ（{activeStaff.length}名）</h2>
        <ul className="flex flex-col gap-2">
          {activeStaff.map((staff) => (
            <StaffRow key={staff.id} staff={staff} isSelf={staff.id === actor.id} />
          ))}
          {activeStaff.length === 0 ? <li className="text-sm text-neutral-400">在籍中のスタッフはいません。</li> : null}
        </ul>
      </section>

      {inactiveStaff.length > 0 ? (
        <section className="rounded-2xl border border-neutral-200 bg-white p-5 sm:p-6">
          <h2 className="mb-3 text-sm font-semibold text-neutral-700">
            退職したスタッフ（過去在籍者・{inactiveStaff.length}名）
          </h2>
          <ul className="flex flex-col gap-2">
            {inactiveStaff.map((staff) => (
              <StaffRow key={staff.id} staff={staff} isSelf={staff.id === actor.id} />
            ))}
          </ul>
        </section>
      ) : null}
    </PageContainer>
  );
}

type StaffListItem = Awaited<ReturnType<typeof listAllStaffForManagement>>[number];

function StaffRow({ staff, isSelf }: { staff: StaffListItem; isSelf: boolean }) {
  return (
    <li
      className={`rounded-xl border px-4 py-3 ${
        staff.is_active ? "border-neutral-200" : "border-neutral-200 bg-neutral-50 opacity-70"
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-neutral-900">
            {staff.last_name} {staff.first_name}
          </span>
          {isSelf ? (
            <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-500">自分</span>
          ) : null}
          <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600">
            {STAFF_ROLE_LABELS[staff.role]}
          </span>
          <span
            className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${
              staff.is_active ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
            }`}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-current" />
            {staff.is_active ? "在籍" : "退職"}
          </span>
        </span>
        <span className="text-xs text-neutral-500">
          作成日:{" "}
          <span className="font-medium tabular-nums">
            {new Date(staff.created_at).toLocaleDateString("ja-JP")}
          </span>{" "}
          / 最終ログイン:{" "}
          <span className="font-medium tabular-nums">
            {staff.last_login_at ? new Date(staff.last_login_at).toLocaleString("ja-JP") : "未ログイン"}
          </span>
        </span>
      </div>

      <details className="mt-2">
        <summary className="cursor-pointer text-xs text-neutral-500 underline">編集・操作</summary>
        <div className="mt-3 flex flex-col gap-3 border-t border-neutral-100 pt-3">
          <form action={updateStaffProfileAction} className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <input type="hidden" name="staffId" value={staff.id} />
            <label className="flex-1 text-sm font-medium text-neutral-700">
              姓
              <input
                name="lastName"
                type="text"
                defaultValue={staff.last_name}
                required
                className="mt-1.5 w-full rounded-xl border border-neutral-300 px-3.5 py-3 text-base"
              />
            </label>
            <label className="flex-1 text-sm font-medium text-neutral-700">
              名
              <input
                name="firstName"
                type="text"
                defaultValue={staff.first_name}
                required
                className="mt-1.5 w-full rounded-xl border border-neutral-300 px-3.5 py-3 text-base"
              />
            </label>
            <label className="flex-1 text-sm font-medium text-neutral-700">
              role
              <select
                name="role"
                defaultValue={staff.role}
                className="mt-1.5 w-full rounded-xl border border-neutral-300 px-3.5 py-3 text-base"
              >
                {ROLE_OPTIONS.map((role) => (
                  <option
                    key={role}
                    value={role}
                    disabled={isSelf && isAdminRole(staff.role) && !isAdminRole(role)}
                  >
                    {STAFF_ROLE_LABELS[role]}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              className="whitespace-nowrap rounded-xl border border-neutral-300 px-4 py-3 text-sm font-medium text-neutral-700"
            >
              更新する
            </button>
          </form>
          {isSelf && isAdminRole(staff.role) ? (
            <p className="text-xs text-neutral-500">
              自分自身の権限をpresident/executiveから外すことはできません。
            </p>
          ) : null}

          <StaffPasswordResetForm
            staffId={staff.id}
            staffLabel={`${staff.last_name} ${staff.first_name}`}
          />

          <div className="flex flex-wrap gap-2">
            {staff.is_active ? (
              isSelf ? (
                <span className="rounded-md border border-neutral-200 px-3 py-1.5 text-xs text-neutral-500">
                  自分自身は退職処理できません
                </span>
              ) : (
                <form action={deactivateStaffAction}>
                  <input type="hidden" name="staffId" value={staff.id} />
                  <ConfirmSubmitButton
                    confirmMessage={`${staff.last_name} ${staff.first_name} を退職処理しますか？ログイン不可・担当候補から除外されます。`}
                    className="rounded-md border border-red-300 px-3 py-1.5 text-xs text-red-700"
                  >
                    退職処理する
                  </ConfirmSubmitButton>
                </form>
              )
            ) : (
              <form action={reactivateStaffAction}>
                <input type="hidden" name="staffId" value={staff.id} />
                <ConfirmSubmitButton
                  confirmMessage={`${staff.last_name} ${staff.first_name} を再有効化しますか？`}
                  className="rounded-md border border-green-300 px-3 py-1.5 text-xs text-green-700"
                >
                  再有効化する
                </ConfirmSubmitButton>
              </form>
            )}
          </div>
        </div>
      </details>
    </li>
  );
}
