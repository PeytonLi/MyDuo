import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  turbopack: { root: process.cwd() },
  async headers() {
    return [{ source: "/meet-addon", headers: [{ key: "Content-Security-Policy", value: "frame-ancestors https://meet.google.com" }] }];
  },
};

export default nextConfig;
