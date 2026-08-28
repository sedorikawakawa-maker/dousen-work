import type { Database } from "@/lib/supabase/database.types";
import { POST_TYPE_LABELS, PRODUCTION_TASK_STATUS_LABELS } from "@/lib/clients/labels";
import type { StatusValue, UrgencyLevel } from "@/lib/clients/statusStyles";
import { getClientConfirmationElapsedDays, getClientConfirmationLevel } from "@/lib/reminders/clientConfirmation";
import { INTERNAL_TASK_PRIORITY_LABELS, INTERNAL_TASK_STATUS_LABELS } from "@/lib/internalTasks/labels";
import type { PendingWCheckItem } from "@/lib/wchecks/queries";
import { relevantDueDates, type DashboardData } from "./queries";

type ProductionTaskRow = Database["public"]["Tables"]["production_tasks"]["Row"];
type InternalTaskRow = Database["public"]["Tables"]["internal_tasks"]["Row"];

/** 「今日」は日本時間の暦日で判定する（internalTasks/queries.tsのtodayIsoと同じ理由）。 */
function todayIsoJST(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const lookup = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${lookup.year}-${lookup.month}-${lookup.day}`;
}

/**
 * 社内タスクを「今日やること」に採用するかどうかの判定。
 * 期限超過・今日締切のものに加え、期限に関わらずpriority Aのものも対象とする
 * （期限が無い/先でも優先度Aなら埋もれさせない）。それ以外は「担当社内タスク」側に回す。
 */
export function classifyInternalTaskForToday(
  task: InternalTaskRow,
  todayJST: string,
): "overdue" | "due_today" | "priority_a" | null {
  const dueDate = task.due_at ? task.due_at.slice(0, 10) : null;
  if (dueDate && dueDate < todayJST) return "overdue";
  if (dueDate === todayJST) return "due_today";
  if (task.priority === "A") return "priority_a";
  return null;
}

/**
 * 「今日やること」に採用されなかった残りの未完了社内タスク（担当社内タスク一覧向け）。
 * 重複表示を避けるため、buildTodayActionItemsと同じ判定基準で除外する。
 */
export function selectRemainingInternalTasks(myIncompleteInternalTasks: InternalTaskRow[]): InternalTaskRow[] {
  const todayJST = todayIsoJST();
  return myIncompleteInternalTasks.filter(
    (task) => classifyInternalTaskForToday(task, todayJST) === null,
  );
}

export interface TodayActionItem {
  id: string;
  statusValue: StatusValue;
  statusLabel: string;
  clientName: string;
  /** ClientAvatar表示用。今のところWチェック修正依頼カードのみで使用する。 */
  clientThumbnailUrl?: string | null;
  title: string;
  meta: string | null;
  assignmentTag: string | null;
  /** assignmentTagを強調表示するか（例: 自分が指定されたWチェック）。 */
  assignmentHighlight?: boolean;
  urgency: UrgencyLevel | null;
  href: string;
  actionLabel: string;
  /** Wチェック修正依頼専用の強調表示・詳細情報。通常の制作中タスクと区別するために使う。 */
  wcheckRevision?: {
    postTypeLabel: string;
    revisionComment: string;
    requestedAt: string;
    scheduledPostDate: string | null;
  };
}

const TASK_ACTION_LABEL: Partial<Record<ProductionTaskRow["status"], string>> = {
  material_waiting: "素材の督促・確認",
  production_waiting: "制作を進める",
  in_production: "制作を進める",
  wcheck_waiting: "Wチェック依頼を確認",
  client_confirmation_waiting: "顧客の返信を確認",
  posting_waiting: "投稿実績を登録",
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function earliestDueDate(task: ProductionTaskRow): string | null {
  const dates = relevantDueDates(task);
  return dates.length > 0 ? [...dates].sort()[0] : null;
}

const URGENCY_RANK: Record<UrgencyLevel, number> = {
  overdue: 0,
  urgent: 0,
  due_today: 1,
  warning: 2,
};

/**
 * 「今日締切」「Wチェック待ち」「顧客確認待ち」「素材待ち」「投稿待ち」といった
 * 別々に取得済みのダッシュボードデータを、既存の判定ロジック（日付比較・
 * 既存の経過日数しきい値）だけを使ってひとつの優先度順リストにまとめる。
 * 新しい業務ルールは追加しない。
 */
export function buildTodayActionItems(params: {
  dashboard: DashboardData;
  staffId: string;
  clientNameById: Map<string, string>;
  clientThumbnailById?: Map<string, string | null>;
  /** 自分の担当分で未完了の社内タスク全件（listMyIncompleteInternalTasksの結果）。 */
  myIncompleteInternalTasks?: InternalTaskRow[];
  /** 自分が担当者の制作タスクで、Wチェック修正依頼が未対応のまま残っているもの。 */
  pendingWCheckRevisions?: PendingWCheckItem[];
}): TodayActionItem[] {
  const {
    dashboard,
    staffId,
    clientNameById,
    clientThumbnailById = new Map(),
    myIncompleteInternalTasks = [],
    pendingWCheckRevisions = [],
  } = params;
  const today = todayIso();
  const todayJST = todayIsoJST();

  const taskById = new Map<string, ProductionTaskRow>();
  for (const task of [
    ...dashboard.dueTodayTasks,
    ...dashboard.priorityTasks,
    ...dashboard.postingWaitingTasks,
  ]) {
    taskById.set(task.id, task);
  }

  const taskItems: TodayActionItem[] = [...taskById.values()].map((task) => {
    const earliest = earliestDueDate(task);
    const urgency: UrgencyLevel | null =
      earliest !== null && earliest < today ? "overdue" : earliest === today ? "due_today" : null;
    return {
      id: `task-${task.id}`,
      statusValue: task.status,
      statusLabel: PRODUCTION_TASK_STATUS_LABELS[task.status],
      clientName: clientNameById.get(task.client_id) ?? "不明な顧客",
      title: task.title,
      meta: !task.assignee_staff_id ? "未割当" : null,
      assignmentTag: null,
      urgency,
      href: `/tasks/${task.id}`,
      actionLabel: TASK_ACTION_LABEL[task.status] ?? "タスクを確認",
    };
  });

  // Wチェックは全スタッフが対応可能という業務方針のため全社分を対象とするが、
  // 「あなたへのWチェック」を明示的に最優先（他の指定なし/他スタッフ指定より上）に並べ替える。
  const wcheckItems: TodayActionItem[] = [...dashboard.wcheckWaitingItems]
    .sort((a, b) => {
      const aMine = a.wcheck.reviewer_staff_id === staffId ? 0 : 1;
      const bMine = b.wcheck.reviewer_staff_id === staffId ? 0 : 1;
      return aMine - bMine;
    })
    .map(({ wcheck, task }) => {
      const isMine = wcheck.reviewer_staff_id === staffId;
      return {
        id: `wcheck-${wcheck.id}`,
        statusValue: "wcheck_waiting" as const,
        statusLabel: "Wチェック待ち",
        clientName: clientNameById.get(task.client_id) ?? "不明な顧客",
        title: task.title,
        meta: null,
        assignmentTag: isMine ? "あなたへのWチェック" : wcheck.reviewer_staff_id ? "他スタッフ指定" : "指定なし（誰でも確認可）",
        assignmentHighlight: isMine,
        urgency: null,
        href: `/tasks/${task.id}`,
        actionLabel: "Wチェックする",
      };
    });

  const confirmationItems: TodayActionItem[] = dashboard.myClientConfirmationWaitingItems.map(
    ({ confirmation, task }) => {
      const days = getClientConfirmationElapsedDays(confirmation.requested_at);
      const level = getClientConfirmationLevel(confirmation.requested_at);
      return {
        id: `confirmation-${confirmation.id}`,
        statusValue: "client_confirmation_waiting",
        statusLabel: "顧客確認待ち",
        clientName: clientNameById.get(task.client_id) ?? "不明な顧客",
        title: task.title,
        meta: days !== null ? `${days}日経過` : null,
        assignmentTag: null,
        urgency: level === "urgent" ? "urgent" : level === "warning" ? "warning" : null,
        href: `/tasks/${task.id}`,
        actionLabel: "顧客に督促する",
      };
    },
  );

  // Wチェック修正依頼: 通常の制作中タスクと区別するため、専用のwcheckRevisionフィールドを持たせる。
  // かなり優先度の高い項目として扱うため urgency は "urgent"（最優先）とする。
  const wcheckRevisionItems: TodayActionItem[] = pendingWCheckRevisions.map(({ wcheck, task }) => ({
    id: `wcheck-revision-${task.id}`,
    statusValue: task.status,
    statusLabel: PRODUCTION_TASK_STATUS_LABELS[task.status],
    clientName: clientNameById.get(task.client_id) ?? "不明な顧客",
    clientThumbnailUrl: clientThumbnailById.get(task.client_id) ?? null,
    title: task.title,
    meta: null,
    assignmentTag: null,
    urgency: "urgent",
    href: `/tasks/${task.id}`,
    actionLabel: "修正内容を確認",
    wcheckRevision: {
      postTypeLabel: POST_TYPE_LABELS[task.post_type],
      revisionComment: wcheck.revision_comment ?? "",
      requestedAt: wcheck.reviewed_at ?? wcheck.requested_at,
      scheduledPostDate: task.scheduled_post_date,
    },
  }));

  // 素材待ちは「今日やること」の対象からは外し、経過日数に応じて「要対応」セクション
  // （selectPersonalInterventions）へ一本化する（同じ案件が両方に出るのを避けるため）。

  const internalTaskItems: TodayActionItem[] = myIncompleteInternalTasks
    .map((task) => ({ task, classification: classifyInternalTaskForToday(task, todayJST) }))
    .filter(
      (x): x is { task: InternalTaskRow; classification: "overdue" | "due_today" | "priority_a" } =>
        x.classification !== null,
    )
    .map(({ task, classification }) => {
      const urgency: UrgencyLevel | null =
        classification === "overdue" ? "overdue" : classification === "due_today" ? "due_today" : null;
      return {
        id: `internal-${task.id}`,
        statusValue: task.status,
        statusLabel: INTERNAL_TASK_STATUS_LABELS[task.status],
        clientName: task.client_id ? (clientNameById.get(task.client_id) ?? "不明な顧客") : "社内タスク",
        title: task.title,
        meta: `${task.category} ・ 優先度${INTERNAL_TASK_PRIORITY_LABELS[task.priority]}`,
        assignmentTag: null,
        urgency,
        href: `/internal-tasks/${task.id}/edit`,
        actionLabel: "社内タスクを確認",
      };
    });

  const items = [
    ...taskItems,
    ...wcheckRevisionItems,
    ...wcheckItems,
    ...confirmationItems,
    ...internalTaskItems,
  ];

  items.sort((a, b) => {
    const rankA = a.urgency ? URGENCY_RANK[a.urgency] : 9;
    const rankB = b.urgency ? URGENCY_RANK[b.urgency] : 9;
    return rankA - rankB;
  });

  return items;
}
