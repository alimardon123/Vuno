import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const nextConfig: NextConfig = {
  // Required: .zscripts/build.sh looks for .next/standalone/server.js and will
  // rewrite this config if it is missing. `bun run start` runs that server
  // rather than `next start`, which does not work with a standalone build.
  output: "standalone",
  // Without this, a lockfile anywhere above the project can be picked as the
  // tracing root and the wrong files get bundled.
  outputFileTracingRoot: dirname(fileURLToPath(import.meta.url)),
  // Type errors fail the build. They were suppressed while 40 of them existed;
  // that count is now zero and the flag stays off (CLAUDE.md, definition of done).
  reactStrictMode: true,
  // The dev-mode badge is fixed to the bottom-left, which is exactly where the
  // rail keeps the theme menu and your avatar.
  devIndicators: false,
};

export default nextConfig;
