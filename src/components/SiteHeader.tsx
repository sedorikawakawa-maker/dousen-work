import Link from "next/link";
import { canAccessManagementFeatures } from "@/lib/auth/roles";
import type { StaffRole } from "@/lib/supabase/database.types";

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

  return (
    <header className="border-b border-neutral-200 bg-white">
      <div className="mx-auto flex max-w-5xl flex-col gap-2 px-4 py-3">
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
          <Link
            href="/notifications"
            className="relative shrink-0 rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-700"
          >
            通知
            {unreadCount > 0 ? (
              <span className="absolute -right-1.5 -top-1.5 rounded-full bg-red-600 px-1.5 text-[10px] font-medium leading-4 text-white">
                {unreadCount}
              </span>
            ) : null}
          </Link>
        </div>
        <nav className="flex flex-wrap gap-1">
          <Link href="/clients" className={NAV_LINK_CLASS}>
            顧客一覧
          </Link>
          <Link href="/wchecks" className={NAV_LINK_CLASS}>
            Wチェック待ち
          </Link>
          <Link href="/client-confirmations" className={NAV_LINK_CLASS}>
            顧客確認待ち
          </Link>
          <Link href="/post-records" className={NAV_LINK_CLASS}>
            投稿履歴
          </Link>
          <Link href="/reminders" className={NAV_LINK_CLASS}>
            催促
          </Link>
          {showManagement ? (
            <>
              <Link href="/management" className={NAV_LINK_CLASS}>
                管理ダッシュボード
              </Link>
              <Link href="/management/staff-progress" className={NAV_LINK_CLASS}>
                担当者別進捗
              </Link>
            </>
          ) : null}
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
