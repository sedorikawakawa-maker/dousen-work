"use client";

import { forwardRef } from "react";

interface FileSelectButtonProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "className"> {
  label?: string;
}

/**
 * ネイティブのfile inputは見た目がボタンだと分かりにくく、未選択のまま送信されやすいため、
 * inputをsr-only（アクセシビリティは維持したまま視覚的に隠す）にし、labelをボタン風に見せる。
 * 素材納品フォーム・外注納品フォームで見た目を統一するために切り出した共通部品。
 */
export const FileSelectButton = forwardRef<HTMLInputElement, FileSelectButtonProps>(function FileSelectButton(
  { label = "ファイルを選択", disabled, ...props },
  ref,
) {
  return (
    <label
      className={`inline-flex w-fit items-center gap-2 rounded-full border px-4 py-2.5 text-sm font-medium transition-colors focus-within:ring-2 focus-within:ring-[var(--accent)] focus-within:ring-offset-2 ${
        disabled
          ? "cursor-not-allowed border-neutral-200 text-neutral-400"
          : "cursor-pointer border-neutral-300 text-neutral-700 hover:bg-neutral-50"
      }`}
    >
      {label}
      <input ref={ref} type="file" disabled={disabled} className="sr-only" {...props} />
    </label>
  );
});
