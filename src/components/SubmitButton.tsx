"use client";

import { useFormStatus } from "react-dom";
import type { ButtonHTMLAttributes } from "react";

/**
 * 送信中は自動的に無効化し、二重送信を防ぐボタン。
 * 親要素が <form action={...}> である必要がある(useFormStatusの制約)。
 */
export function SubmitButton({
  children,
  pendingText,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { pendingText?: string }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending || rest.disabled}
      className={`${className ?? ""} disabled:cursor-not-allowed disabled:opacity-60`}
      {...rest}
    >
      {pending ? (pendingText ?? "送信中...") : children}
    </button>
  );
}
