import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

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
    <html lang="en">
      <body className="font-sans">
        <div className="mx-auto flex min-h-screen max-w-4xl flex-col px-6">
          <header className="flex items-center justify-between border-b border-line py-5">
            <a href="/" className="text-sm font-semibold tracking-tight hover:text-accent">
              StayFinder
            </a>
            <span className="text-xs text-muted">Supplier aggregation demo</span>
          </header>
          <main className="flex-1 py-16">{children}</main>
          <footer className="border-t border-line py-5 text-xs text-muted">
            Seeded demo data. No real hotels, no real money.
          </footer>
        </div>
      </body>
    </html>
  );
}
