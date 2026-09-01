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
import { generateMaterialFormToken, hashMaterialFormToken } from "@/lib/materials/formToken";
import { uploadFilesForMaterialSubmission } from "@/lib/materials/submissionUpload";
import type {
  AssignmentType,
  ContractStatus,
  LinkType,
  MaterialSubmissionFileInput,
  PostType,
} from "@/lib/supabase/database.types";

function emptyToNull(value: FormDataEntryValue | null): string | null {
  const text = String(value ?? "").trim();
  return text === "" ? null : text;
}

const THUMBNAIL_BUCKET = "client-thumbnails";
const MAX_THUMBNAIL_BYTES = 5 * 1024 * 1024;
const ALLOWED_THUMBNAIL_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"];

function extensionForThumbnailType(mime: string): string {
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  return "jpg";
}

/** 顧客ロゴ/店舗サムネイルのアップロード・差し替え。Google Driveの素材フォルダとは無関係。 */
export async function uploadClientThumbnailAction(formData: FormData) {
  const clientId = String(formData.get("clientId"));
  const file = formData.get("file");

  if (!(file instanceof File) || file.size === 0) {
    redirect(`/clients/${clientId}?tab=overview&error=${encodeURIComponent("画像ファイルを選択してください")}`);
  }
  if (!ALLOWED_THUMBNAIL_TYPES.includes(file.type)) {
    redirect(
      `/clients/${clientId}?tab=overview&error=${encodeURIComponent("jpg・png・webp形式の画像のみアップロードできます")}`,
    );
  }
  if (file.size > MAX_THUMBNAIL_BYTES) {
    redirect(`/clients/${clientId}?tab=overview&error=${encodeURIComponent("画像は5MB以下にしてください")}`);
  }

  const supabase = await createSupabaseServerClient();

  // 安全な差し替え順序: 1) 新画像を新規パスへアップロード 2) 成功確認 3) DB更新 4) DB更新成功後にのみ旧画像を削除。
  // 新画像アップロード・DB更新のいずれかが失敗した場合、既存の旧画像には一切触れない。
  const path = `${clientId}/${Date.now()}.${extensionForThumbnailType(file.type)}`;
  const { error: uploadError } = await supabase.storage
    .from(THUMBNAIL_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: true });

  if (uploadError) {
    redirect(`/clients/${clientId}?tab=overview&error=${encodeURIComponent("画像のアップロードに失敗しました")}`);
  }

  const {
    data: { publicUrl },
  } = supabase.storage.from(THUMBNAIL_BUCKET).getPublicUrl(path);

  const { error: rpcError } = await supabase.rpc("update_client_thumbnail", {
    p_client_id: clientId,
    p_thumbnail_url: publicUrl,
  });

  if (rpcError) {
    // DB更新が失敗した場合、旧画像は残したまま。今回アップロードした新画像は孤立するが、
    // 誤って旧画像を消すよりも安全なため、ベストエフォートで新画像だけ後始末する。
    await supabase.storage.from(THUMBNAIL_BUCKET).remove([path]);
    redirect(`/clients/${clientId}?tab=overview&error=${encodeURIComponent("画像の保存に失敗しました")}`);
  }

  // DB更新が成功した後にのみ、新パス以外の旧ファイルを削除する（ベストエフォート）。
  // 削除に失敗しても、サムネイル更新自体は既に成功しているためエラー扱いにしない。
  const { data: existingFiles } = await supabase.storage.from(THUMBNAIL_BUCKET).list(clientId);
  const staleFiles = (existingFiles ?? [])
    .map((f) => `${clientId}/${f.name}`)
    .filter((existingPath) => existingPath !== path);
  if (staleFiles.length > 0) {
    await supabase.storage.from(THUMBNAIL_BUCKET).remove(staleFiles);
  }

  redirect(`/clients/${clientId}?tab=overview&saved=1`);
}

/** 顧客ロゴ/店舗サムネイルの削除。 */
export async function removeClientThumbnailAction(formData: FormData) {
  const clientId = String(formData.get("clientId"));
  const supabase = await createSupabaseServerClient();

  const { data: existingFiles } = await supabase.storage.from(THUMBNAIL_BUCKET).list(clientId);
  if (existingFiles && existingFiles.length > 0) {
    await supabase.storage.from(THUMBNAIL_BUCKET).remove(existingFiles.map((f) => `${clientId}/${f.name}`));
  }

  await supabase.rpc("update_client_thumbnail", { p_client_id: clientId, p_thumbnail_url: null });

  redirect(`/clients/${clientId}?tab=overview&saved=1`);
}

