import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: ["@slideforge/db", "@slideforge/queue", "@slideforge/shared"],
  serverExternalPackages: ["pino", "bullmq", "ioredis"],
  webpack: (config, { isServer }) => {
    // The @kandiforge/pptx-renderer tries to import 'canvas' (Node.js only)
    // for EMF image rendering. We don't need EMF support in the browser.
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        canvas: false,
      };
    }
    return config;
  },
};

export default nextConfig;
