import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The shared package ships TypeScript source rather than a build artifact,
  // so the workspaces stay linked without a compile step between edits.
  transpilePackages: ["@stayfinder/shared"],
  typedRoutes: true,
};

export default nextConfig;
