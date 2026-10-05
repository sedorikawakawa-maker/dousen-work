import { afterEach, describe, expect, it, vi } from "vitest";

describe("registerInvoiceFonts（フォント読み込み失敗時の挙動）", () => {
  afterEach(() => {
    vi.doUnmock("node:fs");
    vi.resetModules();
  });

  it("フォントファイルの読み込みに失敗した場合、黙って続行せず明確な例外を投げる", async () => {
    vi.resetModules();
    vi.doMock("node:fs", async () => {
      const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
      return {
        ...actual,
        readFileSync: () => {
          throw new Error("ENOENT: no such file or directory (test double)");
        },
      };
    });

    const { registerInvoiceFonts } = await import("./fonts");
    expect(() => registerInvoiceFonts()).toThrowError(/フォント.*読み込みに失敗/);
  });
});

describe("assertTextRenderableWithInvoiceFont（フォントに存在しない文字の検出）", () => {
  afterEach(() => {
    vi.resetModules();
  });

  it("登録前に呼ぶと明確な例外を投げる（黙って通過しない）", async () => {
    vi.resetModules();
    const { assertTextRenderableWithInvoiceFont } = await import("./fonts");
    expect(() => assertTextRenderableWithInvoiceFont("テスト")).toThrowError(/初期化されていません/);
  });

  it("登録後、通常の日本語文字列は例外を投げない", async () => {
    vi.resetModules();
    const { registerInvoiceFonts, assertTextRenderableWithInvoiceFont } = await import("./fonts");
    registerInvoiceFonts();
    expect(() => assertTextRenderableWithInvoiceFont("株式会社髙橋﨑神﨑テスト 齋藤 渡邊 様")).not.toThrow();
  });

  it("フォントに存在しない文字（絵文字）を含む場合は例外を投げる", async () => {
    vi.resetModules();
    const { registerInvoiceFonts, assertTextRenderableWithInvoiceFont } = await import("./fonts");
    registerInvoiceFonts();
    expect(() => assertTextRenderableWithInvoiceFont("テスト😀")).toThrowError(/存在しない文字/);
  });
});
