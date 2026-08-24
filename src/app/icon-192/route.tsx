import { ImageResponse } from "next/og";
import { renderIconMark } from "../icon-mark";

/**
 * A plain Route Handler (this codebase's existing pattern for `/api/lookup/*`, reused here rather
 * than a custom URL-guessing scheme) serving a 192x192 PNG at `/icon-192` — the size the web app
 * manifest's `icons` array references for PWA installability (Chrome's installability criteria
 * wants an icon >= 192x192). Next's own `icon`/`apple-icon` file-convention routes only ever
 * generate ONE size each and are meant for the browser-tab/home-screen `<link>` tags in `<head>`,
 * not for the manifest's `icons` array — the manifest needs its own explicitly-sized, explicitly-
 * URLed entries, so this (and `icon-512/route.tsx`) exist purely to be linked from `manifest.ts`.
 */
// Nothing here reads the request, so this can be statically generated at build time (matching
// how the `icon.tsx`/`apple-icon.tsx` convention routes are optimized) rather than re-rendered on
// every request.
export const dynamic = "force-static";

export async function GET() {
  return new ImageResponse(renderIconMark(120), { width: 192, height: 192 });
}
