"use client";

import { useEffect, useRef, useState } from "react";
import { revealClientCredentialSecretAction } from "@/app/(app)/clients/[id]/actions";

const AUTO_HIDE_MS = 30_000;
const GENERIC_ERROR = "パスワードを取得できませんでした。";

/**
 * SNSログイン情報のパスワード表示・コピー。ページの初期HTMLには一切パスワードを含めず、
 * 「表示する」「コピー」を押した瞬間にだけサーバーへ復号を依頼する（Reactのstateにのみ
 * 一時保持し、表示は30秒後に自動的に••••••••へ戻る。ページ再読み込みでも必ず非表示）。
 */
export function CredentialSecretReveal({ credentialId }: { credentialId: string }) {
  const [password, setPassword] = useState<string | null>(null);
  const [loading, setLoading] = useState<"view" | "copy" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    };
  }, []);

  async function handleToggleView() {
    if (password) {
      setPassword(null);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      return;
    }
    setError(null);
    setLoading("view");
    try {
      const result = await revealClientCredentialSecretAction(credentialId, "view");
      if (result.error || !result.password) {
        setError(result.error ?? GENERIC_ERROR);
        return;
      }
      setPassword(result.password);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      hideTimerRef.current = setTimeout(() => setPassword(null), AUTO_HIDE_MS);
    } finally {
      setLoading(null);
    }
  }

  async function handleCopy() {
    setError(null);
    setLoading("copy");
    try {
      const result = await revealClientCredentialSecretAction(credentialId, "copy");
      if (result.error || !result.password) {
        setError(result.error ?? GENERIC_ERROR);
        return;
      }
      try {
        await navigator.clipboard.writeText(result.password);
        setCopied(true);
        if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
        copiedTimerRef.current = setTimeout(() => setCopied(false), 2000);
      } catch {
        setError("コピーに失敗しました。");
      }
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span>パスワード: </span>
      <span className="font-mono tabular-nums text-neutral-900">{password ?? "••••••••"}</span>
      <button
        type="button"
        onClick={handleToggleView}
        disabled={loading !== null}
        className="rounded-md border border-neutral-300 px-2.5 py-1 text-xs text-neutral-700 disabled:opacity-50"
      >
        {loading === "view" ? "取得中..." : password ? "隠す" : "表示する"}
      </button>
      <button
        type="button"
        onClick={handleCopy}
        disabled={loading !== null}
        className="rounded-md border border-neutral-300 px-2.5 py-1 text-xs text-neutral-700 disabled:opacity-50"
      >
        {loading === "copy" ? "取得中..." : copied ? "コピーしました" : "コピー"}
      </button>
      {error ? <span className="text-xs text-red-600">{error}</span> : null}
    </div>
  );
}
