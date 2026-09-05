"use client";

import { useState } from "react";
import { confirmOutsourcingDeliveryAction, createOutsourcingUploadSessionAction } from "./actions";

/**
 * 外注先向け納品フォーム。ファイル本体はブラウザからGoogle Driveへ直接PUTし、
 * Netlify Functions（Server Action）のリクエストボディには通さない。
 * DOUSEN WORKへ送るのは、アップロード前後の小さいmetadataのみ。
 *
 * 既存仕様どおり1納品=1ファイル（またはファイルを添付しない場合の手動保存先URL）。
 * 複数ファイルという概念自体がoutsourcing_deliveriesスキーマに無いため持ち込まない。
 */
export function OutsourcingUploadForm({ token }: { token: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [manualDriveUrl, setManualDriveUrl] = useState("");
  const [contractorNote, setContractorNote] = useState("");
  const [phase, setPhase] = useState<"idle" | "uploading" | "submitted">("idle");
  const [progress, setProgress] = useState<number | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  function uploadFileToSession(targetFile: File, sessionUrl: string): Promise<{ id: string; webViewLink: string }> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", sessionUrl, true);
      xhr.setRequestHeader("Content-Range", `bytes 0-${targetFile.size - 1}/${targetFile.size}`);
      xhr.upload.onprogress = (e) => {
        setProgress(e.lengthComputable ? Math.round((e.loaded / e.total) * 100) : null);
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
    if (phase === "uploading") return; // 二重送信防止
    setFormError(null);

    const trimmedManualUrl = manualDriveUrl.trim();
    if (!file && !trimmedManualUrl) {
      setFormError("ファイルを選択するか、保存先URLを入力してください");
      return;
    }

    setPhase("uploading");
    setProgress(file ? 0 : null);

    let driveFileId: string | null = null;
    let driveUrl: string | null = null;

    if (file) {
      // ① セッション発行（ファイル本体はまだ一切送らない）
      const sessionResult = await createOutsourcingUploadSessionAction(
        token,
        { fileName: file.name, mimeType: file.type || "application/octet-stream", fileSizeBytes: file.size },
        window.location.origin,
      );
      if (sessionResult.error || !sessionResult.sessionUrl) {
        setFormError(sessionResult.error ?? "アップロードの準備に失敗しました");
        setPhase("idle");
        return;
      }

      // ② ブラウザ → Google Driveへ直接アップロード
      try {
        const result = await uploadFileToSession(file, sessionResult.sessionUrl);
        driveFileId = result.id;
        driveUrl = result.webViewLink;
      } catch (err) {
        setFormError(err instanceof Error ? err.message : "アップロードに失敗しました");
        setPhase("idle");
        return;
      }
    }

    // ③ 成功結果（または手動URL）のmetadataだけ送って確定登録
    const confirmResult = await confirmOutsourcingDeliveryAction({
      token,
      driveFileId,
      driveUrl,
      manualDriveUrl: file ? null : trimmedManualUrl || null,
      contractorNote: contractorNote.trim() || null,
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
        納品を受け付けました。ご対応ありがとうございます。
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
          完成動画/ファイル
          <input
            type="file"
            accept="video/*,image/*"
            disabled={isUploading}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="mt-1.5 w-full text-sm disabled:opacity-50"
          />
        </label>

        {file ? (
          <div className="rounded-xl border border-neutral-200 px-3 py-2 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate text-neutral-700">{file.name}</span>
              <span className="shrink-0 text-xs">
                {phase === "uploading" ? (
                  <span className="text-[var(--accent-strong)]">
                    アップロード中{progress !== null ? `（${progress}%）` : ""}
                  </span>
                ) : (
                  <span className="text-neutral-400">待機中</span>
                )}
              </span>
            </div>
            {phase === "uploading" ? (
              <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-neutral-100">
                <div
                  className="h-full rounded-full bg-[var(--accent)] transition-all"
                  style={{ width: `${progress ?? 30}%` }}
                />
              </div>
            ) : null}
          </div>
        ) : null}

        <label className="text-sm font-medium text-neutral-700">
          保存先URL（ファイルを添付しない場合）
          <input
            type="url"
            value={manualDriveUrl}
            onChange={(e) => setManualDriveUrl(e.target.value)}
            disabled={isUploading}
            className="mt-1.5 w-full rounded-xl border border-neutral-300 px-3.5 py-3 text-base disabled:bg-neutral-50"
          />
        </label>

        <label className="text-sm font-medium text-neutral-700">
          外注メモ
          <textarea
            value={contractorNote}
            onChange={(e) => setContractorNote(e.target.value)}
            disabled={isUploading}
            rows={3}
            className="mt-1.5 w-full rounded-xl border border-neutral-300 px-3.5 py-3 text-base disabled:bg-neutral-50"
          />
        </label>

        <button
          type="submit"
          disabled={isUploading}
          className="mt-2 w-full rounded-full bg-[var(--accent)] px-4 py-4 text-base font-semibold text-white hover:bg-[var(--accent-strong)] disabled:opacity-50"
        >
          {isUploading ? "送信中..." : "納品する"}
        </button>
      </form>
    </div>
  );
}
