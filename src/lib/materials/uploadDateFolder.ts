import "server-only";

/**
 * 顧客向け素材アップロード・スタッフ素材登録のGoogle Drive保存先フォルダ名として使う、
 * 日本時間(Asia/Tokyo)での「実際にアップロードされた日」のYYYY-MM-DD文字列。
 * 投稿実績(final)・外注納品(outsourcing)のフォルダ構成には使わない。
 */
export function getMaterialUploadDateFolderName(date: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const lookup = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${lookup.year}-${lookup.month}-${lookup.day}`;
}
