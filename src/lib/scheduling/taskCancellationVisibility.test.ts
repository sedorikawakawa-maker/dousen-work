import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { listUpcomingProductionTasks } from "@/lib/clients/queries";
import { listScheduledPostsForMonth } from "@/lib/calendar/queries";
import { listCandidateTasksForPostRecord, listRecentlyCompletedTasks } from "@/lib/postRecords/queries";
import { getCurrentMonthClientProgress, getDashboardData } from "@/lib/dashboard/queries";
import {
  countPendingWChecks,
  listPendingWCheckRevisionsForAssignee,
  listPendingWChecksWithTasks,
  listWChecksForTask,
} from "@/lib/wchecks/queries";
import {
  listClientConfirmationsForClient,
  listClientConfirmationsForTask,
  listPendingClientConfirmationsWithTasks,
} from "@/lib/clientConfirmations/queries";

type TaskRow = Database["public"]["Tables"]["production_tasks"]["Row"];

// 取消済みタスクが通常の一覧・ダッシュボード集計に出てこないことを、
// スタブ側でeq/is/neq/gte/lt/in等を実際に評価して検証する
// （「.is()が呼ばれたか」ではなく、絞り込みの結果まで確認する）。

type Filter = { method: string; args: unknown[] };

function rowMatches(row: Record<string, unknown>, filters: Filter[]): boolean {
  for (const { method, args } of filters) {
    const [column, value] = args as [string, unknown];
    const actual = row[column];
    if (method === "eq" && actual !== value) return false;
    if (method === "is" && actual !== value) return false;
    if (method === "neq" && actual === value) return false;
    if (method === "gte" && !(String(actual) >= String(value))) return false;
    if (method === "lte" && !(String(actual) <= String(value))) return false;
    if (method === "lt" && !(String(actual) < String(value))) return false;
    if (method === "in" && !(value as unknown[]).includes(actual)) return false;
    if (method === "not" && args[1] === "is" && args[2] === null && actual === null) return false;
  }
  return true;
}

function createStub(rowsByTable: Record<string, Record<string, unknown>[]>) {
  const from = vi.fn((table: string) => {
    const filters: Filter[] = [];
    const resolve = () => ({
      data: (rowsByTable[table] ?? []).filter((row) => rowMatches(row, filters)),
      error: null,
    });

    const chain: Record<string, unknown> = {
      maybeSingle: async () => ({ data: resolve().data[0] ?? null, error: null }),
      single: async () => ({ data: resolve().data[0] ?? null, error: null }),
      then: (onFulfilled: (v: unknown) => void, onRejected: (e: unknown) => void) =>
        Promise.resolve(resolve()).then(onFulfilled, onRejected),
    };
    for (const method of ["select", "eq", "is", "neq", "gte", "lte", "lt", "in", "not", "order", "limit"]) {
      chain[method] = (...args: unknown[]) => {
        filters.push({ method, args });
        return chain;
      };
    }
    // .or(...)（担当者/副担当のどちらかに一致）はこのスタブでは素通しにする。
    // ここで検証したいのはcancelled_atによる除外であり、担当者の絞り込みではないため。
    chain.or = () => chain;
    return chain;
  });

  return { from } as unknown as SupabaseClient<Database>;
}

function task(overrides: Partial<TaskRow> = {}): Record<string, unknown> {
  return {
    id: "task-1",
    client_id: "client-1",
    schedule_rule_id: "rule-1",
    post_type: "reel",
    task_kind: "recurring",
    source_month: "2026-11-01",
    scheduled_post_date: "2026-11-09",
    original_scheduled_post_date: "2026-11-09",
    status: "production_waiting",
    assignee_staff_id: "staff-1",
    secondary_staff_id: null,
    title: "リール（2026-11-09）",
    is_carryover: false,
    cancelled_at: null,
    ...overrides,
  };
}

const normalTask = task({ id: "normal-task" });
const cancelledTask = task({
  id: "cancelled-task",
  scheduled_post_date: "2026-11-16",
  original_scheduled_post_date: "2026-11-16",
  cancelled_at: "2026-11-01T10:00:00Z",
  cancelled_by_staff_id: "staff-1",
  cancel_reason: "本数調整",
});

describe("取消済みタスクが通常の一覧から除外される", () => {
  it("顧客の投稿スケジュール一覧（listUpcomingProductionTasks）から除外される", async () => {
    const supabase = createStub({ production_tasks: [normalTask, cancelledTask] });
    const tasks = await listUpcomingProductionTasks(supabase, "client-1");
    expect(tasks.map((t) => t.id)).toEqual(["normal-task"]);
  });

  it("カレンダー（listScheduledPostsForMonth）から除外される", async () => {
    const supabase = createStub({ production_tasks: [normalTask, cancelledTask] });
    const tasks = await listScheduledPostsForMonth(supabase, ["client-1"], { year: 2026, month0: 10 });
    expect(tasks.map((t) => t.id)).toEqual(["normal-task"]);
  });

  it("投稿実績登録の対象タスク候補（listCandidateTasksForPostRecord）から除外される", async () => {
    const supabase = createStub({ production_tasks: [normalTask, cancelledTask] });
    const tasks = await listCandidateTasksForPostRecord(supabase, "client-1", "reel");
    expect(tasks.map((t) => t.id)).toEqual(["normal-task"]);
  });
});

