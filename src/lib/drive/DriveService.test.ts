import { describe, expect, it } from "vitest";
import { MockDriveService } from "./DriveService";

describe("MockDriveService.resolveInvoiceDocumentFolder", () => {
  it("顧客フォルダ配下の「請求書/{year}」を解決する", async () => {
    const service = new MockDriveService();
    const folder = await service.resolveInvoiceDocumentFolder({ clientId: "client-1", year: "2026" });
    expect(folder.folderId).toContain("client-1");
    expect(folder.folderId).toContain("請求書");
    expect(folder.folderId).toContain("2026");
    expect(decodeURIComponent(folder.folderUrl)).toContain("請求書");
    expect(folder.folderUrl).toContain("2026");
  });

  it("同じclientId+yearなら毎回同じフォルダに解決される（決定的）", async () => {
    const service = new MockDriveService();
    const a = await service.resolveInvoiceDocumentFolder({ clientId: "client-1", year: "2026" });
    const b = await service.resolveInvoiceDocumentFolder({ clientId: "client-1", year: "2026" });
    expect(a.folderId).toBe(b.folderId);
  });

  it("年が異なれば異なるフォルダに解決される", async () => {
    const service = new MockDriveService();
    const y2026 = await service.resolveInvoiceDocumentFolder({ clientId: "client-1", year: "2026" });
    const y2027 = await service.resolveInvoiceDocumentFolder({ clientId: "client-1", year: "2027" });
    expect(y2026.folderId).not.toBe(y2027.folderId);
  });
});

describe("MockDriveService.uploadFileToResolvedFolder + resolveInvoiceDocumentFolder（結合）", () => {
  it("解決済みフォルダへアップロードしたファイル名がそのままURLへ反映される", async () => {
    const service = new MockDriveService();
    const folder = await service.resolveInvoiceDocumentFolder({ clientId: "client-1", year: "2026" });
    const file = new File([Buffer.from("dummy pdf bytes")], "202610-0001_株式会社サンプル_2026年10月請求書.pdf", {
      type: "application/pdf",
    });
    const result = await service.uploadFileToResolvedFolder({ file, folderId: folder.folderId });
    expect(result.driveFileId).toBeTruthy();
    expect(decodeURIComponent(result.driveUrl)).toContain("202610-0001_株式会社サンプル_2026年10月請求書.pdf");
    expect(result.driveUrl).toContain(folder.folderId);
  });
});
