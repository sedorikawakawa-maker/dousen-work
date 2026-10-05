import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Phase2B: 請求書PDF生成(src/lib/billing/pdf)がfs.readFileSync(path.join(...))で
  // @embedpdf/fonts-jp配下のOTFを実行時読み込みするため、Next.jsのoutput file tracingが
  // 動的に構築したパスを静的解析で検出できない可能性がある。outputFileTracingIncludes
  // (Next.js 16ではexperimentalではなく安定版のトップレベル設定)で、どのルートの
  // server bundleにもNotoSansJP Regular/Boldの2ウェイトのみ（未使用5ウェイトは含めない）
  // を明示的に含める。まだ特定のルート/Server ActionからPDF生成を呼んでいないため
  // （Phase2C以降で接続予定）、ルートパターンは"/**"とし確実性を優先する。
  outputFileTracingIncludes: {
    "/**": [
      "./node_modules/@embedpdf/fonts-jp/fonts/NotoSansJP-Regular.otf",
      "./node_modules/@embedpdf/fonts-jp/fonts/NotoSansJP-Bold.otf",
    ],
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
