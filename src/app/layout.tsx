import type { Metadata } from "next";
import { Geist_Mono, Inter } from "next/font/google";
import "./globals.css";

// Phase 8i (2026-08-09/10, "Visual identity v2"): Fraunces is removed entirely (the registration,
// the --font-fraunces variable, and every font-serif class in src/) and Geist Sans is swapped for
// Inter as the sole body/UI/heading face -- Jeff's resolution of the design doc's one open
// question, per ai-context/DECISIONS.md's Phase 8i entry: "one import and one CSS variable ...
// zero component changes, because everything already resolves through --font-sans." Geist Mono is
// unaffected -- nothing about the code/mono face needed to change.
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Health Tracker",
  description: "Track daily food intake, weight, and body fat with minimal effort.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
