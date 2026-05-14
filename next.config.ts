import type { NextConfig } from "next";

const cosmographStyleModule = "./node_modules/@cosmograph/cosmograph/cosmograph/style.module.css.js";

const nextConfig: NextConfig = {
  output: "standalone",
  turbopack: {
    resolveAlias: {
      "@/cosmograph/style.module.css": cosmographStyleModule
    }
  },
  webpack(config) {
    config.resolve.alias = {
      ...(config.resolve.alias ?? {}),
      "@/cosmograph/style.module.css": cosmographStyleModule
    };

    return config;
  }
};

export default nextConfig;
