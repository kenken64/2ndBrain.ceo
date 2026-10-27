import type { Metadata, Viewport } from "next";
import "@xterm/xterm/css/xterm.css";
import "highlight.js/styles/github-dark.css";
import "./globals.css";

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
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
