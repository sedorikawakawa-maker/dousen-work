import Link from "next/link";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentStaff } from "@/lib/auth/session";
import { canViewFinance } from "@/lib/auth/roles";
import { getClientDetail, listActiveStaff } from "@/lib/clients/queries";
import {
  ASSIGNMENT_TYPE_LABELS,
  CONTRACT_STATUS_OPTIONS,
  LINK_TYPE_OPTIONS,
  POST_TYPE_LABELS,
  POST_TYPE_OPTIONS,
} from "@/lib/clients/labels";
import {
  addClientCredentialAction,
  addClientLinkAction,
  addScheduleRuleAction,
  deactivateScheduleRuleAction,
  deleteClientCredentialAction,
  deleteClientLinkAction,
  updateAssignmentAction,
  updateBasicInfoAction,
  updateContractAction,
  updateOperationProfileAction,
  updateReminderSettingAction,
} from "../actions";

const SECTION_TITLES: Record<string, string> = {
  basic: "基本情報",
  contract: "契約情報",
  assignment: "主担当・副担当",
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
  const [detail, staffOptions] = await Promise.all([
    getClientDetail(supabase, id),
    listActiveStaff(supabase),
  ]);

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
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 px-4 py-8">
      <div>
        <Link href={`/clients/${id}`} className="text-sm text-neutral-500">
          ← 顧客詳細に戻る
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-neutral-900">
          顧客編集: {client.company_name}
        </h1>
      </div>

      {saved ? (
        <p className="rounded-md bg-green-50 px-4 py-2 text-sm text-green-700">
          {SECTION_TITLES[saved] ?? saved} を保存しました。
        </p>
      ) : null}
      {error ? (
        <p className="rounded-md bg-red-50 px-4 py-2 text-sm text-red-700">
          {SECTION_TITLES[section ?? ""] ?? ""} の保存に失敗しました: {error}
        </p>
      ) : null}

      {/* 基本情報 */}
      <Section title="基本情報">
        <form action={updateBasicInfoAction} className="flex flex-col gap-4">
          <input type="hidden" name="clientId" value={id} />
          <Field label="顧客名（会社名・屋号）" name="companyName" defaultValue={client.company_name} required />
          <Field label="店舗名" name="shopName" defaultValue={client.shop_name ?? ""} />
          <div className="grid grid-cols-2 gap-4">
            <Field label="電話番号" name="phone" defaultValue={client.phone ?? ""} />
            <Field label="メールアドレス" name="email" defaultValue={client.email ?? ""} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="担当者名（先方）" name="contactName" defaultValue={client.contact_name ?? ""} />
            <Field label="業種" name="industry" defaultValue={client.industry ?? ""} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="流入経路" name="inflowChannel" defaultValue={client.inflow_channel ?? ""} />
            <Field label="連絡手段" name="contactMethod" defaultValue={client.contact_method ?? ""} />
          </div>
          <label className="text-sm font-medium text-neutral-700">
            備考
            <textarea
              name="notes"
              rows={3}
              defaultValue={client.notes ?? ""}
              className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-base"
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
              className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-base"
            >
              {CONTRACT_STATUS_OPTIONS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-4">
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
            <div className="grid grid-cols-2 gap-4">
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
            <p className="text-xs text-neutral-400">
              料金・売上はパート権限では表示・編集できません。
            </p>
          )}
          <SaveButton />
        </form>
      </Section>

      {/* 主担当・副担当 */}
      <Section title="主担当・副担当">
        <div className="flex flex-col gap-6">
          <form action={updateAssignmentAction} className="flex items-end gap-3">
            <input type="hidden" name="clientId" value={id} />
            <input type="hidden" name="assignmentType" value="primary" />
            <label className="flex-1 text-sm font-medium text-neutral-700">
              {ASSIGNMENT_TYPE_LABELS.primary}
              <select
                name="staffId"
                defaultValue={primaryAssignment?.staff_id ?? ""}
                className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-base"
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

          <form action={updateAssignmentAction} className="flex items-end gap-3">
            <input type="hidden" name="clientId" value={id} />
            <input type="hidden" name="assignmentType" value="secondary" />
            <label className="flex-1 text-sm font-medium text-neutral-700">
              {ASSIGNMENT_TYPE_LABELS.secondary}
              <select
                name="staffId"
                defaultValue={secondaryAssignment?.staff_id ?? ""}
                className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-base"
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
          <div className="grid grid-cols-2 gap-4">
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
              className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-base"
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
        <div className="flex flex-col gap-4">
          {detail.scheduleRules.length > 0 ? (
            <ul className="flex flex-col gap-2">
              {detail.scheduleRules.map((rule) => (
                <li
                  key={rule.id}
                  className="flex items-center justify-between rounded-md border border-neutral-200 px-3 py-2 text-sm"
                >
                  <span>
                    {POST_TYPE_LABELS[rule.post_type]} / 月{rule.monthly_target}本
                    {rule.is_active ? "" : "（無効）"}
                  </span>
                  {rule.is_active ? (
                    <form action={deactivateScheduleRuleAction}>
                      <input type="hidden" name="clientId" value={id} />
                      <input type="hidden" name="ruleId" value={rule.id} />
                      <button type="submit" className="text-xs text-red-600 underline">
                        無効化
                      </button>
                    </form>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-neutral-400">投稿ルールが未登録です。</p>
          )}

          <form action={addScheduleRuleAction} className="flex flex-col gap-3 border-t border-neutral-100 pt-4">
            <input type="hidden" name="clientId" value={id} />
            <p className="text-xs text-neutral-500">
              ルールを登録すると、将来のPhaseで制作タスクの自動生成に利用されます（本Phaseではデータ登録のみ）。
            </p>
            <div className="grid grid-cols-2 gap-4">
              <label className="text-sm font-medium text-neutral-700">
                投稿種別
                <select
                  name="postType"
                  className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-base"
                >
                  {POST_TYPE_OPTIONS.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <Field label="月間目標本数" name="monthlyTarget" type="number" defaultValue="4" />
            </div>
            <label className="text-sm font-medium text-neutral-700">
              曜日ルール（JSON）
              <input
                name="weekdayRule"
                placeholder='{"mode":"weekly","weekdays":[2]}'
                className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 font-mono text-sm"
              />
            </label>
            <div className="grid grid-cols-3 gap-4">
              <Field label="制作リード日数" name="productionLeadDays" type="number" />
              <Field label="Wチェックリード日数" name="wcheckLeadDays" type="number" />
              <Field label="顧客確認リード日数" name="clientConfirmLeadDays" type="number" />
            </div>
            <Field
              label="適用開始日"
              name="validFrom"
              type="date"
              defaultValue={new Date().toISOString().slice(0, 10)}
            />
            <button
              type="submit"
              className="mt-1 w-full rounded-md border border-neutral-300 px-4 py-2 text-sm text-neutral-700"
            >
              ルールを追加
            </button>
          </form>
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
                  className="flex items-center justify-between gap-3 rounded-md border border-neutral-200 px-3 py-2 text-sm"
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
            <div className="grid grid-cols-2 gap-4">
              <label className="text-sm font-medium text-neutral-700">
                種別
                <select
                  name="linkType"
                  className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-base"
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
              className="mt-1 w-full rounded-md border border-neutral-300 px-4 py-2 text-sm text-neutral-700"
            >
              リンクを追加
            </button>
          </form>
        </div>
      </Section>

      {/* ログインID・パスワード保管先 */}
      <Section title="ログインID・パスワード保管先">
        <div className="flex flex-col gap-4">
          <p className="rounded-md bg-yellow-50 px-3 py-2 text-xs text-yellow-800">
            SNSパスワードそのものはここに入力しないでください。1Password等の外部保管先URLのみ登録します。
          </p>
          {detail.credentials.length > 0 ? (
            <ul className="flex flex-col gap-2">
              {detail.credentials.map((credential) => (
                <li
                  key={credential.id}
                  className="flex items-center justify-between gap-3 rounded-md border border-neutral-200 px-3 py-2 text-sm"
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
            <div className="grid grid-cols-2 gap-4">
              <Field label="ログインID" name="loginId" />
              <Field label="パスワード保管先URL" name="passwordVaultUrl" />
            </div>
            <Field label="補足" name="notes" />
            <button
              type="submit"
              className="mt-1 w-full rounded-md border border-neutral-300 px-4 py-2 text-sm text-neutral-700"
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
              name="reminderEnabled"
              defaultChecked={client.reminder_enabled}
              className="h-4 w-4"
            />
            素材待ち・顧客確認待ちの自動催促対象にする
          </label>
          <SaveButton />
        </form>
      </Section>
    </main>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-6">
      <h2 className="mb-4 text-sm font-semibold text-neutral-700">{title}</h2>
      {children}
    </section>
  );
}

function SaveButton() {
  return (
    <button
      type="submit"
      className="mt-1 w-full rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white"
    >
      保存
    </button>
  );
}

function Field({
  label,
  name,
  type = "text",
  required = false,
  defaultValue,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  defaultValue?: string;
}) {
  return (
    <label className="text-sm font-medium text-neutral-700">
      {label}
      <input
        name={name}
        type={type}
        required={required}
        defaultValue={defaultValue}
        className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-base"
      />
    </label>
  );
}
