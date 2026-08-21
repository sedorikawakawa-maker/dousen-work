"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentStaff } from "@/lib/auth/session";
import { canViewFinance } from "@/lib/auth/roles";
import {
  generateTasksForRule,
  regenerateTasksForRule,
  removeUnstartedFutureTasksForRule,
} from "@/lib/scheduling/generate";
import type { WeekdayRule } from "@/lib/scheduling/weekdayRule";
import { getDriveService } from "@/lib/drive/DriveService";
import type {
  AssignmentType,
  ContractStatus,
  Database,
  LinkType,
  PostType,
} from "@/lib/supabase/database.types";

type ClientUpdate = Database["public"]["Tables"]["clients"]["Update"];

function emptyToNull(value: FormDataEntryValue | null): string | null {
  const text = String(value ?? "").trim();
  return text === "" ? null : text;
}

function editUrl(clientId: string, params: Record<string, string>) {
  const search = new URLSearchParams(params).toString();
  return `/clients/${clientId}/edit?${search}`;
}

export async function updateBasicInfoAction(formData: FormData) {
  const clientId = String(formData.get("clientId"));
  const supabase = await createSupabaseServerClient();

  const { error } = await supabase
    .from("clients")
    .update({
      company_name: String(formData.get("companyName") ?? "").trim(),
      shop_name: emptyToNull(formData.get("shopName")),
      phone: emptyToNull(formData.get("phone")),
      email: emptyToNull(formData.get("email")),
      contact_name: emptyToNull(formData.get("contactName")),
      industry: emptyToNull(formData.get("industry")),
      inflow_channel: emptyToNull(formData.get("inflowChannel")),
      contact_method: emptyToNull(formData.get("contactMethod")),
      notes: emptyToNull(formData.get("notes")),
    })
    .eq("id", clientId);

  redirect(
    editUrl(clientId, error ? { error: error.message, section: "basic" } : { saved: "basic" }),
  );
}

export async function updateContractAction(formData: FormData) {
  const clientId = String(formData.get("clientId"));
  const staff = await getCurrentStaff();
  const supabase = await createSupabaseServerClient();

  const update: ClientUpdate = {
    contract_status: String(formData.get("contractStatus") ?? "proposal") as ContractStatus,
    contract_start_date: emptyToNull(formData.get("contractStartDate")),
    contract_end_date: emptyToNull(formData.get("contractEndDate")),
  };

  if (staff && canViewFinance(staff.role)) {
    const revenue = emptyToNull(formData.get("revenueAmount"));
    const fee = emptyToNull(formData.get("feeAmount"));
    update.revenue_amount = revenue === null ? null : Number(revenue);
    update.fee_amount = fee === null ? null : Number(fee);
  }

  const { error } = await supabase.from("clients").update(update).eq("id", clientId);

  redirect(
    editUrl(
      clientId,
      error ? { error: error.message, section: "contract" } : { saved: "contract" },
    ),
  );
}

export async function updateAssignmentAction(formData: FormData) {
  const clientId = String(formData.get("clientId"));
  const assignmentType = String(formData.get("assignmentType")) as AssignmentType;
  const staffId = emptyToNull(formData.get("staffId"));
  const supabase = await createSupabaseServerClient();
  const today = new Date().toISOString().slice(0, 10);

  const { data: current } = await supabase
    .from("client_assignments")
    .select("id, staff_id")
    .eq("client_id", clientId)
    .eq("assignment_type", assignmentType)
    .is("active_to", null)
    .maybeSingle();

  if (current?.staff_id === staffId) {
    redirect(editUrl(clientId, { saved: "assignment" }));
  }

  if (current) {
    await supabase
      .from("client_assignments")
      .update({ active_to: today })
      .eq("id", current.id);
  }

  if (staffId) {
    const { error } = await supabase.from("client_assignments").insert({
      client_id: clientId,
      staff_id: staffId,
      assignment_type: assignmentType,
      active_from: today,
      active_to: null,
    });
    if (error) {
      redirect(editUrl(clientId, { error: error.message, section: "assignment" }));
    }

    // 主担当変更時: 未完了の制作タスクは新主担当へ引き継ぐ（過去実績の担当者は変更しない）
    if (assignmentType === "primary") {
      await supabase
        .from("production_tasks")
        .update({ assignee_staff_id: staffId })
        .eq("client_id", clientId)
        .neq("status", "completed");
    }
  }

  redirect(editUrl(clientId, { saved: "assignment" }));
}

