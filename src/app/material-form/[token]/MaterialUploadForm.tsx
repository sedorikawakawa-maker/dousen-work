"use client";

import { useRef, useState } from "react";
import {
  confirmMaterialSubmissionAction,
  createMaterialUploadSessionsAction,
} from "./actions";
import { POST_TYPE_OPTIONS, REQUESTED_POST_TIMING_OPTIONS } from "@/lib/clients/labels";

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
 * 顧客向け素材アップロードフォーム。動画・画像本体はブラウザからGoogle Driveへ
 * 直接PUTし、Netlify Functions（Server Action）のリクエストボディには通さない。
 * DOUSEN WORKへ送るのは、アップロード前後の小さいmetadataのみ。
 *
 * 現在のmaterial_submissionの設計（1回の提出＝1トランザクション）に合わせ、
 * 複数ファイルは全件成功して初めて提出を成立させる（1件でも失敗したら提出は
 * 成立させず、既にDriveへ送信済みの分はサーバー側でベストエフォート削除する）。
 */
export function MaterialUploadForm({ token }: { token: string }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [postUsage, setPostUsage] = useState("");
  const [requestedPostTiming, setRequestedPostTiming] = useState("");
  const [editingInstructions, setEditingInstructions] = useState("");
  const [captionInstructions, setCaptionInstructions] = useState("");
  const [contactNotes, setContactNotes] = useState("");
  const [shotDate, setShotDate] = useState("");
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [phase, setPhase] = useState<"idle" | "uploading" | "submitted">("idle");
  const [formError, setFormError] = useState<string | null>(null);

  const uploadedCount = entries.filter((e) => e.state.status === "uploaded").length;
  const failedCount = entries.filter((e) => e.state.status === "failed").length;

  function updateEntry(localId: string, state: FileUploadState) {
    setEntries((prev) => prev.map((e) => (e.localId === localId ? { ...e, state } : e)));
  }

  function handleFilesSelected(fileList: FileList | null) {
    if (!fileList) return;
    const files = Array.from(fileList).filter((f) => f.size > 0);
    setEntries(files.map((file) => ({ localId: crypto.randomUUID(), file, state: { status: "queued" } })));
    setFormError(null);
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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (phase === "uploading") return; // 二重送信防止
    setFormError(null);

    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setFormError("素材の内容（タイトル）を入力してください");
      return;
    }

    setPhase("uploading");

    // ① セッション発行（ファイル本体はまだ一切送らない）
    const sessionResult = await createMaterialUploadSessionsAction(
      token,
      trimmedTitle,
      entries.map((entry) => ({
        fileName: entry.file.name,
        mimeType: entry.file.type || "application/octet-stream",
        fileSizeBytes: entry.file.size,
      })),
      window.location.origin,
    );

    if (sessionResult.error) {
      setFormError(sessionResult.error);
      setPhase("idle");
      return;
    }

    let uploaded: { fileName: string; driveFileId: string; driveUrl: string }[] = [];

    if (entries.length > 0) {
      if (sessionResult.sessions.length !== entries.length) {
        setFormError("アップロードの準備に失敗しました。もう一度お試しください");
        setPhase("idle");
        return;
      }

      // ② ブラウザ → Google Driveへ直接アップロード（並行実行）
      const results = await Promise.all(
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

      uploaded = results.filter(
        (r): r is { fileName: string; driveFileId: string; driveUrl: string; ok: true } => r.ok,
      );

      if (uploaded.length !== entries.length) {
        // 1件でも失敗した場合は提出を成立させない（現在のmaterial_submissionの設計に合わせる）。
        // 成功済みファイルの後始末はサーバー側（confirm）で行うため、成功分だけでも確定Actionを呼ぶ。
        await confirmMaterialSubmissionAction({
          token,
          submissionId: sessionResult.submissionId,
          title: trimmedTitle,
          postUsage: postUsage || null,
          requestedPostTiming: requestedPostTiming || null,
          editingInstructions: editingInstructions || null,
          captionInstructions: captionInstructions || null,
          contactNotes: contactNotes || null,
          shotDate: shotDate || null,
          dateFolderName: sessionResult.dateFolderName,
          driveFolderId: sessionResult.driveFolderId,
          driveFolderUrl: sessionResult.driveFolderUrl,
          expectedFileCount: entries.length,
          uploaded,
        });
        setFormError(
          `一部のファイルのアップロードに失敗したため、送信は完了していません（成功 ${uploaded.length} / 失敗 ${
            entries.length - uploaded.length
          }）。もう一度お試しください。`,
        );
        setPhase("idle");
        return;
      }
    }

    // ④ 成功分（または0件）のmetadataだけ送って確定登録
    const confirmResult = await confirmMaterialSubmissionAction({
      token,
      submissionId: sessionResult.submissionId,
      title: trimmedTitle,
      postUsage: postUsage || null,
      requestedPostTiming: requestedPostTiming || null,
      editingInstructions: editingInstructions || null,
      captionInstructions: captionInstructions || null,
      contactNotes: contactNotes || null,
      shotDate: shotDate || null,
      dateFolderName: sessionResult.dateFolderName,
      driveFolderId: sessionResult.driveFolderId,
      driveFolderUrl: sessionResult.driveFolderUrl,
      expectedFileCount: entries.length,
      uploaded,
    });

    if (confirmResult.error) {
      setFormError(confirmResult.error);
      setPhase("idle");
      return;
    }

    setPhase("submitted");
  }

  if (phase === "submitted") {
    return (
      <p className="rounded-2xl bg-[var(--accent-soft-bg)] px-4 py-3.5 text-sm text-[var(--accent-soft-text)]">
        送信しました。ご協力ありがとうございます。
      </p>
    );
  }

  const isUploading = phase === "uploading";

  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-5 sm:p-6">
      {formError ? (
        <p className="mb-4 rounded-2xl bg-red-50 px-3.5 py-2.5 text-sm text-red-700" role="alert">
          {formError}
        </p>
      ) : null}

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <label className="text-sm font-medium text-neutral-700">
          素材の内容（タイトル）
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            disabled={isUploading}
            className="mt-1.5 w-full rounded-xl border border-neutral-300 px-3.5 py-3 text-base disabled:bg-neutral-50"
          />
        </label>

        <label className="text-sm font-medium text-neutral-700">
          投稿用途
          <select
            value={postUsage}
            onChange={(e) => setPostUsage(e.target.value)}
            disabled={isUploading}
            className="mt-1.5 w-full rounded-xl border border-neutral-300 px-3.5 py-3 text-base disabled:bg-neutral-50"
          >
            <option value="">選択しない</option>
            {POST_TYPE_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>

        <label className="text-sm font-medium text-neutral-700">
          投稿希望時期
          <select
            value={requestedPostTiming}
            onChange={(e) => setRequestedPostTiming(e.target.value)}
            disabled={isUploading}
            className="mt-1.5 w-full rounded-xl border border-neutral-300 px-3.5 py-3 text-base disabled:bg-neutral-50"
          >
            <option value="">選択しない</option>
            {REQUESTED_POST_TIMING_OPTIONS.map((label) => (
              <option key={label} value={label}>
                {label}
              </option>
            ))}
          </select>
        </label>

        <label className="text-sm font-medium text-neutral-700">
          編集指示
          <textarea
            value={editingInstructions}
            onChange={(e) => setEditingInstructions(e.target.value)}
            disabled={isUploading}
            rows={3}
            className="mt-1.5 w-full rounded-xl border border-neutral-300 px-3.5 py-3 text-base disabled:bg-neutral-50"
          />
        </label>
        <label className="text-sm font-medium text-neutral-700">
          キャプション指定
          <textarea
            value={captionInstructions}
            onChange={(e) => setCaptionInstructions(e.target.value)}
            disabled={isUploading}
            rows={2}
            className="mt-1.5 w-full rounded-xl border border-neutral-300 px-3.5 py-3 text-base disabled:bg-neutral-50"
          />
        </label>
        <label className="text-sm font-medium text-neutral-700">
          その他連絡事項
          <textarea
            value={contactNotes}
            onChange={(e) => setContactNotes(e.target.value)}
            disabled={isUploading}
            rows={2}
            className="mt-1.5 w-full rounded-xl border border-neutral-300 px-3.5 py-3 text-base disabled:bg-neutral-50"
          />
        </label>
        <label className="text-sm font-medium text-neutral-700">
          撮影日
          <input
            type="date"
            value={shotDate}
            onChange={(e) => setShotDate(e.target.value)}
            disabled={isUploading}
            className="mt-1.5 w-full rounded-xl border border-neutral-300 px-3.5 py-3 text-base disabled:bg-neutral-50"
          />
        </label>

        <label className="text-sm font-medium text-neutral-700">
          ファイル（複数選択できます。任意。大きな動画等は別途Google Driveでの共有も可能です）
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,video/*"
            multiple
            disabled={isUploading}
            onChange={(e) => handleFilesSelected(e.target.files)}
            className="mt-1 w-full text-sm disabled:opacity-50"
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

        {isUploading ? (
          <p className="text-sm text-neutral-600">
            アップロード中: {uploadedCount + failedCount} / {entries.length}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={isUploading}
          className="mt-2 w-full rounded-full bg-[var(--accent)] px-4 py-3.5 text-base font-semibold text-white hover:bg-[var(--accent-strong)] disabled:opacity-50"
        >
          {isUploading ? "送信中..." : "送信する"}
        </button>
      </form>
    </div>
  );
}