function editUrl(clientId: string, params: Record<string, string>) {
  const search = new URLSearchParams(params).toString();
  return `/clients/${clientId}/edit?${search}`;
}

export async function updateBasicInfoAction(formData: FormData) {
  const clientId = String(formData.get("clientId"));
  const supabase = await createSupabaseServerClient();
  const services = formData.getAll("services").map((v) => String(v));

  const { error } = await supabase.rpc("update_client_basic_info", {
    p_client_id: clientId,
    p_company_name: String(formData.get("companyName") ?? "").trim(),
    p_shop_name: emptyToNull(formData.get("shopName")),
    p_phone: emptyToNull(formData.get("phone")),
    p_email: emptyToNull(formData.get("email")),
    p_contact_name: emptyToNull(formData.get("contactName")),
    p_industry: emptyToNull(formData.get("industry")),
    p_inflow_channel: emptyToNull(formData.get("inflowChannel")),
    p_contact_method: emptyToNull(formData.get("contactMethod")),
    p_notes: emptyToNull(formData.get("notes")),
    p_services: services,
  });

  redirect(
    editUrl(clientId, error ? { error: error.message, section: "basic" } : { saved: "basic" }),
  );
}

export async function updateContractAction(formData: FormData) {
  const clientId = String(formData.get("clientId"));
  const staff = await getCurrentStaff();
  const supabase = await createSupabaseServerClient();

  const contractStatus = String(formData.get("contractStatus") ?? "proposal") as ContractStatus;
  const contractStartDate = emptyToNull(formData.get("contractStartDate"));
  const contractEndDate = emptyToNull(formData.get("contractEndDate"));

  const canUpdateFinance = Boolean(staff && canViewFinance(staff.role));
  const revenue = emptyToNull(formData.get("revenueAmount"));
  const fee = emptyToNull(formData.get("feeAmount"));

  const { error } = await supabase.rpc("update_client_contract", {
    p_client_id: clientId,
    p_contract_status: contractStatus,
    p_contract_start_date: contractStartDate,
    p_contract_end_date: contractEndDate,
    p_update_finance: canUpdateFinance,
    p_revenue_amount: canUpdateFinance && revenue !== null ? Number(revenue) : null,
    p_fee_amount: canUpdateFinance && fee !== null ? Number(fee) : null,
  });

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

/**
 * ログイン者の一括更新。現在選択されているstaff集合とDBの既存集合の差分だけを
 * INSERT/DELETEする。途中失敗で全件消えることを避けるため、先にINSERT（新規追加分）
 * を確定させてから、その後にDELETE（解除分）を行う順序にしている
 * （INSERT失敗時は既存の登録に一切影響しない。DELETE失敗時も、消し漏れが残るだけで
 * 全滅よりはるかに安全）。
 */
export async function updateLoginStaffAction(formData: FormData) {
  const clientId = String(formData.get("clientId"));
  const staff = await getCurrentStaff();
  const supabase = await createSupabaseServerClient();

  const selectedStaffIds = [...new Set(formData.getAll("loginStaffIds").map((v) => String(v)))];

  const { data: currentRows, error: fetchError } = await supabase
    .from("client_login_staff")
    .select("staff_id")
    .eq("client_id", clientId);

  if (fetchError) {
    redirect(editUrl(clientId, { error: fetchError.message, section: "loginStaff" }));
  }

  const currentStaffIds = new Set((currentRows ?? []).map((r) => r.staff_id));
  const selectedSet = new Set(selectedStaffIds);

  const toAdd = selectedStaffIds.filter((id) => !currentStaffIds.has(id));
  const toRemove = [...currentStaffIds].filter((id) => !selectedSet.has(id));

  if (toAdd.length > 0) {
    const { error: insertError } = await supabase.from("client_login_staff").insert(
      toAdd.map((staffId) => ({
        client_id: clientId,
        staff_id: staffId,
        created_by_staff_id: staff?.id ?? null,
      })),
    );
    if (insertError) {
      redirect(editUrl(clientId, { error: insertError.message, section: "loginStaff" }));
    }
  }

  if (toRemove.length > 0) {
    const { error: deleteError } = await supabase
      .from("client_login_staff")
      .delete()
      .eq("client_id", clientId)
      .in("staff_id", toRemove);
    if (deleteError) {
      redirect(editUrl(clientId, { error: deleteError.message, section: "loginStaff" }));
    }
  }

  redirect(editUrl(clientId, { saved: "loginStaff" }));
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

  const monthlyTarget = Number(formData.get("monthlyTarget") ?? 0);
  if (!Number.isInteger(monthlyTarget) || monthlyTarget < 0) {
    redirect(
      editUrl(clientId, { error: "月間本数は0以上の整数で入力してください", section: "schedule" }),
    );
  }

  const payload = {
    client_id: clientId,
    post_type: postType,
    monthly_target: monthlyTarget,
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

  const { error } = await supabase.rpc("update_client_reminder_setting", {
    p_client_id: clientId,
    p_material_reminder_enabled: materialReminderEnabled,
    p_client_confirmation_reminder_enabled: clientConfirmationReminderEnabled,
  });

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

  const file = formData.get("file");
  const files = file instanceof File && file.size > 0 ? [file] : [];

  // submission IDを先に確定し、Drive submissionフォルダの一意化とDB行のidに同じ値を使う。
  // Drive格納に失敗した場合はここで中断し、submission・materialsとも作成しない
  // （Drive成功 → DB保存の順序を守る。顧客向けフォームと共通の仕組み）。
  let submissionId = "";
  let driveFolderId: string | null = null;
  let driveFolderUrl: string | null = null;
  let uploadedFiles: MaterialSubmissionFileInput[] = [];
  try {
    const result = await uploadFilesForMaterialSubmission({ clientId, title, files });
    submissionId = result.submissionId;
    driveFolderId = result.driveFolderId;
    driveFolderUrl = result.driveFolderUrl;
    uploadedFiles = result.files;
  } catch {
    redirect(
      `/clients/${clientId}?tab=materials&error=${encodeURIComponent("ファイルの保存に失敗しました。時間をおいて再度お試しください")}`,
    );
  }

  // submission作成＋materials作成を1トランザクションで行うRPC（顧客向けフォームと共通の仕組み）。
  const { error } = await supabase.rpc("create_material_submission", {
    p_id: submissionId,
    p_client_id: clientId,
    p_title: title,
    p_post_usage: emptyToNull(formData.get("postUsage")),
    p_requested_post_timing: emptyToNull(formData.get("requestedPostTiming")),
    p_editing_instructions: emptyToNull(formData.get("editingInstructions")),
    p_caption_instructions: emptyToNull(formData.get("captionInstructions")),
    p_contact_notes: emptyToNull(formData.get("contactNotes")),
    p_shot_date: emptyToNull(formData.get("shotDate")),
    p_drive_folder_id: driveFolderId,
    p_drive_folder_url: driveFolderUrl,
    p_files: uploadedFiles,
  });

  if (error) {
    redirect(
      `/clients/${clientId}?tab=materials&error=${encodeURIComponent("登録に失敗しました。時間をおいて再度お試しください")}`,
    );
  }

  redirect(`/clients/${clientId}?tab=materials&saved=1`);
}

/**
 * 素材フォームURLの発行・再発行。既存の有効トークンは無効化してから新規発行する。
 * 生の値はDBに保存しない（hashのみ保存）ため、この直後のリダイレクト先でのみ表示できる。
 */
export async function issueMaterialFormTokenAction(formData: FormData) {
  const clientId = String(formData.get("clientId"));
  const staff = await getCurrentStaff();
  const supabase = await createSupabaseServerClient();

  const rawToken = generateMaterialFormToken();
  const tokenHash = hashMaterialFormToken(rawToken);

  await supabase
    .from("material_form_tokens")
    .update({ is_active: false, revoked_at: new Date().toISOString() })
    .eq("client_id", clientId)
    .eq("is_active", true);

  const { error } = await supabase.from("material_form_tokens").insert({
    client_id: clientId,
    token_hash: tokenHash,
    created_by_staff_id: staff?.id ?? null,
  });

  if (error) {
    redirect(`/clients/${clientId}?tab=materials&error=${encodeURIComponent(error.message)}`);
  }

  redirect(`/clients/${clientId}?tab=materials&newToken=${encodeURIComponent(rawToken)}`);
}

export async function revokeMaterialFormTokenAction(formData: FormData) {
  const clientId = String(formData.get("clientId"));
  const supabase = await createSupabaseServerClient();

  await supabase
    .from("material_form_tokens")
    .update({ is_active: false, revoked_at: new Date().toISOString() })
    .eq("client_id", clientId)
    .eq("is_active", true);

  redirect(`/clients/${clientId}?tab=materials&saved=1`);
}
