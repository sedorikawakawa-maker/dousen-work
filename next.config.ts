import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
