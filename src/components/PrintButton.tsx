"use client";

/** ブラウザの印刷機能を使ってPDF化するための起動ボタン（印刷時は自分自身も非表示にする）。 */
export function PrintButton({ label = "PDF出力（印刷）" }: { label?: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="print:hidden rounded-full border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
    >
      {label}
    </button>
  );
}
