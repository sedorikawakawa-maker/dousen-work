import Link from "next/link";
import { requireAccountingAccess } from "@/lib/accounting/authGuard";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCompanyProfile, isCompanyProfileReadyForInvoiceIssue } from "@/lib/billing/companyProfile";
import { PageContainer } from "@/components/PageContainer";
import { SubmitButton } from "@/components/SubmitButton";
import { updateCompanyProfileAction } from "./actions";

export default async function AccountingSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  await requireAccountingAccess();
  const { saved, error } = await searchParams;

  const supabase = await createSupabaseServerClient();
  const profile = await getCompanyProfile(supabase);
  const ready = isCompanyProfileReadyForInvoiceIssue(profile);

  return (
    <PageContainer variant="narrow" className="gap-6 bg-neutral-50 py-6 sm:py-8">
      <div>
        <Link href="/accounting/invoices" className="text-sm text-neutral-500">
          ← 請求書に戻る
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-neutral-900">自社請求情報設定</h1>
        <p className="mt-1 text-xs text-neutral-500">
          正式請求書PDFに記載する発行者情報です。すべて設定されるまで請求書は発行できません。
        </p>
      </div>

      {!ready ? (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
          一部の項目が未設定です。すべて入力して保存してください。
        </p>
      ) : null}
      {saved ? <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">保存しました。</p> : null}
      {error ? <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}

      <form action={updateCompanyProfileAction} className="flex flex-col gap-4 rounded-2xl border border-neutral-200 bg-white p-5">
        <Field label="会社名" name="companyName" defaultValue={profile?.company_name} required />
        <Field label="郵便番号" name="postalCode" defaultValue={profile?.postal_code} required placeholder="100-0001" />
        <Field label="住所" name="address" defaultValue={profile?.address} required />
        <Field label="電話番号" name="phone" defaultValue={profile?.phone} required />
        <Field label="メールアドレス" name="email" defaultValue={profile?.email} required type="email" />
        <Field label="インボイス登録番号" name="invoiceRegistrationNumber" defaultValue={profile?.invoice_registration_number} required placeholder="T1234567890123" />
        <Field label="銀行名" name="bankName" defaultValue={profile?.bank_name} required />
        <Field label="支店名" name="branchName" defaultValue={profile?.branch_name} required />
        <Field label="口座種別" name="accountType" defaultValue={profile?.account_type} required placeholder="普通" />
        <Field label="口座番号" name="accountNumber" defaultValue={profile?.account_number} required />
        <Field label="口座名義" name="accountHolderName" defaultValue={profile?.account_holder_name} required />
        <Field
          label="標準支払日数（顧客ごとの支払サイトが未設定の場合に使用）"
          name="defaultPaymentDueDays"
          defaultValue={profile?.default_payment_due_days?.toString()}
          type="number"
        />
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-neutral-700">備考</span>
          <textarea name="note" defaultValue={profile?.note ?? ""} rows={3} className="rounded-md border border-neutral-300 px-3 py-2 text-sm" />
        </label>

        <SubmitButton pendingText="保存中..." className="self-start rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white">
          保存する
        </SubmitButton>
      </form>
    </PageContainer>
  );
}

function Field({
  label,
  name,
  defaultValue,
  required,
  type = "text",
  placeholder,
}: {
  label: string;
  name: string;
  defaultValue?: string | null;
  required?: boolean;
  type?: string;
  placeholder?: string;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium text-neutral-700">
        {label}
        {required ? <span className="ml-1 text-red-500">*</span> : null}
      </span>
      <input
        name={name}
        type={type}
        defaultValue={defaultValue ?? ""}
        required={required}
        placeholder={placeholder}
        className="rounded-md border border-neutral-300 px-3 py-2 text-sm"
      />
    </label>
  );
}
