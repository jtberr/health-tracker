import { ImageResponse } from "next/og";
import { renderIconMark } from "./icon-mark";

/**
 * Next.js `apple-icon` file convention — generates the
 * `<link rel="apple-touch-icon" href="/apple-icon?<hash>" ...>` tag automatically (the icon iOS
 * uses for "Add to Home Screen", independent of the web app manifest). Served at `/apple-icon`.
 * 180x180 is Apple's own documented recommended size (App Icon guidelines). Part of Phase 9.
 */
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(renderIconMark(112), size);
}
