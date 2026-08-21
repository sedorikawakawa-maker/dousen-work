import type {
  AssignmentType,
  ClientCurrentStatus,
  ContractStatus,
  LinkType,
  PostType,
  ProductionTaskStatus,
} from "@/lib/supabase/database.types";

export const CONTRACT_STATUS_LABELS: Record<ContractStatus, string> = {
  contracted: "契約中",
  proposal: "提案中",
  paused: "休止",
  ended: "契約終了",
};

export const CLIENT_CURRENT_STATUS_LABELS: Record<ClientCurrentStatus, string> = {
  on_track: "順調",
  material_waiting: "素材待ち",
  in_production: "制作中",
  wcheck_waiting: "Wチェック待ち",
  client_confirmation_waiting: "顧客確認待ち",
  posting_waiting: "投稿待ち",
  paused: "休止",
  other: "その他",
};

export const CLIENT_CURRENT_STATUS_OPTIONS = Object.entries(
  CLIENT_CURRENT_STATUS_LABELS,
) as [ClientCurrentStatus, string][];

export const CONTRACT_STATUS_OPTIONS = Object.entries(
  CONTRACT_STATUS_LABELS,
) as [ContractStatus, string][];

export const ASSIGNMENT_TYPE_LABELS: Record<AssignmentType, string> = {
  primary: "主担当",
  secondary: "副担当",
};

export const LINK_TYPE_LABELS: Record<LinkType, string> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  youtube: "YouTube",
  website: "Webサイト",
  drive_root: "Google Drive（顧客フォルダ）",
  canva_feed: "Canva（フィード）",
  canva_story: "Canva（ストーリーズ）",
  canva_thumbnail: "Canva（サムネイル）",
  official_line: "公式LINE",
  material_form: "素材フォーム",
};

export const LINK_TYPE_OPTIONS = Object.entries(LINK_TYPE_LABELS) as [
  LinkType,
  string,
][];

export const POST_TYPE_LABELS: Record<PostType, string> = {
  reel: "リール",
  feed: "フィード",
  story: "ストーリーズ",
};

export const POST_TYPE_OPTIONS = Object.entries(POST_TYPE_LABELS) as [
  PostType,
  string,
][];

export const PRODUCTION_TASK_STATUS_LABELS: Record<ProductionTaskStatus, string> = {
  material_waiting: "素材待ち",
  production_waiting: "制作待ち",
  in_production: "制作中",
  wcheck_waiting: "Wチェック待ち",
  client_confirmation_waiting: "顧客確認待ち",
  posting_waiting: "投稿待ち",
  completed: "完了",
};

export const NEXT_ACTION_BY_STATUS: Record<ClientCurrentStatus, string> = {
  on_track: "特になし",
  material_waiting: "素材の督促・確認",
  in_production: "制作を進める",
  wcheck_waiting: "Wチェック対応待ち",
  client_confirmation_waiting: "顧客からの返信待ち",
  posting_waiting: "投稿を実施する",
  paused: "休止中",
  other: "状況確認",
};
