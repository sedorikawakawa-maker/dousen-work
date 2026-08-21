// Phase 1 時点で必要な最小限のテーブル定義。
// 今後 `supabase gen types typescript` で自動生成に置き換える想定。

export type StaffRole = "president" | "executive" | "employee" | "part_time";

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
          contract_status: string;
          current_status: string;
          contract_start_date: string | null;
          contract_end_date: string | null;
          notes: string | null;
          revenue_amount: number | null;
          fee_amount: number | null;
          material_wait_started_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["clients"]["Row"],
          "id" | "created_at" | "updated_at"
        > & {
          id?: string;
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
          assignment_type: "primary" | "secondary";
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