export async function updateOperationProfileAction(formData: FormData) {
  const clientId = String(formData.get("clientId"));
  const supabase = await createSupabaseServerClient();

  const { error } = await supabase.from("client_operation_profiles").upsert(
    {
      client_id: clientId,
      purpose: emptyToNull(formData.get("purpose")),
      target_audience: emptyToNull(formData.get("targetAudience")),
      content_direction: emptyToNull(formData.get("contentDirection")),
      tone: emptyToNull(formData.get("tone")),
      cta_policy: emptyToNull(formData.get("ctaPolicy")),
      ng_notes: emptyToNull(formData.get("ngNotes")),
      reference_accounts: emptyToNull(formData.get("referenceAccounts")),
      hashtag_policy: emptyToNull(formData.get("hashtagPolicy")),
      hearing_sheet_url: emptyToNull(formData.get("hearingSheetUrl")),
    },
    { onConflict: "client_id" },
  );

  redirect(
    editUrl(clientId, error ? { error: error.message, section: "profile" } : { saved: "profile" }),
  );
}

export async function addClientLinkAction(formData: FormData) {
  const clientId = String(formData.get("clientId"));
  const url = String(formData.get("url") ?? "").trim();
  const supabase = await createSupabaseServerClient();

  if (!url) {
    redirect(editUrl(clientId, { error: "URLを入力してください", section: "links" }));
  }

  const { error } = await supabase.from("client_links").insert({
    client_id: clientId,
    link_type: String(formData.get("linkType")) as LinkType,
    label: emptyToNull(formData.get("label")),
    url,
  });

  redirect(
    editUrl(clientId, error ? { error: error.message, section: "links" } : { saved: "links" }),
  );
}

export async function deleteClientLinkAction(formData: FormData) {
  const clientId = String(formData.get("clientId"));
  const linkId = String(formData.get("linkId"));
  const supabase = await createSupabaseServerClient();

  await supabase.from("client_links").delete().eq("id", linkId);

  redirect(editUrl(clientId, { saved: "links" }));
}

export async function addClientCredentialAction(formData: FormData) {
  const clientId = String(formData.get("clientId"));
  const serviceName = String(formData.get("serviceName") ?? "").trim();
  const supabase = await createSupabaseServerClient();

  if (!serviceName) {
    redirect(editUrl(clientId, { error: "サービス名を入力してください", section: "credentials" }));
  }

  const { error } = await supabase.from("client_credentials").insert({
    client_id: clientId,
    service_name: serviceName,
    login_id: emptyToNull(formData.get("loginId")),
    password_vault_url: emptyToNull(formData.get("passwordVaultUrl")),
    notes: emptyToNull(formData.get("notes")),
    last_updated_at: new Date().toISOString(),
  });

  redirect(
    editUrl(
      clientId,
      error ? { error: error.message, section: "credentials" } : { saved: "credentials" },
    ),
  );
}

export async function deleteClientCredentialAction(formData: FormData) {
  const clientId = String(formData.get("clientId"));
  const credentialId = String(formData.get("credentialId"));
  const supabase = await createSupabaseServerClient();

  await supabase.from("client_credentials").delete().eq("id", credentialId);

  redirect(editUrl(clientId, { saved: "credentials" }));
}

function parseWeekdayRuleFromForm(formData: FormData): WeekdayRule | null {
  const mode = String(formData.get("weekdayMode") ?? "weekly");

  if (mode === "nth_weekday") {
    const rules: { nth: number; weekday: number }[] = [];
    for (let i = 0; i < 4; i += 1) {
      const nthRaw = formData.get(`nthRow${i}Nth`);
      const weekdayRaw = formData.get(`nthRow${i}Weekday`);
      if (!nthRaw || !weekdayRaw) continue;
      const nth = Number(nthRaw);
      const weekday = Number(weekdayRaw);
      if (Number.isNaN(nth) || Number.isNaN(weekday)) continue;
      rules.push({ nth, weekday });
    }
    if (rules.length === 0) return null;
    return { mode: "nth_weekday", rules };
  }

  const weekdays = formData
    .getAll("weeklyWeekday")
    .map((v) => Number(v))
    .filter((v) => !Number.isNaN(v));
  if (weekdays.length === 0) return null;
  return { mode: "weekly", weekdays };
}

function numberOrNull(value: FormDataEntryValue | null): number | null {
  const text = emptyToNull(value);
  return text === null ? null : Number(text);
}

/**
 * 投稿種別ごとの投稿ルールを保存する。
 * 既存の有効ルール(ruleId指定あり)は同じ行を更新し、未着手・未来・未手動変更の
 * タスクのみ削除→再生成する。新規(ruleIdなし)は新しいルールを作成して生成する。
 */
