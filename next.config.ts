import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // The authenticated proxy buffers request bodies; leave room for 20 MiB uploads.
  experimental: { proxyClientMaxBodySize: 21 * 1024 * 1024 },
  outputFileTracingIncludes: {
    "/*": [
      // pdfjs loads this dynamically when pdf-parse extracts text on the server.
      "./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs"
    ]
  },
  serverExternalPackages: ["pdf-parse"]
};

export default nextConfig;
