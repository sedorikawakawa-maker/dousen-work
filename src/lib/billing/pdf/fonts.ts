import "server-only";

import path from "node:path";
import { readFileSync } from "node:fs";
import * as fontkit from "fontkit";
import { Font } from "@react-pdf/renderer";

// 正式請求書PDF専用の日本語フォント（Noto Sans JP, SIL Open Font License 1.1）。
// フォント本体（Regular/Boldの2ウェイトのみ）はsrc/assets/fonts/へこのリポジトリの一部として
// 固定配置している（node_modules配下のnpm依存パッケージからは読まない）。Webフォント用の
// unicode-range分割サブセットではなく、1ウェイト=1ファイルの完全なグリフセットのため、
// 会社名・住所・人名・摘要に任意の漢字（異体字・旧字体含む、JIS X 0208/0213準拠の範囲）が
// 入っても文字化け（豆腐文字）を起こさない。ブラウザへは一切配布しない
// （このモジュールはserver-onlyであり、Next.jsのクライアントバンドルには含まれない）。
// ライセンス全文はsrc/assets/fonts/NotoSansJP-LICENSE.txtに同梱している（OFL1.1の
// 「再配布時もライセンス全文を同梱する」要件を満たすため）。
//
// 過去の実装ではrequire.resolve("@embedpdf/fonts-jp")でnpmパッケージのインストール場所を
// 逆算していたが、Netlify本番のバンドル済みサーバーランタイムではrequire.resolve自体が
// Turbopack/webpack独自のシムに置き換わっており、実ファイルパスではなく内部モジュールID
// （数値）を返すことがあり、本番でのみ"The path argument must be of type string. Received
// type number"という実行時エラーを起こしていた（ローカルのNode直接実行やvitestでは
// require.resolveがNode本来の実装のまま動くため再現しなかった）。
// process.cwd() + 固定の相対パスというリテラルな文字列結合は、バンドラーのモジュール解決を
// 一切経由しないため、本番バンドル後でも常に本物のファイルシステムパス文字列を返す。
// テストで直接呼べるようexportする（require.resolveに依存せず常にstringを返すことの検証用）。
export function resolveFontPath(fileName: string): string {
  return path.join(process.cwd(), "src", "assets", "fonts", fileName);
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
      `請求書PDF用フォント（Noto Sans JP）の読み込みに失敗しました。src/assets/fonts/配下にNotoSansJP-Regular.otf/NotoSansJP-Bold.otfが存在するか確認してください: ${
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
