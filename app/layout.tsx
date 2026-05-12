import type { Metadata, Viewport } from "next";
import "@xyflow/react/dist/style.css";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "2ndBrain.ceo",
    template: "%s | 2ndBrain.ceo"
  },
  description: "A warm AI workspace for turning scattered ideas into usable company systems.",
  icons: {
    icon: "/logo-app.png",
    apple: "/logo-app.png"
  }
};

export const viewport: Viewport = {
  initialScale: 1,
  themeColor: "#fcfbf8",
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
