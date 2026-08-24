import type { ReactElement } from "react";

/**
 * The shared visual mark rendered by every generated app-icon file (`icon.tsx`, `apple-icon.tsx`,
 * `icon-192/route.tsx`, `icon-512/route.tsx`) — one implementation of the icon glyph so the
 * favicon, the iOS home-screen icon, and the two PWA-manifest icon sizes can never drift into
 * four subtly different marks. Not a Next.js file-convention name itself (no special routing
 * behavior), just a plain co-located helper the convention files import.
 *
 * Deliberately NOT under `lib/domain/` — this returns JSX for `next/og`'s `ImageResponse`, so it's
 * a framework-dependent presentational helper, not the framework-free pure logic that directory is
 * reserved for (see AGENTS.md's Conventions).
 *
 * Treatment: a solid `--accent` (#1d4ed8) fill with a bold white "H" — the same blue Phase 8i's
 * token table already assigns to the wordmark's "Tracker" half and to every primary action in the
 * app, so the icon reads as visibly the same brand as the rest of the UI rather than inventing a
 * separate icon-only color. No border-radius is baked into the image itself: both Android's
 * (optional) "maskable" icon handling and iOS's home-screen icon masking apply their own shape on
 * top of a plain square/edge-to-edge source image — pre-rounding it here would double up with (or
 * fight) whichever mask the platform applies. `next/og`'s Satori-based renderer only supports a
 * constrained CSS subset (flexbox layout, no external fonts loaded here), which this deliberately
 * stays well within — a single centered glyph on a flat fill.
 */
export function renderIconMark(fontSize: number): ReactElement {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#1d4ed8",
        color: "#ffffff",
        fontSize,
        fontWeight: 700,
        fontFamily: "sans-serif",
      }}
    >
      H
    </div>
  );
}
