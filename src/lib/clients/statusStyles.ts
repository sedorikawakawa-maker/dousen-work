import type {
  ClientCurrentStatus,
  ContractStatus,
  InternalTaskStatus,
  OutsourcingStatus,
  ProductionTaskStatus,
} from "@/lib/supabase/database.types";

/**
 * 状態色（何の状態か）と緊急度色（どれくらい急ぐか）は別の軸として扱う。
 * 状態色は常にこのマッピングのみで決まり、緊急度によって赤に置き換えたりしない。
 * 顧客/タスクだけでなく、外注・社内タスク・契約ステータスのstatusもここに集約し、StatusBadgeで使い回す。
 */
export type StatusValue =
  | ClientCurrentStatus
  | ProductionTaskStatus
  | OutsourcingStatus
  | InternalTaskStatus
  | ContractStatus;

interface StatusStyle {
  bg: string;
  text: string;
}

export const STATUS_BADGE_STYLE: Record<StatusValue, StatusStyle> = {
  on_track: { bg: "bg-green-100", text: "text-green-700" },
  material_waiting: { bg: "bg-orange-100", text: "text-orange-700" },
  production_waiting: { bg: "bg-blue-100", text: "text-blue-700" },
  in_production: { bg: "bg-blue-100", text: "text-blue-700" },
  wcheck_waiting: { bg: "bg-purple-100", text: "text-purple-700" },
  client_confirmation_waiting: { bg: "bg-pink-100", text: "text-pink-700" },
  posting_waiting: { bg: "bg-cyan-100", text: "text-cyan-700" },
  completed: { bg: "bg-neutral-100", text: "text-neutral-600" },
  paused: { bg: "bg-neutral-100", text: "text-neutral-500" },
  other: { bg: "bg-neutral-100", text: "text-neutral-500" },
  // 外注(OutsourcingStatus)
  draft: { bg: "bg-neutral-100", text: "text-neutral-500" },
  requested: { bg: "bg-blue-100", text: "text-blue-700" },
  in_progress: { bg: "bg-indigo-100", text: "text-indigo-700" },
  delivered: { bg: "bg-orange-100", text: "text-orange-700" },
  cancelled: { bg: "bg-neutral-100", text: "text-neutral-400" },
  // 社内タスク(InternalTaskStatus)
  not_started: { bg: "bg-neutral-100", text: "text-neutral-500" },
  done: { bg: "bg-neutral-100", text: "text-neutral-600" },
  // 契約ステータス(ContractStatus)。pausedはClientCurrentStatusのpausedと共通の色を使う。
  contracted: { bg: "bg-green-100", text: "text-green-700" },
  proposal: { bg: "bg-amber-100", text: "text-amber-700" },
  contract_preparation: { bg: "bg-yellow-100", text: "text-yellow-800" },
  lost: { bg: "bg-neutral-200", text: "text-neutral-600" },
  ended: { bg: "bg-rose-100", text: "text-rose-700" },
};

/**
 * 顧客一覧カードの背景色（contract_status用）。現在状態(current_status)は
 * CLIENT_STATUS_BORDER_ACCENTで左端borderに表す役割分担のため、この2つの色の
 * 意味を混ぜないこと。ごく薄い背景＋同系色の薄いborderに留め、原色は使わない。
 */
export const CONTRACT_STATUS_CARD_BG: Record<ContractStatus, { bg: string; border: string }> = {
  contracted: { bg: "bg-green-50", border: "border-green-200" },
  proposal: { bg: "bg-blue-50", border: "border-blue-200" },
  contract_preparation: { bg: "bg-amber-50", border: "border-amber-200" },
  lost: { bg: "bg-neutral-100", border: "border-neutral-200" },
  paused: { bg: "bg-neutral-50", border: "border-neutral-200" },
  ended: { bg: "bg-neutral-100", border: "border-neutral-200" },
};

/**
 * 顧客一覧カードの左端アクセント用。StatusBadgeと同じ色相の薄いborderを使い、
 * 緊急度（赤・amber系のみ）とは重ならない色を選んでいる。
 */
export const CLIENT_STATUS_BORDER_ACCENT: Record<ClientCurrentStatus, string> = {
  on_track: "border-l-green-300",
  material_waiting: "border-l-orange-300",
  in_production: "border-l-blue-300",
  wcheck_waiting: "border-l-purple-300",
  client_confirmation_waiting: "border-l-pink-300",
  posting_waiting: "border-l-cyan-300",
  paused: "border-l-neutral-300",
  other: "border-l-neutral-300",
};

/** 緊急度は状態とは独立したバッジで表現する（状態色を赤へ置き換えない）。 */
export type UrgencyLevel = "overdue" | "due_today" | "urgent" | "warning";

interface UrgencyStyle {
  label: string;
  bg: string;
  text: string;
  border: string;
}

export const URGENCY_STYLE: Record<UrgencyLevel, UrgencyStyle> = {
  overdue: { label: "期限超過", bg: "bg-red-50", text: "text-red-700", border: "border-red-400" },
  urgent: { label: "最優先", bg: "bg-red-50", text: "text-red-700", border: "border-red-400" },
  due_today: { label: "本日締切", bg: "bg-red-50", text: "text-red-600", border: "border-red-300" },
  warning: { label: "注意", bg: "bg-amber-50", text: "text-amber-700", border: "border-amber-300" },
};
