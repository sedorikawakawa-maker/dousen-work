import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import {
  flagCarryoverForClient,
  generateTasksForRule,
  getMonthlySummary,
  regenerateTasksForRule,
  removeUnstartedFutureTasksForRule,
} from "./generate";

type ScheduleRule = Database["public"]["Tables"]["posting_schedule_rules"]["Row"];
type TaskRow = Database["public"]["Tables"]["production_tasks"]["Row"];

// ---------------------------------------------------------------------------
// 取消済みタスク（cancelled_at）が自動生成・一括削除・持越し判定でどう扱われるかを検証する。
// 検証したいのは「どのフィルタが付いているか」そのものなので、スタブ側でeq/is/neq/gte/lt/in
// を実際に評価する小さなPostgREST相当の絞り込みを実装し、フィルタの意味まで含めて確認する
// （「.is()が呼ばれたか」だけを見る形にすると、カラム名や値が間違っていても通ってしまうため）。
// ---------------------------------------------------------------------------

type Filter = { method: string; args: unknown[] };
type Recorded = { table: string; op: string; filters: Filter[]; payload?: unknown };

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

function createSchedulingStub(options: {
  tasks?: Partial<TaskRow>[];
  rules?: ScheduleRule[];
  primaryStaffId?: string | null;
  postRecordTaskIds?: string[];
}) {
  const tasks = (options.tasks ?? []) as Record<string, unknown>[];
  const calls: Recorded[] = [];

  function rowsFor(table: string): Record<string, unknown>[] {
    if (table === "production_tasks") return tasks;
    if (table === "posting_schedule_rules") return (options.rules ?? []) as unknown as Record<string, unknown>[];
    if (table === "client_assignments") {
      return options.primaryStaffId ? [{ staff_id: options.primaryStaffId }] : [];
    }
    if (table === "post_records") {
      return (options.postRecordTaskIds ?? []).map((id) => ({ production_task_id: id, cancelled_at: null }));
    }
    throw new Error(`unexpected table: ${table}`);
  }

  function makeChain(record: Recorded) {
    calls.push(record);
    const resolveRows = () => rowsFor(record.table).filter((row) => rowMatches(row, record.filters));

    const chain: Record<string, unknown> = {
      maybeSingle: async () => ({ data: resolveRows()[0] ?? null, error: null }),
      single: async () => ({ data: resolveRows()[0] ?? null, error: null }),
      then: (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
        Promise.resolve({ data: resolveRows(), error: null }).then(resolve, reject),
    };
    for (const method of ["select", "eq", "is", "neq", "gte", "lte", "lt", "in", "not", "order", "limit"]) {
      chain[method] = (...args: unknown[]) => {
        record.filters.push({ method, args });
        return chain;
      };
    }
    return chain;
  }

  const from = vi.fn((table: string) => ({
    select: (...args: unknown[]) => {
      const chain = makeChain({ table, op: "select", filters: [] });
      return (chain.select as (...a: unknown[]) => unknown)(...args);
    },
    insert: (payload: unknown) => makeChain({ table, op: "insert", filters: [], payload }),
    update: (payload: unknown) => makeChain({ table, op: "update", filters: [], payload }),
    delete: () => makeChain({ table, op: "delete", filters: [] }),
  }));

  const client = { from } as unknown as SupabaseClient<Database>;

  return {
    client,
    calls,
    insertedDates: () =>
      calls
        .filter((c) => c.table === "production_tasks" && c.op === "insert")
        .map((c) => (c.payload as { scheduled_post_date: string }).scheduled_post_date),
    deleteCalls: () => calls.filter((c) => c.table === "production_tasks" && c.op === "delete"),
    updateCalls: () => calls.filter((c) => c.table === "production_tasks" && c.op === "update"),
  };
}

function baseRule(overrides: Partial<ScheduleRule> = {}): ScheduleRule {
  return {
    id: "rule-1",
    client_id: "client-1",
    post_type: "reel",
    monthly_target: 10,
    // 毎週月曜（JSのgetDay()と同じ 0=日曜）。
    weekday_rule: { mode: "weekly", weekdays: [1] } as unknown as Record<string, unknown>,
    production_lead_days: null,
    wcheck_lead_days: null,
    client_confirm_lead_days: null,
    valid_from: "2026-01-01",
    valid_to: null,
    is_active: true,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  } as ScheduleRule;
}

function baseTask(overrides: Partial<TaskRow> = {}): Partial<TaskRow> {
  const scheduledPostDate = overrides.scheduled_post_date ?? "2026-11-02";
  return {
    id: "task-1",
    client_id: "client-1",
    schedule_rule_id: "rule-1",
    post_type: "reel",
    task_kind: "recurring",
    source_month: "2026-11-01",
    scheduled_post_date: scheduledPostDate,
    // 既定では「手動で日付変更していない」状態にする（一括削除の対象条件を満たす形）。
    original_scheduled_post_date: scheduledPostDate,
    status: "production_waiting",
    is_carryover: false,
    cancelled_at: null,
    cancelled_by_staff_id: null,
    cancel_reason: null,
    ...overrides,
  };
}

// 2026-11-01(日)に固定。ローリング窓は2026年11月・12月・2027年1月となり、
// 11月の月曜は 2/9/16/23/30。
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-01T00:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("generateTasksForRule（取消済みタスクの再生成防止）", () => {
  it("取消済みタスクがある日付は「既に存在する」と扱い、再生成しない", async () => {
    const stub = createSchedulingStub({
      tasks: [
        baseTask({
          id: "cancelled-task",
          scheduled_post_date: "2026-11-09",
          cancelled_at: "2026-11-01T10:00:00Z",
          cancelled_by_staff_id: "staff-1",
          cancel_reason: "今月は本数を調整",
        }),
      ],
    });

    await generateTasksForRule(stub.client, baseRule());

    expect(stub.insertedDates()).not.toContain("2026-11-09");
  });

  it("取消していない他の日付・他の投稿種別は通常どおり生成される", async () => {
    const stub = createSchedulingStub({
      tasks: [
        baseTask({ id: "cancelled-task", scheduled_post_date: "2026-11-09", cancelled_at: "2026-11-01T10:00:00Z" }),
      ],
    });

    await generateTasksForRule(stub.client, baseRule());

    const dates = stub.insertedDates();
    expect(dates).toContain("2026-11-02");
    expect(dates).toContain("2026-11-16");
    expect(dates).toContain("2026-11-23");
    expect(dates).toContain("2026-11-30");
    expect(dates).not.toContain("2026-11-09");

    // 別の投稿種別(feed)のルールは、同じ日付でも独立して生成される。
    const feedStub = createSchedulingStub({
      tasks: [
        baseTask({ id: "cancelled-task", scheduled_post_date: "2026-11-09", cancelled_at: "2026-11-01T10:00:00Z" }),
      ],
    });
    await generateTasksForRule(feedStub.client, baseRule({ id: "rule-2", post_type: "feed" }));
    expect(feedStub.insertedDates()).toContain("2026-11-09");
  });

  it("未取消の既存タスクも従来どおり再生成されない（既存の重複防止が壊れていない）", async () => {
    const stub = createSchedulingStub({
      tasks: [baseTask({ id: "existing-task", scheduled_post_date: "2026-11-02" })],
    });

    await generateTasksForRule(stub.client, baseRule());

    expect(stub.insertedDates()).not.toContain("2026-11-02");
    expect(stub.insertedDates()).toContain("2026-11-09");
  });

  it("生成される新規タスクはcancelled_at関連の値を持たない（取消はRPC経由のみ）", async () => {
    const stub = createSchedulingStub({ tasks: [] });

    await generateTasksForRule(stub.client, baseRule());

    const insertPayloads = stub.calls
      .filter((c) => c.table === "production_tasks" && c.op === "insert")
      .map((c) => c.payload as Record<string, unknown>);
    expect(insertPayloads.length).toBeGreaterThan(0);
    for (const payload of insertPayloads) {
      expect(payload.cancelled_at).toBeUndefined();
      expect(payload.cancel_reason).toBeUndefined();
    }
  });
});

describe("ルール変更・無効化時の一括削除（取消済みタスクを巻き戻さない）", () => {
  it("regenerateTasksForRule は取消済みタスクを物理削除しない", async () => {
    const stub = createSchedulingStub({
      tasks: [
        baseTask({ id: "cancelled-task", scheduled_post_date: "2026-11-09", cancelled_at: "2026-11-01T10:00:00Z" }),
        baseTask({ id: "normal-task", scheduled_post_date: "2026-11-16" }),
      ],
    });

    await regenerateTasksForRule(stub.client, baseRule());

    const deletes = stub.deleteCalls();
    expect(deletes).toHaveLength(1);
    const deletedIds = deletes[0].filters.find((f) => f.method === "in")?.args[1] as string[];
    expect(deletedIds).toEqual(["normal-task"]);
    expect(deletedIds).not.toContain("cancelled-task");
  });

  it("regenerateTasksForRule 後も取消済みの日付は再生成されない（取消が巻き戻らない）", async () => {
    const stub = createSchedulingStub({
      tasks: [
        baseTask({ id: "cancelled-task", scheduled_post_date: "2026-11-09", cancelled_at: "2026-11-01T10:00:00Z" }),
      ],
    });

    await regenerateTasksForRule(stub.client, baseRule());

    expect(stub.insertedDates()).not.toContain("2026-11-09");
  });

  it("removeUnstartedFutureTasksForRule も取消済みタスクを物理削除しない", async () => {
    const stub = createSchedulingStub({
      tasks: [
        baseTask({ id: "cancelled-task", scheduled_post_date: "2026-11-09", cancelled_at: "2026-11-01T10:00:00Z" }),
        baseTask({ id: "normal-task", scheduled_post_date: "2026-11-16" }),
      ],
    });

    await removeUnstartedFutureTasksForRule(stub.client, "rule-1");

    const deletes = stub.deleteCalls();
    expect(deletes).toHaveLength(1);
    expect(deletes[0].filters.find((f) => f.method === "in")?.args[1]).toEqual(["normal-task"]);
  });
});

describe("flagCarryoverForClient（取消済みタスクは持越しにしない）", () => {
  it("一括UPDATEはcancelled_at is nullで絞り込む（取消済み行に当たるとトリガーで失敗するため必須）", async () => {
    const stub = createSchedulingStub({ tasks: [] });

    await flagCarryoverForClient(stub.client, "client-1");

    const updates = stub.updateCalls();
    expect(updates).toHaveLength(1);
    expect(updates[0].payload).toEqual({ is_carryover: true });
    expect(updates[0].filters).toEqual(
      expect.arrayContaining([{ method: "is", args: ["cancelled_at", null] }]),
    );
  });
});

describe("getMonthlySummary（取消済みタスクを集計から除外）", () => {
  it("取消済みの過去月タスクは持越し件数に数えない", async () => {
    const stub = createSchedulingStub({
      rules: [baseRule({ monthly_target: 4 })],
      tasks: [
        // 過去月(10月)の未完了タスク2件のうち、1件は取消済み。
        baseTask({ id: "past-normal", source_month: "2026-10-01", scheduled_post_date: "2026-10-05" }),
        baseTask({
          id: "past-cancelled",
          source_month: "2026-10-01",
          scheduled_post_date: "2026-10-12",
          cancelled_at: "2026-10-20T00:00:00Z",
        }),
      ],
    });

    const rows = await getMonthlySummary(stub.client, "client-1");
    const november = rows[0];

    expect(november.label).toBe("2026年11月");
    expect(november.byPostType.reel.carryover).toBe(1);
    expect(november.byPostType.reel.required).toBe(5);
  });
});
