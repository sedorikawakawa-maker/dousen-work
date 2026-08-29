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

export type TaskKind = "recurring" | "spot";

export type SubmittedByType = "client" | "staff";

/** create_material_submission / create_client_material_submission の p_files 要素。 */
export interface MaterialSubmissionFileInput {
  file_name: string;
  drive_file_id: string;
  drive_url: string;
}

export type WCheckAssetType = "drive_video" | "canva";

export type WCheckStatus = "waiting" | "approved" | "revision_requested";

export type ClientConfirmationStatus = "waiting" | "approved" | "revision_requested";

export type ReminderType = "material" | "client_confirmation";

export type OutsourcingStatus =
  | "draft"
  | "requested"
  | "in_progress"
  | "delivered"
  | "completed"
  | "cancelled";

export type DriveIntegrationStatus = "not_connected" | "connected" | "error";
export type DriveVerifyStatus = "ok" | "error";

export type InternalTaskPriority = "A" | "B" | "C";

export type InternalTaskStatus = "not_started" | "in_progress" | "done";

export type ProductionTaskStatus =
  | "material_waiting"
  | "production_waiting"
  | "in_production"
  | "wcheck_waiting"
  | "client_confirmation_waiting"
  | "posting_waiting"
  | "completed";

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
          last_login_at: string | null;
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
          last_login_at?: string | null;
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
          material_reminder_enabled: boolean;
          client_confirmation_reminder_enabled: boolean;
          created_at: string;
          updated_at: string;
          services: string[];
          thumbnail_url: string | null;
        };
        Insert: Omit<
          Database["public"]["Tables"]["clients"]["Row"],
          | "id"
          | "client_code"
          | "material_reminder_enabled"
          | "client_confirmation_reminder_enabled"
          | "created_at"
          | "updated_at"
          | "services"
          | "thumbnail_url"
        > & {
          id?: string;
          // 空文字を渡すとDBトリガーが自動採番する（例: D00028）
          client_code?: string;
          material_reminder_enabled?: boolean;
          client_confirmation_reminder_enabled?: boolean;
          created_at?: string;
          updated_at?: string;
          services?: string[];
          thumbnail_url?: string | null;
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
      production_tasks: {
        Row: {
          id: string;
          client_id: string;
          schedule_rule_id: string | null;
          post_type: PostType;
          task_kind: TaskKind;
          source_month: string;
          scheduled_post_date: string | null;
          original_scheduled_post_date: string | null;
          status: ProductionTaskStatus;
          assignee_staff_id: string | null;
          secondary_staff_id: string | null;
          title: string;
          production_start_date: string | null;
          wcheck_due_date: string | null;
          client_confirm_due_date: string | null;
          is_carryover: boolean;
          carried_from_task_id: string | null;
          // タスク単位の素材待ち開始日時（1顧客に複数タスクが同時に素材待ちになり得るため、
          // clients.material_wait_started_atとは別に保持する）
          material_wait_started_at: string | null;
          started_at: string | null;
          completed_at: string | null;
          work_minutes: number | null;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["production_tasks"]["Row"],
          | "id"
          | "material_wait_started_at"
          | "started_at"
          | "completed_at"
          | "work_minutes"
          | "notes"
          | "created_at"
          | "updated_at"
        > & {
          id?: string;
          material_wait_started_at?: string | null;
          started_at?: string | null;
          completed_at?: string | null;
          work_minutes?: number | null;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["production_tasks"]["Insert"]
        >;
        Relationships: [];
      };
      post_records: {
        Row: {
          id: string;
          production_task_id: string | null;
          client_id: string;
          post_type: PostType;
          posted_at: string;
          posted_by_staff_id: string;
          title: string | null;
          social_post_url: string | null;
          canva_url: string | null;
          final_drive_file_id: string | null;
          final_drive_url: string | null;
          source_material_id: string | null;
          created_at: string;
          cancelled_at: string | null;
          cancelled_by_staff_id: string | null;
          cancel_reason: string | null;
        };
        Insert: Omit<
          Database["public"]["Tables"]["post_records"]["Row"],
          "id" | "created_at" | "cancelled_at" | "cancelled_by_staff_id" | "cancel_reason"
        > & {
          id?: string;
          created_at?: string;
          cancelled_at?: string | null;
          cancelled_by_staff_id?: string | null;
          cancel_reason?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["post_records"]["Insert"]>;
        Relationships: [];
      };
      materials: {
        Row: {
          id: string;
          client_id: string;
          material_submission_id: string;
          file_name: string | null;
          title: string;
          post_usage: string | null;
          requested_post_timing: string | null;
          editing_instructions: string | null;
          caption_instructions: string | null;
          contact_notes: string | null;
          shot_date: string | null;
          received_at: string;
          drive_file_id: string | null;
          drive_url: string | null;
          submitted_by_type: SubmittedByType;
          created_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["materials"]["Row"],
          "id" | "received_at" | "submitted_by_type" | "created_at"
        > & {
          id?: string;
          received_at?: string;
          submitted_by_type?: SubmittedByType;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["materials"]["Insert"]>;
        Relationships: [];
      };
      material_submissions: {
        Row: {
          id: string;
          client_id: string;
          title: string;
          post_usage: string | null;
          requested_post_timing: string | null;
          editing_instructions: string | null;
          caption_instructions: string | null;
          contact_notes: string | null;
          shot_date: string | null;
          received_at: string;
          submitted_by_type: SubmittedByType;
          drive_folder_id: string | null;
          drive_folder_url: string | null;
          created_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["material_submissions"]["Row"],
          "id" | "received_at" | "submitted_by_type" | "drive_folder_id" | "drive_folder_url" | "created_at"
        > & {
          id?: string;
          received_at?: string;
          submitted_by_type?: SubmittedByType;
          drive_folder_id?: string | null;
          drive_folder_url?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["material_submissions"]["Insert"]>;
        Relationships: [];
      };
      notifications: {
        Row: {
          id: string;
          recipient_staff_id: string;
          notification_type: string;
          title: string;
          body: string | null;
          entity_type: string | null;
          entity_id: string | null;
          is_read: boolean;
          created_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["notifications"]["Row"],
          "id" | "is_read" | "created_at"
        > & {
          id?: string;
          is_read?: boolean;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["notifications"]["Insert"]>;
        Relationships: [];
      };
      material_form_tokens: {
        Row: {
          id: string;
          client_id: string;
          token_hash: string;
          is_active: boolean;
          created_by_staff_id: string | null;
          created_at: string;
          revoked_at: string | null;
          expires_at: string | null;
        };
        Insert: Omit<
          Database["public"]["Tables"]["material_form_tokens"]["Row"],
          "id" | "is_active" | "created_at" | "revoked_at" | "expires_at"
        > & {
          id?: string;
          is_active?: boolean;
          created_at?: string;
          revoked_at?: string | null;
          expires_at?: string | null;
        };
        Update: Partial<
          Database["public"]["Tables"]["material_form_tokens"]["Insert"]
        >;
        Relationships: [];
      };
      w_checks: {
        Row: {
          id: string;
          production_task_id: string;
          requested_by_staff_id: string;
          reviewer_staff_id: string | null;
          asset_type: WCheckAssetType;
          asset_url: string;
          status: WCheckStatus;
          notes: string | null;
          revision_comment: string | null;
          requested_at: string;
          reviewed_at: string | null;
          created_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["w_checks"]["Row"],
          "id" | "status" | "revision_comment" | "requested_at" | "reviewed_at" | "created_at"
        > & {
          id?: string;
          status?: WCheckStatus;
          revision_comment?: string | null;
          requested_at?: string;
          reviewed_at?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["w_checks"]["Insert"]>;
        Relationships: [];
      };
      client_confirmations: {
        Row: {
          id: string;
          production_task_id: string;
          requested_by_staff_id: string;
          status: ClientConfirmationStatus;
          requested_at: string;
          responded_at: string | null;
          revision_comment: string | null;
          created_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["client_confirmations"]["Row"],
          "id" | "status" | "requested_at" | "responded_at" | "revision_comment" | "created_at"
        > & {
          id?: string;
          status?: ClientConfirmationStatus;
          requested_at?: string;
          responded_at?: string | null;
          revision_comment?: string | null;
          created_at?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["client_confirmations"]["Insert"]
        >;
        Relationships: [];
      };
      wcheck_skips: {
        Row: {
          id: string;
          production_task_id: string;
          staff_id: string;
          reason: string | null;
          created_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["wcheck_skips"]["Row"], "id" | "created_at"> & {
          id?: string;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["wcheck_skips"]["Insert"]>;
        Relationships: [];
      };
      reminder_logs: {
        Row: {
          id: string;
          client_id: string;
          production_task_id: string | null;
          reminder_type: ReminderType;
          reminded_by_staff_id: string;
          reminded_at: string;
          note: string | null;
        };
        Insert: Omit<
          Database["public"]["Tables"]["reminder_logs"]["Row"],
          "id" | "reminded_at"
        > & {
          id?: string;
          reminded_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["reminder_logs"]["Insert"]>;
        Relationships: [];
      };
      drive_integration: {
        Row: {
          id: number;
          status: DriveIntegrationStatus;
          google_account_email: string | null;
          refresh_token_encrypted: string | null;
          root_folder_id: string | null;
          root_folder_name: string | null;
          last_verified_at: string | null;
          last_verified_status: DriveVerifyStatus | null;
          last_error_message: string | null;
          connected_by_staff_id: string | null;
          connected_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["drive_integration"]["Row"],
          "created_at" | "updated_at"
        > & {
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["drive_integration"]["Insert"]>;
        Relationships: [];
      };
      outsourcing_requests: {
        Row: {
          id: string;
          client_id: string | null;
          production_task_id: string | null;
          title: string;
          contractor_name: string;
          instruction: string | null;
          material_link: string | null;
          requested_at: string;
          due_date: string | null;
          upload_token_hash: string;
          token_expires_at: string | null;
          status: OutsourcingStatus;
          created_by_staff_id: string;
          created_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["outsourcing_requests"]["Row"],
          "id" | "requested_at" | "status" | "created_at"
        > & {
          id?: string;
          requested_at?: string;
          status?: OutsourcingStatus;
          created_at?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["outsourcing_requests"]["Insert"]
        >;
        Relationships: [];
      };
      outsourcing_deliveries: {
        Row: {
          id: string;
          outsourcing_request_id: string;
          drive_file_id: string | null;
          drive_url: string | null;
          contractor_note: string | null;
          delivered_at: string;
          created_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["outsourcing_deliveries"]["Row"],
          "id" | "delivered_at" | "created_at"
        > & {
          id?: string;
          delivered_at?: string;
          created_at?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["outsourcing_deliveries"]["Insert"]
        >;
        Relationships: [];
      };
      wcheck_list_views: {
        Row: {
          staff_id: string;
          last_viewed_at: string;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["wcheck_list_views"]["Row"],
          "created_at" | "updated_at"
        > & {
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["wcheck_list_views"]["Insert"]>;
        Relationships: [];
      };
      production_videos: {
        Row: {
          id: string;
          client_id: string;
          post_type: PostType | null;
          file_name: string | null;
          drive_file_id: string;
          drive_url: string;
          memo: string | null;
          uploaded_by_staff_id: string;
          created_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["production_videos"]["Row"],
          "id" | "post_type" | "file_name" | "memo" | "created_at"
        > & {
          id?: string;
          post_type?: PostType | null;
          file_name?: string | null;
          memo?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["production_videos"]["Insert"]>;
        Relationships: [];
      };
      internal_tasks: {
        Row: {
          id: string;
          client_id: string | null;
          assignee_staff_id: string;
          category: string;
          title: string;
          description: string | null;
          priority: InternalTaskPriority;
          status: InternalTaskStatus;
          due_at: string | null;
          attachment_url: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["internal_tasks"]["Row"],
          "id" | "priority" | "status" | "created_at" | "updated_at"
        > & {
          id?: string;
          priority?: InternalTaskPriority;
          status?: InternalTaskStatus;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["internal_tasks"]["Insert"]>;
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
      drive_integration_status_view: {
        Row: Omit<
          Database["public"]["Tables"]["drive_integration"]["Row"],
          "refresh_token_encrypted" | "connected_by_staff_id" | "created_at"
        >;
        Relationships: [];
      };
    };
    Functions: {
      create_post_record_and_complete_task: {
        Args: {
          p_production_task_id: string;
          p_client_id: string;
          p_post_type: PostType;
          p_posted_at: string;
          p_posted_by_staff_id: string;
          p_title: string | null;
          p_social_post_url: string | null;
          p_canva_url: string | null;
          p_final_drive_file_id: string | null;
          p_final_drive_url: string | null;
          p_source_material_id: string | null;
        };
        Returns: string;
      };
      cancel_post_record: {
        Args: {
          p_post_record_id: string;
          p_staff_id: string;
          p_reason: string;
        };
        Returns: undefined;
      };
      create_outsourcing_delivery: {
        Args: {
          p_outsourcing_request_id: string;
          p_drive_file_id: string | null;
          p_drive_url: string | null;
          p_contractor_note: string | null;
        };
        Returns: string;
      };
      create_client: {
        Args: {
          p_company_name: string;
          p_shop_name: string | null;
          p_phone: string | null;
          p_email: string | null;
          p_contact_name: string | null;
          p_industry: string | null;
          p_inflow_channel: string | null;
          p_contact_method: string | null;
          p_contract_status: ContractStatus;
          p_contract_start_date: string | null;
          p_notes: string | null;
          p_services: string[];
        };
        Returns: string;
      };
      update_client_basic_info: {
        Args: {
          p_client_id: string;
          p_company_name: string;
          p_shop_name: string | null;
          p_phone: string | null;
          p_email: string | null;
          p_contact_name: string | null;
          p_industry: string | null;
          p_inflow_channel: string | null;
          p_contact_method: string | null;
          p_notes: string | null;
          p_services: string[];
        };
        Returns: undefined;
      };
      update_client_thumbnail: {
        Args: {
          p_client_id: string;
          p_thumbnail_url: string | null;
        };
        Returns: undefined;
      };
      update_client_contract: {
        Args: {
          p_client_id: string;
          p_contract_status: ContractStatus;
          p_contract_start_date: string | null;
          p_contract_end_date: string | null;
          p_update_finance: boolean;
          p_revenue_amount: number | null;
          p_fee_amount: number | null;
        };
        Returns: undefined;
      };
      update_client_reminder_setting: {
        Args: {
          p_client_id: string;
          p_material_reminder_enabled: boolean;
          p_client_confirmation_reminder_enabled: boolean;
        };
        Returns: undefined;
      };
      update_client_status: {
        Args: {
          p_client_id: string;
          p_new_status: ClientCurrentStatus;
        };
        Returns: undefined;
      };
      create_material_submission: {
        Args: {
          p_id: string;
          p_client_id: string;
          p_title: string;
          p_post_usage: string | null;
          p_requested_post_timing: string | null;
          p_editing_instructions: string | null;
          p_caption_instructions: string | null;
          p_contact_notes: string | null;
          p_shot_date: string | null;
          p_drive_folder_id: string | null;
          p_drive_folder_url: string | null;
          p_files: MaterialSubmissionFileInput[];
        };
        Returns: string;
      };
      create_client_material_submission: {
        Args: {
          p_id: string;
          p_client_id: string;
          p_title: string;
          p_post_usage: string | null;
          p_requested_post_timing: string | null;
          p_editing_instructions: string | null;
          p_caption_instructions: string | null;
          p_contact_notes: string | null;
          p_shot_date: string | null;
          p_drive_folder_id: string | null;
          p_drive_folder_url: string | null;
          p_files: MaterialSubmissionFileInput[];
        };
        Returns: string;
      };
    };
    Enums: Record<string, never>;
  };
}
