"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // 開発時はコンソールで詳細を確認できるようにする（本番でもエラー追跡があれば送信先を追加）
    console.error(error);
  }, [error]);

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-lg font-semibold text-neutral-900">エラーが発生しました</h1>
      <p className="text-sm text-neutral-500">
        データの取得または保存に失敗しました。時間をおいて再度お試しください。
      </p>
      <button
        type="button"
        onClick={reset}
        className="rounded-full bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[var(--accent-strong)]"
      >
        再読み込み
      </button>
    </main>
  );
}
