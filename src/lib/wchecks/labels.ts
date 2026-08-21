import type { WCheckAssetType, WCheckStatus } from "@/lib/supabase/database.types";
import type { PostType } from "@/lib/supabase/database.types";

export const WCHECK_ASSET_TYPE_LABELS: Record<WCheckAssetType, string> = {
  drive_video: "Google Drive動画リンク",
  canva: "Canvaリンク",
};

/** リールはGoogle Drive動画、フィード/ストーリーズはCanvaを基本とする。 */
export function assetTypeForPostType(postType: PostType): WCheckAssetType {
  return postType === "reel" ? "drive_video" : "canva";
}

export const WCHECK_STATUS_LABELS: Record<WCheckStatus, string> = {
  waiting: "Wチェック待ち",
  approved: "OK",
  revision_requested: "修正依頼",
};

// docs/ui-spec.md / docs/requirements.md: Wチェック基準として画面に表示する
// （細かなチェックボックス管理は不要）
export const WCHECK_CRITERIA = [
  "誤字脱字",
  "テロップのタイミング",
  "音量",
  "動画の切れ",
  "見やすさ",
] as const;
