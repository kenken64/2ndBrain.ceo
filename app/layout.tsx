import type { Metadata, Viewport } from "next";
import { Manrope } from "next/font/google";
import { Suspense } from "react";
import { PageProgress } from "@/components/page-progress";
import "@xterm/xterm/css/xterm.css";
import "highlight.js/styles/github-dark.css";
import "./globals.css";

// Loaded once here so every page renders in the brand face; --font-sans reads this variable.
const manrope = Manrope({
  display: "swap",
  subsets: ["latin"],
  variable: "--font-manrope",
  weight: ["400", "500", "600", "700", "800"]
});

export const metadata: Metadata = {
  title: {
    default: "AI CUBER",
    template: "%s | AI CUBER"
  },
  description: "A warm AI workspace for turning scattered ideas into usable company systems.",
  icons: {
    icon: "/aicuber-icon.png",
    apple: "/aicuber-icon.png"
  }
};

export const viewport: Viewport = {
  initialScale: 1,
  themeColor: "#f5f8ff",
  width: "device-width"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html className={manrope.variable} lang="en">
      <body><Suspense fallback={null}><PageProgress /></Suspense>{children}</body>
    </html>
  );
}
