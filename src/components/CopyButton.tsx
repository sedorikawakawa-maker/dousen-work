"use client";

import { useState } from "react";

export function CopyButton({ text, label = "コピー" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          // クリップボードAPIが使えない環境ではユーザーが手動選択してコピーする
        }
      }}
      className="shrink-0 rounded-md border border-neutral-300 px-3 py-1 text-xs text-neutral-700"
    >
      {copied ? "コピーしました" : label}
    </button>
  );
}
