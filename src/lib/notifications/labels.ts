export const NOTIFICATION_TYPE_LABELS: Record<string, string> = {
  new_material: "新着素材",
  wcheck_requested: "Wチェック依頼",
  wcheck_approved: "WチェックOK",
  wcheck_revision_requested: "Wチェック修正依頼",
  client_confirmation_approved: "顧客OK",
  client_confirmation_revision_requested: "顧客修正依頼",
  outsourcing_delivered: "外注納品",
  task_due_today: "今日締切",
};

export function notificationTypeLabel(type: string): string {
  return NOTIFICATION_TYPE_LABELS[type] ?? type;
}
