/**
 * 通知の種別ごとの色。既存の状態色ルール（素材=オレンジ／Wチェック=パープル／
 * 顧客確認=ピンク／完了系=グリーン）と矛盾しないように合わせている。
 * 表示専用で、notification_type の値そのもの（DB・生成ロジック）は変更しない。
 */
interface NotificationTypeStyle {
  bg: string;
  text: string;
  icon: string;
}

const NOTIFICATION_TYPE_STYLE: Record<string, NotificationTypeStyle> = {
  new_material: { bg: "bg-orange-100", text: "text-orange-700", icon: "📦" },
  wcheck_requested: { bg: "bg-purple-100", text: "text-purple-700", icon: "🔍" },
  wcheck_approved: { bg: "bg-green-100", text: "text-green-700", icon: "✅" },
  wcheck_revision_requested: { bg: "bg-purple-100", text: "text-purple-700", icon: "✏️" },
  client_confirmation_approved: { bg: "bg-green-100", text: "text-green-700", icon: "✅" },
  client_confirmation_revision_requested: { bg: "bg-pink-100", text: "text-pink-700", icon: "💬" },
  outsourcing_delivered: { bg: "bg-blue-100", text: "text-blue-700", icon: "📁" },
  task_due_today: { bg: "bg-red-50", text: "text-red-700", icon: "⏰" },
};

const DEFAULT_NOTIFICATION_TYPE_STYLE: NotificationTypeStyle = {
  bg: "bg-neutral-100",
  text: "text-neutral-600",
  icon: "🔔",
};

export function notificationTypeStyle(type: string): NotificationTypeStyle {
  return NOTIFICATION_TYPE_STYLE[type] ?? DEFAULT_NOTIFICATION_TYPE_STYLE;
}
