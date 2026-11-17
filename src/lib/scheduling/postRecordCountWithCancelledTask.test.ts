import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { getMonthlySummary } from "./generate";
import { getCurrentMonthClientProgress } from "@/lib/dashboard/queries";
import { getStaffProgressOverview } from "@/lib/management/staffProgress";

// ---------------------------------------------------------------------------
// 仕様: 制作タスク(production_tasks)の取消と投稿実績(post_records)の取消は別物。
//   ・制作タスクを取消しても、既存の有効なpost_recordは実績としてカウントし続ける
//     （月次サマリー・ダッシュボード今月実績・スタッフ実績のすべてで同じ意味）。
//   ・post_record自体を取消した場合のみ、全ての実績件数から除外する。
//   ・取消済みタスクは制作進捗（持越し・未完了・担当件数）には含めない。
// スタブ側でeq/is/neq/gte/lt/inを実際に評価し、絞り込みの結果まで確認する。
// ---------------------------------------------------------------------------

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
      then: (onFulfilled: (v: unknown) => void, onRejected: (e: unknown) => void) =>
        Promise.resolve(resolve()).then(onFulfilled, onRejected),
    };
    for (const method of ["select", "eq", "is", "neq", "gte", "lte", "lt", "in", "order", "limit"]) {
      chain[method] = (...args: unknown[]) => {
        filters.push({ method, args });
        return chain;
      };
    }
    return chain;
  });
  return { from } as unknown as SupabaseClient<Database>;
}

// 2026-11-18(水)に固定。今月=2026-11、今週の開始=2026-11-16(月)。
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-18T03:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

const TASK_CANCELLED_AT = "2026-11-18T01:00:00Z";

/** 完了済みタスク1件 + 有効な投稿実績1件の状態。取消状態を引数で切り替える。 */
function world(options: { taskCancelled: boolean; postRecordCancelled: boolean }) {
  return {
    staff: [{ id: "staff-1", last_name: "山田", first_name: "花子", role: "employee", is_active: true }],
    client_assignments: [{ staff_id: "staff-1", assignment_type: "primary", client_id: "client-1", active_to: null }],
    posting_schedule_rules: [
      { client_id: "client-1", post_type: "reel", monthly_target: 4, is_active: true },
    ],
    production_tasks: [
      {
        id: "task-done",
        client_id: "client-1",
        schedule_rule_id: "rule-1",
        post_type: "reel",
        task_kind: "recurring",
        source_month: "2026-11-01",
        scheduled_post_date: "2026-11-16",
        status: "completed",
        assignee_staff_id: "staff-1",
        cancelled_at: options.taskCancelled ? TASK_CANCELLED_AT : null,
      },
    ],
    post_records: [
      {
        id: "record-1",
        production_task_id: "task-done",
        client_id: "client-1",
        post_type: "reel",
        posted_by_staff_id: "staff-1",
        posted_at: "2026-11-17T05:00:00Z",
        cancelled_at: options.postRecordCancelled ? "2026-11-18T02:00:00Z" : null,
      },
    ],
  };
}

async function countEverywhere(rows: Record<string, Record<string, unknown>[]>) {
  const monthly = await getMonthlySummary(createStub(rows), "client-1");
  const dashboard = await getCurrentMonthClientProgress(createStub(rows), ["client-1"]);
  const staff = await getStaffProgressOverview(createStub(rows));
  return {
    monthlyActual: monthly[0].byPostType.reel.actual,
    monthlyCarryover: monthly[0].byPostType.reel.carryover,
    dashboardActual: dashboard.get("client-1")?.actual,
    dashboardCarryover: dashboard.get("client-1")?.carryover,
    staffCompletedThisWeek: staff.find((s) => s.staffId === "staff-1")?.completedThisWeekCount,
  };
}

describe("完了済みタスクを取消しても、有効な投稿実績は実績としてカウントし続ける", () => {
  it("1. 取消前: 完了済みタスク + 有効な投稿実績 → 全画面で実績1", async () => {
    const counts = await countEverywhere(world({ taskCancelled: false, postRecordCancelled: false }));
    expect(counts.monthlyActual).toBe(1);
    expect(counts.dashboardActual).toBe(1);
    expect(counts.staffCompletedThisWeek).toBe(1);
  });

  it("2〜5. その制作タスクを取消 → 月次サマリー・ダッシュボード・スタッフ実績すべて1のまま", async () => {
    const counts = await countEverywhere(world({ taskCancelled: true, postRecordCancelled: false }));
    expect(counts.monthlyActual).toBe(1); // 3. client monthly summary
    expect(counts.dashboardActual).toBe(1); // 4. dashboard 今月実績
    expect(counts.staffCompletedThisWeek).toBe(1); // 5. staff progress
  });

  it("6. 投稿実績(post_record)自体を取消 → 全ての実績件数から除外（タスク取消の有無に関係なく）", async () => {
    for (const taskCancelled of [false, true]) {
      const counts = await countEverywhere(world({ taskCancelled, postRecordCancelled: true }));
      expect(counts.monthlyActual).toBe(0);
      expect(counts.dashboardActual).toBe(0);
      expect(counts.staffCompletedThisWeek).toBe(0);
    }
  });
});

describe("7. 取消済みタスクは制作進捗の件数には含めない", () => {
  function progressWorld(cancelled: boolean) {
    const base = world({ taskCancelled: false, postRecordCancelled: false });
    return {
      ...base,
      post_records: [],
      production_tasks: [
        // 過去月の未完了タスク（持越し対象）と、今月の未完了タスク（担当件数対象）。
        {
          id: "past-open",
          client_id: "client-1",
          schedule_rule_id: "rule-1",
          post_type: "reel",
          task_kind: "recurring",
          source_month: "2026-10-01",
          scheduled_post_date: "2026-10-26",
          status: "production_waiting",
          assignee_staff_id: "staff-1",
          cancelled_at: cancelled ? TASK_CANCELLED_AT : null,
        },
        {
          id: "current-open",
          client_id: "client-1",
          schedule_rule_id: "rule-1",
          post_type: "reel",
          task_kind: "recurring",
          source_month: "2026-11-01",
          scheduled_post_date: "2026-11-23",
          status: "wcheck_waiting",
          assignee_staff_id: "staff-1",
          cancelled_at: cancelled ? TASK_CANCELLED_AT : null,
        },
      ],
    };
  }

  it("未取消なら持越し・担当件数に数え、取消済みなら数えない", async () => {
    const open = await countEverywhere(progressWorld(false));
    expect(open.monthlyCarryover).toBe(1);
    expect(open.dashboardCarryover).toBe(1);

    const cancelled = await countEverywhere(progressWorld(true));
    expect(cancelled.monthlyCarryover).toBe(0);
    expect(cancelled.dashboardCarryover).toBe(0);

    const staffOpen = (await getStaffProgressOverview(createStub(progressWorld(false))))[0];
    expect(staffOpen.productionWaitingCount).toBe(1);
    expect(staffOpen.wcheckWaitingCount).toBe(1);

    const staffCancelled = (await getStaffProgressOverview(createStub(progressWorld(true))))[0];
    expect(staffCancelled.productionWaitingCount).toBe(0);
    expect(staffCancelled.wcheckWaitingCount).toBe(0);
  });
});
