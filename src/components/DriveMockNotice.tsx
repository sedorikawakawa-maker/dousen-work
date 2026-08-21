import { getDriveService } from "@/lib/drive/DriveService";

/** 開発環境かつモックDrive使用中のみ表示する注意書き。本番UIには出さない。 */
export function DriveMockNotice() {
  const isMock = getDriveService().isMock;
  if (!isMock || process.env.NODE_ENV === "production") return null;

  return (
    <p className="rounded-md bg-blue-50 px-3 py-2 text-xs text-blue-700">
      🔧 開発環境: Google Drive連携は現在モックです（アップロードしたファイルは保存されません）。
    </p>
  );
}
