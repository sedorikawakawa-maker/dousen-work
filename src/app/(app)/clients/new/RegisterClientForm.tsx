"use client";

import { useActionState, type ReactNode } from "react";
import { registerClientAction, type RegisterClientState } from "./actions";
import {
  CONTRACT_STATUS_OPTIONS,
  SERVICE_OPTIONS,
  CONTACT_METHOD_OPTIONS,
  INFLOW_CHANNEL_OPTIONS,
  INDUSTRY_OPTIONS,
} from "@/lib/clients/labels";

const initialState: RegisterClientState = { error: null };

interface StaffOption {
  id: string;
  last_name: string;
  first_name: string;
}

export function RegisterClientForm({ staffOptions }: { staffOptions: StaffOption[] }) {
  const [state, formAction, isPending] = useActionState(registerClientAction, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <FormSection title="基本情報">
        <Field label="顧客名（会社名・屋号）" name="companyName" required />
        <Field label="店舗名" name="shopName" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="電話番号" name="phone" />
          <Field label="メールアドレス" name="email" type="email" />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="担当者名（先方）" name="contactName" />
          <SelectField label="業種" name="industry" options={INDUSTRY_OPTIONS} />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <SelectField label="流入経路" name="inflowChannel" options={INFLOW_CHANNEL_OPTIONS} />
          <SelectField label="連絡手段" name="contactMethod" options={CONTACT_METHOD_OPTIONS} />
        </div>

        <fieldset>
          <legend className="text-sm font-medium text-neutral-700">提供サービス（複数選択可）</legend>
          <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-3">
            {SERVICE_OPTIONS.map((service) => (
              <label key={service} className="flex items-center gap-1.5 text-sm text-neutral-700">
                <input type="checkbox" name="services" value={service} className="h-4 w-4 rounded border-neutral-300" />
                {service}
              </label>
            ))}
          </div>
        </fieldset>
      </FormSection>

      <FormSection title="契約・担当">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="text-sm font-medium text-neutral-700">
            契約状況
            <select
              name="contractStatus"
              defaultValue="proposal"
              className="mt-1.5 w-full rounded-xl border border-neutral-300 px-3.5 py-3 text-base"
            >
              {CONTRACT_STATUS_OPTIONS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <Field label="契約開始日" name="contractStartDate" type="date" />
        </div>

        <label className="text-sm font-medium text-neutral-700">
          主担当
          <select
            name="primaryStaffId"
            defaultValue=""
            className="mt-1.5 w-full rounded-xl border border-neutral-300 px-3.5 py-3 text-base"
          >
            <option value="">未設定</option>
            {staffOptions.map((staff) => (
              <option key={staff.id} value={staff.id}>
                {staff.last_name} {staff.first_name}
              </option>
            ))}
          </select>
        </label>

        <fieldset>
          <legend className="text-sm font-medium text-neutral-700">
            ログイン者（任意・複数選択可）
          </legend>
          <p className="mt-0.5 text-xs text-neutral-500">
            この顧客のSNS等アカウントへログインできるスタッフです。主担当・副担当とは別に設定します。
          </p>
          <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-3">
            {staffOptions.map((staff) => (
              <label key={staff.id} className="flex items-center gap-1.5 text-sm text-neutral-700">
                <input
                  type="checkbox"
                  name="loginStaffIds"
                  value={staff.id}
                  className="h-4 w-4 rounded border-neutral-300"
                />
                {staff.last_name} {staff.first_name}
              </label>
            ))}
          </div>
        </fieldset>
      </FormSection>

      <FormSection title="備考">
        <label className="text-sm font-medium text-neutral-700">
          自由記述
          <textarea
            name="notes"
            rows={3}
            className="mt-1.5 w-full rounded-xl border border-neutral-300 px-3.5 py-3 text-base"
          />
        </label>
      </FormSection>

      {state.error ? (
        <p className="rounded-2xl bg-red-50 px-4 py-2.5 text-sm text-red-700" role="alert">
          {state.error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={isPending}
        className="mt-1 w-full rounded-full bg-[var(--accent)] px-4 py-3.5 text-base font-semibold text-white hover:bg-[var(--accent-strong)] disabled:opacity-50"
      >
        {isPending ? "登録中..." : "登録する"}
      </button>
    </form>
  );
}

function FormSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-4 border-t border-neutral-100 pt-6 first:border-t-0 first:pt-0">
      <h2 className="text-sm font-semibold text-neutral-700">{title}</h2>
      {children}
    </div>
  );
}

function Field({
  label,
  name,
  type = "text",
  required = false,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
}) {
  return (
    <label className="text-sm font-medium text-neutral-700">
      {label}
      <input
        name={name}
        type={type}
        required={required}
        className="mt-1.5 w-full rounded-xl border border-neutral-300 px-3.5 py-3 text-base"
      />
    </label>
  );
}

function SelectField({
  label,
  name,
  options,
}: {
  label: string;
  name: string;
  options: readonly string[];
}) {
  return (
    <label className="text-sm font-medium text-neutral-700">
      {label}
      <select
        name={name}
        defaultValue=""
        className="mt-1.5 w-full rounded-xl border border-neutral-300 px-3.5 py-3 text-base"
      >
        <option value="">未選択</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}
