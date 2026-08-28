import type { ReactNode } from "react";

export type PageContainerVariant = "normal" | "wide" | "narrow";

/**
 * サイドバー導入後は右メイン領域（グリッドの1fr列）が基準幅になるため、
 * vw基準ではなくその領域に対する相対幅（w-full）＋上限(max-w)で幅を決める。
 * - normal: 既存24ページのデフォルト。表・カード中心の一般的な業務画面。
 * - wide: 表・カレンダー・管理画面など、横幅を広く使いたい画面のみ明示的に指定する。
 * - narrow: フォーム等、行長を絞りたい画面向け（多くのフォームは従来通り自前のmax-w-*を
 *   className側で指定しているため、narrowは主に新規ページ向けの選択肢として用意する）。
 */
const VARIANT_CLASS: Record<PageContainerVariant, string> = {
  // mx-autoによる自動マージンで既存と同じ見た目になるため、lg以上の左右paddingは付けない（現状互換）。
  normal: "w-full lg:max-w-[1400px] lg:px-0",
  narrow: "w-full lg:max-w-3xl lg:px-0",
  // wideはmx-autoの余白がほぼ無くなるため、サイドバー・画面端との間に明示的な余白を確保する。
  wide: "w-full lg:px-8",
};

export function PageContainer({
  children,
  className = "",
  variant = "normal",
}: {
  children: ReactNode;
  className?: string;
  variant?: PageContainerVariant;
}) {
  return (
    <main className={`mx-auto flex min-h-screen ${VARIANT_CLASS[variant]} flex-col px-4 ${className}`}>
      {children}
    </main>
  );
}
