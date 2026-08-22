import type { OutsourcingStatus } from "@/lib/supabase/database.types";

export const OUTSOURCING_STATUS_LABELS: Record<OutsourcingStatus, string> = {
  draft: "下書き",
  requested: "依頼中",
  in_progress: "対応中",
  delivered: "納品済み（未確認）",
  completed: "完了",
  cancelled: "中止",
};

export const OUTSOURCING_STATUS_OPTIONS = Object.entries(OUTSOURCING_STATUS_LABELS) as [
  OutsourcingStatus,
  string,
][];
