import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Dev-only: allows this dev server's assets/HMR/RSC payloads to load when accessed from
  // another device on the LAN (e.g. testing the camera-scan barcode flow from a phone, which
  // needs a real rear camera a laptop webcam doesn't have) instead of only localhost. Next.js
  // blocks cross-origin dev requests by default for safety; without this, the page's HTML loads
  // but client-side JS/hydration silently never runs, which looks exactly like a stuck data
  // fetch even though the actual bug is upstream of any app code. Has no effect in production
  // builds (`next build`/`next start`) -- dev-server-only protection.
  allowedDevOrigins: ["192.168.1.58"],
};

export default nextConfig;
