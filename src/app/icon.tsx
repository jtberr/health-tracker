import { ImageResponse } from "next/og";
import { renderIconMark } from "./icon-mark";

/**
 * Next.js `icon` file convention (docs: file-conventions/metadata/app-icons) — generates the
 * `<link rel="icon" href="/icon?<hash>" ...>` tag automatically; no import/registration needed
 * anywhere else. Served at `/icon`. Part of Phase 9's "PWA-lite shell" scope (design doc §8):
 * `icon.png`/`apple-icon.png` via the code-generation route, since this sandbox has no
 * image-editing tool to hand-author a static asset — see the developer's PROGRESS.md entry for
 * the full reasoning.
 */
export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(renderIconMark(20), size);
}
