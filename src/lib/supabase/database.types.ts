// Phase 2 時点で必要な最小限のテーブル定義。
// 今後 `supabase gen types typescript` で自動生成に置き換える想定。

export type StaffRole = "president" | "executive" | "employee" | "part_time";

export type ContractStatus = "contracted" | "proposal" | "paused" | "ended";

export type ClientCurrentStatus =
  | "on_track"
  | "material_waiting"
  | "in_production"
  | "wcheck_waiting"
  | "client_confirmation_waiting"
  | "posting_waiting"
  | "paused"
  | "other";

export type AssignmentType = "primary" | "secondary";

export type LinkType =
  | "instagram"
  | "tiktok"
  | "youtube"
  | "website"
  | "drive_root"
  | "canva_feed"
  | "canva_story"
  | "canva_thumbnail"
  | "official_line"
  | "material_form";

export type PostType = "reel" | "feed" | "story";

export interface Database {
  public: {
    Tables: {
      staff: {
        Row: {
          id: string;
          auth_user_id: string;
          last_name: string;
          first_name: string;
          role: StaffRole;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          auth_user_id: string;
          last_name: string;
          first_name: string;
          role: StaffRole;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["staff"]["Insert"]>;
        Relationships: [];
      };
      clients: {
        Row: {
          id: string;
          client_code: string;
          company_name: string;
          shop_name: string | null;
          phone: string | null;
          email: string | null;
          contact_name: string | null;
          industry: string | null;
          inflow_channel: string | null;
          contact_method: string | null;
          contract_status: ContractStatus;
          current_status: ClientCurrentStatus;
          contract_start_date: string | null;
          contract_end_date: string | null;
          notes: string | null;
          revenue_amount: number | null;
          fee_amount: number | null;
          material_wait_started_at: string | null;
          reminder_enabled: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["clients"]["Row"],
          "id" | "client_code" | "reminder_enabled" | "created_at" | "updated_at"
        > & {
          id?: string;
          // 空文字を渡すとDBトリガーが自動採番する（例: D00028）
          client_code?: string;
          reminder_enabled?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["clients"]["Insert"]>;
        Relationships: [];
      };
      client_assignments: {
        Row: {
          id: string;
          client_id: string;
          staff_id: string;
          assignment_type: AssignmentType;
          active_from: string;
          active_to: string | null;
          created_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["client_assignments"]["Row"],
          "id" | "created_at"
        > & {
          id?: string;
          created_at?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["client_assignments"]["Insert"]
        >;
        Relationships: [];
      };
      client_operation_profiles: {
        Row: {
          id: string;
          client_id: string;
          purpose: string | null;
          target_audience: string | null;
          content_direction: string | null;
          tone: string | null;
          cta_policy: string | null;
          ng_notes: string | null;
          reference_accounts: string | null;
          hashtag_policy: string | null;
          hearing_sheet_url: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["client_operation_profiles"]["Row"],
          "id" | "created_at" | "updated_at"
        > & {
          id?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["client_operation_profiles"]["Insert"]
        >;
        Relationships: [];
      };
      client_links: {
        Row: {
          id: string;
          client_id: string;
          link_type: LinkType;
          label: string | null;
          url: string;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["client_links"]["Row"],
          "id" | "created_at" | "updated_at"
        > & {
          id?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["client_links"]["Insert"]>;
        Relationships: [];
      };
      client_credentials: {
        Row: {
          id: string;
          client_id: string;
          service_name: string;
          login_id: string | null;
          password_vault_url: string | null;
          last_updated_at: string | null;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["client_credentials"]["Row"],
          "id" | "created_at" | "updated_at"
        > & {
          id?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["client_credentials"]["Insert"]
        >;
        Relationships: [];
      };
      posting_schedule_rules: {
        Row: {
          id: string;
          client_id: string;
          post_type: PostType;
          monthly_target: number;
          weekday_rule: Record<string, unknown>;
          production_lead_days: number | null;
          wcheck_lead_days: number | null;
          client_confirm_lead_days: number | null;
          valid_from: string;
          valid_to: string | null;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["posting_schedule_rules"]["Row"],
          "id" | "created_at" | "updated_at"
        > & {
          id?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["posting_schedule_rules"]["Insert"]
        >;
        Relationships: [];
      };
      activity_logs: {
        Row: {
          id: string;
          actor_staff_id: string | null;
          entity_type: string;
          entity_id: string;
          action: string;
          before_data: Record<string, unknown> | null;
          after_data: Record<string, unknown> | null;
          created_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["activity_logs"]["Row"],
          "id" | "created_at"
        > & {
          id?: string;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["activity_logs"]["Insert"]>;
        Relationships: [];
      };
    };
    Views: {
      clients_view: {
        Row: Omit<
          Database["public"]["Tables"]["clients"]["Row"],
          "revenue_amount" | "fee_amount"
        > & {
          revenue_amount: number | null;
          fee_amount: number | null;
        };
        Relationships: [];
      };
    };
    Functions: Record<string, never>;
    Enums: Record<string, never>;
  };
}
