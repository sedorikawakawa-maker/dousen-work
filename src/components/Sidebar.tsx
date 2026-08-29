"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { canAccessManagementFeatures, canManageStaff } from "@/lib/auth/roles";
import type { StaffRole } from "@/lib/supabase/database.types";

interface NavItem {
  href: string;
  label: string;
  /** 催促一覧など、他より控えめに表示したい項目。 */
  subtle?: boolean;
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

function buildNavGroups(role: StaffRole): NavGroup[] {
  const groups: NavGroup[] = [
    {
      title: "日常",
      items: [
        { href: "/", label: "ダッシュボード" },
        { href: "/notifications", label: "通知" },
        { href: "/wchecks", label: "Wチェック待ち" },
        { href: "/client-confirmations", label: "顧客確認待ち" },
        { href: "/internal-tasks", label: "社内タスク" },
      ],
    },
    {
      title: "顧客",
      items: [
        { href: "/clients", label: "顧客一覧" },
        { href: "/clients/new", label: "顧客登録" },
      ],
    },
    {
      title: "業務",
      items: [
        { href: "/post-records", label: "投稿履歴" },
        { href: "/production-videos", label: "制作動画" },
        { href: "/outsourcing", label: "外注管理" },
        { href: "/reminders", label: "催促一覧", subtle: true },
      ],
    },
  ];

  const managementItems: NavItem[] = [];
  if (canAccessManagementFeatures(role)) {
    managementItems.push(
      { href: "/management", label: "管理ダッシュボード" },
      { href: "/management/staff-progress", label: "担当者別進捗" },
      { href: "/management/settings", label: "システム設定" },
    );
  }
  if (canManageStaff(role)) {
    managementItems.push({ href: "/management/staff", label: "スタッフ管理" });
  }
  if (managementItems.length > 0) {
    groups.push({ title: "管理", items: managementItems });
  }

  return groups;
}

/** 詳細/編集など専用ナビ項目を持たないサブページでは、親の一覧項目を現在地として強調する。 */
function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  if (pathname === href) return true;
  if (href === "/clients") return pathname.startsWith("/clients/") && !pathname.startsWith("/clients/new");
  if (href === "/internal-tasks") {
    return pathname.startsWith("/internal-tasks/") && !pathname.startsWith("/internal-tasks/new");
  }
  if (href === "/outsourcing") {
    return pathname.startsWith("/outsourcing/") && !pathname.startsWith("/outsourcing/new");
  }
  return false;
}

export function Sidebar({
  role,
  unreadCount,
  wcheckNewCount,
  onLogout,
}: {
  role: StaffRole;
  unreadCount: number;
  wcheckNewCount: number;
  onLogout: () => void | Promise<void>;
}) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const groups = buildNavGroups(role);
  const unreadBadge = unreadCount > 99 ? "99+" : String(unreadCount);
  const wcheckNewBadge = wcheckNewCount > 99 ? "99+" : String(wcheckNewCount);

  function closeMobileMenu() {
    setMobileOpen(false);
  }

  useEffect(() => {
    if (!mobileOpen) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setMobileOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [mobileOpen]);

  const navBody = (
    <>
      <Link href="/" onClick={closeMobileMenu} className="block px-2 pb-4 text-lg font-bold text-white">
        DOUSEN WORK
      </Link>

      <form action="/clients" method="get" className="mb-4 px-2">
        <input
          type="text"
          name="q"
          placeholder="顧客名・店舗名・顧客IDで検索"
          className="w-full rounded-md border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-white placeholder:text-neutral-500"
        />
      </form>

      <div className="flex flex-col gap-4">
        {groups.map((group) => (
          <div key={group.title}>
            <p className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
              {group.title}
            </p>
            <nav className="flex flex-col gap-0.5">
              {group.items.map((item) => {
                const active = isActive(pathname, item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={closeMobileMenu}
                    className={`flex items-center justify-between gap-2 rounded-md border-l-2 px-2.5 py-2 text-sm ${
                      active
                        ? "border-[var(--accent)] bg-[var(--accent-soft-bg)] font-medium text-[var(--accent-soft-text)]"
                        : item.subtle
                          ? "border-transparent text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200"
                          : "border-transparent text-neutral-200 hover:bg-neutral-800"
                    }`}
                  >
                    <span>{item.label}</span>
                    {item.href === "/notifications" && unreadCount > 0 ? (
                      <span className="rounded-full bg-red-600 px-1.5 py-0.5 text-[10px] font-medium leading-none text-white">
                        {unreadBadge}
                      </span>
                    ) : item.href === "/wchecks" && wcheckNewCount > 0 ? (
                      <span className="rounded-full bg-[var(--accent-soft-bg)] px-1.5 py-0.5 text-[10px] font-semibold leading-none text-[var(--accent-soft-text)]">
                        {wcheckNewBadge}
                      </span>
                    ) : null}
                  </Link>
                );
              })}
            </nav>
          </div>
        ))}
      </div>

      <div className="mt-6 flex flex-col gap-0.5 border-t border-neutral-800 pt-4">
        <p className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">自分</p>
        <Link
          href="/account"
          onClick={closeMobileMenu}
          className={`rounded-md border-l-2 px-2.5 py-2 text-sm ${
            isActive(pathname, "/account")
              ? "border-[var(--accent)] bg-[var(--accent-soft-bg)] font-medium text-[var(--accent-soft-text)]"
              : "border-transparent text-neutral-200 hover:bg-neutral-800"
          }`}
        >
          アカウント設定
        </Link>
        <form action={onLogout}>
          <button
            type="submit"
            className="w-full rounded-md border-l-2 border-transparent px-2.5 py-2 text-left text-sm text-neutral-200 hover:bg-neutral-800"
          >
            ログアウト
          </button>
        </form>
      </div>
    </>
  );

  return (
    <div className="lg:contents">
      {/* スマホ用ヘッダー */}
      <div className="flex items-center justify-between border-b border-neutral-200 bg-white px-4 py-3 lg:hidden">
        <Link href="/" className="text-sm font-semibold text-neutral-900">
          DOUSEN WORK
        </Link>
        <div className="flex items-center gap-3">
          {unreadCount > 0 ? (
            <span className="rounded-full bg-red-600 px-1.5 py-0.5 text-[10px] font-medium leading-none text-white">
              {unreadBadge}
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            aria-label="メニューを開く"
            className="rounded-md border border-neutral-300 px-2.5 py-1.5 text-sm text-neutral-700"
          >
            ☰
          </button>
        </div>
      </div>

      {/* PC用サイドバー（常時表示・独立スクロール） */}
      <aside className="hidden lg:sticky lg:top-0 lg:flex lg:h-screen lg:w-[250px] lg:shrink-0 lg:flex-col lg:overflow-y-auto lg:bg-neutral-900 lg:p-4">
        {navBody}
      </aside>

      {/* スマホ用ドロワー */}
      {mobileOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setMobileOpen(false)}
            aria-hidden="true"
          />
          <aside className="absolute inset-y-0 left-0 flex w-[82vw] max-w-[300px] flex-col overflow-y-auto bg-neutral-900 p-4">
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              aria-label="メニューを閉じる"
              className="mb-2 self-end rounded-md p-1 text-neutral-400 hover:text-white"
            >
              ×
            </button>
            {navBody}
          </aside>
        </div>
      ) : null}
    </div>
  );
}
