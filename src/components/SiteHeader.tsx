import Link from "next/link";
import { canAccessManagementFeatures, canManageStaff } from "@/lib/auth/roles";
import type { StaffRole } from "@/lib/supabase/database.types";
import { PAGE_WIDTH_CLASS } from "@/components/PageContainer";

const NAV_LINK_CLASS =
  "whitespace-nowrap rounded-md px-2 py-1.5 text-sm text-neutral-600 hover:bg-neutral-100";

export function SiteHeader({
  role,
  unreadCount,
}: {
  role: StaffRole;
  unreadCount: number;
}) {
  const showManagement = canAccessManagementFeatures(role);
  const showStaffManagement = canManageStaff(role);
  const unreadBadge = unreadCount > 99 ? "99+" : String(unreadCount);

  return (
    <header className="border-b border-neutral-200 bg-white">
      <div className={`mx-auto flex ${PAGE_WIDTH_CLASS} flex-col gap-2 px-4 py-3 lg:px-0`}>
        <div className="flex items-center gap-3">
          <Link href="/" className="shrink-0 text-sm font-semibold text-neutral-900">
            DOUSEN WORK
          </Link>
          <form action="/clients" method="get" className="min-w-0 flex-1">
            <input
              type="text"
              name="q"
              placeholder="顧客名・店舗名・顧客IDで検索"
              className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
            />
          </form>
        </div>
        <nav className="flex flex-wrap gap-1">
          <Link href="/notifications" className={`${NAV_LINK_CLASS} relative`}>
            通知
            {unreadCount > 0 ? (
              <span className="absolute -right-1.5 -top-1.5 rounded-full bg-red-600 px-1.5 text-[10px] font-medium leading-4 text-white">
                {unreadBadge}
              </span>
            ) : null}
          </Link>
          <Link href="/clients" className={NAV_LINK_CLASS}>
            顧客一覧
          </Link>
          <Link href="/wchecks" className={NAV_LINK_CLASS}>
            Wチェック待ち
          </Link>
          <Link href="/client-confirmations" className={NAV_LINK_CLASS}>
            顧客確認待ち
          </Link>
          <Link href="/internal-tasks" className={NAV_LINK_CLASS}>
            社内タスク
          </Link>
          {/* 頻度の低い入口。催促(/reminders)はダッシュボード「要対応」から辿れるため、
              トップレベルのナビからは外す（機能・URL自体は維持）。 */}
          <Link href="/post-records" className={NAV_LINK_CLASS}>
            投稿履歴
          </Link>
          <Link href="/outsourcing" className={NAV_LINK_CLASS}>
            外注管理
          </Link>
          {showManagement ? (
            <>
              <Link href="/management" className={NAV_LINK_CLASS}>
                管理ダッシュボード
              </Link>
              <Link href="/management/staff-progress" className={NAV_LINK_CLASS}>
                担当者別進捗
              </Link>
              <Link href="/management/settings" className={NAV_LINK_CLASS}>
                システム設定
              </Link>
            </>
          ) : null}
          {showStaffManagement ? (
            <Link href="/management/staff" className={NAV_LINK_CLASS}>
              スタッフ管理
            </Link>
          ) : null}
          <Link href="/account" className={NAV_LINK_CLASS}>
            アカウント設定
          </Link>
          <Link
            href="/clients/new"
            className="whitespace-nowrap rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white"
          >
            ＋ 顧客登録
          </Link>
        </nav>
      </div>
    </header>
  );
}
