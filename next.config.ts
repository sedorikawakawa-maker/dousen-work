import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 請求書PDF生成(src/lib/billing/pdf)がfs.readFileSync(path.join(process.cwd(), ...))で
  // src/assets/fonts/配下のNoto Sans JP OTF（Regular/Boldの2ウェイトのみ、未使用5ウェイトは
  // 含めない）を実行時読み込みする。outputFileTracingIncludes（Next.js 16では安定版の
  // トップレベル設定）で、どのルートのserver bundleにもこの2ファイルを明示的に含める
  // （本番(Netlify)のバンドル済みランタイムでの読み込み失敗を防ぐための明示的な保証。
  // 旧実装はnode_modules/@embedpdf/fonts-jp配下を参照していたが、フォント本体を
  // src/assets/fonts/へ固定配置したためそちらは不要になった）。
  outputFileTracingIncludes: {
    "/**": ["./src/assets/fonts/NotoSansJP-Regular.otf", "./src/assets/fonts/NotoSansJP-Bold.otf"],
  },
  experimental: {
    // SNS素材（画像・動画）を顧客向けフォーム/スタッフ登録からアップロードできるよう、
    // Server Actionsのデフォルト本文サイズ上限(1MB)を引き上げる（検証用の暫定値）。
    serverActions: {
      bodySizeLimit: "100mb",
    },
    // src/proxy.ts（旧middleware）はリクエストボディをメモリへバッファするため、
    // デフォルト10MBまでしか読めず大きい動画アップロードで本文が途中で切れる
    // （"Unexpected end of form"）。serverActions.bodySizeLimitとは別の設定値なので
    // 両方を引き上げる（検証用の暫定値。本番Netlifyでの上限を保証するものではない）。
    // 旧名 experimental.middlewareClientMaxBodySize はdeprecatedのため使わない。
    proxyClientMaxBodySize: "100mb",
  },
};

export default nextConfig;
