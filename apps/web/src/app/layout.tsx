import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import type { ReactNode } from "react";
import "./globals.css";

/**
 * Plex rather than a neutral UI grotesque. This interface is an instrument —
 * every latency, price, and event id is a figure you compare against another —
 * so the mono is load-bearing rather than decorative, and the two faces are
 * designed as one family so mixing them mid-sentence does not jar.
 *
 * Self-hosted at build time by `next/font`, so there is no runtime CDN request.
 */
const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-sans",
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "StayFinder — multi-supplier hotel search",
    template: "%s · StayFinder",
  },
  description:
    "A miniature OTA: parallel supplier fan-out with per-supplier deadlines, progressive streaming, quote revalidation, and a payment-safe booking state machine.",
  icons: {
    // Inline so there is no binary asset to keep in sync with the palette.
    icon: [
      {
        url:
          "data:image/svg+xml," +
          encodeURIComponent(
            `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#1c2431"/><path d="M8 21V11m0 10h4m-4-5h8m0 5V11" stroke="#fff" stroke-width="2.5" fill="none" stroke-linecap="round"/><circle cx="23" cy="16" r="2.5" fill="#4a9ec4"/></svg>`,
          ),
        type: "image/svg+xml",
      },
    ],
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${plexSans.variable} ${plexMono.variable}`}>
      <body className="font-sans">
        <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-5 sm:px-8">
          <header className="flex items-center justify-between border-b border-line py-4">
            <a
              href="/"
              className="text-sm font-semibold tracking-tight hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              StayFinder
            </a>
            <span className="font-mono text-[11px] tracking-wide text-muted">
              supplier aggregation demo
            </span>
          </header>
          <main className="flex-1 py-10">{children}</main>
          <footer className="border-t border-line py-4 font-mono text-[11px] text-muted">
            seeded data · no real hotels · no real money
          </footer>
        </div>
      </body>
    </html>
  );
}
