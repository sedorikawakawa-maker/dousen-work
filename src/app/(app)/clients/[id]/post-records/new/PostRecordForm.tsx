"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { confirmPostRecordAction, createPostRecordUploadSessionAction } from "./actions";
import { PRODUCTION_TASK_STATUS_LABELS } from "@/lib/clients/labels";
import type { Database, PostType } from "@/lib/supabase/database.types";

type ProductionTaskRow = Database["public"]["Tables"]["production_tasks"]["Row"];

interface StaffOption {
  id: string;
  last_name: string;
  first_name: string;
}
interface MaterialOption {
  id: string;
  label: string;
}

type FileUploadState =
  | { status: "idle" }
  | { status: "uploading"; progress: number | null }
  | { status: "uploaded"; driveFileId: string; driveUrl: string }
  | { status: "failed"; message: string };

/**
 * 投稿実績登録フォーム。final動画本体はブラウザからGoogle Driveへ直接PUTし、
 * Netlify Functions（Server Action）のリクエストボディには通さない。
 * DOUSEN WORKへ送るのは、アップロード前後の小さいmetadataのみ。
 *
 * 既存仕様どおり、final動画は必須ではない（reel/storyでは代わりに手動保存先URLや
 * Canvaリンクで登録できる。feedはファイル自体が不要）。
 */
