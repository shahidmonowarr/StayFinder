import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "StayFinder",
  description: "Multi-supplier hotel search and booking engine",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans">
        <div className="mx-auto flex min-h-screen max-w-4xl flex-col px-6">
          <header className="flex items-center justify-between border-b border-line py-5">
            <span className="text-sm font-semibold tracking-tight">StayFinder</span>
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
