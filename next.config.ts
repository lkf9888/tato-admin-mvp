import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingRoot: process.cwd(),
  // Required at runtime rather than bundled. These reach for sockets
  // and the filesystem, and bundling them buys nothing on a server
  // that has both.
  serverExternalPackages: ["imapflow", "mailparser", "@zone-eu/mailsplit"],
  experimental: {
    serverActions: {
      bodySizeLimit: "8mb",
    },
  },
};

export default nextConfig;
