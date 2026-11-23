import type { NextConfig } from "next";

const basePath = process.env.GITHUB_PAGES === "true" ? "/demonica" : "";

const nextConfig: NextConfig = {
  output: "export",
  basePath,
  trailingSlash: true,
  images: { unoptimized: true },
  env: { NEXT_PUBLIC_BASE_PATH: basePath },
  reactCompiler: true,
};

export default nextConfig;
