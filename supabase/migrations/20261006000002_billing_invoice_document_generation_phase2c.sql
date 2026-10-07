-- Phase 2C: 請求書PDF生成 -> Google Drive保存 -> invoice_documents.generated ->
-- invoices.status prepared の発行フローをDB側で安全につなぐ。
-- PDF生成・Drive保存自体はアプリ層(Node runtime)で行うため、DBとDriveを同一トランザクションに
-- はできない。そのため「DB issuing作成(Phase2A) -> PDF生成 -> Drive upload -> DB complete」の
-- 順を前提に、DB側の2つの境界（生成開始のロック取得／生成完了の確定）をそれぞれ1トランザクション
-- で安全に実行できるRPCを追加する。
--
-- 税額端数処理ルールはまだ未確定のため、本migrationはgenerated/preparedという
-- 「技術的な発行準備完了」までを表現するだけで、正式送付可否の判断には関与しない
-- （mark_invoice_sentは今回変更しない）。

-- ---------------------------------------------------------------------------
-- invoice_documents.generation_started_at: PDF生成処理の二重実行防止用の短命ロック。
-- 「PDF生成」操作が連打された場合でも、Drive上に同じ請求書PDFが複数生成されないようにする
-- （真の同時実行に対する最終防衛線はbegin_invoice_document_generation_attemptのFOR UPDATE）。
-- 5分以上更新が無い場合は失敗して放棄されたとみなし、再試行で上書きできるようにする。
-- ---------------------------------------------------------------------------

alter table public.invoice_documents
  add column generation_started_at timestamptz;

-- ---------------------------------------------------------------------------
-- RPC: begin_invoice_document_generation_attempt
-- PDF生成（外部I/O）を始める前に、DB側で「生成中」ロックを原子的に取得し、
-- 生成に必要なsnapshot/client_idを1回で返す。FOR UPDATEによる行ロックのため、
-- 真に同時に呼ばれても片方だけが成功する。
-- ---------------------------------------------------------------------------

