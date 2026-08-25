"use client";

import type { ButtonHTMLAttributes } from "react";

/** 送信前に window.confirm で確認を挟む送信ボタン。親要素は <form action={...}> を想定。 */
export function ConfirmSubmitButton({
  confirmMessage,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { confirmMessage: string }) {
  return (
    <button
      type="submit"
      onClick={(e) => {
        if (!window.confirm(confirmMessage)) {
          e.preventDefault();
        }
      }}
      {...rest}
    >
      {children}
    </button>
  );
}
