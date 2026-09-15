/** @type {import('next').NextConfig} */

/*
 * PGLearn's authenticated routes. Listed here so the no-store header applies
 * from the edge, independently of the per-route segment config, and so the
 * list has one home shared with middleware's matcher (added at T01).
 */
const PLATFORM_PATHS = [
  "/login",
  "/forgot-password",
  "/set-password",
  "/invitations/:path*",
  "/learn/:path*",
  "/certificates/:path*",
  "/settings",
  "/manage/:path*",
  "/admin/:path*",
  "/api/v1/:path*",
];

const nextConfig = {
  async headers() {
    return [
      // spec/05: never cache an authenticated response across users.
      ...PLATFORM_PATHS.map((source) => ({
        source,
        headers: [
          { key: "Cache-Control", value: "private, no-store, max-age=0" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      })),
    ];
  },
};

export default nextConfig;
