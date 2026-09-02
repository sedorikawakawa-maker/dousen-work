"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  confirmProductionVideoUploadAction,
  createProductionVideoUploadSessionsAction,
} from "@/app/(app)/production-videos/actions";
import { POST_TYPE_OPTIONS } from "@/lib/clients/labels";

interface ClientOption {
  id: string;
  label: string;
}

type FileUploadState =
  | { status: "queued" }
  | { status: "uploading"; progress: number | null }
  | { status: "uploaded"; driveFileId: string; driveUrl: string }
  | { status: "failed"; message: string };

interface FileEntry {
  localId: string;
  file: File;
  state: FileUploadState;
}

/**
 * 制作動画アップロード用共通フォーム。/production-videos と 顧客詳細「制作動画」タブの
 * 両方から使う（二重実装を避けるための単一コンポーネント）。
 *
 * 動画本体はブラウザからGoogle Driveへ直接PUTする（Netlify Functions/Server Actionの
 * リクエストボディには一切通さない）。Server Actionへ送るのは、①アップロード前の
 * ファイルメタデータ（ファイル名・種別・サイズ）、②アップロード成功後の
 * driveFileId/driveUrl等の小さいmetadataのみ。
 */
export function ProductionVideoUploadForm({
  clients,
  lockedClientId,
  lockedClientLabel,
}: {
  clients?: ClientOption[];
  lockedClientId?: string;
  lockedClientLabel?: string;
}) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [clientId, setClientId] = useState(lockedClientId ?? "");
  const [postType, setPostType] = useState("");
  const [memo, setMemo] = useState("");
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [phase, setPhase] = useState<"idle" | "uploading" | "done">("idle");
  const [formError, setFormError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const uploadedCount = entries.filter((e) => e.state.status === "uploaded").length;
  const failedCount = entries.filter((e) => e.state.status === "failed").length;

  function updateEntry(localId: string, state: FileUploadState) {
    setEntries((prev) => prev.map((e) => (e.localId === localId ? { ...e, state } : e)));
  }

  function uploadFileToSession(entry: FileEntry, sessionUrl: string): Promise<{ id: string; webViewLink: string }> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", sessionUrl, true);
      xhr.setRequestHeader("Content-Range", `bytes 0-${entry.file.size - 1}/${entry.file.size}`);
      xhr.upload.onprogress = (e) => {
        updateEntry(entry.localId, {
          status: "uploading",
          progress: e.lengthComputable ? Math.round((e.loaded / e.total) * 100) : null,
        });
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const data = JSON.parse(xhr.responseText);
            if (!data.id) throw new Error("no id");
            resolve({ id: data.id, webViewLink: data.webViewLink ?? `https://drive.google.com/file/d/${data.id}/view` });
          } catch {
            reject(new Error("応答の解析に失敗しました"));
          }
        } else {
          reject(new Error(`アップロードに失敗しました（status: ${xhr.status}）`));
        }
      };
      xhr.onerror = () => reject(new Error("ネットワークエラーが発生しました"));
      xhr.send(entry.file);
    });
  }

  function handleFilesSelected(fileList: FileList | null) {
    if (!fileList) return;
    const files = Array.from(fileList).filter((f) => f.size > 0);
    setEntries(files.map((file) => ({ localId: crypto.randomUUID(), file, state: { status: "queued" } })));
    setFormError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);

    const targetClientId = lockedClientId ?? clientId;
    if (!targetClientId) {
      setFormError("顧客を選択してください");
      return;
    }
    if (entries.length === 0) {
      setFormError("ファイルを選択してください");
      return;
    }

    setPhase("uploading");

    // ① セッション発行（動画本体はまだ一切送らない。ファイル名・種別・サイズのみ）
    // window.location.originはサーバー側で必ず検証される（申告値をそのまま信用しない）。
    const sessionResult = await createProductionVideoUploadSessionsAction(
      targetClientId,
      entries.map((entry) => ({
        fileName: entry.file.name,
        mimeType: entry.file.type || "application/octet-stream",
        fileSizeBytes: entry.file.size,
      })),
      window.location.origin,
    );

    if (sessionResult.error || sessionResult.sessions.length !== entries.length) {
      setFormError(sessionResult.error ?? "アップロードの準備に失敗しました");
      setEntries((prev) => prev.map((e) => ({ ...e, state: { status: "failed", message: "準備に失敗しました" } })));
      setPhase("done");
      return;
    }

    // ② ブラウザ → Google Driveへ直接アップロード（並行実行）
    const uploadResults = await Promise.all(
      entries.map(async (entry, i) => {
        const session = sessionResult.sessions[i];
        updateEntry(entry.localId, { status: "uploading", progress: 0 });
        try {
          const result = await uploadFileToSession(entry, session.sessionUrl);
          updateEntry(entry.localId, { status: "uploaded", driveFileId: result.id, driveUrl: result.webViewLink });
          return { fileName: entry.file.name, driveFileId: result.id, driveUrl: result.webViewLink, ok: true as const };
        } catch (err) {
          const message = err instanceof Error ? err.message : "アップロードに失敗しました";
          updateEntry(entry.localId, { status: "failed", message });
          return { ok: false as const };
        }
      }),
    );

    // ④⑤ 成功分だけmetadataを送って確定登録
    const uploaded = uploadResults.filter((r): r is { fileName: string; driveFileId: string; driveUrl: string; ok: true } => r.ok);

    if (uploaded.length > 0) {
      const confirmResult = await confirmProductionVideoUploadAction({
        clientId: targetClientId,
        postType: postType || null,
        memo: memo.trim() || null,
        uploaded: uploaded.map(({ fileName, driveFileId, driveUrl }) => ({ fileName, driveFileId, driveUrl })),
      });
      if (confirmResult.error) {
        setFormError(confirmResult.error);
      }
    }

    setPhase("done");
    startTransition(() => {
      router.refresh();
    });
  }

  function handleReset() {
    setEntries([]);
    setPostType("");
    setMemo("");
    setFormError(null);
    setPhase("idle");
    if (!lockedClientId) setClientId("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  const isUploading = phase === "uploading";

  return (
    <form
      onSubmit={handleSubmit}
      className="flex max-w-xl flex-col gap-4 rounded-2xl bg-white p-5"
    >
      {lockedClientId ? (
        <p className="text-sm font-medium text-neutral-700">
          顧客
          <span className="mt-1.5 block rounded-xl border border-neutral-200 bg-neutral-50 px-3.5 py-3 text-base text-neutral-900">
            {lockedClientLabel}
          </span>
        </p>
      ) : (
        <label className="text-sm font-medium text-neutral-700">
          顧客
          <select
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            required
            disabled={isUploading}
            className="mt-1.5 w-full rounded-xl border border-neutral-300 px-3.5 py-3 text-base disabled:bg-neutral-50"
          >
            <option value="" disabled>
              選択してください
            </option>
            {(clients ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
      )}

      <label className="text-sm font-medium text-neutral-700">
        ファイル（複数選択可）
        <input
          ref={fileInputRef}
          type="file"
          multiple
          required
          accept="video/*"
          disabled={isUploading}
          onChange={(e) => handleFilesSelected(e.target.files)}
          className="mt-1.5 w-full rounded-xl border border-neutral-300 px-3.5 py-3 text-base disabled:bg-neutral-50"
        />
      </label>

      <label className="text-sm font-medium text-neutral-700">
        投稿種別（任意）
        <select
          value={postType}
          onChange={(e) => setPostType(e.target.value)}
          disabled={isUploading}
          className="mt-1.5 w-full rounded-xl border border-neutral-300 px-3.5 py-3 text-base disabled:bg-neutral-50"
        >
          <option value="">未指定</option>
          {POST_TYPE_OPTIONS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>

      <label className="text-sm font-medium text-neutral-700">
        メモ（任意）
        <textarea
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          disabled={isUploading}
          rows={2}
          className="mt-1.5 w-full rounded-xl border border-neutral-300 px-3.5 py-3 text-base disabled:bg-neutral-50"
        />
      </label>

      {entries.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {entries.map((entry) => (
            <li key={entry.localId} className="rounded-xl border border-neutral-200 px-3 py-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate text-neutral-700">{entry.file.name}</span>
                <span className="shrink-0 text-xs">
                  {entry.state.status === "queued" ? (
                    <span className="text-neutral-400">待機中</span>
                  ) : entry.state.status === "uploading" ? (
                    <span className="text-[var(--accent-strong)]">
                      アップロード中{entry.state.progress !== null ? `（${entry.state.progress}%）` : ""}
                    </span>
                  ) : entry.state.status === "uploaded" ? (
                    <span className="text-[var(--accent-strong)]">✓ 完了</span>
                  ) : (
                    <span className="text-red-600">✗ 失敗</span>
                  )}
                </span>
              </div>
              {entry.state.status === "uploading" ? (
                <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-neutral-100">
                  <div
                    className="h-full rounded-full bg-[var(--accent)] transition-all"
                    style={{ width: `${entry.state.progress ?? 30}%` }}
                  />
                </div>
              ) : null}
              {entry.state.status === "failed" ? (
                <p className="mt-1 text-xs text-red-600">{entry.state.message}</p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {phase === "uploading" ? (
        <p className="text-sm text-neutral-600">
          アップロード中: {uploadedCount + failedCount} / {entries.length}
        </p>
      ) : null}
      {phase === "done" ? (
        <p className={`text-sm ${failedCount > 0 ? "text-amber-700" : "text-[var(--accent-strong)]"}`}>
          完了: 成功 {uploadedCount}件 {failedCount > 0 ? `／ 失敗 ${failedCount}件` : ""}
        </p>
      ) : null}

      {formError ? (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {formError}
        </p>
      ) : null}

      {phase === "done" ? (
        <button
          type="button"
          onClick={handleReset}
          className="mt-1 w-full rounded-full border border-neutral-300 px-4 py-3 text-sm font-medium text-neutral-700"
        >
          続けてアップロードする
        </button>
      ) : (
        <button
          type="submit"
          disabled={isUploading || isPending}
          className="mt-1 w-full rounded-full bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-white hover:bg-[var(--accent-strong)] disabled:opacity-50"
        >
          {isUploading ? "アップロード中..." : "アップロードする"}
        </button>
      )}
    </form>
  );
}
