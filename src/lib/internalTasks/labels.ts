import type { InternalTaskPriority, InternalTaskStatus } from "@/lib/supabase/database.types";

export const INTERNAL_TASK_PRIORITY_LABELS: Record<InternalTaskPriority, string> = {
  A: "A（高）",
  B: "B（中）",
  C: "C（低）",
};

export const INTERNAL_TASK_PRIORITY_OPTIONS = Object.entries(
  INTERNAL_TASK_PRIORITY_LABELS,
) as [InternalTaskPriority, string][];

export const INTERNAL_TASK_STATUS_LABELS: Record<InternalTaskStatus, string> = {
  not_started: "未着手",
  in_progress: "作業中",
  done: "完了",
};

export const INTERNAL_TASK_STATUS_OPTIONS = Object.entries(
  INTERNAL_TASK_STATUS_LABELS,
) as [InternalTaskStatus, string][];

export const INTERNAL_TASK_NEXT_STATUS: Record<InternalTaskStatus, InternalTaskStatus | null> = {
  not_started: "in_progress",
  in_progress: "done",
  done: null,
};

export const INTERNAL_TASK_NEXT_STATUS_LABEL: Record<InternalTaskStatus, string> = {
  not_started: "作業中にする",
  in_progress: "完了にする",
  done: "完了済み",
};