create or replace function public.begin_invoice_document_generation_attempt(
  p_invoice_document_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_status text;
  v_voided_at timestamptz;
  v_generation_started_at timestamptz;
  v_snapshot jsonb;
  v_invoice_id uuid;
  v_client_id uuid;
begin
  if not public.can_view_finance() then
    raise exception 'この操作を行う権限がありません（請求・売上）';
  end if;
  if public.current_staff_id() is null then
    raise exception 'ログインが必要です';
  end if;

  select d.status, d.voided_at, d.generation_started_at, d.snapshot, d.invoice_id, i.client_id
  into v_status, v_voided_at, v_generation_started_at, v_snapshot, v_invoice_id, v_client_id
  from public.invoice_documents d
  join public.invoices i on i.id = d.invoice_id
  where d.id = p_invoice_document_id
  for update of d;

  if v_status is null then
    raise exception '対象の請求書（発行データ）が見つかりません';
  end if;
  if v_voided_at is not null then
    raise exception '取消済みの発行データはPDFを生成できません';
  end if;
  if v_status = 'generated' then
    raise exception 'この請求書は既にPDF生成済みです';
  end if;
  if v_status <> 'issuing' then
    raise exception '不正な状態のためPDFを生成できません';
  end if;
  if v_generation_started_at is not null and v_generation_started_at > now() - interval '5 minutes' then
    raise exception '別の生成処理が進行中の可能性があります。しばらく待ってから再試行してください';
  end if;

  update public.invoice_documents
    set generation_started_at = now()
    where id = p_invoice_document_id;

  return jsonb_build_object('snapshot', v_snapshot, 'invoice_id', v_invoice_id, 'client_id', v_client_id);
end;
$$;

revoke all on function public.begin_invoice_document_generation_attempt(uuid) from public;
revoke execute on function public.begin_invoice_document_generation_attempt(uuid) from anon;
grant execute on function public.begin_invoice_document_generation_attempt(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- RPC: complete_invoice_document_generation
-- PDF生成・Drive upload成功後、invoice_documentsをgeneratedへ、同一トランザクション内で
-- invoices.statusをplanned->preparedへ進める（片方だけ成功する状態を作らない）。
-- ---------------------------------------------------------------------------

create or replace function public.complete_invoice_document_generation(
  p_invoice_document_id uuid,
  p_drive_file_id text,
  p_drive_url text
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_staff_id uuid;
  v_status text;
  v_invoice_id uuid;
  v_invoice_status text;
begin
  if not public.can_view_finance() then
    raise exception 'この操作を行う権限がありません（請求・売上）';
  end if;
  v_staff_id := public.current_staff_id();
  if v_staff_id is null then
    raise exception 'ログインが必要です';
  end if;

  if p_drive_file_id is null or btrim(p_drive_file_id) = '' then
    raise exception 'drive_file_idを指定してください';
  end if;
  if p_drive_url is null or btrim(p_drive_url) = '' then
    raise exception 'drive_urlを指定してください';
  end if;

  select status, invoice_id into v_status, v_invoice_id
  from public.invoice_documents
  where id = p_invoice_document_id
  for update;

  if v_status is null then
    raise exception '対象の請求書（発行データ）が見つかりません';
  end if;
  if v_status <> 'issuing' then
    raise exception 'この発行データはissuing状態ではないため完了できません';
  end if;

  update public.invoice_documents
    set status = 'generated',
        drive_file_id = p_drive_file_id,
        drive_url = p_drive_url,
        generation_error = null,
        generation_started_at = null
    where id = p_invoice_document_id;

  -- invoiceが既にplanned以外（例: 既存の既知ギャップにより他経路でsentへ進められていた場合）は
  -- invoice側の更新をスキップする（invoices_enforce_status_transitionのsent凍結に抵触させず、
  -- invoice_documents側のgenerated確定は常に成立させる）。
  select status into v_invoice_status
  from public.invoices
  where id = v_invoice_id
  for update;

  if v_invoice_status = 'planned' then
    update public.invoices
      set status = 'prepared'
      where id = v_invoice_id;
  end if;
end;
$$;

revoke all on function public.complete_invoice_document_generation(uuid, text, text) from public;
revoke execute on function public.complete_invoice_document_generation(uuid, text, text) from anon;
grant execute on function public.complete_invoice_document_generation(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- RPC: mark_invoice_document_generation_failed
-- PDF生成またはDrive uploadが失敗した場合に、issuing状態のまま安全にgeneration_errorだけを
-- 更新する専用入口（汎用UPDATEは許可しない）。generation_started_atも解放し、
-- 待ち時間なしで再試行できるようにする。
-- ---------------------------------------------------------------------------

create or replace function public.mark_invoice_document_generation_failed(
  p_invoice_document_id uuid,
  p_error_message text
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_status text;
begin
  if not public.can_view_finance() then
    raise exception 'この操作を行う権限がありません（請求・売上）';
  end if;
  if public.current_staff_id() is null then
    raise exception 'ログインが必要です';
  end if;

  if p_error_message is null or btrim(p_error_message) = '' then
    raise exception 'エラー内容を指定してください';
  end if;

  select status into v_status
  from public.invoice_documents
  where id = p_invoice_document_id
  for update;

  if v_status is null then
    raise exception '対象の請求書（発行データ）が見つかりません';
  end if;
  if v_status <> 'issuing' then
    raise exception 'issuing状態以外のためgeneration_errorを更新できません';
  end if;

  update public.invoice_documents
    set generation_error = left(p_error_message, 1000),
        generation_started_at = null
    where id = p_invoice_document_id;
end;
$$;

revoke all on function public.mark_invoice_document_generation_failed(uuid, text) from public;
revoke execute on function public.mark_invoice_document_generation_failed(uuid, text) from anon;
grant execute on function public.mark_invoice_document_generation_failed(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- activity_logs連携: invoice_document_generated / invoice_document_generation_failed を追加。
-- 既存のinvoice_document_issued/voidedロジックは変更しない（CREATE OR REPLACEで
-- トリガー本体だけを差し替え、既存トリガー自体の再作成は不要）。
-- snapshot全文・Drive認証情報・PDF本文は記録しない（drive_file_id/drive_urlはIDとURLのみで
-- 機密情報ではないため記録する）。
-- ---------------------------------------------------------------------------

create or replace function public.log_invoice_documents_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.activity_logs (actor_staff_id, entity_type, entity_id, action, before_data, after_data)
    values (
      new.issued_by_staff_id, 'invoice_document', new.id, 'invoice_document_issued',
      null,
      jsonb_build_object(
        'invoice_id', new.invoice_id, 'invoice_number', new.invoice_number,
        'status', new.status, 'issue_date', new.issue_date, 'due_date', new.due_date
      )
    );
    return new;
  end if;

  if old.voided_at is null and new.voided_at is not null then
    insert into public.activity_logs (actor_staff_id, entity_type, entity_id, action, before_data, after_data)
    values (
      new.voided_by_staff_id, 'invoice_document', new.id, 'invoice_document_voided',
      jsonb_build_object('status', old.status),
      jsonb_build_object('status', new.status, 'void_reason', new.void_reason)
    );
    return new;
  end if;

  if old.status = 'issuing' and new.status = 'generated' then
    insert into public.activity_logs (actor_staff_id, entity_type, entity_id, action, before_data, after_data)
    values (
      public.current_staff_id(), 'invoice_document', new.id, 'invoice_document_generated',
      jsonb_build_object('status', old.status),
      jsonb_build_object('status', new.status, 'drive_file_id', new.drive_file_id, 'drive_url', new.drive_url)
    );
    return new;
  end if;

  if old.status = 'issuing' and new.status = 'issuing'
     and old.generation_error is distinct from new.generation_error
     and new.generation_error is not null then
    insert into public.activity_logs (actor_staff_id, entity_type, entity_id, action, before_data, after_data)
    values (
      public.current_staff_id(), 'invoice_document', new.id, 'invoice_document_generation_failed',
      null,
      jsonb_build_object('generation_error', new.generation_error)
    );
    return new;
  end if;

  return new;
end;
$$;
