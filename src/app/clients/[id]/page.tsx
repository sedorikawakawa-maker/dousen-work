import Link from "next/link";
import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getClientDetail, listActiveStaff } from "@/lib/clients/queries";
import {
  ASSIGNMENT_TYPE_LABELS,
  CLIENT_CURRENT_STATUS_LABELS,
  CONTRACT_STATUS_LABELS,
  LINK_TYPE_LABELS,
  POST_TYPE_LABELS,
} from "@/lib/clients/labels";

const TABS = [
  { key: "overview", label: "概要" },
  { key: "contract", label: "契約・担当" },
  { key: "profile", label: "制作方針" },
  { key: "schedule", label: "投稿スケジュール" },
  { key: "consumption", label: "運用・消化" },
  { key: "materials", label: "素材" },
  { key: "posts", label: "投稿履歴" },
  { key: "confirmations", label: "顧客確認履歴" },
  { key: "links", label: "SNS・リンク" },
  { key: "credentials", label: "ログイン情報" },
  { key: "history", label: "履歴" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

const NOT_YET_IMPLEMENTED: Partial<Record<TabKey, string>> = {
  consumption: "Phase 4（担当者ダッシュボード）以降で実装予定です。",
  materials: "Phase 5（素材）で実装予定です。",
  posts: "Phase 8（投稿実績）で実装予定です。",
  confirmations: "Phase 7（顧客確認）で実装予定です。",
};

export default async function ClientDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  const { tab } = await searchParams;
  const activeTab: TabKey = TABS.some((t) => t.key === tab) ? (tab as TabKey) : "overview";

  const supabase = await createSupabaseServerClient();
  const [detail, staffOptions] = await Promise.all([
    getClientDetail(supabase, id),
    listActiveStaff(supabase),
  ]);

  if (!detail.client) {
    notFound();
  }

  const client = detail.client;
  const staffNameById = new Map(
    staffOptions.map((s) => [s.id, `${s.last_name} ${s.first_name}`]),
  );

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-6 px-4 py-8">
      <div className="flex items-start justify-between">
        <div>
          <Link href="/clients" className="text-sm text-neutral-500">
            ← 顧客一覧に戻る
          </Link>
          <h1 className="mt-2 text-xl font-semibold text-neutral-900">
            {client.company_name}
            {client.shop_name ? `（${client.shop_name}）` : ""}
          </h1>
          <p className="text-sm text-neutral-500">{client.client_code}</p>
        </div>
        <Link
          href={`/clients/${id}/edit`}
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white"
        >
          編集
        </Link>
      </div>

      <nav className="flex flex-wrap gap-1 border-b border-neutral-200">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/clients/${id}?tab=${t.key}`}
            className={`rounded-t-md px-3 py-2 text-sm ${
              activeTab === t.key
                ? "border-b-2 border-neutral-900 font-medium text-neutral-900"
                : "text-neutral-500"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      <div className="rounded-lg border border-neutral-200 bg-white p-6">
        {NOT_YET_IMPLEMENTED[activeTab] ? (
          <p className="text-sm text-neutral-400">{NOT_YET_IMPLEMENTED[activeTab]}</p>
        ) : null}

        {activeTab === "overview" ? (
          <dl className="grid grid-cols-2 gap-4 text-sm">
            <InfoRow label="契約状況" value={CONTRACT_STATUS_LABELS[client.contract_status]} />
            <InfoRow
              label="現在ステータス"
              value={CLIENT_CURRENT_STATUS_LABELS[client.current_status]}
            />
            <InfoRow label="電話番号" value={client.phone ?? "—"} />
            <InfoRow label="メールアドレス" value={client.email ?? "—"} />
            <InfoRow label="先方担当者" value={client.contact_name ?? "—"} />
            <InfoRow label="業種" value={client.industry ?? "—"} />
            <InfoRow label="流入経路" value={client.inflow_channel ?? "—"} />
            <InfoRow label="連絡手段" value={client.contact_method ?? "—"} />
            <div className="col-span-2">
              <InfoRow label="備考" value={client.notes ?? "—"} />
            </div>
          </dl>
        ) : null}

        {activeTab === "contract" ? (
          <div className="flex flex-col gap-6">
            <dl className="grid grid-cols-2 gap-4 text-sm">
              <InfoRow label="契約状況" value={CONTRACT_STATUS_LABELS[client.contract_status]} />
              <InfoRow label="契約開始日" value={client.contract_start_date ?? "—"} />
              <InfoRow label="契約終了日" value={client.contract_end_date ?? "—"} />
              <InfoRow
                label="売上"
                value={client.revenue_amount === null ? "—" : String(client.revenue_amount)}
              />
              <InfoRow
                label="料金"
                value={client.fee_amount === null ? "—" : String(client.fee_amount)}
              />
            </dl>
            <div>
              <h3 className="mb-2 text-xs font-semibold text-neutral-500">担当履歴</h3>
              <ul className="flex flex-col gap-1 text-sm">
                {detail.assignments.map((a) => (
                  <li key={a.id}>
                    {ASSIGNMENT_TYPE_LABELS[a.assignment_type]}: {staffNameById.get(a.staff_id) ?? "不明なスタッフ"}
                    （{a.active_from} 〜 {a.active_to ?? "現在"}）
                  </li>
                ))}
                {detail.assignments.length === 0 ? (
                  <li className="text-neutral-400">担当履歴がありません</li>
                ) : null}
              </ul>
            </div>
          </div>
        ) : null}

        {activeTab === "profile" ? (
          detail.profile ? (
            <dl className="grid grid-cols-2 gap-4 text-sm">
              <InfoRow label="運用目的" value={detail.profile.purpose ?? "—"} />
              <InfoRow label="ターゲット層" value={detail.profile.target_audience ?? "—"} />
              <InfoRow label="コンテンツ方向性" value={detail.profile.content_direction ?? "—"} />
              <InfoRow label="トーン" value={detail.profile.tone ?? "—"} />
              <InfoRow label="CTA方針" value={detail.profile.cta_policy ?? "—"} />
              <InfoRow label="NG事項" value={detail.profile.ng_notes ?? "—"} />
              <InfoRow label="参考アカウント" value={detail.profile.reference_accounts ?? "—"} />
              <InfoRow label="ハッシュタグ方針" value={detail.profile.hashtag_policy ?? "—"} />
              <InfoRow label="ヒアリングシート" value={detail.profile.hearing_sheet_url ?? "—"} />
            </dl>
          ) : (
            <p className="text-sm text-neutral-400">制作方針は未登録です。</p>
          )
        ) : null}

        {activeTab === "schedule" ? (
          <ul className="flex flex-col gap-2 text-sm">
            {detail.scheduleRules.map((rule) => (
              <li key={rule.id} className="rounded-md border border-neutral-200 px-3 py-2">
                {POST_TYPE_LABELS[rule.post_type]} / 月{rule.monthly_target}本
                {rule.is_active ? "" : "（無効）"}
                <span className="ml-2 text-xs text-neutral-400">
                  {rule.valid_from} 〜 {rule.valid_to ?? "継続中"}
                </span>
              </li>
            ))}
            {detail.scheduleRules.length === 0 ? (
              <li className="text-neutral-400">投稿ルールが未登録です。</li>
            ) : null}
          </ul>
        ) : null}

        {activeTab === "links" ? (
          <ul className="flex flex-col gap-2 text-sm">
            {detail.links.map((link) => (
              <li key={link.id}>
                <strong>{link.label || LINK_TYPE_LABELS[link.link_type]}</strong>:{" "}
                <a href={link.url} target="_blank" rel="noreferrer" className="underline">
                  {link.url}
                </a>
              </li>
            ))}
            {detail.links.length === 0 ? (
              <li className="text-neutral-400">登録済みのリンクはありません。</li>
            ) : null}
          </ul>
        ) : null}

        {activeTab === "credentials" ? (
          <ul className="flex flex-col gap-2 text-sm">
            {detail.credentials.map((c) => (
              <li key={c.id}>
                <strong>{c.service_name}</strong>
                {c.login_id ? ` / ID: ${c.login_id}` : ""}
                {c.password_vault_url ? (
                  <>
                    {" / 保管先: "}
                    <a href={c.password_vault_url} target="_blank" rel="noreferrer" className="underline">
                      リンク
                    </a>
                  </>
                ) : (
                  " / 保管先: —"
                )}
              </li>
            ))}
            {detail.credentials.length === 0 ? (
              <li className="text-neutral-400">登録済みのログイン情報はありません。</li>
            ) : null}
          </ul>
        ) : null}

        {activeTab === "history" ? (
          <ul className="flex flex-col gap-2 text-sm">
            {detail.activityLogs.map((log) => (
              <li key={log.id} className="border-b border-neutral-100 pb-2">
                <span className="text-neutral-400">
                  {new Date(log.created_at).toLocaleString("ja-JP")}
                </span>{" "}
                {log.actor_staff_id ? staffNameById.get(log.actor_staff_id) ?? "不明なスタッフ" : "システム"}{" "}
                — {log.action}
              </li>
            ))}
            {detail.activityLogs.length === 0 ? (
              <li className="text-neutral-400">履歴はありません。</li>
            ) : null}
          </ul>
        ) : null}
      </div>
    </main>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-neutral-400">{label}</dt>
      <dd className="text-neutral-900">{value}</dd>
    </div>
  );
}
