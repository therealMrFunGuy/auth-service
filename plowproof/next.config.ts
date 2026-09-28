import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow photo/PDF route-sheet uploads through the AI import route.
  experimental: { serverActions: { bodySizeLimit: "10mb" } },
};

export default nextConfig;
