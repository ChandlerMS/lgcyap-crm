import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ["pg"],
  async redirects() {
    return [{ source: "/apply/:path*", destination: "/v2/apply/:path*", permanent: false }];
  },
  async rewrites() {
    // The unmodified source generates this callback URL for optional V2 Google setup.
    return [{ source: "/api/google/callback", destination: "/api/v2/google/callback" }];
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
      { source: "/v2/app", headers: [
        { key: "X-Frame-Options", value: "SAMEORIGIN" },
        { key: "Content-Security-Policy", value: "frame-ancestors 'self'; object-src 'none'; base-uri 'self'; form-action 'self'" },
      ] },
      ...["/", "/queue", "/v2/:path*", "/sign-in", "/sign-out", "/api/:path*"].map(source => ({ source, headers: privatePage })),
    ];
  },
};

export default nextConfig;
