import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { DriveService, DriveFolderRef, DriveUploadResult } from "@/lib/drive/DriveService";
import { MockDriveService } from "@/lib/drive/DriveService";
import { generateAndStoreInvoiceDocumentPdf } from "./issueInvoiceDocument";
import type { InvoiceDocumentSnapshot } from "./snapshot";

function validSnapshot(): InvoiceDocumentSnapshot {
  return {
    issuer: {
      company_name: "株式会社ドウセン",
      postal_code: "100-0001",
      address: "東京都千代田区1-1-1",
      phone: "03-0000-0000",
      email: "info@example.com",
      invoice_registration_number: "T1234567890123",
      bank_name: "テスト銀行",
      branch_name: "テスト支店",
      account_type: "普通",
      account_number: "1234567",
      account_holder_name: "カ）ドウセン",
    },
    recipient: {
      company_name: "株式会社サンプル",
      department: null,
      contact_name: null,
      postal_code: "160-0001",
      address: "東京都新宿区1-1-1",
    },
    invoice: {
      invoice_number: "202610-0001",
      invoice_title: "10月分ご請求",
      issue_date: "2026-10-05",
      due_date: "2026-11-04",
      billing_month: "2026-10-01",
    },
    items: [
      {
        subject: "Instagram運用支援",
        description: null,
        quantity: 1,
        unit_price_ex_tax: 50000,
        tax_excluded_amount: 50000,
        tax_rate: 0.1,
        tax_category: "課税",
        revenue_month: "2026-10-01",
      },
    ],
  };
}

type RpcHandler = (args: Record<string, unknown>) => { data: unknown; error: { message: string } | null };

function createSupabaseStub(handlers: Record<string, RpcHandler>) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    calls.push({ name, args });
    const handler = handlers[name];
    if (!handler) throw new Error(`unexpected rpc call: ${name}`);
    return handler(args);
  });
  const client = { rpc } as unknown as SupabaseClient<Database>;
  return { client, calls };
}

function beginSuccess(snapshot: unknown = validSnapshot()) {
  return () => ({ data: { snapshot, invoice_id: "invoice-1", client_id: "client-1" }, error: null });
}

function createDriveServiceStub(overrides: Partial<DriveService> = {}): DriveService {
  const base: DriveService = {
    isMock: true,
    uploadFile: vi.fn(),
    resolveMaterialSubmissionFolder: vi.fn(),
    uploadFileToResolvedFolder: vi.fn(
      async (): Promise<DriveUploadResult> => ({ driveFileId: "drive-file-1", driveUrl: "https://drive.example/drive-file-1" }),
    ),
    resolveFolder: vi.fn(),
    resolveAccountingDocumentFolder: vi.fn(),
    resolveInvoiceDocumentFolder: vi.fn(
      async (): Promise<DriveFolderRef> => ({ folderId: "folder-1", folderUrl: "https://drive.example/folder-1" }),
    ),
    createResumableUploadSession: vi.fn(),
    deleteFile: vi.fn(async () => {}),
    getFileMetadata: vi.fn(),
  };
  return { ...base, ...overrides };
}

