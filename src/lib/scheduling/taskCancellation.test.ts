import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import {
  canCancelProductionTask,
  cancelProductionTask,
  type CancellableTaskFields,
} from "./taskCancellation";

function task(overrides: Partial<CancellableTaskFields> = {}): CancellableTaskFields {
  return { task_kind: "recurring", status: "production_waiting", cancelled_at: null, ...overrides };
}

describe("canCancelProductionTask（個別取消の可否判定）", () => {
  it("自動生成(recurring)・制作待ち・未取消なら取消できる", () => {
    expect(canCancelProductionTask(task())).toBe(true);
  });

  it("既に取消済みなら取消できない（二重取消を防ぐ）", () => {
    expect(canCancelProductionTask(task({ cancelled_at: "2026-10-26T00:00:00Z" }))).toBe(false);
  });

  it("素材待ち・制作中・Wチェック以降・顧客確認中・投稿待ち・完了済みは取消できない", () => {
    for (const status of [
      "material_waiting",
      "in_production",
      "wcheck_waiting",
      "client_confirmation_waiting",
      "posting_waiting",
      "completed",
    ] as const) {
      expect(canCancelProductionTask(task({ status }))).toBe(false);
    }
  });

  it("スポットタスク(task_kind='spot')は今回の取消対象に含めない", () => {
    expect(canCancelProductionTask(task({ task_kind: "spot" }))).toBe(false);
  });
});

function createSupabaseStub(result: { error: { message: string } | null }) {
  const rpcCalls: { name: string; args: unknown }[] = [];
  const rpc = vi.fn(async (name: string, args: unknown) => {
    rpcCalls.push({ name, args });
    return { data: null, error: result.error };
  });
  const client = { rpc } as unknown as SupabaseClient<Database>;
  return { client, rpcCalls };
}

describe("cancelProductionTask（cancel_production_task RPCを1回だけ呼ぶ）", () => {
  it("取消理由が空ならRPCを呼ばずに拒否する", async () => {
    const { client, rpcCalls } = createSupabaseStub({ error: null });
    const result = await cancelProductionTask(client, "task-1", "   ");
    expect(result.error).toBe("取消理由を入力してください。");
    expect(rpcCalls).toHaveLength(0);
  });

  it("正しい引数でRPCを1回呼び、理由の前後空白は除去する", async () => {
    const { client, rpcCalls } = createSupabaseStub({ error: null });
    const result = await cancelProductionTask(client, "task-1", "  今月は投稿本数を調整するため  ");
    expect(result.error).toBeNull();
    expect(rpcCalls).toEqual([
      {
        name: "cancel_production_task",
        args: { p_task_id: "task-1", p_reason: "今月は投稿本数を調整するため" },
      },
    ]);
  });

  it("RPC側で拒否された場合（二重取消・制作待ち以外）はそのメッセージを返す", async () => {
    const { client } = createSupabaseStub({ error: { message: "この制作タスクは既に取消済みです" } });
    const result = await cancelProductionTask(client, "task-1", "理由");
    expect(result.error).toBe("この制作タスクは既に取消済みです");
  });

  it("UI側で物理DELETEを行わない（RPC以外のDB操作をしない）", async () => {
    const { client, rpcCalls } = createSupabaseStub({ error: null });
    // fromを持たないスタブでも成功する = テーブルへの直接操作（delete含む）を一切していない。
    await cancelProductionTask(client, "task-1", "理由");
    expect(rpcCalls.map((c) => c.name)).toEqual(["cancel_production_task"]);
  });
});
