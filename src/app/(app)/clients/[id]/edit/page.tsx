import Link from "next/link";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentStaff } from "@/lib/auth/session";
import { canViewFinance } from "@/lib/auth/roles";
import {
  getClientDetail,
  listActiveStaff,
  listClientLoginStaffForClient,
  listLoginStaffCandidates,
} from "@/lib/clients/queries";
import {
  ASSIGNMENT_TYPE_LABELS,
  CONTACT_METHOD_OPTIONS,
  CONTRACT_STATUS_OPTIONS,
  INDUSTRY_OPTIONS,
  INFLOW_CHANNEL_OPTIONS,
  LINK_TYPE_OPTIONS,
  POST_TYPE_LABELS,
  POST_TYPE_OPTIONS,
  SERVICE_OPTIONS,
} from "@/lib/clients/labels";
import { WEEKDAY_LABELS, isWeekdayRule, type WeekdayRule } from "@/lib/scheduling/weekdayRule";
import type { Database, PostType } from "@/lib/supabase/database.types";
import {
  addClientCredentialAction,
  addClientLinkAction,
  deactivateScheduleRuleAction,
  deleteClientCredentialAction,
  deleteClientLinkAction,
  saveScheduleRuleAction,
  updateAssignmentAction,
  updateBasicInfoAction,
  updateContractAction,
  updateLoginStaffAction,
  updateOperationProfileAction,
  updateReminderSettingAction,
} from "../actions";
import { PageContainer } from "@/components/PageContainer";

type ScheduleRuleRow = Database["public"]["Tables"]["posting_schedule_rules"]["Row"];

const NTH_ROW_COUNT = 4;

const SECTION_TITLES: Record<string, string> = {
  basic: "基本情報",
  contract: "契約情報",
  assignment: "主担当・副担当",
  loginStaff: "ログイン者",
  profile: "制作方針",
  schedule: "投稿スケジュール",
  links: "SNS・各種リンク",
  credentials: "ログインID・パスワード保管先",
  reminder: "通知・催促設定",
};

