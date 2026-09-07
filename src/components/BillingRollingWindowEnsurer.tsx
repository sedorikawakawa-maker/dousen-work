"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { ensureBillingRollingWindowAction } from "@/app/(app)/management/billing/actions";

/**
 * ページ表示のたびに1回だけ、現在月+2か月のローリング窓の不足分を補完する。
 * マウント時に一度だけ実行し（refで多重実行を防止）、何か生成された場合のみ
 * router.refresh()でServer Component側の一覧を再取得する。refresh自体はこの
 * コンポーネントを再マウントしないため、無限ループにはならない。
 * /management/billingと/management/revenueの両方から呼ばれる想定（実装は1箇所のみ）。
 */
export function BillingRollingWindowEnsurer() {
  const router = useRouter();
  const hasRunRef = useRef(false);

  useEffect(() => {
    if (hasRunRef.current) return;
    hasRunRef.current = true;

    ensureBillingRollingWindowAction()
      .then((result) => {
        if (result.itemsGenerated > 0) {
          router.refresh();
        }
      })
      .catch(() => {
        // 補完に失敗しても一覧表示自体は継続させる（致命的エラーにしない）。
      });
  }, [router]);

  return null;
}
