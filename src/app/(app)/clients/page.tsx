import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  getClientAssignmentNames,
  getClientLoginStaffNames,
  listActiveStaff,
  listClients,
} from "@/lib/clients/queries";
import {
  CONTRACT_STATUS_LABELS,
  CONTRACT_STATUS_OPTIONS,
  CLIENT_CURRENT_STATUS_LABELS,
  CLIENT_CURRENT_STATUS_OPTIONS,
} from "@/lib/clients/labels";
import { CLIENT_STATUS_BORDER_ACCENT, CONTRACT_STATUS_CARD_BG } from "@/lib/clients/statusStyles";
import { getMaterialWaitElapsedDays, getMaterialWaitLevel } from "@/lib/reminders/material";
import { PageContainer } from "@/components/PageContainer";
import { StatusBadge } from "@/components/StatusBadge";
import { UrgencyBadge } from "@/components/UrgencyBadge";
import { ClientAvatar } from "@/components/ClientAvatar";

const MAX_VISIBLE_SERVICES = 2;
const MAX_VISIBLE_LOGIN_STAFF = 2;
import type { ClientCurrentStatus, ContractStatus } from "@/lib/supabase/database.types";

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    currentStatus?: string;
    contractStatus?: string;
    assigneeStaffId?: string;
    loginStaffId?: string;
  }>;
}) {
  const { q, currentStatus, contractStatus, assigneeStaffId, loginStaffId } = await searchParams;
  const supabase = await createSupabaseServerClient();

  const validCurrentStatus = CLIENT_CURRENT_STATUS_OPTIONS.some(([v]) => v === currentStatus)
    ? (currentStatus as ClientCurrentStatus)
    : undefined;
  const validContractStatus = CONTRACT_STATUS_OPTIONS.some(([v]) => v === contractStatus)
    ? (contractStatus as ContractStatus)
    : undefined;

  const [clients, staffOptions] = await Promise.all([
    listClients(supabase, {
      q,
      currentStatus: validCurrentStatus,
      contractStatus: validContractStatus,
      assigneeStaffId: assigneeStaffId || undefined,
      loginStaffId: loginStaffId || undefined,
    }),
    listActiveStaff(supabase),
  ]);

  const clientIds = clients.map((c) => c.id);
  const [assignmentByClientId, loginStaffNamesByClientId] = await Promise.all([
    getClientAssignmentNames(supabase, clientIds),
    getClientLoginStaffNames(supabase, clientIds),
  ]);

  const hasActiveFilter = Boolean(
    validCurrentStatus || validContractStatus || assigneeStaffId || loginStaffId,
  );

  return (
    <PageContainer variant="wide" className="gap-6 bg-neutral-50 py-8">
      <header className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-neutral-900">顧客一覧</h1>
        <Link
          href="/clients/new"
          className="whitespace-nowrap rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--accent-strong)]"
        >
          ＋ 顧客登録
        </Link>
      </header>

      <form method="get" className="flex flex-col gap-2">
        <div className="flex gap-2">
          <input
            type="text"
            name="q"
            defaultValue={q ?? ""}
            placeholder="顧客名・店舗名・顧客IDで検索"
            className="flex-1 rounded-full border border-neutral-300 px-4 py-2 text-base"
          />
          <button
            type="submit"
            className="rounded-full border border-neutral-300 bg-white px-4 py-2 text-sm text-neutral-700"
          >
            検索
          </button>
        </div>

        <div className="flex flex-wrap gap-2">
          <select
            name="currentStatus"
            defaultValue={validCurrentStatus ?? ""}
            aria-label="顧客の状態で絞り込み"
            className="min-w-[9.5rem] flex-1 rounded-full border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-700 sm:flex-none"
          >
            <option value="">状態: すべて</option>
            {CLIENT_CURRENT_STATUS_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>

          <select
            name="contractStatus"
            defaultValue={validContractStatus ?? ""}
            aria-label="契約ステータスで絞り込み"
            className="min-w-[9.5rem] flex-1 rounded-full border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-700 sm:flex-none"
          >
            <option value="">契約: すべて</option>
            {CONTRACT_STATUS_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>

          <select
            name="assigneeStaffId"
            defaultValue={assigneeStaffId ?? ""}
            aria-label="担当者で絞り込み"
            className="min-w-[9.5rem] flex-1 rounded-full border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-700 sm:flex-none"
          >
            <option value="">担当者: すべて</option>
            {staffOptions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.last_name} {s.first_name}
              </option>
            ))}
          </select>

          <select
            name="loginStaffId"
            defaultValue={loginStaffId ?? ""}
            aria-label="ログイン者で絞り込み"
            className="min-w-[9.5rem] flex-1 rounded-full border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-700 sm:flex-none"
          >
            <option value="">ログイン者: すべて</option>
            {staffOptions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.last_name} {s.first_name}
              </option>
            ))}
          </select>

          {hasActiveFilter ? (
            <Link
              href={q ? `/clients?q=${encodeURIComponent(q)}` : "/clients"}
              className="inline-flex items-center rounded-full px-3 py-1.5 text-sm text-neutral-500 underline"
            >
              絞り込みを解除
            </Link>
          ) : null}
        </div>
      </form>

      {clients.length === 0 ? (
        <p className="rounded-2xl border border-neutral-200 bg-white py-10 text-center text-sm text-neutral-400">
          該当する顧客がありません。検索・絞り込み条件を変えてお試しください。
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {clients.map((client) => {
            const assignment = assignmentByClientId.get(client.id);
            const loginStaffNames = loginStaffNamesByClientId.get(client.id) ?? [];
            const visibleLoginStaffNames = loginStaffNames.slice(0, MAX_VISIBLE_LOGIN_STAFF);
            const hiddenLoginStaffCount = loginStaffNames.length - visibleLoginStaffNames.length;
            const materialWaitDays =
              client.current_status === "material_waiting"
                ? getMaterialWaitElapsedDays(client.material_wait_started_at)
                : null;
            const materialWaitLevel =
              client.current_status === "material_waiting"
                ? getMaterialWaitLevel(client.material_wait_started_at)
                : "none";
            const cardTone = CONTRACT_STATUS_CARD_BG[client.contract_status];

            return (
              <Link
                key={client.id}
                href={`/clients/${client.id}`}
                className={`flex flex-col gap-2 rounded-2xl border border-l-4 p-3.5 hover:shadow-sm ${cardTone.bg} ${cardTone.border} ${CLIENT_STATUS_BORDER_ACCENT[client.current_status]}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-start gap-2">
                    <ClientAvatar thumbnailUrl={client.thumbnail_url} name={client.company_name} size="sm" />
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-neutral-900">
                        {client.company_name}
                        {client.shop_name ? `（${client.shop_name}）` : ""}
                      </p>
                      <p className="text-xs font-medium tabular-nums text-neutral-500">{client.client_code}</p>
                    </div>
                  </div>
                  <span className="shrink-0 text-neutral-400" aria-hidden="true">
                    ›
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  {materialWaitDays !== null && materialWaitLevel !== "none" ? (
                    <UrgencyBadge level={materialWaitLevel === "urgent" ? "urgent" : "warning"} />
                  ) : null}
                  <StatusBadge
                    status={client.current_status}
                    label={CLIENT_CURRENT_STATUS_LABELS[client.current_status]}
                  />
                  <StatusBadge
                    status={client.contract_status}
                    label={CONTRACT_STATUS_LABELS[client.contract_status]}
                  />
                </div>

                {client.services.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {client.services.slice(0, MAX_VISIBLE_SERVICES).map((service) => (
                      <span
                        key={service}
                        className="rounded-full bg-white/70 px-2 py-0.5 text-[11px] text-neutral-600"
                      >
                        {service}
                      </span>
                    ))}
                    {client.services.length > MAX_VISIBLE_SERVICES ? (
                      <span className="rounded-full bg-white/70 px-2 py-0.5 text-[11px] text-neutral-500">
                        +{client.services.length - MAX_VISIBLE_SERVICES}
                      </span>
                    ) : null}
                  </div>
                ) : null}

                <p className="text-xs text-neutral-500">
                  主担当: {assignment?.primaryName ?? "未設定"} ／ 副担当: {assignment?.secondaryName ?? "—"}
                </p>

                <p className="text-xs text-neutral-500">
                  ログイン者:{" "}
                  {loginStaffNames.length === 0 ? (
                    <span className="text-neutral-400">未設定</span>
                  ) : (
                    <>
                      {visibleLoginStaffNames.join(" / ")}
                      {hiddenLoginStaffCount > 0 ? ` +${hiddenLoginStaffCount}` : ""}
                    </>
                  )}
                </p>
              </Link>
            );
          })}
        </div>
      )}
    </PageContainer>
  );
}
