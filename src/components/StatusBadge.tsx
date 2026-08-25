import { STATUS_BADGE_STYLE, type StatusValue } from "@/lib/clients/statusStyles";

/** 「何の状態か」だけを表す色付きバッジ。緊急度の表現は UrgencyBadge を併用する。 */
export function StatusBadge({ status, label }: { status: StatusValue; label: string }) {
  const style = STATUS_BADGE_STYLE[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ${style.bg} ${style.text}`}
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" aria-hidden="true" />
      {label}
    </span>
  );
}
