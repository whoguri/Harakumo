import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";

export const metadata: Metadata = {
  title: "Harakumo Launchpad — provision infrastructure with the Harakumo SDK",
  description:
    "A developer dashboard that plans and provisions Harakumo databases, storage, vectors, memory and functions through the official SDK, with an approval-gated AI planner.",
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = { themeColor: "#0b0d11", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
