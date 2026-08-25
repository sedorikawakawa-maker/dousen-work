import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // SNS素材（画像・動画）を顧客向けフォーム/スタッフ登録からアップロードできるよう、
    // Server Actionsのデフォルト本文サイズ上限(1MB)を引き上げる（検証用の暫定値）。
    serverActions: {
      bodySizeLimit: "100mb",
    },
  },
};

export default nextConfig;
