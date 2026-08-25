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

/**
 * materials.post_usage表示用。新しい素材フォームはreel/feed/story等の値を保存するが、
 * 過去の自由記述データ（post_type以外の文字列）が残っていても壊れないようフォールバックする。
 */
export function postUsageLabel(value: string | null): string {
  if (!value) return "—";
  return POST_TYPE_LABELS[value as PostType] ?? value;
}

export const REQUESTED_POST_TIMING_OPTIONS = ["おまかせ", "今週～来週", "来週以降"] as const;

export const PRODUCTION_TASK_STATUS_LABELS: Record<ProductionTaskStatus, string> = {
  material_waiting: "素材待ち",
  production_waiting: "制作待ち",
  in_production: "制作中",
  wcheck_waiting: "Wチェック待ち",
  client_confirmation_waiting: "顧客確認待ち",
  posting_waiting: "投稿待ち",
  completed: "完了",
};

/**
 * 提供サービスの選択肢（設定マスタ準拠）。1顧客が複数選択できる想定でtext[]に保存する。
 * DB側は自由なtext[]のため、この一覧に無い値（将来の追加等）が入っていても表示は壊れない。
 */
export const SERVICE_OPTIONS = [
  "丸投げプラン",
  "コンサルティング",
  "台本制作",
  "投稿管理",
  "動画チェック",
  "動画制作",
  "撮影",
  "編集",
  "MEO",
  "ブランディング支援",
  "採用支援",
  "Youtube出演",
  "その他",
] as const;

/**
 * 連絡手段/流入経路/業種は既存どおりclients.*がtext（自由入力）のままのため、
 * 選択肢はUI側の候補一覧としてのみ定義する。過去の自由入力値が候補外でも、
 * 各編集フォーム側でその値を選択肢へ追加表示するフォールバックを行うため消えない。
 */
export const CONTACT_METHOD_OPTIONS = ["LINE", "電話", "メール", "Messenger", "スラック", "チャットワーク"] as const;

export const INFLOW_CHANNEL_OPTIONS = [
  "紹介",
  "Instagram",
  "交流会",
  "既存顧客からの紹介",
  "HP・Google検索",
  "広告",
  "直営業・店頭",
  "YouTube",
  "その他",
] as const;

export const INDUSTRY_OPTIONS = [
  "飲食",
  "美容・サロン",
  "医療・クリニック",
  "福祉・介護",
  "教育・スクール",
  "住宅・リフォーム",
  "建設・電気系",
  "自動車・整備",
  "士業",
  "小売・物販",
  "不動産",
  "IT・映像",
  "政治家",
  "メディア・広報",
  "その他サービス業",
  "コーチング・コンサルティング",
  "その他",
] as const;

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
