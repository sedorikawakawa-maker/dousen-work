import { getDriveService } from "@/lib/drive/DriveService";

/**
 * Drive連携の状態をアップロードフォーム上に表示する。
 * 開発環境でMock使用中は常に注意書きを出す（本番では隠さない）。
 * 本番でDrive設定に不備がある場合はgetDriveService()が例外を投げるため、
 * ここで捕捉して「アップロードは失敗する」ことが分かる警告として表示する
 * （本番でモックのまま気づかれず運用される事態を防ぐため）。
 */
export async function DriveMockNotice() {
  let state: "mock" | "unavailable" | "ok";
  try {
    state = (await getDriveService()).isMock ? "mock" : "ok";
  } catch {
    state = "unavailable";
  }

  if (state === "ok") return null;

  if (state === "unavailable") {
    return (
      <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">
        ⚠ Google Drive連携が現在利用できません。ファイルのアップロードは失敗します。管理者にご連絡ください。
      </p>
    );
  }

  return (
    <p className="rounded-md bg-blue-50 px-3 py-2 text-xs text-blue-700">
      🔧 開発環境: Google Drive連携は現在モックです（アップロードしたファイルは保存されません）。
    </p>
  );
}
