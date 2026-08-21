// 素材待ちの経過日数に応じた表示レベル。
// 7日以上: 注意(黄), 14日以上: 催促対象(赤)。docs/automation-rules.md 準拠。

export type MaterialWaitLevel = "none" | "warning" | "urgent";

export function getMaterialWaitElapsedDays(
  materialWaitStartedAt: string | null,
  now: Date = new Date(),
): number | null {
  if (!materialWaitStartedAt) return null;
  const started = new Date(materialWaitStartedAt);
  const diffMs = now.getTime() - started.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

export function getMaterialWaitLevel(
  materialWaitStartedAt: string | null,
  now: Date = new Date(),
): MaterialWaitLevel {
  const days = getMaterialWaitElapsedDays(materialWaitStartedAt, now);
  if (days === null) return "none";
  if (days >= 14) return "urgent";
  if (days >= 7) return "warning";
  return "none";
}
