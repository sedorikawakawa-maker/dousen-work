"use client";

import { useActionState } from "react";
import { loginAction, type LoginState } from "./actions";

const initialState: LoginState = { error: null };

export function LoginForm() {
  const [state, formAction, isPending] = useActionState(loginAction, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex gap-3">
        <label className="flex-1 text-sm font-medium text-neutral-700">
          姓
          <input
            name="lastName"
            type="text"
            required
            autoComplete="family-name"
            className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-base"
          />
        </label>
        <label className="flex-1 text-sm font-medium text-neutral-700">
          名
          <input
            name="firstName"
            type="text"
            required
            autoComplete="given-name"
            className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-base"
          />
        </label>
      </div>

      <label className="text-sm font-medium text-neutral-700">
        パスワード
        <input
          name="password"
          type="password"
          required
          autoComplete="current-password"
          className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-base"
        />
      </label>

      {state.error ? (
        <p className="text-sm text-red-600" role="alert">
          {state.error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={isPending}
        className="mt-2 w-full rounded-md bg-neutral-900 px-4 py-2 text-base font-medium text-white disabled:opacity-50"
      >
        {isPending ? "ログイン中..." : "ログイン"}
      </button>
    </form>
  );
}
