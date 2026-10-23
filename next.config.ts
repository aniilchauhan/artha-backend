import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  compress: true,
  poweredByHeader: false,
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },
  outputFileTracingExcludes: {
    '*': [
      './stock-ai/**/*',
      './data/**/*',
      './scratch/**/*',
    ],
  },
  experimental: {
    workerThreads: false,
    cpus: 1,
  },
  webpack(config) {
    for (const plugin of config.plugins ?? []) {
      if (plugin?.constructor?.name === 'TraceEntryPointsPlugin' && Array.isArray(plugin.traceIgnores)) {
        plugin.traceIgnores.push('**/stock-ai/**', '**/data/**', '**/scratch/**');
      }
    }
    return config;
  },
  async headers() {
    return [
      {
        source: "/api/:path*",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "*" },
          { key: "Access-Control-Allow-Methods", value: "GET,OPTIONS,PATCH,DELETE,POST,PUT" },
          { key: "Access-Control-Allow-Headers", value: "X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization" },
        ],
      },
    ];
  },
};

export default nextConfig;
