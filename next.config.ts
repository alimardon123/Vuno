import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Type errors fail the build. They were suppressed while 40 of them existed;
  // that count is now zero and the flag stays off (CLAUDE.md, definition of done).
  reactStrictMode: true,
  // The dev-mode badge is fixed to the bottom-left, which is exactly where the
  // rail keeps the theme menu and your avatar.
  devIndicators: false,
};

export default nextConfig;
