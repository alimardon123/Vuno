import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Type errors fail the build. They were suppressed while 40 of them existed;
  // that count is now zero and the flag stays off (CLAUDE.md, definition of done).
  reactStrictMode: true,
};

export default nextConfig;
