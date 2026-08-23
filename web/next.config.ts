import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.T21_DISTDIR === "1" ? ".next-t21" : undefined,
  /* config options here */
};

export default nextConfig;
