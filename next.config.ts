import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ["pg"],
  async redirects() {
    return [
      { source: "/embed", has: [{ type: "host" as const, value: "queue.lgcyap.com" }], destination: "https://crm.lgcyap.com/queue-access?embedded=1", permanent: false },
      { source: "/sign-in", has: [{ type: "host" as const, value: "queue.lgcyap.com" }], destination: "https://crm.lgcyap.com/queue-access", permanent: false },
      { source: "/sign-out", has: [{ type: "host" as const, value: "queue.lgcyap.com" }], destination: "https://crm.lgcyap.com/sign-out", permanent: false },
      // leaderboard.lgcyap.com (office TVs) signs in through the CRM, like the Queue site.
      { source: "/sign-in", has: [{ type: "host" as const, value: "leaderboard.lgcyap.com" }], destination: "https://crm.lgcyap.com/leaderboard-access", permanent: false },
      { source: "/sign-out", has: [{ type: "host" as const, value: "leaderboard.lgcyap.com" }], destination: "https://crm.lgcyap.com/sign-out", permanent: false },
      { source: "/apply/:path*", destination: "/v2/apply/:path*", permanent: false },
    ];
  },
  async rewrites() {
    // The unmodified source generates this callback URL for optional V2 Google setup.
    return {
      beforeFiles: [
        { source: "/", has: [{ type: "host" as const, value: "queue.lgcyap.com" }], destination: "/queue" },
        { source: "/", has: [{ type: "host" as const, value: "leaderboard.lgcyap.com" }], destination: "/leaderboard-tv" },
      ],
      afterFiles: [{ source: "/api/google/callback", destination: "/api/v2/google/callback" }],
      fallback: [],
    };
  },
  async headers() {
    const security = [
      { key: "Referrer-Policy", value: "no-referrer" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Robots-Tag", value: "noindex, nofollow" },
      { key: "Content-Security-Policy", value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'" },
    ];
    const privatePage = [{ key: "Cache-Control", value: "private, no-store, max-age=0" }];
    return [
      { source: "/:path*", headers: security },
      { source: "/:path*", missing: [{ type: "host" as const, value: "queue.lgcyap.com" }], headers: [{ key: "X-Frame-Options", value: "DENY" }] },
      ...["/queue", "/queue-access", "/v2/app", "/ringcx", "/event-attendance"].map(source => ({ source, missing: [{ type: "host" as const, value: "queue.lgcyap.com" }], headers: [
        { key: "X-Frame-Options", value: "SAMEORIGIN" },
        { key: "Content-Security-Policy", value: "frame-ancestors 'self'; object-src 'none'; base-uri 'self'; form-action 'self'" },
      ] })),
      ...["/", "/queue"].map(source => ({ source, has: [{ type: "host" as const, value: "queue.lgcyap.com" }], headers: [
        { key: "Content-Security-Policy", value: "frame-ancestors 'self' https://crm.lgcyap.com; object-src 'none'; base-uri 'self'; form-action 'self'" },
      ] })),
      ...["/", "/queue", "/ringcx", "/event-attendance", "/v2/:path*", "/sign-in", "/sign-out", "/queue-access", "/leaderboard-access", "/leaderboard-tv", "/api/:path*"].map(source => ({ source, headers: privatePage })),
    ];
  },
};

export default nextConfig;
