import type { ClientConfirmationStatus } from "@/lib/supabase/database.types";

export const CLIENT_CONFIRMATION_STATUS_LABELS: Record<ClientConfirmationStatus, string> = {
  waiting: "確認待ち",
  approved: "OK",
  revision_requested: "修正依頼",
};
