import "server-only";

import path from "node:path";
import { readFileSync } from "node:fs";
import * as fontkit from "fontkit";
import { Font } from "@react-pdf/renderer";

// 正式請求書PDF専用の日本語フォント（Noto Sans JP, SIL Open Font License 1.1）。
// @embedpdf/fonts-jp（npm依存）が同梱するフルセットOTFをそのまま使う。Webフォント用の
// unicode-range分割サブセットではなく、1ウェイト=1ファイルの完全なグリフセットのため、
// 会社名・住所・人名・摘要に任意の漢字（異体字・旧字体含む、JIS X 0208/0213準拠の範囲）が
// 入っても文字化け（豆腐文字）を起こさない。ブラウザへは一切配布しない
// （このモジュールはserver-onlyであり、Next.jsのクライアントバンドルには含まれない）。
// @embedpdf/fonts-jpのpackage.jsonはexportsマップで"."（dist/index.cjs）のみを公開しており、
// "./package.json"や"./fonts/*"はサブパスとして解決できない（Node標準のexports制限）。
// そのため、許可されているメインエントリ(".")をrequire.resolveで解決し、そこから
// パッケージルート（dist/の親）を導出してfontsディレクトリへ辿る
// （fs.readFileSync自体はexportsマップの制約を受けないため、パッケージルートが分かれば
// 問題なくファイルを読み込める。Windows/Linux双方でpath.join経由のネイティブセパレータに
// なるため、OS固有の絶対パスをハードコードしない）。
// パス解決はregisterInvoiceFonts()呼び出し時まで遅延させる（モジュール読み込み時には行わない）。
// Next.jsのビルド時ページデータ収集（next build）は、ルートから到達可能なモジュールを
// インポートして静的解析するだけでなく、トップレベルのコードも評価するため、モジュール読み込み
// 時点でrequire.resolve()を呼ぶと、バンドラーが提供する独自のrequire.resolve実装
// （実ファイルパスではなく内部モジュールIDのような値を返す場合がある）に当たってしまい
// ビルドが失敗することが判明した。実際のPDF生成（Node runtime実行時）まで解決を遅らせることで
// 常に本物のファイルシステムパスを得る。
function resolveFontPath(fileName: string): string {
  const mainEntryPath = require.resolve("@embedpdf/fonts-jp");
  const packageRoot = path.dirname(path.dirname(mainEntryPath));
  return path.join(packageRoot, "fonts", fileName);
}

export const INVOICE_FONT_FAMILY = "NotoSansJP";

let registered = false;
let cachedRegularFont: fontkit.Font | null = null;

/**
 * @react-pdf/rendererへフォントを登録する（プロセス内で1回のみ）。
 * フォントファイルが見つからない・読み込めない場合は、ここで明確に例外を投げる
 * （黙ってフォールバックのシステムフォントへ切り替えて文字化けPDFを生成しない）。
 */
export function registerInvoiceFonts(): void {
  if (registered) return;

  let regularPath: string;
  let boldPath: string;
  let regularBuffer: Buffer;
  let boldBuffer: Buffer;
  try {
    regularPath = resolveFontPath("NotoSansJP-Regular.otf");
    boldPath = resolveFontPath("NotoSansJP-Bold.otf");
    // 対象ファイルはnext.config.tsのoutputFileTracingIncludesで明示的にserver bundleへ
    // 含めているため、Turbopackの動的パス検出による「プロジェクト全体をトレース」という
    // 保守的なフォールバックは不要（turbopackIgnoreで抑制する）。
    regularBuffer = readFileSync(/* turbopackIgnore: true */ regularPath);
    boldBuffer = readFileSync(/* turbopackIgnore: true */ boldPath);
  } catch (err) {
    throw new Error(
      `請求書PDF用フォント（Noto Sans JP）の読み込みに失敗しました。@embedpdf/fonts-jpのインストール状態を確認してください: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  Font.register({
    family: INVOICE_FONT_FAMILY,
    fonts: [
      { src: regularPath, fontWeight: "normal" },
      { src: boldPath, fontWeight: "bold" },
    ],
  });

  cachedRegularFont = fontkit.create(regularBuffer) as fontkit.Font;
  // Boldも読み込めることだけ確認する（collection/create自体が壊れたファイルなら例外を投げる）。
  fontkit.create(boldBuffer);

  registered = true;
}

/**
 * 指定した文字列のすべての文字が、登録済みフォント（Regular）に存在するグリフを持つかを検証する。
 * 1文字でも存在しない場合は、該当文字を名指しして例外を投げる（正式請求書で豆腐文字や
 * フォールバックグリフを一切許容しないため）。改行・制御文字は対象外とする。
 */
export function assertTextRenderableWithInvoiceFont(text: string): void {
  if (!cachedRegularFont) {
    throw new Error("フォントが初期化されていません。registerInvoiceFonts()を先に呼び出してください。");
  }
  const missing = new Set<string>();
  for (const ch of Array.from(text)) {
    const codePoint = ch.codePointAt(0);
    if (codePoint === undefined) continue;
    // 改行・タブ・スペース等の制御/空白文字はグリフ存在チェックの対象外。
    if (codePoint <= 0x20) continue;
    if (!cachedRegularFont.hasGlyphForCodePoint(codePoint)) {
      missing.add(ch);
    }
  }
  if (missing.size > 0) {
    throw new Error(
      `請求書PDF用フォント（Noto Sans JP）に存在しない文字が含まれています: ${[...missing].join(", ")}`,
    );
  }
}
