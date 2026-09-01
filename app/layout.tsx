import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { PRODUCT_NAME } from "@/lib/brand";
import { SITE_URL } from "@/lib/seo";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  // LP workstream, Phase 2: required so Next.js resolves the relative
  // og:image/twitter:image URLs emitted by app/opengraph-image.tsx and
  // app/twitter-image.tsx against the real production host. Without this,
  // `next build` warns it falls back to resolving them against
  // http://localhost:3000 -- which would ship broken image URLs in every
  // shared link. Confirmed by the build warning this phase's own change
  // triggered, not a hypothetical.
  metadataBase: new URL(SITE_URL),
  title: PRODUCT_NAME,
  description: "AI-assisted permitting for Canadian commercial and trade contractors.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
