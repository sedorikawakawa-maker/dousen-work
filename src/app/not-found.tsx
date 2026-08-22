import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-lg font-semibold text-neutral-900">ページが見つかりません</h1>
      <p className="text-sm text-neutral-500">
        URLが正しくないか、対象のデータが削除・無効化された可能性があります。
      </p>
      <Link
        href="/"
        className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white"
      >
        ダッシュボードに戻る
      </Link>
    </main>
  );
}