export default async function ClientEditPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string; error?: string; section?: string }>;
}) {
  const { id } = await params;
  const { saved, error, section } = await searchParams;

  const staff = await getCurrentStaff();
  const supabase = await createSupabaseServerClient();
  const [detail, staffOptions, loginStaffCandidates, currentLoginStaff] = await Promise.all([
    getClientDetail(supabase, id),
    listActiveStaff(supabase),
    listLoginStaffCandidates(supabase, id),
    listClientLoginStaffForClient(supabase, id),
  ]);
  const currentLoginStaffIds = new Set(currentLoginStaff.map((s) => s.staffId));

  if (!detail.client) {
    notFound();
  }

  const client = detail.client;
  const financeVisible = staff ? canViewFinance(staff.role) : false;

  const primaryAssignment = detail.assignments.find(
    (a) => a.assignment_type === "primary" && a.active_to === null,
  );
  const secondaryAssignment = detail.assignments.find(
    (a) => a.assignment_type === "secondary" && a.active_to === null,
  );

  return (
    <PageContainer className="max-w-3xl gap-6 bg-neutral-50 py-8">
      <div>
        <Link href={`/clients/${id}`} className="text-sm text-neutral-500">
          ← 顧客詳細に戻る
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-neutral-900">
          顧客編集: {client.company_name}
        </h1>
      </div>

      {saved ? (
        <p className="rounded-2xl bg-[var(--accent-soft-bg)] px-4 py-2.5 text-sm text-[var(--accent-soft-text)]">
          {SECTION_TITLES[saved] ?? saved} を保存しました。
        </p>
      ) : null}
      {error ? (
        <p className="rounded-2xl bg-red-50 px-4 py-2.5 text-sm text-red-700">
          {SECTION_TITLES[section ?? ""] ?? ""} の保存に失敗しました: {error}
        </p>
      ) : null}

      {/* 基本情報 */}
      <Section title="基本情報">
        <form action={updateBasicInfoAction} className="flex flex-col gap-4">
          <input type="hidden" name="clientId" value={id} />
          <Field label="顧客名（会社名・屋号）" name="companyName" defaultValue={client.company_name} required />
          <Field label="店舗名" name="shopName" defaultValue={client.shop_name ?? ""} />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="電話番号" name="phone" defaultValue={client.phone ?? ""} />
            <Field label="メールアドレス" name="email" defaultValue={client.email ?? ""} />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="担当者名（先方）" name="contactName" defaultValue={client.contact_name ?? ""} />
            <SelectFieldWithFallback label="業種" name="industry" options={INDUSTRY_OPTIONS} value={client.industry} />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <SelectFieldWithFallback
              label="流入経路"
              name="inflowChannel"
              options={INFLOW_CHANNEL_OPTIONS}
              value={client.inflow_channel}
            />
            <SelectFieldWithFallback
              label="連絡手段"
              name="contactMethod"
              options={CONTACT_METHOD_OPTIONS}
              value={client.contact_method}
            />
          </div>

          <fieldset>
            <legend className="text-sm font-medium text-neutral-700">提供サービス（複数選択可）</legend>
            <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-3">
              {SERVICE_OPTIONS.map((service) => (
                <label key={service} className="flex items-center gap-1.5 text-sm text-neutral-700">
                  <input
                    type="checkbox"
                    name="services"
                    value={service}
                    defaultChecked={client.services.includes(service)}
                    className="h-4 w-4 rounded border-neutral-300"
                  />
                  {service}
                </label>
              ))}
            </div>
          </fieldset>

          <label className="text-sm font-medium text-neutral-700">
            備考
            <textarea
              name="notes"
              rows={3}
              defaultValue={client.notes ?? ""}
              className="mt-1.5 w-full rounded-xl border border-neutral-300 px-3.5 py-3 text-base"
            />
          </label>
          <SaveButton />
        </form>
      </Section>

      {/* 契約情報 */}
      <Section title="契約情報">
        <form action={updateContractAction} className="flex flex-col gap-4">
          <input type="hidden" name="clientId" value={id} />
          <label className="text-sm font-medium text-neutral-700">
            契約状況
            <select
              name="contractStatus"
              defaultValue={client.contract_status}
              className="mt-1.5 w-full rounded-xl border border-neutral-300 px-3.5 py-3 text-base"
            >
              {CONTRACT_STATUS_OPTIONS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field
              label="契約開始日"
              name="contractStartDate"
              type="date"
              defaultValue={client.contract_start_date ?? ""}
            />
            <Field
              label="契約終了日"
              name="contractEndDate"
              type="date"
              defaultValue={client.contract_end_date ?? ""}
            />
          </div>
          {financeVisible ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field
                label="売上"
                name="revenueAmount"
                type="number"
                defaultValue={client.revenue_amount?.toString() ?? ""}
              />
              <Field
                label="料金"
                name="feeAmount"
                type="number"
                defaultValue={client.fee_amount?.toString() ?? ""}
              />
            </div>
          ) : (
            <p className="text-xs text-neutral-500">
              料金・売上はパート権限では表示・編集できません。
            </p>
          )}
          <SaveButton />
        </form>
      </Section>

      {/* 主担当・副担当 */}
      <Section title="主担当・副担当">
        <div className="flex flex-col gap-6">
          <form action={updateAssignmentAction} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="clientId" value={id} />
            <input type="hidden" name="assignmentType" value="primary" />
            <label className="flex-1 text-sm font-medium text-neutral-700">
              {ASSIGNMENT_TYPE_LABELS.primary}
              <select
                name="staffId"
                defaultValue={primaryAssignment?.staff_id ?? ""}
                className="mt-1.5 w-full rounded-xl border border-neutral-300 px-3.5 py-3 text-base"
              >
                <option value="">未設定</option>
                {staffOptions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.last_name} {s.first_name}
                  </option>
                ))}
              </select>
            </label>
            <SaveButton />
          </form>

          <form action={updateAssignmentAction} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="clientId" value={id} />
            <input type="hidden" name="assignmentType" value="secondary" />
            <label className="flex-1 text-sm font-medium text-neutral-700">
              {ASSIGNMENT_TYPE_LABELS.secondary}
              <select
                name="staffId"
                defaultValue={secondaryAssignment?.staff_id ?? ""}
                className="mt-1.5 w-full rounded-xl border border-neutral-300 px-3.5 py-3 text-base"
              >
                <option value="">未設定</option>
                {staffOptions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.last_name} {s.first_name}
                  </option>
                ))}
              </select>
            </label>
            <SaveButton />
          </form>
        </div>
      </Section>

      {/* ログイン者 */}
      <Section title="ログイン者">
        <form action={updateLoginStaffAction} className="flex flex-col gap-4">
          <input type="hidden" name="clientId" value={id} />
          <p className="text-xs text-neutral-500">
            この顧客のSNS等アカウントへログインできるスタッフです。主担当・副担当とは別に、複数名を設定できます。
          </p>
          <fieldset>
            <legend className="sr-only">ログイン者</legend>
            <div className="grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-3">
              {loginStaffCandidates.map((candidate) => (
                <label
                  key={candidate.staffId}
                  className={`flex items-center gap-1.5 text-sm ${
                    candidate.isActive ? "text-neutral-700" : "text-neutral-400"
                  }`}
                >
                  <input
                    type="checkbox"
                    name="loginStaffIds"
                    value={candidate.staffId}
                    defaultChecked={currentLoginStaffIds.has(candidate.staffId)}
                    className="h-4 w-4 rounded border-neutral-300"
                  />
                  {candidate.name}
                  {!candidate.isActive ? "（無効）" : ""}
                </label>
              ))}
              {loginStaffCandidates.length === 0 ? (
                <p className="col-span-full text-sm text-neutral-400">選択可能なスタッフがいません。</p>
              ) : null}
            </div>
          </fieldset>
          <SaveButton />
        </form>
      </Section>

      {/* 制作方針 */}
      <Section title="制作方針">
        <form action={updateOperationProfileAction} className="flex flex-col gap-4">
          <input type="hidden" name="clientId" value={id} />
          <Field label="運用目的" name="purpose" defaultValue={detail.profile?.purpose ?? ""} />
          <Field
            label="ターゲット層"
            name="targetAudience"
            defaultValue={detail.profile?.target_audience ?? ""}
          />
          <Field
            label="コンテンツ方向性"
            name="contentDirection"
            defaultValue={detail.profile?.content_direction ?? ""}
          />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="トーン" name="tone" defaultValue={detail.profile?.tone ?? ""} />
            <Field
              label="CTA方針"
              name="ctaPolicy"
              defaultValue={detail.profile?.cta_policy ?? ""}
            />
          </div>
          <label className="text-sm font-medium text-neutral-700">
            NG事項
            <textarea
              name="ngNotes"
              rows={2}
              defaultValue={detail.profile?.ng_notes ?? ""}
              className="mt-1.5 w-full rounded-xl border border-neutral-300 px-3.5 py-3 text-base"
            />
          </label>
          <Field
            label="参考アカウント"
            name="referenceAccounts"
            defaultValue={detail.profile?.reference_accounts ?? ""}
          />
          <Field
            label="ハッシュタグ方針"
            name="hashtagPolicy"
            defaultValue={detail.profile?.hashtag_policy ?? ""}
          />
          <Field
            label="ヒアリングシートURL"
            name="hearingSheetUrl"
            defaultValue={detail.profile?.hearing_sheet_url ?? ""}
          />
          <SaveButton />
        </form>
      </Section>

      {/* 投稿スケジュール */}
      <Section title="投稿スケジュール">
        <div className="flex flex-col gap-6">
          <p className="text-xs text-neutral-500">
            投稿種別ごとに月間本数・曜日・各期限（投稿の◯日前）を設定します。保存すると、現在月+2か月先までの制作タスクが自動生成されます。
            すでに制作着手済み・Wチェック以降・素材待ち・手動で日付変更したタスクは変更されません。
          </p>
          {!primaryAssignment ? (
            <p className="rounded-2xl bg-amber-50 px-3.5 py-2.5 text-xs text-amber-800">
              ⚠ 主担当が未設定です。生成される制作タスクの担当者は「未割当」になります。
            </p>
          ) : null}
          {POST_TYPE_OPTIONS.map(([postType]) => {
            const rule = detail.scheduleRules.find(
              (r) => r.post_type === postType && r.is_active,
            );
            return (
              <div key={postType} className="flex flex-col gap-2">
                <ScheduleRuleForm clientId={id} postType={postType} rule={rule} />
                {rule ? (
                  <form action={deactivateScheduleRuleAction} className="self-end">
                    <input type="hidden" name="clientId" value={id} />
                    <input type="hidden" name="ruleId" value={rule.id} />
                    <button type="submit" className="text-xs text-red-600 underline">
                      このルールを無効化する
                    </button>
                  </form>
                ) : null}
              </div>
            );
          })}
        </div>
      </Section>

      {/* SNS・各種リンク（Drive/Canva/公式LINE含む） */}
      <Section title="SNS・各種リンク（Google Drive / Canva / 公式LINE含む）">
        <div className="flex flex-col gap-4">
          {detail.links.length > 0 ? (
            <ul className="flex flex-col gap-2">
              {detail.links.map((link) => (
                <li
                  key={link.id}
                  className="flex items-center justify-between gap-3 rounded-2xl border border-neutral-200 px-3.5 py-3 text-sm"
                >
                  <span className="truncate">
                    <strong>{link.label || link.link_type}</strong>: {link.url}
                  </span>
                  <form action={deleteClientLinkAction}>
                    <input type="hidden" name="clientId" value={id} />
                    <input type="hidden" name="linkId" value={link.id} />
                    <button type="submit" className="shrink-0 text-xs text-red-600 underline">
                      削除
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-neutral-400">登録済みのリンクはありません。</p>
          )}

          <form action={addClientLinkAction} className="flex flex-col gap-3 border-t border-neutral-100 pt-4">
            <input type="hidden" name="clientId" value={id} />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <label className="text-sm font-medium text-neutral-700">
                種別
                <select
                  name="linkType"
                  className="mt-1.5 w-full rounded-xl border border-neutral-300 px-3.5 py-3 text-base"
                >
                  {LINK_TYPE_OPTIONS.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <Field label="ラベル（任意）" name="label" />
            </div>
            <Field label="URL" name="url" required />
            <button
              type="submit"
              className="mt-1 w-full rounded-full border border-neutral-300 px-4 py-2.5 text-sm font-medium text-neutral-700"
            >
              リンクを追加
            </button>
          </form>
        </div>
      </Section>

      {/* ログインID・パスワード保管先 */}
      <Section title="ログインID・パスワード保管先">
        <div className="flex flex-col gap-4">
          <p className="rounded-2xl bg-amber-50 px-3.5 py-2.5 text-xs text-amber-800">
            SNSパスワードそのものはここに入力しないでください。1Password等の外部保管先URLのみ登録します。
          </p>
          {detail.credentials.length > 0 ? (
            <ul className="flex flex-col gap-2">
              {detail.credentials.map((credential) => (
                <li
                  key={credential.id}
                  className="flex items-center justify-between gap-3 rounded-2xl border border-neutral-200 px-3.5 py-3 text-sm"
                >
                  <span className="truncate">
                    <strong>{credential.service_name}</strong>
                    {credential.login_id ? ` / ID: ${credential.login_id}` : ""}
                    {credential.password_vault_url ? ` / 保管先あり` : ""}
                  </span>
                  <form action={deleteClientCredentialAction}>
                    <input type="hidden" name="clientId" value={id} />
                    <input type="hidden" name="credentialId" value={credential.id} />
                    <button type="submit" className="shrink-0 text-xs text-red-600 underline">
                      削除
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-neutral-400">登録済みのログイン情報はありません。</p>
          )}

          <form
            action={addClientCredentialAction}
            className="flex flex-col gap-3 border-t border-neutral-100 pt-4"
          >
            <input type="hidden" name="clientId" value={id} />
            <Field label="サービス名" name="serviceName" required />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="ログインID" name="loginId" />
              <Field label="パスワード保管先URL" name="passwordVaultUrl" />
            </div>
            <Field label="補足" name="notes" />
            <button
              type="submit"
              className="mt-1 w-full rounded-full border border-neutral-300 px-4 py-2.5 text-sm font-medium text-neutral-700"
            >
              追加
            </button>
          </form>
        </div>
      </Section>

      {/* 通知・催促設定 */}
      <Section title="通知・催促設定">
        <form action={updateReminderSettingAction} className="flex flex-col gap-3">
          <input type="hidden" name="clientId" value={id} />
          <label className="flex items-center gap-2 text-sm text-neutral-700">
            <input
              type="checkbox"
              name="materialReminderEnabled"
              defaultChecked={client.material_reminder_enabled}
              className="h-4 w-4"
            />
            素材待ちの自動催促対象にする（7日以上で注意、14日以上で催促対象）
          </label>
          <label className="flex items-center gap-2 text-sm text-neutral-700">
            <input
              type="checkbox"
              name="clientConfirmationReminderEnabled"
              defaultChecked={client.client_confirmation_reminder_enabled}
              className="h-4 w-4"
            />
            顧客確認待ちの自動催促対象にする（14日以上で催促対象）
          </label>
          <p className="text-xs text-neutral-500">
            通知先は主担当・副担当および管理者権限のスタッフです。個別の通知先指定は現時点では未対応です。
          </p>
          <SaveButton />
        </form>
      </Section>
    </PageContainer>
  );
}

function ScheduleRuleForm({
  clientId,
  postType,
  rule,
}: {
  clientId: string;
  postType: PostType;
  rule?: ScheduleRuleRow;
}) {
  const parsed = rule && isWeekdayRule(rule.weekday_rule) ? (rule.weekday_rule as WeekdayRule) : null;
  const mode = parsed?.mode ?? "weekly";
  const weeklySelected = new Set(mode === "weekly" && parsed && parsed.mode === "weekly" ? parsed.weekdays : []);
  const nthRows = mode === "nth_weekday" && parsed && parsed.mode === "nth_weekday" ? parsed.rules : [];

  return (
    <form
      action={saveScheduleRuleAction}
      className="flex flex-col gap-3 rounded-2xl border border-neutral-200 p-4 sm:p-5"
    >
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="postType" value={postType} />
      {rule ? <input type="hidden" name="ruleId" value={rule.id} /> : null}

      <h3 className="text-sm font-semibold text-neutral-800">{POST_TYPE_LABELS[postType]}</h3>

      <Field
        label="月間本数"
        name="monthlyTarget"
        type="number"
        min={0}
        max={99}
        required
        defaultValue={String(rule?.monthly_target ?? 4)}
      />

      <fieldset className="flex flex-col gap-2 rounded-2xl border border-neutral-100 p-3.5">
        <legend className="px-1 text-xs font-medium text-neutral-500">曜日ルール</legend>

        <label className="flex items-center gap-2 text-sm text-neutral-700">
          <input type="radio" name="weekdayMode" value="weekly" defaultChecked={mode === "weekly"} />
          毎週
        </label>
        <div className="ml-6 flex flex-wrap gap-3">
          {WEEKDAY_LABELS.map((label, weekday) => (
            <label key={weekday} className="flex items-center gap-1 text-sm text-neutral-700">
              <input
                type="checkbox"
                name="weeklyWeekday"
                value={weekday}
                defaultChecked={weeklySelected.has(weekday)}
              />
              {label}
            </label>
          ))}
        </div>

        <label className="flex items-center gap-2 text-sm text-neutral-700">
          <input
            type="radio"
            name="weekdayMode"
            value="nth_weekday"
            defaultChecked={mode === "nth_weekday"}
          />
          第◯曜日を指定（例: 第1・第3木曜日）
        </label>
        <div className="ml-6 flex flex-col gap-2">
          {Array.from({ length: NTH_ROW_COUNT }).map((_, i) => {
            const existing = nthRows[i];
            return (
              <div key={i} className="flex items-center gap-2 text-sm">
                <select
                  name={`nthRow${i}Nth`}
                  defaultValue={existing ? String(existing.nth) : ""}
                  className="rounded-md border border-neutral-300 px-3 py-2 text-sm"
                >
                  <option value="">未使用</option>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <option key={n} value={n}>
                      第{n}
                    </option>
                  ))}
                </select>
                <select
                  name={`nthRow${i}Weekday`}
                  defaultValue={existing ? String(existing.weekday) : ""}
                  className="rounded-md border border-neutral-300 px-3 py-2 text-sm"
                >
                  <option value="">曜日</option>
                  {WEEKDAY_LABELS.map((label, weekday) => (
                    <option key={weekday} value={weekday}>
                      {label}曜日
                    </option>
                  ))}
                </select>
              </div>
            );
          })}
        </div>
      </fieldset>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field
          label="制作開始: 投稿の◯日前"
          name="productionLeadDays"
          type="number"
          min={0}
          max={365}
          defaultValue={rule?.production_lead_days?.toString() ?? ""}
        />
        <Field
          label="Wチェック期限: 投稿の◯日前"
          name="wcheckLeadDays"
          type="number"
          min={0}
          max={365}
          defaultValue={rule?.wcheck_lead_days?.toString() ?? ""}
        />
        <Field
          label="顧客確認期限: 投稿の◯日前"
          name="clientConfirmLeadDays"
          type="number"
          min={0}
          max={365}
          defaultValue={rule?.client_confirm_lead_days?.toString() ?? ""}
        />
      </div>

      <Field
        label="適用開始日"
        name="validFrom"
        type="date"
        defaultValue={rule?.valid_from ?? new Date().toISOString().slice(0, 10)}
      />

      <SaveButton />
    </form>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-neutral-200 bg-white p-5 sm:p-6">
      <h2 className="mb-4 text-sm font-semibold text-neutral-700">{title}</h2>
      {children}
    </section>
  );
}

function SaveButton() {
  return (
    <button
      type="submit"
      className="mt-1 w-full rounded-full bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[var(--accent-strong)] sm:w-auto sm:px-6"
    >
      保存
    </button>
  );
}

/**
 * 業種/流入経路/連絡手段は自由入力からプルダウンへ変更するが、DB列は既存どおりtextのまま。
 * 過去の自由入力値が選択肢一覧に無い場合でも消えないよう、その値を選択肢へ追加して表示する。
 */
function SelectFieldWithFallback({
  label,
  name,
  options,
  value,
}: {
  label: string;
  name: string;
  options: readonly string[];
  value: string | null;
}) {
  const hasLegacyValue = !!value && !options.includes(value);
  return (
    <label className="text-sm font-medium text-neutral-700">
      {label}
      <select
        name={name}
        defaultValue={value ?? ""}
        className="mt-1.5 w-full rounded-xl border border-neutral-300 px-3.5 py-3 text-base"
      >
        <option value="">未選択</option>
        {hasLegacyValue ? (
          <option value={value ?? ""}>{value}（既存の入力）</option>
        ) : null}
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

function Field({
  label,
  name,
  type = "text",
  required = false,
  defaultValue,
  min,
  max,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  defaultValue?: string;
  min?: number;
  max?: number;
}) {
  return (
    <label className="text-sm font-medium text-neutral-700">
      {label}
      <input
        name={name}
        type={type}
        required={required}
        defaultValue={defaultValue}
        min={min}
        max={max}
        className="mt-1.5 w-full rounded-xl border border-neutral-300 px-3.5 py-3 text-base"
      />
    </label>
  );
}
