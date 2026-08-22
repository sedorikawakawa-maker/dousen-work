// 顧客確認待ちの経過日数に応じた表示レベル。
// 14日未満: 経過日数に応じた段階色分け(7日以上で注意/黄)、14日以上: 最優先催促(赤)。
// docs/automation-rules.md 準拠。自動でLINE等を送信する処理は行わない。

export type ClientConfirmationLevel = "none" | "warning" | "urgent";

export function getClientConfirmationElapsedDays(
  requestedAt: string | null,
  now: Date = new Date(),
): number | null {
  if (!requestedAt) return null;
  const diffMs = now.getTime() - new Date(requestedAt).getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

export function getClientConfirmationLevel(
  requestedAt: string | null,
  now: Date = new Date(),
): ClientConfirmationLevel {
  const days = getClientConfirmationElapsedDays(requestedAt, now);
  if (days === null) return "none";
  if (days >= 14) return "urgent";
  if (days >= 7) return "warning";
  return "none";
}

export const CLIENT_CONFIRMATION_URGENT_THRESHOLD_DAYS = 14;
