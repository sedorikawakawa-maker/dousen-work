"use client";

import { CLIENT_CURRENT_STATUS_OPTIONS } from "@/lib/clients/labels";
import type { ClientCurrentStatus } from "@/lib/supabase/database.types";
import { updateClientStatusAction } from "./status-action";

export function StatusSelect({
  clientId,
  currentStatus,
}: {
  clientId: string;
  currentStatus: ClientCurrentStatus;
}) {
  return (
    <form action={updateClientStatusAction}>
      <input type="hidden" name="clientId" value={clientId} />
      <select
        name="currentStatus"
        defaultValue={currentStatus}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="rounded-md border border-neutral-300 px-2 py-1 text-sm"
      >
        {CLIENT_CURRENT_STATUS_OPTIONS.map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
    </form>
  );
}