describe("取消済みタスクがダッシュボード（今日やること・要対応）から除外される", () => {
  it("自分の未完了タスク（今日やること・優先タスク・投稿待ち）に取消済みタスクを含めない", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const supabase = createStub({
      client_assignments: [{ client_id: "client-1", assignment_type: "primary", staff_id: "staff-1", active_to: null }],
      clients_view: [{ id: "client-1", company_name: "テスト株式会社", created_at: "2026-01-01T00:00:00Z" }],
      posting_schedule_rules: [],
      post_records: [],
      production_tasks: [
        // 今日が投稿待ちの未取消タスクと、同条件の取消済みタスク。
        task({ id: "normal-posting", status: "posting_waiting", scheduled_post_date: today }),
        task({
          id: "cancelled-posting",
          status: "posting_waiting",
          scheduled_post_date: today,
          cancelled_at: "2026-11-01T10:00:00Z",
        }),
      ],
      material_submissions: [],
      w_checks: [],
      client_confirmations: [],
    });

    const data = await getDashboardData(supabase, "staff-1");

    expect(data.postingWaitingTasks.map((t) => t.id)).toEqual(["normal-posting"]);
    expect(data.postingWaitingTasks.map((t) => t.id)).not.toContain("cancelled-posting");
  });

  it("担当者未割当タスクの一覧に取消済みタスクを含めない", async () => {
    const supabase = createStub({
      client_assignments: [],
      clients_view: [],
      posting_schedule_rules: [],
      post_records: [],
      production_tasks: [
        task({ id: "unassigned-normal", assignee_staff_id: null }),
        task({ id: "unassigned-cancelled", assignee_staff_id: null, cancelled_at: "2026-11-01T10:00:00Z" }),
      ],
      material_submissions: [],
      w_checks: [],
      client_confirmations: [],
    });

    const data = await getDashboardData(supabase, "staff-1");

    expect(data.unassignedTasks.map((t) => t.id)).toEqual(["unassigned-normal"]);
  });
});

