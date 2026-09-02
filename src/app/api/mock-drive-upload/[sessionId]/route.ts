import { NextResponse, type NextRequest } from "next/server";

/**
 * MockDriveService専用の疑似resumable upload受け口。
 * Google Driveへ実接続していない開発環境でも、ブラウザ側のコードを本番と全く同じ
 * （sessionUrlへ直接PUTしてid/webViewLinkのJSONを受け取る）ままにするためのモック。
 * ファイル本体はどこにも永続化せず破棄する（既存MockDriveServiceと同じ方針）。
 * 本番では絶対に有効化しない。
 */
export async function PUT(request: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "not available" }, { status: 404 });
  }

  const name = request.nextUrl.searchParams.get("name") ?? "mock-file";
  // ファイル本体は保存せず読み捨てる。
  await request.arrayBuffer();

  const id = `mock-${crypto.randomUUID()}`;
  return NextResponse.json(
    {
      id,
      webViewLink: `https://drive.google.com/mock-storage/upload/${encodeURIComponent(name)}?id=${id}`,
    },
    { status: 200 },
  );
}
