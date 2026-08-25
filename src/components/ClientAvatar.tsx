const SIZE_CLASS: Record<"xs" | "sm" | "md", string> = {
  xs: "h-6 w-6 text-[10px]",
  sm: "h-9 w-9 text-sm",
  md: "h-12 w-12 text-base",
};

/**
 * 顧客名を表示するカード/ボタン/一覧行の先頭で共通して使う、丸型サムネイル。
 * thumbnailUrlが無い場合は会社名/店舗名の頭文字によるプレースホルダーを表示する。
 * 顧客名を表示する箇所（一覧・ダッシュボード・通知・Wチェック待ち・顧客確認待ち・
 * 顧客詳細ヘッダー等）はこのコンポーネントで統一する。
 */
export function ClientAvatar({
  thumbnailUrl,
  name,
  size = "sm",
}: {
  thumbnailUrl?: string | null;
  name: string;
  size?: "xs" | "sm" | "md";
}) {
  const sizeClass = SIZE_CLASS[size];
  const initial = name.trim().charAt(0) || "?";

  if (thumbnailUrl) {
    // eslint-disable-next-line @next/next/no-img-element -- Supabase Storageの公開URルを直接表示するため
    return <img src={thumbnailUrl} alt="" className={`shrink-0 rounded-full object-cover ${sizeClass}`} />;
  }

  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center rounded-full bg-neutral-200 font-semibold text-neutral-500 ${sizeClass}`}
    >
      {initial}
    </span>
  );
}
