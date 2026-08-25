"use client";

import { useActionState, useEffect, useRef } from "react";
import { changeOwnPasswordAction, type ChangePasswordState } from "./actions";
import { MIN_PASSWORD_LENGTH } from "@/lib/staff/passwordPolicy";

const initialState: ChangePasswordState = { error: null, success: false };

export function ChangePasswordForm() {
  const [state, formAction, isPending] = useActionState(changeOwnPasswordAction, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.success) {
      formRef.current?.reset();
    }
  }, [state.success]);

  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-4">
      <label className="text-sm font-medium text-neutral-700">
        現在のパスワード
        <input
          name="currentPassword"
          type="password"
          required
          autoComplete="current-password"
          className="mt-1.5 w-full rounded-xl border border-neutral-300 px-3.5 py-3 text-base"
        />
      </label>
      <label className="text-sm font-medium text-neutral-700">
        新しいパスワード
        <input
          name="newPassword"
          type="password"
          required
          autoComplete="new-password"
          className="mt-1.5 w-full rounded-xl border border-neutral-300 px-3.5 py-3 text-base"
        />
      </label>
      <label className="text-sm font-medium text-neutral-700">
        新しいパスワード（確認）
        <input
          name="newPasswordConfirm"
          type="password"
          required
          autoComplete="new-password"
          className="mt-1.5 w-full rounded-xl border border-neutral-300 px-3.5 py-3 text-base"
        />
      </label>
      <p className="text-xs text-neutral-500">{MIN_PASSWORD_LENGTH}文字以上で入力してください。</p>

      {state.error ? (
        <p className="text-sm text-red-700" role="alert">
          {state.error}
        </p>
      ) : null}
      {state.success ? <p className="text-sm text-green-700">パスワードを変更しました。</p> : null}

      <button
        type="submit"
        disabled={isPending}
        className="mt-1 w-full rounded-full bg-[var(--accent)] px-4 py-3 text-base font-semibold text-white hover:bg-[var(--accent-strong)] disabled:opacity-50"
      >
        {isPending ? "変更中..." : "パスワードを変更"}
      </button>
    </form>
  );
}
