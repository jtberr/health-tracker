import { ImageResponse } from "next/og";
import { renderIconMark } from "../icon-mark";

/** Same as `icon-192/route.tsx`, at 512x512 — the second size a PWA manifest conventionally
 * carries (used for splash screens / higher-DPI install icons). Served at `/icon-512`. */
export const dynamic = "force-static";

export async function GET() {
  return new ImageResponse(renderIconMark(320), { width: 512, height: 512 });
}