export async function saveScheduleRuleAction(formData: FormData) {
  const clientId = String(formData.get("clientId"));
  const postType = String(formData.get("postType")) as PostType;
  const existingRuleId = emptyToNull(formData.get("ruleId"));
  const supabase = await createSupabaseServerClient();

  const weekdayRule = parseWeekdayRuleFromForm(formData);
  if (!weekdayRule) {
    redirect(
      editUrl(clientId, { error: "曜日ルールを1つ以上設定してください", section: "schedule" }),
    );
  }

  const payload = {
    client_id: clientId,
    post_type: postType,
    monthly_target: Number(formData.get("monthlyTarget") ?? 0),
    weekday_rule: weekdayRule as unknown as Record<string, unknown>,
    production_lead_days: numberOrNull(formData.get("productionLeadDays")),
    wcheck_lead_days: numberOrNull(formData.get("wcheckLeadDays")),
    client_confirm_lead_days: numberOrNull(formData.get("clientConfirmLeadDays")),
    valid_from: String(formData.get("validFrom") || new Date().toISOString().slice(0, 10)),
  };

  if (existingRuleId) {
    const { data: updatedRule, error } = await supabase
      .from("posting_schedule_rules")
      .update(payload)
      .eq("id", existingRuleId)
      .select("*")
      .single();

    if (error || !updatedRule) {
      redirect(
        editUrl(clientId, {
          error: error?.message ?? "更新に失敗しました",
          section: "schedule",
        }),
      );
    }

    await regenerateTasksForRule(supabase, updatedRule);
  } else {
    const { data: newRule, error } = await supabase
      .from("posting_schedule_rules")
      .insert({ ...payload, valid_to: null, is_active: true })
      .select("*")
      .single();

    if (error || !newRule) {
      redirect(
        editUrl(clientId, {
          error: error?.message ?? "登録に失敗しました",
          section: "schedule",
        }),
      );
    }

    await generateTasksForRule(supabase, newRule);
  }

  redirect(editUrl(clientId, { saved: "schedule" }));
}

export async function deactivateScheduleRuleAction(formData: FormData) {
  const clientId = String(formData.get("clientId"));
  const ruleId = String(formData.get("ruleId"));
  const supabase = await createSupabaseServerClient();
  const today = new Date().toISOString().slice(0, 10);

  await removeUnstartedFutureTasksForRule(supabase, ruleId);

  await supabase
    .from("posting_schedule_rules")
    .update({ is_active: false, valid_to: today })
    .eq("id", ruleId);

  redirect(editUrl(clientId, { saved: "schedule" }));
}

export async function updateTaskScheduledDateAction(formData: FormData) {
  const clientId = String(formData.get("clientId"));
  const taskId = String(formData.get("taskId"));
  const newDate = String(formData.get("scheduledPostDate"));
  const supabase = await createSupabaseServerClient();

  const { error } = await supabase
    .from("production_tasks")
    .update({ scheduled_post_date: newDate })
    .eq("id", taskId);

  const search = new URLSearchParams(
    error ? { error: error.message } : { saved: "1" },
  ).toString();
  redirect(`/clients/${clientId}?tab=schedule&${search}`);
}

export async function updateReminderSettingAction(formData: FormData) {
  const clientId = String(formData.get("clientId"));
  const materialReminderEnabled = formData.get("materialReminderEnabled") === "on";
  const clientConfirmationReminderEnabled =
    formData.get("clientConfirmationReminderEnabled") === "on";
  const supabase = await createSupabaseServerClient();

  const { error } = await supabase
    .from("clients")
    .update({
      material_reminder_enabled: materialReminderEnabled,
      client_confirmation_reminder_enabled: clientConfirmationReminderEnabled,
    })
    .eq("id", clientId);

  redirect(
    editUrl(
      clientId,
      error ? { error: error.message, section: "reminder" } : { saved: "reminder" },
    ),
  );
}

/** スタッフによる素材の手動登録（LINE・メール等、顧客向けフォーム以外で受領した場合）。 */
export async function addMaterialAction(formData: FormData) {
  const clientId = String(formData.get("clientId"));
  const title = String(formData.get("title") ?? "").trim();
  const supabase = await createSupabaseServerClient();

  if (!title) {
    redirect(`/clients/${clientId}?tab=materials&error=${encodeURIComponent("内容（タイトル）を入力してください")}`);
  }

  let driveFileId: string | null = null;
  let driveUrl: string | null = null;
  const file = formData.get("file");
  if (file instanceof File && file.size > 0) {
    const drive = getDriveService();
    const result = await drive.uploadFile({ file, clientId, folderHint: "materials" });
    driveFileId = result.driveFileId;
    driveUrl = result.driveUrl;
  }

  await supabase.from("materials").insert({
    client_id: clientId,
    title,
    post_usage: emptyToNull(formData.get("postUsage")),
    requested_post_timing: emptyToNull(formData.get("requestedPostTiming")),
    editing_instructions: emptyToNull(formData.get("editingInstructions")),
    caption_instructions: emptyToNull(formData.get("captionInstructions")),
    contact_notes: emptyToNull(formData.get("contactNotes")),
    shot_date: emptyToNull(formData.get("shotDate")),
    drive_file_id: driveFileId,
    drive_url: driveUrl,
    submitted_by_type: "staff",
  });

  redirect(`/clients/${clientId}?tab=materials&saved=1`);
}
