import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ["pg"],
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
      ...["/", "/sign-in", "/sign-out", "/api/:path*"].map(source => ({ source, headers: privatePage })),
    ];
  },
};

export default nextConfig;
