import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/*
 * The version reported by /api/v1/health. Read from package.json here so it
 * cannot drift from the release, and exposed as a build constant rather than
 * importing package.json into the route (which would pull the dependency list
 * into the bundle).
 */
const { version } = JSON.parse(fs.readFileSync(path.join(here, "package.json"), "utf8"));

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
  env: {
    APP_VERSION: version,
  },

  /*
   * The design system lives in a sibling directory and is consumed from source
   * through the `@ds` tsconfig path. Turbopack only resolves inside its root,
   * which defaults to this folder, so the root is lifted one level to cover it.
   */
  turbopack: {
    root: path.join(here, ".."),
  },

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
