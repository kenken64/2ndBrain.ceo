import type { Metadata, Viewport } from "next";
import { Manrope } from "next/font/google";
import { Suspense } from "react";
import { cookies } from "next/headers";
import { LanguageProvider } from "@/components/language-provider";
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

export default async function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  const language = (await cookies()).get("aicuber_landing_locale")?.value === "zh" ? "zh" : "en";
  return (
    <html className={manrope.variable} lang={language === "zh" ? "zh-CN" : "en"}>
      <body><LanguageProvider initialLanguage={language}><Suspense fallback={null}><PageProgress /></Suspense>{children}</LanguageProvider></body>
    </html>
  );
}
