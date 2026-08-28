"use client";

import { useActionState } from "react";
import { STAFF_ROLE_LABELS } from "@/lib/auth/roles";
import { CopyButton } from "@/components/CopyButton";
import type { StaffRole } from "@/lib/supabase/database.types";
import { createStaffAction, type TempPasswordActionState } from "./actions";

const ROLE_OPTIONS: StaffRole[] = ["president", "executive", "employee", "part_time"];
const initialState: TempPasswordActionState = { error: null, result: null };

/**
 * 仮パスワードはURLへ含めず、Server Actionの戻り値としてこのコンポーネントの状態にのみ保持する。
 * ページを再読み込みすればこの状態は消える（DB・ログ・URLのどこにも残らない）。
 */
export function CreateStaffForm() {
  const [state, formAction, isPending] = useActionState(createStaffAction, initialState);

  return (
    <div className="flex flex-col gap-3">
      <form action={formAction} className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="flex-1 text-sm font-medium text-neutral-700">
          姓
          <input
            name="lastName"
            type="text"
            required
            className="mt-1.5 w-full rounded-xl border border-neutral-300 px-3.5 py-3 text-base"
          />
        </label>
        <label className="flex-1 text-sm font-medium text-neutral-700">
          名
          <input
            name="firstName"
            type="text"
            required
            className="mt-1.5 w-full rounded-xl border border-neutral-300 px-3.5 py-3 text-base"
          />
        </label>
        <label className="flex-1 text-sm font-medium text-neutral-700">
          role
          <select
            name="role"
            defaultValue="employee"
            className="mt-1.5 w-full rounded-xl border border-neutral-300 px-3.5 py-3 text-base"
          >
            {ROLE_OPTIONS.map((role) => (
              <option key={role} value={role}>
                {STAFF_ROLE_LABELS[role]}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          disabled={isPending}
          className="whitespace-nowrap rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--accent-strong)] disabled:opacity-50"
        >
          {isPending ? "追加中..." : "＋ 追加する"}
        </button>
      </form>
      <p className="text-xs text-neutral-500">
        仮パスワードはサーバー側で自動生成されます（管理者が入力する必要はありません）。
      </p>

      {state.error ? <p className="text-sm text-red-700" role="alert">{state.error}</p> : null}

      {state.result ? (
        <div className="flex flex-col gap-2 rounded-2xl bg-yellow-50 px-4 py-3">
          <p className="text-xs text-yellow-800">
            {state.result.staffName} を作成しました。このパスワードは今だけ表示されます。必ずコピーして本人へ安全な方法で伝えてください。
          </p>
          <div className="flex items-center gap-2">
            <span className="flex-1 truncate rounded-md bg-white px-2 py-1.5 font-mono text-sm">
              {state.result.tempPassword}
            </span>
            <CopyButton text={state.result.tempPassword} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
