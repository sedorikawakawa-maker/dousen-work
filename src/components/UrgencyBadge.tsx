import { URGENCY_STYLE, type UrgencyLevel } from "@/lib/clients/statusStyles";

/** 「どれくらい急ぐか」だけを表すバッジ。状態バッジ（StatusBadge）とは常に別に表示する。 */
export function UrgencyBadge({ level }: { level: UrgencyLevel }) {
  const style = URGENCY_STYLE[level];
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-semibold ${style.bg} ${style.text} ${style.border}`}
    >
      <span aria-hidden="true">⚠</span>
      {style.label}
    </span>
  );
}
