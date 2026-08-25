import type { ReactNode } from "react";

/**
 * 全画面共通のPCコンテンツ幅。SiteHeaderも同じ値を使う。
 * 1366〜1920px程度のPC画面では画面幅の一定割合（85vw）を使いつつ、
 * 大画面では1400pxで頭打ちにして読みやすい行長を保つ。
 * スマホ（lg未満）では幅100%＋左右px-4（従来通り）。
 */
export const PAGE_WIDTH_CLASS = "w-full lg:w-[min(85vw,1400px)]";

export function PageContainer({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <main className={`mx-auto flex min-h-screen ${PAGE_WIDTH_CLASS} flex-col px-4 lg:px-0 ${className}`}>
      {children}
    </main>
  );
}
