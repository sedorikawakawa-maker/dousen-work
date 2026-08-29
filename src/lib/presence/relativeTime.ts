/** 日本時間のカレンダー日で「YYYY-MM-DD」を返す（"昨日"判定に使う）。 */
function jstDayKey(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(date);
}

/**
 * オフラインstaffの最終アクセス表示用。毎秒更新は想定せず、粗い相対表示のみ行う。
 * 例: たった今 / 5分前 / 2時間前 / 昨日 / 3日前
 */
export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  const diffSec = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (diffSec < 60) return "たった今";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}分前`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}時間前`;

  const dayDiff = Math.round(
    (new Date(jstDayKey(now)).getTime() - new Date(jstDayKey(date)).getTime()) / (24 * 60 * 60 * 1000),
  );
  if (dayDiff <= 1) return "昨日";
  return `${dayDiff}日前`;
}
