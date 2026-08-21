"use client";

import { useActionState } from "react";
import { registerClientAction, type RegisterClientState } from "./actions";
import { CONTRACT_STATUS_OPTIONS } from "@/lib/clients/labels";

const initialState: RegisterClientState = { error: null };

interface StaffOption {
  id: string;
  last_name: string;
  first_name: string;
}

export function RegisterClientForm({ staffOptions }: { staffOptions: StaffOption[] }) {
  const [state, formAction, isPending] = useActionState(registerClientAction, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <Field label="顧客名（会社名・屋号）" name="companyName" required />
      <Field label="店舗名" name="shopName" />

      <div className="grid grid-cols-2 gap-4">
        <Field label="電話番号" name="phone" />
        <Field label="メールアドレス" name="email" type="email" />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Field label="担当者名（先方）" name="contactName" />
        <Field label="業種" name="industry" />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Field label="流入経路" name="inflowChannel" />
        <Field label="連絡手段" name="contactMethod" />
      </div>

      <label className="text-sm font-medium text-neutral-700">
        契約状況
        <select
          name="contractStatus"
          defaultValue="proposal"
          className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-base"
        >
          {CONTRACT_STATUS_OPTIONS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>

      <Field label="契約開始日" name="contractStartDate" type="date" />

      <label className="text-sm font-medium text-neutral-700">
        主担当
        <select
          name="primaryStaffId"
          defaultValue=""
          className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-base"
        >
          <option value="">未設定</option>
          {staffOptions.map((staff) => (
            <option key={staff.id} value={staff.id}>
              {staff.last_name} {staff.first_name}
            </option>
          ))}
        </select>
      </label>

      <label className="text-sm font-medium text-neutral-700">
        備考
        <textarea
          name="notes"
          rows={3}
          className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-base"
        />
      </label>

      {state.error ? (
        <p className="text-sm text-red-600" role="alert">
          {state.error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={isPending}
        className="mt-2 w-full rounded-md bg-neutral-900 px-4 py-2 text-base font-medium text-white disabled:opacity-50"
      >
        {isPending ? "登録中..." : "登録する"}
      </button>
    </form>
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
        className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-base"
      />
    </label>
  );
}
