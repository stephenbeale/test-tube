import type { NextConfig } from "next";

// Every page here is per-user and reads the database, so the app is rendered
// dynamically; the scaffold's cacheComponents/partial prefetching are left off.
const nextConfig: NextConfig = {
  serverExternalPackages: ["@libsql/client"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
