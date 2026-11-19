import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ["pg"],
  async redirects() {
    return [
      { source: "/sign-in", has: [{ type: "host", value: "queue.lgcyap.com" }], destination: "https://crm.lgcyap.com/queue-access", permanent: false },
      { source: "/sign-out", has: [{ type: "host", value: "queue.lgcyap.com" }], destination: "https://crm.lgcyap.com/sign-out", permanent: false },
      { source: "/apply/:path*", destination: "/v2/apply/:path*", permanent: false },
    ];
  },
  async rewrites() {
    // The unmodified source generates this callback URL for optional V2 Google setup.
    return {
      beforeFiles: [{ source: "/", has: [{ type: "host", value: "queue.lgcyap.com" }], destination: "/queue" }],
      afterFiles: [{ source: "/api/google/callback", destination: "/api/v2/google/callback" }],
      fallback: [],
    };
  },
  async headers() {
    const security = [
      { key: "Referrer-Policy", value: "no-referrer" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "X-Robots-Tag", value: "noindex, nofollow" },
      { key: "Content-Security-Policy", value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'" },
    ];
    const privatePage = [{ key: "Cache-Control", value: "private, no-store, max-age=0" }];
    return [
      { source: "/:path*", headers: security },
      ...["/queue", "/v2/app", "/ringcx", "/event-attendance"].map(source => ({ source, headers: [
        { key: "X-Frame-Options", value: "SAMEORIGIN" },
        { key: "Content-Security-Policy", value: "frame-ancestors 'self'; object-src 'none'; base-uri 'self'; form-action 'self'" },
      ] })),
      ...["/", "/queue", "/ringcx", "/event-attendance", "/v2/:path*", "/sign-in", "/sign-out", "/queue-access", "/api/:path*"].map(source => ({ source, headers: privatePage })),
    ];
  },
};

export default nextConfig;
