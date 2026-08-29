// NEXT_PUBLIC_ 環境変数はNext.jsのビルド時静的置換の対象になるようリテラルで
// 参照する必要がある（`process.env[name]` のような動的アクセスはブラウザ向け
// バンドルでは置換されず、実行時に必ず未定義になる。createSupabaseBrowserClient()
// をClient Componentから呼ぶ場合に特に注意）。

export function getSupabaseUrl(): string {
  const value = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!value) {
    throw new Error("Missing required environment variable: NEXT_PUBLIC_SUPABASE_URL");
  }
  return value;
}

// Supabaseの新しいキー命名（publishable key / secret key）に統一。
// 旧来の「anon key」に相当するクライアント公開用キー。
export function getSupabasePublishableKey(): string {
  const value = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!value) {
    throw new Error("Missing required environment variable: NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  }
  return value;
}
