import type { MetadataRoute } from "next";

/**
 * Next.js `manifest` file convention — Next serves this at `/manifest.webmanifest` and injects
 * `<link rel="manifest" href="/manifest.webmanifest">` into every page's `<head>` automatically;
 * no import/registration needed elsewhere. Phase 9, "PWA-lite shell" (design doc §8): a plain
 * static object, no logic, so there's nothing here worth a unit test beyond the type-checker
 * itself (`MetadataRoute.Manifest`) enforcing the shape.
 *
 * Deliberately scoped exactly to the design doc's "In" list — `display: 'standalone'`,
 * `start_url`, name/theme, and icons. NO service worker, NO offline caching, NO push/sync — those
 * are explicitly out of scope for v1 (see `ai-context/DECISIONS.md`'s "Persistent login... and
 * installable PWA-lite, online-only" entry) and nothing in this file or anywhere else in this
 * change registers one.
 *
 * `start_url: "/"` is still correct after Phase 8h retired the dashboard: `/` now redirects to
 * `/food` (or to `/login` if signed out), so launching the installed app from a home-screen icon
 * goes through the exact same auth gate/redirect chain a normal browser visit would.
 *
 * `theme_color`/`background_color` are the two hex values from `globals.css`'s `--ink`/`--canvas`
 * tokens (Phase 8i's "v2" palette) — `background_color` matches the app's actual `body` background
 * so there's no flash of an unrelated color on the PWA splash screen before the page paints, and
 * `theme_color` (the installed app's window/toolbar chrome color) uses the darker `--ink` for a
 * distinctly-branded title bar, the same ink Wordmark already uses for "Health". Both are read
 * from CSS custom properties only as plain literal hex strings here — `manifest.ts` runs entirely
 * server-side at build/request time, with no DOM/CSSOM to read a custom property's live value
 * from, so there is no way to import the `:root` values directly; if either token's hex value ever
 * changes in `globals.css`, these two literals need updating to match.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Health Tracker",
    short_name: "Health Tracker",
    description: "Track daily food intake, weight, and body fat with minimal effort.",
    start_url: "/",
    display: "standalone",
    background_color: "#f1f5f9",
    theme_color: "#0f172a",
    icons: [
      {
        src: "/icon-192",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/icon-512",
        sizes: "512x512",
        type: "image/png",
      },
    ],
  };
}
