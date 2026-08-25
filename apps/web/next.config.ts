import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: {
    extensionAlias: { ".js": [".ts", ".tsx", ".js", ".jsx"] },
  },
};

export default nextConfig;
