import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveFontPath } from "./fonts";

describe("resolveFontPath（本番バンドル後も必ずstringの実ファイルパスを返すこと）", () => {
  it("stringを返す（numberやその他の型にならない）", () => {
    const result = resolveFontPath("NotoSansJP-Regular.otf");
    expect(typeof result).toBe("string");
  });

  it("src/assets/fonts/配下への固定相対パスを返す（process.cwd()基準）", () => {
    const result = resolveFontPath("NotoSansJP-Regular.otf");
    expect(result).toContain("assets");
    expect(result).toContain("fonts");
    expect(result.endsWith("NotoSansJP-Regular.otf")).toBe(true);
  });

  it("Regular実ファイルをfs.readFileSyncで読み込める", () => {
    expect(() => readFileSync(resolveFontPath("NotoSansJP-Regular.otf"))).not.toThrow();
  });

  it("Bold実ファイルをfs.readFileSyncで読み込める", () => {
    expect(() => readFileSync(resolveFontPath("NotoSansJP-Bold.otf"))).not.toThrow();
  });

  it("require.resolveを一切呼ばない（require.resolveが異常な値を返す状況でも影響を受けない回帰テスト）", () => {
    // 本番で実際に発生した不具合: バンドル済みランタイムのrequire.resolveがstringではなく
    // 内部モジュールID(number)を返し、path.dirname等に渡されてTypeErrorになった。
    // 新実装はrequire.resolveに一切依存しないため、require.resolveが壊れていても無関係に動く。
    const resolveSpy = vi.spyOn(require, "resolve").mockImplementation(() => {
      throw new Error("require.resolve should not be called by resolveFontPath");
    });
    try {
      expect(() => resolveFontPath("NotoSansJP-Regular.otf")).not.toThrow();
      expect(resolveSpy).not.toHaveBeenCalled();
    } finally {
      resolveSpy.mockRestore();
    }
  });
});

describe("registerInvoiceFonts（フォント読み込み失敗時の挙動）", () => {
  afterEach(() => {
    vi.doUnmock("node:fs");
    vi.resetModules();
  });

  it("require.resolveが異常な値(number)を返す状況でも、registerInvoiceFontsは影響を受けず成功する（本番で発生した不具合の回帰テスト）", async () => {
    vi.resetModules();
    const resolveSpy = vi.spyOn(require, "resolve").mockImplementation(() => {
      // Netlify本番のバンドル済みランタイムで実際に観測された挙動（stringの代わりにnumberを返す）を模す。
      return 94523 as unknown as string;
    });
    try {
      const { registerInvoiceFonts } = await import("./fonts");
      expect(() => registerInvoiceFonts()).not.toThrow();
      expect(resolveSpy).not.toHaveBeenCalled();
    } finally {
      resolveSpy.mockRestore();
    }
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
