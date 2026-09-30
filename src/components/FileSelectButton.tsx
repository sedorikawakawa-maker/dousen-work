"use client";

import { forwardRef } from "react";

interface FileSelectButtonProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "className" | "size"> {
  label?: string;
  /** "lg"はスマホでも一目で分かる大きめボタン（書類BOX等、アップロードが主目的の画面向け）。 */
  buttonSize?: "md" | "lg";
}

const SIZE_CLASSES: Record<"md" | "lg", string> = {
  md: "gap-2 rounded-full px-4 py-2.5 text-sm",
  lg: "gap-2.5 rounded-2xl px-6 py-4 text-base",
};

/**
 * ネイティブのfile inputは見た目がボタンだと分かりにくく、未選択のまま送信されやすいため、
 * inputをsr-only（アクセシビリティは維持したまま視覚的に隠す）にし、labelをボタン風に見せる。
 * 素材納品フォーム・外注納品フォームで見た目を統一するために切り出した共通部品。
 */
export const FileSelectButton = forwardRef<HTMLInputElement, FileSelectButtonProps>(function FileSelectButton(
  { label = "ファイルを選択", disabled, buttonSize = "md", ...props },
  ref,
) {
  return (
    <label
      className={`inline-flex w-fit items-center border font-medium transition-colors focus-within:ring-2 focus-within:ring-[var(--accent)] focus-within:ring-offset-2 ${SIZE_CLASSES[buttonSize]} ${
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