describe("generateAndStoreInvoiceDocumentPdf（正常系）", () => {
  it("PDF生成->Drive upload->complete の順で成功する", async () => {
    const { client, calls } = createSupabaseStub({
      begin_invoice_document_generation_attempt: beginSuccess(),
      complete_invoice_document_generation: (args) => {
        expect(args.p_drive_file_id).toBe("drive-file-1");
        expect(args.p_drive_url).toBe("https://drive.example/drive-file-1");
        return { data: null, error: null };
      },
    });
    const drive = createDriveServiceStub();

    const result = await generateAndStoreInvoiceDocumentPdf(client, drive, "doc-1");

    expect(result.error).toBeNull();
    expect(result.driveFileId).toBe("drive-file-1");
    expect(result.driveUrl).toBe("https://drive.example/drive-file-1");
    expect(drive.resolveInvoiceDocumentFolder).toHaveBeenCalledWith({ clientId: "client-1", year: "2026" });
    expect(drive.uploadFileToResolvedFolder).toHaveBeenCalledTimes(1);
    expect(calls.map((c) => c.name)).toEqual([
      "begin_invoice_document_generation_attempt",
      "complete_invoice_document_generation",
    ]);
  });

  it("実際のMockDriveServiceでも一連の流れが成功する（結合）", async () => {
    const { client } = createSupabaseStub({
      begin_invoice_document_generation_attempt: beginSuccess(),
      complete_invoice_document_generation: () => ({ data: null, error: null }),
    });
    const drive = new MockDriveService();

    const result = await generateAndStoreInvoiceDocumentPdf(client, drive, "doc-1");

    expect(result.error).toBeNull();
    expect(result.driveFileId).toBeTruthy();
    expect(decodeURIComponent(result.driveUrl ?? "")).toContain("202610-0001_株式会社サンプル_2026年10月請求書.pdf");
  });
});

