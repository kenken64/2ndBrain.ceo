import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingIncludes: {
    "/*": [
      // pdfjs loads this dynamically when pdf-parse extracts text on the server.
      "./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs"
    ]
  },
  serverExternalPackages: ["pdf-parse"]
};

export default nextConfig;
