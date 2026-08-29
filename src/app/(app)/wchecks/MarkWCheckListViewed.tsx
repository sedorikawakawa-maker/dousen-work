"use client";

import { useEffect, useRef, useTransition } from "react";
import { markWCheckListViewedAction } from "./actions";

/**
 * /wchecksの表示時に1度だけServer Actionを呼び、閲覧時刻を記録する（Sidebar新着バッジ用）。
 * 何もレンダリングしない。マウント時の1回のみ実行し、再レンダリングでは呼び直さない。
 */
export function MarkWCheckListViewed() {
  const calledRef = useRef(false);
  const [, startTransition] = useTransition();

  useEffect(() => {
    if (calledRef.current) return;
    calledRef.current = true;
    startTransition(() => {
      markWCheckListViewedAction();
    });
  }, []);

  return null;
}
