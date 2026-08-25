/**
 * material_submission専用のGoogle Driveフォルダ名を組み立てる。
 * titleだけでは重複しうるため、submissionId（呼び出し側で事前生成したUUID）の
 * 先頭8文字を必ず付与し、同日・同タイトルでも別submissionなら別フォルダになるようにする。
 */
export function sanitizeSubmissionFolderName(title: string, submissionId: string): string {
  const collapsedWhitespace = title.trim().replace(/\s+/g, " ");
  const withoutIllegalChars = collapsedWhitespace.replace(/[\\/:*?"<>|]/g, "_");
  const truncated = withoutIllegalChars.slice(0, 60).trim();
  const safeTitle = truncated === "" ? "無題" : truncated;
  const shortId = submissionId.replace(/-/g, "").slice(0, 8);
  return `${safeTitle}_${shortId}`;
}
