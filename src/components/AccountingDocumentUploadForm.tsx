"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  createAccountingDocumentUploadSessionAction,
  confirmAccountingDocumentUploadAction,
} from "@/app/(app)/accounting/documents/actions";
import { FileSelectButton } from "@/components/FileSelectButton";

const DOCUMENT_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: "receipt", label: "レシート・領収書" },
  { value: "invoice_received", label: "仕入先請求書" },
  { value: "other", label: "その他" },
];

async function computeSha256Hex(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * 書類BOXへのアップロード。既存のmaterial/production-videosと同じ
 * 「①resumable upload session発行 → ②ブラウザから直接Driveへ直接PUT →
 * ③metadataだけをconfirmAction」の2段階方式。ファイル本文はNetlify Functionsの
 * リクエストボディへ一切通さない。Phase1は1ファイルずつのアップロードとする。
 */
export function AccountingDocumentUploadForm() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [documentType, setDocumentType] = useState("receipt");
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<"idle" | "hashing" | "uploading" | "saving">("idle");
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

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
    if (phase !== "idle") return;
    setError(null);
    setSuccessMessage(null);

    if (!file) {
      setError("ファイルを選択してください");
      return;
    }

    try {
      setPhase("hashing");
      const fileHash = await computeSha256Hex(file);

      setPhase("uploading");
      setProgress(0);
      const sessionResult = await createAccountingDocumentUploadSessionAction(
        { fileName: file.name, mimeType: file.type || "application/octet-stream", fileSizeBytes: file.size },
        window.location.origin,
      );
      if (sessionResult.error || !sessionResult.sessionUrl) {
        setError(sessionResult.error ?? "アップロードの準備に失敗しました");
        setPhase("idle");
        return;
      }

      const uploaded = await uploadFileToSession(file, sessionResult.sessionUrl);

      setPhase("saving");
      const confirmResult = await confirmAccountingDocumentUploadAction({
        documentType,
        fileName: file.name,
        driveFileId: uploaded.id,
        driveUrl: uploaded.webViewLink,
        mimeType: file.type || "application/octet-stream",
        fileSizeBytes: file.size,
        fileHash,
      });

      if (confirmResult.error && !confirmResult.documentId) {
        setError(confirmResult.error);
        setPhase("idle");
        return;
      }

      setSuccessMessage(
        confirmResult.duplicateWarning
          ? "アップロードしました。このファイルは既に登録されている可能性があります（重複警告）。書類BOX一覧でご確認ください。"
          : "アップロードしました。書類BOX一覧に追加されました。",
      );
      setFile(null);
      setDocumentType("receipt");
      if (fileInputRef.current) fileInputRef.current.value = "";
      setPhase("idle");
      setProgress(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "アップロードに失敗しました");
      setPhase("idle");
    }
  }

  const isBusy = phase !== "idle";

  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-4 sm:p-5">
      {successMessage ? (
        <p className="mb-3 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">{successMessage}</p>
      ) : null}
      {error ? (
        <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {error}
        </p>
      ) : null}

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <label className="text-sm font-medium text-neutral-700">
          書類種別
          <select
            value={documentType}
            onChange={(e) => setDocumentType(e.target.value)}
            disabled={isBusy}
            className="mt-1.5 w-full rounded-xl border border-neutral-300 px-3.5 py-3 text-base disabled:bg-neutral-50"
          >
            {DOCUMENT_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-neutral-700">
            レシート・領収書・請求書のPDFまたは写真(JPG/PNG)
          </span>
          <FileSelectButton
            ref={fileInputRef}
            label="＋ 書類をアップロード"
            buttonSize="lg"
            accept="application/pdf,image/jpeg,image/jpg,image/png"
            disabled={isBusy}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          <p className="text-sm text-neutral-500">
            {file ? `選択中: ${file.name}` : "ファイルが選択されていません"}
          </p>
        </div>

        {isBusy ? (
          <p className="text-sm text-neutral-600">
            {phase === "hashing"
              ? "ファイルを検証中..."
              : phase === "uploading"
                ? `アップロード中${progress !== null ? `（${progress}%）` : ""}`
                : "登録中..."}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={isBusy || !file}
          className="w-full rounded-full bg-[var(--accent)] px-4 py-3.5 text-base font-semibold text-white hover:bg-[var(--accent-strong)] disabled:opacity-50"
        >
          {isBusy ? "処理中..." : "アップロードする"}
        </button>
      </form>
    </div>
  );
}