export function PostRecordForm({
  clientId,
  postType,
  candidateTasks,
  selectedTaskId,
  staffOptions,
  currentStaffId,
  materialOptions,
  driveNotice,
}: {
  clientId: string;
  postType: PostType;
  candidateTasks: ProductionTaskRow[];
  selectedTaskId: string;
  staffOptions: StaffOption[];
  currentStaffId: string;
  materialOptions: MaterialOption[];
  driveNotice?: ReactNode;
}) {
  const router = useRouter();
  const [taskId, setTaskId] = useState(selectedTaskId);
  const [postedAt, setPostedAt] = useState(new Date().toISOString().slice(0, 10));
  const [postedByStaffId, setPostedByStaffId] = useState(currentStaffId);
  const [title, setTitle] = useState("");
  const [socialPostUrl, setSocialPostUrl] = useState("");
  const [canvaUrl, setCanvaUrl] = useState("");
  const [manualDriveUrl, setManualDriveUrl] = useState("");
  const [sourceMaterialId, setSourceMaterialId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [fileState, setFileState] = useState<FileUploadState>({ status: "idle" });
  const [phase, setPhase] = useState<"idle" | "submitting">("idle");
  const [formError, setFormError] = useState<string | null>(null);

  const showFileFields = postType === "reel" || postType === "story";

  function uploadFileToSession(targetFile: File, sessionUrl: string): Promise<{ id: string; webViewLink: string }> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", sessionUrl, true);
      xhr.setRequestHeader("Content-Range", `bytes 0-${targetFile.size - 1}/${targetFile.size}`);
      xhr.upload.onprogress = (e) => {
        setFileState({ status: "uploading", progress: e.lengthComputable ? Math.round((e.loaded / e.total) * 100) : null });
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
      xhr.send(targetFile);
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (phase === "submitting") return; // 二重送信防止
    setFormError(null);

    if (!taskId) return setFormError("対象の制作タスクを選択してください");
    if (!postedAt) return setFormError("投稿日を入力してください");
    if (!postedByStaffId) return setFormError("投稿担当を選択してください");
    if (postType === "reel" && !socialPostUrl.trim()) return setFormError("SNS投稿URLを入力してください");
    if (postType === "feed") {
      if (!socialPostUrl.trim()) return setFormError("SNS投稿URLを入力してください");
      if (!canvaUrl.trim()) return setFormError("Canvaリンクを入力してください");
    }
    if ((postType === "reel" || postType === "feed") && !title.trim()) {
      return setFormError("投稿タイトル/内容を入力してください");
    }

    setPhase("submitting");

    try {
      let driveFileId: string | null = null;
      let driveUrl: string | null = null;

      if (showFileFields && file) {
        const sessionResult = await createPostRecordUploadSessionAction(
          clientId,
          { fileName: file.name, mimeType: file.type || "application/octet-stream", fileSizeBytes: file.size },
          window.location.origin,
        );
        if (sessionResult.error || !sessionResult.sessionUrl) {
          setFormError(sessionResult.error ?? "アップロードの準備に失敗しました");
          return;
        }

        setFileState({ status: "uploading", progress: 0 });
        try {
          const result = await uploadFileToSession(file, sessionResult.sessionUrl);
          driveFileId = result.id;
          driveUrl = result.webViewLink;
          setFileState({ status: "uploaded", driveFileId: result.id, driveUrl: result.webViewLink });
        } catch (err) {
          // uploadFileToSession自身のエラーはここで表示済みとし、外側catchでの二重表示はしない。
          const message = err instanceof Error ? err.message : "アップロードに失敗しました";
          setFileState({ status: "failed", message });
          setFormError(message);
          return;
        }
      }

      const confirmResult = await confirmPostRecordAction({
        clientId,
        taskId,
        postType,
        postedAt,
        postedByStaffId,
        title: title.trim() || null,
        socialPostUrl: socialPostUrl.trim() || null,
        canvaUrl: canvaUrl.trim() || null,
        manualDriveUrl: showFileFields && !file ? manualDriveUrl.trim() || null : null,
        sourceMaterialId: sourceMaterialId || null,
        driveFileId,
        driveUrl,
      });

      if (confirmResult.error) {
        setFormError(confirmResult.error);
        return;
      }

      router.push(`/clients/${clientId}?tab=posts&saved=1`);
    } catch (err) {
      // Server Action自体が例外を投げた場合（ネットワーク断・予期しないサーバーエラー等）。
      // stack traceや内部エラー詳細はブラウザへ表示しない。
      console.error(err);
      setFormError("登録処理に失敗しました。時間をおいて再度お試しください。");
    } finally {
      setPhase("idle");
    }
  }

  const isSubmitting = phase === "submitting";

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-4 rounded-2xl border border-neutral-200 bg-white p-5 sm:p-6"
    >
      {formError ? (
        <p className="rounded-2xl bg-red-50 px-4 py-2 text-sm text-red-700" role="alert">
          {formError}
        </p>
      ) : null}

      <label className="text-sm font-medium text-neutral-700">
        対象の制作タスク
        <select
          value={taskId}
          onChange={(e) => setTaskId(e.target.value)}
          required
          disabled={isSubmitting}
          className="mt-1.5 w-full rounded-xl border border-neutral-300 px-3.5 py-3 text-base disabled:bg-neutral-50"
        >
          <option value="" disabled>
            選択してください
          </option>
          {candidateTasks.map((t) => (
            <option key={t.id} value={t.id}>
              {t.scheduled_post_date ?? "予定日未定"} ・ {PRODUCTION_TASK_STATUS_LABELS[t.status]}
              {t.status === "posting_waiting" ? "（推奨）" : ""} ・ {t.title}
            </option>
          ))}
        </select>
        {candidateTasks.length === 0 ? (
          <p className="mt-1 text-xs text-neutral-400">未完了タスクがありません。</p>
        ) : null}
      </label>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="text-sm font-medium text-neutral-700">
          投稿日
          <input
            type="date"
            value={postedAt}
            onChange={(e) => setPostedAt(e.target.value)}
            required
            disabled={isSubmitting}
            className="mt-1.5 w-full rounded-xl border border-neutral-300 px-3.5 py-3 text-base disabled:bg-neutral-50"
          />
        </label>
        <label className="text-sm font-medium text-neutral-700">
          投稿担当
          <select
            value={postedByStaffId}
            onChange={(e) => setPostedByStaffId(e.target.value)}
            required
            disabled={isSubmitting}
            className="mt-1.5 w-full rounded-xl border border-neutral-300 px-3.5 py-3 text-base disabled:bg-neutral-50"
          >
            {staffOptions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.last_name} {s.first_name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="text-sm font-medium text-neutral-700">
        投稿タイトル / 内容{postType === "story" ? "（任意）" : ""}
        <textarea
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          disabled={isSubmitting}
          rows={2}
          className="mt-1.5 w-full rounded-xl border border-neutral-300 px-3.5 py-3 text-base disabled:bg-neutral-50"
        />
      </label>

      <label className="text-sm font-medium text-neutral-700">
        SNS投稿URL{postType === "story" ? "（任意）" : ""}
        <input
          type="url"
          inputMode="url"
          value={socialPostUrl}
          onChange={(e) => setSocialPostUrl(e.target.value)}
          disabled={isSubmitting}
          className="mt-1.5 w-full rounded-xl border border-neutral-300 px-3.5 py-3 text-base disabled:bg-neutral-50"
        />
      </label>

      {postType === "reel" ? (
        <>
          <label className="text-sm font-medium text-neutral-700">
            完成動画ファイル
            <input
              type="file"
              accept="video/*"
              disabled={isSubmitting}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="mt-1 w-full text-sm disabled:opacity-50"
            />
          </label>
          <label className="text-sm font-medium text-neutral-700">
            Google Drive保存先URL（ファイルを添付しない場合）
            <input
              type="url"
              value={manualDriveUrl}
              onChange={(e) => setManualDriveUrl(e.target.value)}
              disabled={isSubmitting || !!file}
              className="mt-1.5 w-full rounded-xl border border-neutral-300 px-3.5 py-3 text-base disabled:bg-neutral-50"
            />
          </label>
          {driveNotice}
        </>
      ) : null}

      {postType === "feed" ? (
        <label className="text-sm font-medium text-neutral-700">
          Canvaリンク
          <input
            type="url"
            value={canvaUrl}
            onChange={(e) => setCanvaUrl(e.target.value)}
            disabled={isSubmitting}
            className="mt-1.5 w-full rounded-xl border border-neutral-300 px-3.5 py-3 text-base disabled:bg-neutral-50"
          />
        </label>
      ) : null}

      {postType === "story" ? (
        <>
          <label className="text-sm font-medium text-neutral-700">
            Canvaリンク
            <input
              type="url"
              value={canvaUrl}
              onChange={(e) => setCanvaUrl(e.target.value)}
              disabled={isSubmitting}
              className="mt-1.5 w-full rounded-xl border border-neutral-300 px-3.5 py-3 text-base disabled:bg-neutral-50"
            />
          </label>
          <label className="text-sm font-medium text-neutral-700">
            画像/動画ファイル（Canvaリンクが無い場合）
            <input
              type="file"
              accept="image/*,video/*"
              disabled={isSubmitting}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="mt-1 w-full text-sm disabled:opacity-50"
            />
          </label>
          <label className="text-sm font-medium text-neutral-700">
            Google Drive保存先URL（ファイルを添付しない場合）
            <input
              type="url"
              value={manualDriveUrl}
              onChange={(e) => setManualDriveUrl(e.target.value)}
              disabled={isSubmitting || !!file}
              className="mt-1.5 w-full rounded-xl border border-neutral-300 px-3.5 py-3 text-base disabled:bg-neutral-50"
            />
          </label>
          {driveNotice}
        </>
      ) : null}

      {showFileFields && file ? (
        <div className="rounded-xl border border-neutral-200 px-3 py-2 text-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate text-neutral-700">{file.name}</span>
            <span className="shrink-0 text-xs">
              {fileState.status === "uploading" ? (
                <span className="text-[var(--accent-strong)]">
                  アップロード中{fileState.progress !== null ? `（${fileState.progress}%）` : ""}
                </span>
              ) : fileState.status === "uploaded" ? (
                <span className="text-[var(--accent-strong)]">✓ 完了</span>
              ) : fileState.status === "failed" ? (
                <span className="text-red-600">✗ 失敗</span>
              ) : (
                <span className="text-neutral-400">待機中</span>
              )}
            </span>
          </div>
          {fileState.status === "uploading" ? (
            <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-neutral-100">
              <div
                className="h-full rounded-full bg-[var(--accent)] transition-all"
                style={{ width: `${fileState.progress ?? 30}%` }}
              />
            </div>
          ) : null}
        </div>
      ) : null}

      <label className="text-sm font-medium text-neutral-700">
        元素材（任意）
        <select
          value={sourceMaterialId}
          onChange={(e) => setSourceMaterialId(e.target.value)}
          disabled={isSubmitting}
          className="mt-1.5 w-full rounded-xl border border-neutral-300 px-3.5 py-3 text-base disabled:bg-neutral-50"
        >
          <option value="">選択しない</option>
          {materialOptions.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </label>

      <button
        type="submit"
        disabled={isSubmitting}
        className="mt-2 w-full rounded-full bg-[var(--accent)] px-4 py-4 text-base font-semibold text-white hover:bg-[var(--accent-strong)] disabled:opacity-50"
      >
        {isSubmitting ? "登録中..." : "登録する"}
      </button>
    </form>
  );
}
