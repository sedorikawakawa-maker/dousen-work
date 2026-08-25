"use client";

import { useActionState } from "react";
import { CopyButton } from "@/components/CopyButton";
import { ConfirmSubmitButton } from "@/components/ConfirmSubmitButton";
import { resetStaffPasswordAction, type TempPasswordActionState } from "./actions";

const initialState: TempPasswordActionState = { error: null, result: null };

/**
 * 仮パスワードはURLへ含めず、Server Actionの戻り値としてこのコンポーネントの状態にのみ保持する。
 * ページを再読み込みすればこの状態は消える（DB・ログ・URLのどこにも残らない）。
 */
export function StaffPasswordResetForm({ staffId, staffLabel }: { staffId: string; staffLabel: string }) {
  const [state, formAction, isPending] = useActionState(resetStaffPasswordAction, initialState);

  return (
    <div className="flex flex-col gap-2">
      <form action={formAction}>
        <input type="hidden" name="staffId" value={staffId} />
        <ConfirmSubmitButton
          confirmMessage={`${staffLabel} の仮パスワードを再発行しますか？`}
          disabled={isPending}
          className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs text-neutral-700 disabled:opacity-50"
        >
          {isPending ? "発行中..." : "仮パスワード再発行"}
        </ConfirmSubmitButton>
      </form>

      {state.error ? <p className="text-xs text-red-700" role="alert">{state.error}</p> : null}

      {state.result ? (
        <div className="flex flex-col gap-2 rounded-md bg-yellow-50 px-3 py-2">
          <p className="text-xs text-yellow-800">
            新しい仮パスワードです。このパスワードは今だけ表示されます。必ずコピーして本人へ安全な方法で伝えてください。
          </p>
          <div className="flex items-center gap-2">
            <span className="flex-1 truncate rounded-md bg-white px-2 py-1 font-mono text-xs">
              {state.result.tempPassword}
            </span>
            <CopyButton text={state.result.tempPassword} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
