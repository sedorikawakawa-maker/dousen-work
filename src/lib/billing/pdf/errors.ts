import "server-only";

/**
 * PDF生成・Drive upload失敗時に、invoice_documents.generation_errorへ安全に保存できる
 * メッセージへ変換する純粋関数。スタックトレースは含めず、長さも制限する
 * （DBカラムへの保存・将来のUI表示を想定した安全な文字列）。
 */
export function toSafeGenerationErrorMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message.slice(0, 500);
}