describe("取消済みタスクがダッシュボード集計から除外される", () => {
  it("今月の進捗（持越し件数）に取消済みタスクを数えない", async () => {
    const supabase = createStub({
      posting_schedule_rules: [{ client_id: "client-1", monthly_target: 4, is_active: true }],
      production_tasks: [
        // 過去月の未完了タスク2件のうち1件は取消済み → 持越しは1件だけ。
        task({ id: "past-normal", source_month: "2020-01-01" }),
        task({ id: "past-cancelled", source_month: "2020-01-01", cancelled_at: "2020-02-01T00:00:00Z" }),
      ],
      post_records: [],
    });

    const progress = await getCurrentMonthClientProgress(supabase, ["client-1"]);

    expect(progress.get("client-1")?.carryover).toBe(1);
    expect(progress.get("client-1")?.required).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// 全status取消対応: Wチェック待ち・顧客確認待ち等の業務キューからの除外と、履歴の保持
// ---------------------------------------------------------------------------

const CANCELLED_AT = "2026-11-10T00:00:00Z";

describe("取消済みタスクがWチェック待ちのキューから除外される", () => {
  const rows = {
    production_tasks: [
      task({ id: "wcheck-normal", status: "wcheck_waiting" }),
      task({ id: "wcheck-cancelled", status: "wcheck_waiting", cancelled_at: CANCELLED_AT }),
    ],
    w_checks: [
      { id: "w-normal", production_task_id: "wcheck-normal", status: "waiting", requested_at: "2026-11-05T00:00:00Z" },
      { id: "w-cancelled", production_task_id: "wcheck-cancelled", status: "waiting", requested_at: "2026-11-04T00:00:00Z" },
    ],
  };

  it("Wチェック待ち一覧（listPendingWChecksWithTasks）に取消済みタスクを含めない", async () => {
    const items = await listPendingWChecksWithTasks(createStub(rows));
    expect(items.map((i) => i.task.id)).toEqual(["wcheck-normal"]);
  });

  it("サイドバーのWチェック待ち件数（countPendingWChecks）も一覧と同じく取消済みを数えない", async () => {
    expect(await countPendingWChecks(createStub(rows))).toBe(1);
  });

  it("取消済みタスクのw_checks自体は削除されず、タスク詳細の履歴として取得できる", async () => {
    const history = await listWChecksForTask(createStub(rows), "wcheck-cancelled");
    expect(history.map((w) => w.id)).toEqual(["w-cancelled"]);
  });

  it("Wチェック修正依頼の未対応一覧（listPendingWCheckRevisionsForAssignee）に取消済みタスクを含めない", async () => {
    const supabase = createStub({
      production_tasks: [
        task({ id: "rev-normal", status: "in_production" }),
        task({ id: "rev-cancelled", status: "in_production", cancelled_at: CANCELLED_AT }),
      ],
      w_checks: [
        { id: "w1", production_task_id: "rev-normal", status: "revision_requested", requested_at: "2026-11-05T00:00:00Z" },
        { id: "w2", production_task_id: "rev-cancelled", status: "revision_requested", requested_at: "2026-11-05T00:00:00Z" },
      ],
      wcheck_skips: [],
    });
    const items = await listPendingWCheckRevisionsForAssignee(supabase, "staff-1");
    expect(items.map((i) => i.task.id)).toEqual(["rev-normal"]);
  });
});

describe("取消済みタスクが顧客確認待ちのキューから除外される", () => {
  const rows = {
    production_tasks: [
      task({ id: "cc-normal", status: "client_confirmation_waiting" }),
      task({ id: "cc-cancelled", status: "client_confirmation_waiting", cancelled_at: CANCELLED_AT }),
    ],
    client_confirmations: [
      { id: "c-normal", production_task_id: "cc-normal", status: "waiting", requested_at: "2026-11-05T00:00:00Z" },
      { id: "c-cancelled", production_task_id: "cc-cancelled", status: "waiting", requested_at: "2026-11-04T00:00:00Z" },
    ],
  };

  it("顧客確認待ち一覧・催促候補の元データ（listPendingClientConfirmationsWithTasks）に含めない", async () => {
    const items = await listPendingClientConfirmationsWithTasks(createStub(rows));
    expect(items.map((i) => i.task.id)).toEqual(["cc-normal"]);
  });

  it("取消済みタスクのclient_confirmationsは削除されず、タスク詳細・顧客の確認履歴から取得できる", async () => {
    const forTask = await listClientConfirmationsForTask(createStub(rows), "cc-cancelled");
    expect(forTask.map((c) => c.id)).toEqual(["c-cancelled"]);

    const forClient = await listClientConfirmationsForClient(createStub(rows), "client-1");
    expect(forClient.map((c) => c.id).sort()).toEqual(["c-cancelled", "c-normal"]);
  });
});

describe("全statusの取消済みタスクが通常一覧・ダッシュボードから除外される", () => {
  const STATUSES = [
    "material_waiting",
    "production_waiting",
    "in_production",
    "wcheck_waiting",
    "client_confirmation_waiting",
    "posting_waiting",
  ] as const;

  it.each(STATUSES)("status=%s の取消済みタスク（recurring/spot）は顧客の投稿スケジュール一覧に出ない", async (status) => {
    const supabase = createStub({
      production_tasks: [
        task({ id: "normal", status }),
        task({ id: "cancelled-recurring", status, cancelled_at: CANCELLED_AT }),
        task({ id: "cancelled-spot", status, task_kind: "spot", schedule_rule_id: null, cancelled_at: CANCELLED_AT }),
      ],
    });
    const tasks = await listUpcomingProductionTasks(supabase, "client-1");
    expect(tasks.map((t) => t.id)).toEqual(["normal"]);
  });

  it.each(STATUSES)("status=%s の取消済みタスクは自分の担当タスク（今日やること・要対応）に出ない", async (status) => {
    const supabase = createStub({
      client_assignments: [],
      clients_view: [],
      posting_schedule_rules: [],
      post_records: [],
      production_tasks: [
        task({ id: "normal", status }),
        task({ id: "cancelled-spot", status, task_kind: "spot", cancelled_at: CANCELLED_AT }),
      ],
      material_submissions: [],
      w_checks: [],
      client_confirmations: [],
    });
    const data = await getDashboardData(supabase, "staff-1");
    const ids = [...data.priorityTasks, ...data.dueTodayTasks, ...data.postingWaitingTasks].map((t) => t.id);
    expect(ids).not.toContain("cancelled-spot");
  });

  it("取消済みの完了タスクは顧客詳細の「投稿済み」一覧（listRecentlyCompletedTasks）に出ない", async () => {
    const supabase = createStub({
      production_tasks: [
        task({ id: "done-normal", status: "completed" }),
        task({ id: "done-cancelled", status: "completed", cancelled_at: CANCELLED_AT }),
      ],
    });
    const tasks = await listRecentlyCompletedTasks(supabase, "client-1");
    expect(tasks.map((t) => t.id)).toEqual(["done-normal"]);
  });
});