describe("generateAndStoreInvoiceDocumentPdf（失敗系）", () => {
  it("begin RPCが失敗（既にgenerated等）した場合、PDF生成・Driveを一切呼ばずにエラーを返す", async () => {
    const { client, calls } = createSupabaseStub({
      begin_invoice_document_generation_attempt: () => ({
        data: null,
        error: { message: "この請求書は既にPDF生成済みです" },
      }),
    });
    const drive = createDriveServiceStub();

    const result = await generateAndStoreInvoiceDocumentPdf(client, drive, "doc-1");

    expect(result.error).toBe("この請求書は既にPDF生成済みです");
    expect(drive.resolveInvoiceDocumentFolder).not.toHaveBeenCalled();
    expect(drive.uploadFileToResolvedFolder).not.toHaveBeenCalled();
    expect(calls.map((c) => c.name)).toEqual(["begin_invoice_document_generation_attempt"]);
  });

  it("voided文書に対するbegin RPC拒否もPDF生成を行わずエラーを返す", async () => {
    const { client } = createSupabaseStub({
      begin_invoice_document_generation_attempt: () => ({
        data: null,
        error: { message: "取消済みの発行データはPDFを生成できません" },
      }),
    });
    const drive = createDriveServiceStub();

    const result = await generateAndStoreInvoiceDocumentPdf(client, drive, "doc-1");
    expect(result.error).toBe("取消済みの発行データはPDFを生成できません");
    expect(drive.uploadFileToResolvedFolder).not.toHaveBeenCalled();
  });

  it("PDF生成が失敗（フォント非対応文字）した場合、Driveを呼ばずgeneration_errorを記録する", async () => {
    const brokenSnapshot = validSnapshot();
    brokenSnapshot.recipient.company_name = "株式会社テスト😀";

    const { client, calls } = createSupabaseStub({
      begin_invoice_document_generation_attempt: beginSuccess(brokenSnapshot),
      mark_invoice_document_generation_failed: (args) => {
        expect(typeof args.p_error_message).toBe("string");
        expect(args.p_error_message as string).toContain("存在しない文字");
        return { data: null, error: null };
      },
    });
    const drive = createDriveServiceStub();

    const result = await generateAndStoreInvoiceDocumentPdf(client, drive, "doc-1");

    expect(result.error).toContain("存在しない文字");
    expect(drive.resolveInvoiceDocumentFolder).not.toHaveBeenCalled();
    expect(drive.uploadFileToResolvedFolder).not.toHaveBeenCalled();
    expect(calls.map((c) => c.name)).toEqual([
      "begin_invoice_document_generation_attempt",
      "mark_invoice_document_generation_failed",
    ]);
  });

  it("Drive uploadが失敗した場合、completeは呼ばずgeneration_errorを記録する（preparedにもgeneratedにもならない）", async () => {
    const { client, calls } = createSupabaseStub({
      begin_invoice_document_generation_attempt: beginSuccess(),
      mark_invoice_document_generation_failed: (args) => {
        expect(args.p_error_message).toBe("Drive upload failed (test)");
        return { data: null, error: null };
      },
    });
    const drive = createDriveServiceStub({
      uploadFileToResolvedFolder: vi.fn(async () => {
        throw new Error("Drive upload failed (test)");
      }),
    });

    const result = await generateAndStoreInvoiceDocumentPdf(client, drive, "doc-1");

    expect(result.error).toBe("Drive upload failed (test)");
    expect(calls.map((c) => c.name)).toEqual([
      "begin_invoice_document_generation_attempt",
      "mark_invoice_document_generation_failed",
    ]);
    expect(calls.some((c) => c.name === "complete_invoice_document_generation")).toBe(false);
  });

  it("DB complete RPCが失敗した場合、Driveファイルをbest-effort削除し、generation_errorを記録する", async () => {
    const { client, calls } = createSupabaseStub({
      begin_invoice_document_generation_attempt: beginSuccess(),
      complete_invoice_document_generation: () => ({ data: null, error: { message: "complete failed (test)" } }),
      mark_invoice_document_generation_failed: (args) => {
        expect(args.p_error_message).toBe("complete failed (test)");
        return { data: null, error: null };
      },
    });
    const drive = createDriveServiceStub();

    const result = await generateAndStoreInvoiceDocumentPdf(client, drive, "doc-1");

    expect(result.error).toBe("complete failed (test)");
    expect(drive.deleteFile).toHaveBeenCalledWith("drive-file-1");
    expect(calls.map((c) => c.name)).toEqual([
      "begin_invoice_document_generation_attempt",
      "complete_invoice_document_generation",
      "mark_invoice_document_generation_failed",
    ]);
  });

  it("DB complete RPC失敗 + Drive削除自体も失敗した場合、両方の内容をgeneration_errorへ残す", async () => {
    const { client } = createSupabaseStub({
      begin_invoice_document_generation_attempt: beginSuccess(),
      complete_invoice_document_generation: () => ({ data: null, error: { message: "complete failed (test)" } }),
      mark_invoice_document_generation_failed: (args) => {
        const message = args.p_error_message as string;
        expect(message).toContain("complete failed (test)");
        expect(message).toContain("削除にも失敗");
        return { data: null, error: null };
      },
    });
    const drive = createDriveServiceStub({
      deleteFile: vi.fn(async () => {
        throw new Error("delete also failed (test)");
      }),
    });

    const result = await generateAndStoreInvoiceDocumentPdf(client, drive, "doc-1");
    expect(result.error).toContain("complete failed (test)");
    expect(result.error).toContain("削除にも失敗");
  });
});

describe("generateAndStoreInvoiceDocumentPdf（retry）", () => {
  it("generation_errorがある状態からの再試行でも、同じsnapshot/同じinvoice_numberのまま成功する", async () => {
    const snapshot = validSnapshot();
    const { client, calls } = createSupabaseStub({
      begin_invoice_document_generation_attempt: beginSuccess(snapshot),
      complete_invoice_document_generation: (args) => {
        expect(args.p_invoice_document_id).toBe("doc-1");
        return { data: null, error: null };
      },
    });
    const drive = createDriveServiceStub();

    const result = await generateAndStoreInvoiceDocumentPdf(client, drive, "doc-1");

    expect(result.error).toBeNull();
    // begin RPC自体がDB側で「新しい番号を採番しない（同じissuing行をそのまま使う）」ことを保証する。
    // ここではオーケストレーション層が同じsnapshot(= 同じinvoice_number)をPDF生成に渡し、
    // 新たな発行開始RPC(begin_invoice_document_issue)を一切呼んでいないことを確認する。
    expect(calls.some((c) => c.name === "begin_invoice_document_issue")).toBe(false);
    expect(snapshot.invoice.invoice_number).toBe("202610-0001");
  });
});
